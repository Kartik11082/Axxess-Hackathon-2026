"""
Simple Flask API wrapper for TimesFM heart-rate forecasting.

Run:
  python ml_api_app.py
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

from flask import Flask, jsonify, request
from flask_cors import CORS

from time_series_uci_parameter_forecast import predict_heart_rate

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and value == value


def _parse_history(values: Any) -> list[float]:
    if not isinstance(values, list):
        raise ValueError("`heartRates` must be an array of numbers.")
    parsed = [float(item) for item in values if _is_number(item)]
    if len(parsed) != len(values):
        raise ValueError("`heartRates` must contain only numeric values.")
    if len(parsed) < 12:
        raise ValueError("`heartRates` must contain at least 12 data points.")
    return parsed


@app.get("/health")
def health() -> Any:
    return jsonify({"status": "ok", "service": "timesfm-heart-rate-api"})


@app.post("/predict-heart-rate")
def predict_heart_rate_route() -> Any:
    payload = request.get_json(silent=True) or {}

    patient_id = str(payload.get("patientId")).strip()
    print(f"Received prediction request for patientId: {payload}")
    if not patient_id:
        return jsonify({"error": "`patientId` is required."}), 400

    horizon_raw = payload.get("horizon", 12)
    context_raw = payload.get("context")
    try:
        horizon = int(horizon_raw)
    except (TypeError, ValueError):
        return jsonify({"error": "`horizon` must be an integer."}), 400

    context: int | None = None
    if context_raw is not None:
        try:
            context = int(context_raw)
        except (TypeError, ValueError):
            return (
                jsonify({"error": "`context` must be an integer when provided."}),
                400,
            )

    try:
        history = _parse_history(payload.get("heartRates"))
        result = predict_heart_rate(history=history, horizon=horizon, context=context)
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    except Exception as error:  # pragma: no cover
        return jsonify({"error": f"Prediction failed: {error}"}), 500

    predicted_values = result.get("predicted_values", [])
    if not isinstance(predicted_values, list):
        predicted_values = []

    return jsonify(
        {
            "patientId": patient_id,
            "horizon": horizon,
            "predictedHeartRates": predicted_values,
            "lowQuantile": result.get("low_quantile", []),
            "highQuantile": result.get("high_quantile", []),
            "confidence": result.get("confidence"),
            "model": result.get("model"),
            "configUsed": result.get("config_used"),
            "context": result.get("context"),
            "generatedAt": datetime.now(timezone.utc).isoformat(),
        }
    )


if __name__ == "__main__":
    host = os.getenv("ML_API_HOST", "0.0.0.0")
    port = int(os.getenv("ML_API_PORT", "5001"))
    debug = os.getenv("ML_API_DEBUG", "true").lower() in {"1", "true", "yes"}
    app.run(host=host, port=port, debug=debug)
