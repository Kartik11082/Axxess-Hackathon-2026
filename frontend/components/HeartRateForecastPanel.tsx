"use client";

import { HeartRatePredictionResponse, MockHeartRateInputPayload } from "@/lib/types";

interface HeartRateForecastPanelProps {
  prediction: HeartRatePredictionResponse | null;
  inputPayload: MockHeartRateInputPayload | null;
}

function formatNumber(value: number | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }
  return value.toFixed(1);
}

export function HeartRateForecastPanel({ prediction, inputPayload }: HeartRateForecastPanelProps) {
  const rows = prediction
    ? prediction.predictedHeartRates.map((value, index) => ({
        step: index + 1,
        predicted: value,
        low: prediction.lowQuantile[index],
        high: prediction.highQuantile[index]
      }))
    : [];

  return (
    <div className="card">
      <div className="card-header">
        <span className="predicted-badge">ML FORECAST</span>
        <span className="timestamp-label">
          Input: {inputPayload ? `${inputPayload.windowSize} samples` : "waiting"}
        </span>
      </div>
      <h3>Heart Rate Forecast Window</h3>
      {prediction ? (
        <>
          <div className="metric-row">
            <span>Model</span>
            <strong>{prediction.model ?? "timesfm"}</strong>
          </div>
          <div className="metric-row">
            <span>Confidence</span>
            <strong>{typeof prediction.confidence === "number" ? `${Math.round(prediction.confidence * 100)}%` : "N/A"}</strong>
          </div>
          <div className="metric-row">
            <span>Config</span>
            <strong>{prediction.configUsed ?? "default"}</strong>
          </div>
          <table className="forecast-table">
            <thead>
              <tr>
                <th>Step</th>
                <th>Predicted</th>
                <th>Low</th>
                <th>High</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 8).map((row) => (
                <tr key={row.step}>
                  <td>+{row.step}</td>
                  <td>{formatNumber(row.predicted)}</td>
                  <td>{formatNumber(row.low)}</td>
                  <td>{formatNumber(row.high)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="assistive">
            Forecast is model-based, not a diagnosis. Range values are uncertainty bounds from quantiles.
          </p>
        </>
      ) : (
        <p className="small-copy">Waiting for realtime mock input and ML forecast response...</p>
      )}
    </div>
  );
}
