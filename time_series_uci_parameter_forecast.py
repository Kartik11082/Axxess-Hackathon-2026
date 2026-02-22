"""
TimesFM 2.5 - UCI Heart Disease Parameter Forecasting

This script creates pseudo time-series from `heart_disease.csv` and forecasts
the next period for a selected parameter (for example: thalach, chol, trestbps).

Run from the TimesFM environment:
    cd timesfm_repo
    uv run python3 ../time_series_uci_parameter_forecast.py --parameter thalach
"""

from __future__ import annotations

import argparse
import csv
import inspect
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import torch
import timesfm

_TIMESFM_MODEL: Any | None = None


def parse_float(value: str | None) -> float:
    if value is None:
        return float("nan")
    text = str(value).strip().lower()
    if text in ("", "?", "na", "nan", "null", "none"):
        return float("nan")
    try:
        return float(text)
    except ValueError:
        return float("nan")


def sanitize_signal(values: Iterable[float]) -> np.ndarray:
    arr = np.asarray(list(values), dtype=np.float32).reshape(-1)
    if arr.size == 0:
        raise ValueError("Series is empty.")
    finite = np.isfinite(arr)
    if not finite.any():
        raise ValueError("Series has no finite values.")
    if not finite.all():
        idx = np.arange(arr.size, dtype=np.int64)
        arr[~finite] = np.interp(idx[~finite], idx[finite], arr[finite]).astype(
            np.float32
        )
    return arr


def load_rows(csv_path: Path) -> list[dict[str, str]]:
    if not csv_path.exists():
        raise FileNotFoundError(f"CSV not found: {csv_path}")
    with csv_path.open("r", newline="", encoding="utf-8") as file:
        reader = csv.DictReader(file)
        rows = list(reader)
        if not reader.fieldnames:
            raise ValueError("CSV has no header row.")
    if not rows:
        raise ValueError("CSV has no data rows.")
    return rows


def sort_rows(rows: list[dict[str, str]], sort_by: str | None) -> list[dict[str, str]]:
    if sort_by is None:
        return rows
    if sort_by not in rows[0]:
        raise ValueError(f"`sort_by` column not found: {sort_by}")

    def sort_key(row: dict[str, str]) -> tuple[int, float]:
        value = parse_float(row.get(sort_by))
        if np.isnan(value):
            return (1, 0.0)
        return (0, value)

    return sorted(rows, key=sort_key)


def build_series(
    rows: list[dict[str, str]],
    parameter: str,
    split_by_disease: bool,
) -> tuple[list[str], list[np.ndarray]]:
    if parameter not in rows[0]:
        raise ValueError(f"`parameter` column not found: {parameter}")

    groups: dict[str, list[float]] = {}
    if split_by_disease:
        if "num" not in rows[0]:
            raise ValueError("CSV must contain `num` column for split-by-disease mode.")
        groups["No Disease (num=0)"] = []
        groups["Disease (num>0)"] = []
        for row in rows:
            num_value = parse_float(row.get("num"))
            if np.isnan(num_value):
                continue
            group_name = "No Disease (num=0)" if num_value == 0 else "Disease (num>0)"
            groups[group_name].append(parse_float(row.get(parameter)))
    else:
        groups["All Rows"] = [parse_float(row.get(parameter)) for row in rows]

    labels: list[str] = []
    series: list[np.ndarray] = []
    for label, values in groups.items():
        if len(values) == 0:
            continue
        labels.append(label)
        series.append(sanitize_signal(values))

    if not series:
        raise ValueError("No valid series could be created from this CSV/parameter.")
    return labels, series


def next_multiple(value: int, multiple: int) -> int:
    return int(np.ceil(value / multiple) * multiple)


