"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { PredictedTrendPoint } from "@/lib/types";

interface RiskForecastChartProps {
  observedRiskSeries: Array<{ timestamp: string; riskScore: number }>;
  predictedTrend: PredictedTrendPoint[];
  confidence?: number;
}

export function RiskForecastChart({ observedRiskSeries, predictedTrend, confidence }: RiskForecastChartProps) {
  const observed = observedRiskSeries.slice(-10).map((point, index) => ({
    label: `T-${observedRiskSeries.length - index}`,
    observedRisk: point.riskScore,
    predictedRisk: null as number | null
  }));

  const projected = predictedTrend.map((point) => ({
    label: point.label,
    observedRisk: null as number | null,
    predictedRisk: point.score
  }));

  const chartData = [...observed, ...projected];

  return (
    <div className="card chart-card predicted-card">
      <div className="card-header">
        <span className="predicted-badge">PREDICTED TREND</span>
        <span className="confidence-badge">Confidence: {confidence ? `${Math.round(confidence * 100)}%` : "N/A"}</span>
      </div>
      <h3>7-Day Forecast Risk Trajectory</h3>
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={chartData}>
          <defs>
            <linearGradient id="predictedGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#ff5ea8" stopOpacity={0.42} />
              <stop offset="95%" stopColor="#ff5ea8" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
          <XAxis dataKey="label" stroke="#d8c5ff" />
          <YAxis stroke="#d8c5ff" domain={[0, 1]} />
          <Tooltip />
          <Legend />
          <Line
            type="monotone"
            dataKey="observedRisk"
            stroke="#4cb2ff"
            strokeWidth={3}
            dot={false}
            name="Observed Risk"
          />
          <Line
            type="monotone"
            dataKey="predictedRisk"
            stroke="#ff5ea8"
            strokeWidth={3}
            strokeDasharray="7 5"
            dot={false}
            name="Predicted Risk"
          />
          <Area type="monotone" dataKey="predictedRisk" stroke="none" fill="url(#predictedGradient)" />
        </AreaChart>
      </ResponsiveContainer>
      <p className="assistive">
        Model-based projection only. This is not a diagnosis and should support, not replace, clinician judgment.
      </p>
    </div>
  );
}
