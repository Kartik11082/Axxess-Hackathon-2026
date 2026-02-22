"use client";

import { PredictionResponse } from "@/lib/types";

interface PredictionInsightsProps {
  prediction: PredictionResponse | null;
  insurance: {
    icdCode: string;
    coverageCompatibility: string;
  } | null;
}

export function PredictionInsights({ prediction, insurance }: PredictionInsightsProps) {
  return (
    <div className="card insights-card">
      <h3>Explainable AI Panel</h3>
      {prediction ? (
        <>
          <div className="metric-row">
            <span>Disease Classification</span>
            <strong>{prediction.predictedDisease}</strong>
          </div>
          <div className="metric-row">
            <span>Risk Score</span>
            <strong>{Math.round(prediction.predictedRiskScore * 100)}%</strong>
          </div>
          <div className="metric-row">
            <span>Risk Momentum</span>
            <strong
              className={
                prediction.riskMomentum === "Increasing"
                  ? "risk-up"
                  : prediction.riskMomentum === "Improving"
                    ? "risk-down"
                    : "risk-flat"
              }
            >
              {prediction.riskMomentum === "Increasing"
                ? "Risk up: Increasing"
                : prediction.riskMomentum === "Improving"
                  ? "Risk down: Improving"
                  : "Risk stable"}
            </strong>
          </div>

          <h4>Top Contributing Features</h4>
          <ul className="feature-list">
            {prediction.explainability.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>

          <h4>Insurance Coverage Compatibility Check</h4>
          <p className="small-copy">
            ICD: <strong>{insurance?.icdCode ?? prediction.icdCode}</strong>
          </p>
          <p className="small-copy">{insurance?.coverageCompatibility ?? "Loading compatibility estimate..."}</p>
        </>
      ) : (
        <p className="small-copy">Waiting for predictive model output...</p>
      )}
    </div>
  );
}
