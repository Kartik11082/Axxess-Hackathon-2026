#!/usr/bin/env python3
"""Predict diabetes status for a patient ID from chronic disease records."""

from __future__ import annotations

import argparse
import json
import pickle
import sys
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from random_diabetes_risk import load_and_prepare, train_model


DIRECT_PARAM_MAP = {
    "Age": "Age",
    "BMI": "BMI",
    "BloodPressure": "BloodPressure_Diastolic",
}

PROXY_PARAM_MAP = {
    "Glucose": "BiomarkerScore",
    "Insulin": "MedicationDose",
}


def _scale_value(value: float, src_min: float, src_max: float, dst_min: float, dst_max: float) -> float:
    if src_max <= src_min:
        return float(dst_min)
    clamped = min(max(value, src_min), src_max)
    ratio = (clamped - src_min) / (src_max - src_min)
    return float(dst_min + ratio * (dst_max - dst_min))


def _load_pickle_model(model_path: Path) -> Any | None:
    if not model_path.exists():
        return None

    class A:
        """Placeholder for legacy pickles that reference __main__.A."""

    setattr(sys.modules.get("__main__"), "A", A)

    try:
        with model_path.open("rb") as f:
            model = pickle.load(f)
    except Exception:
        return None

    if callable(getattr(model, "predict_proba", None)) or callable(getattr(model, "predict", None)):
        return model
    return None


def _choose_latest_record(patient_rows: pd.DataFrame) -> pd.Series:
    rows = patient_rows.copy()
    rows["Date"] = pd.to_datetime(rows["Date"], errors="coerce")
    rows = rows.sort_values("Date")
    return rows.iloc[-1]


def _forecast_series(values: np.ndarray, horizon: int) -> np.ndarray:
    if horizon <= 0:
        return np.array([], dtype=float)
    if values.size == 0:
        return np.zeros(horizon, dtype=float)
    if values.size == 1:
        return np.repeat(float(values[-1]), horizon)

    x = np.arange(values.size, dtype=float)
    slope, intercept = np.polyfit(x, values, deg=1)
    future_x = np.arange(values.size, values.size + horizon, dtype=float)
    trend = intercept + slope * future_x

    diffs = np.diff(values)
    drift = float(np.median(diffs)) if diffs.size else 0.0
    drift_line = float(values[-1]) + drift * np.arange(1, horizon + 1, dtype=float)

    forecast = 0.7 * trend + 0.3 * drift_line

    vmin = float(np.nanmin(values))
    vmax = float(np.nanmax(values))
    span = max(vmax - vmin, 1e-6)
    forecast = np.clip(forecast, vmin - 0.2 * span, vmax + 0.2 * span)
    forecast = np.where(np.isfinite(forecast), forecast, float(values[-1]))
    return forecast


def _forecast_patient_rows(patient_rows: pd.DataFrame, horizon: int) -> pd.DataFrame:
    rows = patient_rows.copy()
    rows["Date"] = pd.to_datetime(rows["Date"], errors="coerce")
    rows = rows.sort_values("Date").reset_index(drop=True)

    if rows.empty or horizon <= 0:
        return pd.DataFrame(columns=rows.columns)

    diffs = rows["Date"].diff().dt.days.dropna()
    diffs = diffs[diffs > 0]
    step_days = int(round(float(diffs.median()))) if not diffs.empty else 30
    last_date = rows["Date"].iloc[-1]
    future_dates = [last_date + pd.Timedelta(days=step_days * i) for i in range(1, horizon + 1)]

    numeric_cols = list(rows.select_dtypes(include=[np.number]).columns)
    int_like_cols = [c for c in numeric_cols if pd.api.types.is_integer_dtype(rows[c])]

    forecasts: dict[str, np.ndarray] = {}
    for col in numeric_cols:
        vals = rows[col].astype(float).to_numpy()
        forecasts[col] = _forecast_series(vals, horizon)

    latest = rows.iloc[-1]
    out_rows: list[dict[str, Any]] = []
    for i in range(horizon):
        new_row: dict[str, Any] = {}
        for col in rows.columns:
            if col == "Date":
                new_row[col] = future_dates[i].date().isoformat()
            elif col in numeric_cols:
                val = float(forecasts[col][i])
                if col in int_like_cols:
                    new_row[col] = int(round(val))
                else:
                    new_row[col] = round(val, 4)
            else:
                new_row[col] = latest[col]
        out_rows.append(new_row)

    return pd.DataFrame(out_rows)


