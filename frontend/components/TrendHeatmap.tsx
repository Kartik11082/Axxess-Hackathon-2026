"use client";

import { PredictedTrendPoint } from "@/lib/types";

interface TrendHeatmapProps {
  trend: PredictedTrendPoint[];
}

function stateFromScore(score: number): "Stable" | "Watch" | "High risk" {
  if (score >= 0.75) {
    return "High risk";
  }
  if (score >= 0.45) {
    return "Watch";
  }
  return "Stable";
}

export function TrendHeatmap({ trend }: TrendHeatmapProps) {
  return (
    <div className="card heatmap-card">
      <h3>Trend Heatmap</h3>
      <div className="heatmap-grid">
        {trend.map((point) => {
          const state = stateFromScore(point.score);
          return (
            <div key={point.label} className={`heatmap-cell state-${state.replace(" ", "-").toLowerCase()}`}>
              <span>{point.label}</span>
              <strong>{Math.round(point.score * 100)}%</strong>
              <small>{state}</small>
            </div>
          );
        })}
      </div>
    </div>
  );
}