def choose_context(
    inputs: list[np.ndarray],
    context_override: int | None = None,
    *,
    verbose: bool = True,
) -> int:
    min_input_len = min(len(x) for x in inputs)
    max_input_len = max(len(x) for x in inputs)
    if context_override is not None:
        dynamic_context = context_override
    else:
        # Choose context <= shortest input and multiple of patch size (32).
        # This avoids left-padding/all-masked leading patches that can cause
        # unstable numerics on uneven-length groups.
        dynamic_context = (min_input_len // 32) * 32
        if dynamic_context < 32:
            dynamic_context = 32
        dynamic_context = min(1024, dynamic_context)
    if verbose:
        print(
            f"  Context selection: min_len={min_input_len}, max_len={max_input_len}, "
            f"chosen_context={dynamic_context}"
        )
    return dynamic_context


def build_model_context_window(
    signal: np.ndarray, context: int
) -> tuple[np.ndarray, np.ndarray]:
    """Replicates TimesFM base preprocessing for one input up to model entry."""
    value = np.array(signal, dtype=np.float32)

    # strip_leading_nans equivalent
    isnan = np.isnan(value)
    if value.size == 0 or np.all(isnan):
        value = np.array([], dtype=np.float32)
    else:
        first_valid_index = int(np.argmax(~isnan))
        value = value[first_valid_index:]

    # linear_interpolation equivalent
    nans = np.isnan(value)
    if np.any(nans):
        x = np.arange(value.size, dtype=np.int64)
        non_nans_indices = x[~nans]
        non_nans_values = value[~nans]
        if non_nans_values.size > 0:
            value[nans] = np.interp(x[nans], non_nans_indices, non_nans_values)

    if value.size >= context:
        window = value[-context:]
        mask = np.zeros_like(window, dtype=bool)
    else:
        pad = context - value.size
        mask = np.array([True] * pad + [False] * value.size, dtype=bool)
        window = np.pad(value, (pad, 0), "constant", constant_values=0.0)

    return window.astype(np.float32), mask


class LegacyTimesFmAdapter:
    """
    Adapter for older `timesfm.TimesFm` API so the rest of this module can
    still call `compile(...)` + `forecast(horizon=..., inputs=...)`.
    """

    def __init__(self, model: Any):
        self._model = model

    def compile(self, _forecast_config: Any) -> None:
        # Older TimesFm API does not require compile per forecast config.
        return None

    def forecast(self, horizon: int, inputs: list[np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
        freq = [0] * len(inputs)

        try:
            point_forecast, quantile_forecast = self._model.forecast(inputs=inputs, freq=freq)
        except TypeError:
            # Some versions accept positional args.
            point_forecast, quantile_forecast = self._model.forecast(inputs, freq)

        point = np.asarray(point_forecast, dtype=np.float32)
        if point.ndim == 1:
            point = point.reshape(1, -1)
        point = point[:, :horizon]

        quant = np.asarray(quantile_forecast, dtype=np.float32)
        if quant.ndim == 1:
            quant = quant.reshape(1, -1, 1)
        elif quant.ndim == 2:
            quant = quant[:, :, None]

        quant = quant[:, :horizon, :]

        # Ensure at least [point, low, high] channels for downstream indexing.
        if quant.shape[-1] < 3:
            spread = np.maximum(np.abs(point) * 0.05, 1.0).astype(np.float32)
            low = point - spread
            high = point + spread
            quant = np.stack([point, low, high], axis=-1)

        return point, quant


def _construct_with_supported_kwargs(constructor: Any, kwargs: dict[str, Any]) -> Any:
    signature = inspect.signature(constructor)
    accepted = {key: value for key, value in kwargs.items() if key in signature.parameters}
    return constructor(**accepted)


def run_forecast_with_fallback(
    model: Any,
    inputs: list[np.ndarray],
    horizon: int,
    context_override: int | None = None,
    *,
    verbose: bool = True,
) -> tuple[np.ndarray, np.ndarray, str]:
    dynamic_context = choose_context(
        inputs, context_override=context_override, verbose=verbose
    )
    infer_positive = bool(all(np.min(x) >= 0 for x in inputs))

    if hasattr(timesfm, "ForecastConfig"):
        configs: list[tuple[str, Any]] = [
            (
                "primary",
                timesfm.ForecastConfig(
                    max_context=dynamic_context,
                    max_horizon=256,
                    normalize_inputs=True,
                    use_continuous_quantile_head=False,
                    force_flip_invariance=False,
                    infer_is_positive=infer_positive,
                    fix_quantile_crossing=True,
                ),
            ),
            (
                "fallback",
                timesfm.ForecastConfig(
                    max_context=dynamic_context,
                    max_horizon=256,
                    normalize_inputs=False,
                    use_continuous_quantile_head=False,
                    force_flip_invariance=False,
                    infer_is_positive=infer_positive,
                    fix_quantile_crossing=False,
                ),
            ),
        ]
    else:
        # Older TimesFm API path.
        configs = [("legacy", None)]

    last_error = "unknown"
    for config_name, forecast_config in configs:
        if verbose:
            if forecast_config is None:
                print(f"Running model ({config_name}) without compile-time forecast config")
            else:
                print(
                    f"Compiling model ({config_name}) with max_context={forecast_config.max_context}, "
                    f"normalize_inputs={forecast_config.normalize_inputs}, "
                    f"use_continuous_quantile_head={forecast_config.use_continuous_quantile_head}"
                )
        if forecast_config is not None:
            model.compile(forecast_config)
        point_forecast, quantile_forecast = model.forecast(
            horizon=horizon, inputs=inputs
        )
        if np.isfinite(point_forecast).all() and np.isfinite(quantile_forecast).all():
            return point_forecast, quantile_forecast, config_name
        last_error = f"{config_name} config returned non-finite outputs"
        if verbose:
            print(
                f"  Warning: {last_error}. "
                "Retrying with a more conservative config..."
            )

    raise RuntimeError(last_error)


def get_timesfm_model() -> Any:
    global _TIMESFM_MODEL
    if _TIMESFM_MODEL is not None:
        return _TIMESFM_MODEL

    torch.set_float32_matmul_precision("high")

    # Preferred 2.5 torch API (direct top-level attr).
    if hasattr(timesfm, "TimesFM_2p5_200M_torch"):
        _TIMESFM_MODEL = timesfm.TimesFM_2p5_200M_torch.from_pretrained(
            "google/timesfm-2.5-200m-pytorch",
            torch_compile=False,
        )
        return _TIMESFM_MODEL

    # 2.5 torch API may live in a submodule depending on package layout.
    try:
        from timesfm.timesfm_torch import TimesFM_2p5_200M_torch  # type: ignore

        _TIMESFM_MODEL = TimesFM_2p5_200M_torch.from_pretrained(
            "google/timesfm-2.5-200m-pytorch",
            torch_compile=False,
        )
        return _TIMESFM_MODEL
    except Exception:
        pass

    # Legacy `TimesFm` API fallback.
    if hasattr(timesfm, "TimesFm") and hasattr(timesfm, "TimesFmHparams") and hasattr(
        timesfm, "TimesFmCheckpoint"
    ):
        try:
            hparams = _construct_with_supported_kwargs(
                timesfm.TimesFmHparams,
                {
                    "backend": "cpu",
                    "per_core_batch_size": 32,
                    "horizon_len": 256,
                    "context_len": 1024,
                    "input_patch_len": 32,
                    "output_patch_len": 128,
                    "num_layers": 20,
                    "model_dims": 1280,
                    "use_positional_embedding": False,
                },
            )
            checkpoint = _construct_with_supported_kwargs(
                timesfm.TimesFmCheckpoint,
                {
                    "huggingface_repo_id": "google/timesfm-1.0-200m-pytorch",
                    "path": None,
                },
            )
            legacy_model = timesfm.TimesFm(hparams=hparams, checkpoint=checkpoint)
            _TIMESFM_MODEL = LegacyTimesFmAdapter(legacy_model)
            return _TIMESFM_MODEL
        except Exception as error:
            raise RuntimeError(
                "Legacy TimesFm API was detected but model initialization failed. "
                f"Underlying error: {error}"
            ) from error

    raise RuntimeError(
        "Unsupported timesfm package API. Missing both `TimesFM_2p5_200M_torch` and legacy "
        "`TimesFm` classes. Install a compatible build, e.g. `timesfm[torch]`."
    )


def forecast_signal(
    values: Iterable[float], horizon: int = 12, context: int | None = None
) -> dict[str, object]:
    """
    Forecast a single numeric signal with TimesFM.

    This helper is import-safe and reusable by a Flask API.
    """
    if horizon < 1 or horizon > 256:
        raise ValueError("`horizon` must be in [1, 256].")
    if context is not None and (context < 32 or context > 1024):
        raise ValueError("`context` must be in [32, 1024].")

    signal = sanitize_signal(values)
    model = get_timesfm_model()
    chosen_context = choose_context([signal], context_override=context, verbose=False)

    point_forecast, quantile_forecast, config_used = run_forecast_with_fallback(
        model=model,
        inputs=[signal],
        horizon=horizon,
        context_override=chosen_context,
        verbose=False,
    )

    point_values = point_forecast[0].astype(float).tolist()
    low_values = quantile_forecast[0, :, 1].astype(float).tolist()
    high_values = quantile_forecast[0, :, -1].astype(float).tolist()

    spread = float(np.mean(np.asarray(high_values) - np.asarray(low_values)))
    signal_std = float(np.std(signal))
    scale = max(signal_std * 3.0, 1.0)
    confidence = float(np.clip(1.0 - (spread / scale), 0.05, 0.99))

    return {
        "predicted_values": point_values,
        "low_quantile": low_values,
        "high_quantile": high_values,
        "confidence": round(confidence, 3),
        "model": "timesfm-2.5-200m",
        "config_used": config_used,
        "context": chosen_context,
    }


def predict_heart_rate(
    history: Iterable[float], horizon: int = 12, context: int | None = None
) -> dict[str, object]:
    """
    Convenience wrapper used by the Flask prediction API.
    """
    return forecast_signal(values=history, horizon=horizon, context=context)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Forecast UCI heart disease parameter with TimesFM."
    )
    parser.add_argument(
        "--csv",
        type=Path,
        default=Path(__file__).resolve().parent / "heart_disease.csv",
        help="Path to UCI heart_disease.csv",
    )
    parser.add_argument(
        "--parameter",
        type=str,
        default="thalach",
        help="Numeric column to forecast (e.g. thalach, chol, trestbps, oldpeak)",
    )
    parser.add_argument("--horizon", type=int, default=12, help="Forecast horizon")
    parser.add_argument(
        "--sort-by",
        type=str,
        default="age",
        help="Optional column to sort rows before creating pseudo-time-series (default: age)",
    )
    parser.add_argument(
        "--no-split-by-disease",
        action="store_true",
        help="Use one series from all rows instead of two groups by `num`",
    )
    parser.add_argument(
        "--context",
        type=int,
        default=None,
        help="Optional context length override (must be in [32, 1024])",
    )
    args = parser.parse_args()

    print("Loading UCI heart disease data...")
    rows = load_rows(args.csv)
    rows = sort_rows(rows, args.sort_by)
    labels, inputs = build_series(
        rows=rows,
        parameter=args.parameter,
        split_by_disease=not args.no_split_by_disease,
    )

    print(f"  CSV path          : {args.csv}")
    print(f"  Selected parameter: {args.parameter}")
    print(f"  Total rows        : {len(rows)}")
    for label, signal in zip(labels, inputs):
        print(
            f"  {label}: length={signal.shape[0]}, "
            f"range=[{signal.min():.3f}, {signal.max():.3f}], "
            f"finite={np.isfinite(signal).all()}"
        )

    print("\nLoading TimesFM 2.5 (200M) model...")
    model = get_timesfm_model()

    if args.horizon < 1 or args.horizon > 256:
        raise ValueError("`horizon` must be in [1, 256].")
    if args.context is not None and (args.context < 32 or args.context > 1024):
        raise ValueError("`context` must be in [32, 1024].")

    chosen_context = choose_context(inputs, context_override=args.context)
    print("\nContext windows fed into TimesFM (exact values):")
    for label, signal in zip(labels, inputs):
        context_window, context_mask = build_model_context_window(
            signal, chosen_context
        )
        print(
            f"\n{label} | context_len={chosen_context} | masked_prefix={int(context_mask.sum())}"
        )
        print(np.array2string(context_window, precision=4, separator=", "))

    print(f"\nForecasting next {args.horizon} steps...")
    point_forecast, quantile_forecast, config_used = run_forecast_with_fallback(
        model=model,
        inputs=inputs,
        horizon=args.horizon,
        context_override=chosen_context,
    )

    print("\n" + "=" * 70)
    print(f"   UCI HEART DISEASE PARAMETER FORECAST ({args.parameter})")
    print("=" * 70)
    print(f"Config used: {config_used}")
    for i, label in enumerate(labels):
        print(f"\n{label}")
        print(f"  Input context  : {inputs[i].shape[0]} points")
        print(f"  Forecast steps : {args.horizon}")
        print(f"  Point forecast : {np.round(point_forecast[i], 4)}")
        print(f"  10th pct (low) : {np.round(quantile_forecast[i, :, 1], 4)}")
        print(f"  90th pct (high): {np.round(quantile_forecast[i, :, -1], 4)}")

    print("\n" + "=" * 70)
    print(f"point_forecast shape   : {point_forecast.shape}")
    print(f"quantile_forecast shape: {quantile_forecast.shape}")
    print("=" * 70)
    print("\nDone.")


if __name__ == "__main__":
    main()