def _build_feature_values(
    record: pd.Series,
    feature_df: pd.DataFrame,
    use_proxy_fields: bool,
) -> tuple[dict[str, float], dict[str, list[str]], dict[str, str], list[str]]:
    model_features = list(feature_df.columns)
    feature_defaults = feature_df.median(numeric_only=True).to_dict()
    feature_values = {col: float(feature_defaults.get(col, 0.0)) for col in model_features}

    possible_parameters: dict[str, list[str]] = {}
    used_parameters: dict[str, str] = {}

    for feature in model_features:
        options: list[str] = []
        direct_col = DIRECT_PARAM_MAP.get(feature)
        if direct_col and direct_col in record.index:
            options.append(direct_col)
        proxy_col = PROXY_PARAM_MAP.get(feature)
        if proxy_col and proxy_col in record.index:
            options.append(proxy_col)
        possible_parameters[feature] = options

    for feature, source_col in DIRECT_PARAM_MAP.items():
        if feature in feature_values and source_col in record.index:
            val = record[source_col]
            if pd.notna(val):
                feature_values[feature] = float(val)
                used_parameters[feature] = source_col

    if use_proxy_fields:
        if "Glucose" in feature_values and "Glucose" not in used_parameters and "BiomarkerScore" in record.index:
            biomarker = record["BiomarkerScore"]
            if pd.notna(biomarker):
                feature_values["Glucose"] = _scale_value(
                    float(biomarker),
                    src_min=0.0,
                    src_max=10.0,
                    dst_min=float(feature_df["Glucose"].min()),
                    dst_max=float(feature_df["Glucose"].max()),
                )
                used_parameters["Glucose"] = "BiomarkerScore(scaled)"

        if "Insulin" in feature_values and "Insulin" not in used_parameters and "MedicationDose" in record.index:
            med_dose = record["MedicationDose"]
            if pd.notna(med_dose):
                feature_values["Insulin"] = _scale_value(
                    float(med_dose),
                    src_min=0.0,
                    src_max=2.0,
                    dst_min=float(feature_df["Insulin"].quantile(0.1)),
                    dst_max=float(feature_df["Insulin"].quantile(0.9)),
                )
                used_parameters["Insulin"] = "MedicationDose(scaled)"

        if "SkinThickness" in feature_values and "SkinThickness" not in used_parameters and "BMI" in record.index:
            bmi = record["BMI"]
            if pd.notna(bmi):
                feature_values["SkinThickness"] = float(min(max(float(bmi) * 0.9, 10.0), 50.0))
                used_parameters["SkinThickness"] = "BMI(derived)"

    missing_features = [f for f in model_features if f not in used_parameters]
    return feature_values, possible_parameters, used_parameters, missing_features


def _predict_diabetes(model: Any, feature_values: dict[str, float], model_features: list[str]) -> tuple[float, bool]:
    X = pd.DataFrame([feature_values], columns=model_features)
    if callable(getattr(model, "predict_proba", None)):
        diabetes_probability = float(model.predict_proba(X)[0][1])
        predicted_diabetes = bool(diabetes_probability >= 0.5)
    else:
        predicted_label = int(model.predict(X)[0])
        predicted_diabetes = bool(predicted_label == 1)
        diabetes_probability = float(predicted_label)
    return diabetes_probability, predicted_diabetes


def predict_diabetes_for_pid(
    patient_id: str = "PID0445",
    patient_data_path: str | Path = "chronic_disease_progression.csv",
    diabetes_model_path: str | Path = "Diabetesmodel.pkl",
    diabetes_reference_path: str | Path = "diabetes.csv",
    use_proxy_fields: bool = True,
    forecast_horizon: int = 15,
) -> dict[str, Any]:
    patient_data_path = Path(patient_data_path)
    diabetes_model_path = Path(diabetes_model_path)
    diabetes_reference_path = Path(diabetes_reference_path)

    patient_df = pd.read_csv(patient_data_path)
    patient_rows = patient_df[patient_df["PatientID"] == patient_id]
    if patient_rows.empty:
        raise ValueError(f"No records found for patient '{patient_id}'")

    latest_record = _choose_latest_record(patient_rows)
    diabetes_df = load_and_prepare(diabetes_reference_path)
    if "Outcome" not in diabetes_df.columns:
        raise ValueError("Expected 'Outcome' column in diabetes reference data")

    feature_df = diabetes_df.drop(columns=["Outcome"])
    model_features = list(feature_df.columns)
    feature_values, possible_parameters, used_parameters, missing_features = _build_feature_values(
        latest_record, feature_df, use_proxy_fields
    )

    model = _load_pickle_model(diabetes_model_path)
    if model is not None:
        model_source = str(diabetes_model_path)
    else:
        model = train_model(feature_df, diabetes_df["Outcome"])
        model_source = f"fallback-trained-from-{diabetes_reference_path}"

    diabetes_probability, predicted_diabetes = _predict_diabetes(model, feature_values, model_features)

    forecast_rows = _forecast_patient_rows(patient_rows, forecast_horizon)
    forecast_predictions: list[dict[str, Any]] = []
    for i, row in forecast_rows.iterrows():
        row_features, _, row_used, row_missing = _build_feature_values(row, feature_df, use_proxy_fields)
        row_probability, row_predicted = _predict_diabetes(model, row_features, model_features)
        forecast_predictions.append(
            {
                "step": i + 1,
                "forecast_date": row["Date"],
                "diabetes_probability": row_probability,
                "predicted_diabetes": row_predicted,
                "used_parameters": row_used,
                "missing_model_features": row_missing,
            }
        )

    forecast_detected_count = sum(1 for x in forecast_predictions if x["predicted_diabetes"])
    forecast_avg_probability = (
        float(np.mean([x["diabetes_probability"] for x in forecast_predictions])) if forecast_predictions else None
    )
    forecast_any_diabetes = bool(forecast_detected_count > 0)

    latest_date = pd.to_datetime(latest_record["Date"], errors="coerce")
    if pd.isna(latest_date):
        latest_date_str = str(latest_record["Date"])
    else:
        latest_date_str = latest_date.date().isoformat()

    return {
        "patient_id": patient_id,
        "records_found": int(patient_rows.shape[0]),
        "latest_record_date": latest_date_str,
        "latest_attributes": latest_record.to_dict(),
        "all_attributes": patient_rows.to_dict(orient="records"),
        "model_features": model_features,
        "possible_parameters": possible_parameters,
        "used_parameters": used_parameters,
        "missing_model_features": missing_features,
        "model_source": model_source,
        "diabetes_probability": diabetes_probability,
        "predicted_diabetes": predicted_diabetes,
        "forecast_horizon": forecast_horizon,
        "forecast_rows": forecast_rows.to_dict(orient="records"),
        "forecast_predictions": forecast_predictions,
        "forecast_average_probability": forecast_avg_probability,
        "forecast_detected_count": int(forecast_detected_count),
        "forecast_any_diabetes": forecast_any_diabetes,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Predict diabetes status for a patient ID")
    parser.add_argument("--patient-id", default="PID0445", help="Patient ID in chronic_disease_progression.csv")
    parser.add_argument(
        "--use-proxy-fields",
        dest="use_proxy_fields",
        action="store_true",
        default=True,
        help="Allow proxy column mapping for missing model features (default: enabled)",
    )
    parser.add_argument(
        "--no-proxy-fields",
        dest="use_proxy_fields",
        action="store_false",
        help="Disable proxy/scaled feature mapping",
    )
    parser.add_argument(
        "--forecast-horizon",
        type=int,
        default=15,
        help="Number of future points to forecast from patient history",
    )
    parser.add_argument("--json", dest="as_json", action="store_true", help="Output JSON")
    args = parser.parse_args()

    result = predict_diabetes_for_pid(
        patient_id=args.patient_id,
        use_proxy_fields=args.use_proxy_fields,
        forecast_horizon=args.forecast_horizon,
    )

    if args.as_json:
        print(json.dumps(result, indent=2, default=str))
        return

    print(f"Patient: {result['patient_id']}")
    print(f"Records found: {result['records_found']}")
    print(f"Latest record date: {result['latest_record_date']}")
    print(f"Model source: {result['model_source']}")
    print(f"Used parameters: {result['used_parameters']}")
    print(f"Diabetes probability: {result['diabetes_probability']:.4f}")
    print(f"Predicted diabetes: {result['predicted_diabetes']}")
    print(
        "Forecast summary: "
        f"horizon={result['forecast_horizon']}, "
        f"average_probability={result['forecast_average_probability']:.4f}, "
        f"detected_count={result['forecast_detected_count']}, "
        f"any_diabetes={result['forecast_any_diabetes']}"
    )


if __name__ == "__main__":
    main()
