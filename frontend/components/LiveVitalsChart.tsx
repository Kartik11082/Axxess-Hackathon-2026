"use client";

import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend
} from "recharts";
import { StreamingVitals } from "@/lib/types";

interface LiveVitalsChartProps {
  vitals: StreamingVitals[];
  heartRateForecast?: number[];
  forecastConfidence?: number;
}

export function LiveVitalsChart({ vitals, heartRateForecast = [], forecastConfidence }: LiveVitalsChartProps) {
  const observed = vitals.slice(-24).map((item) => ({
    label: new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    observedHeartRate: item.heartRate,
    predictedHeartRate: null as number | null,
    bloodOxygen: item.bloodOxygen,
    sleepScore: item.sleepScore
  }));

  const forecast = heartRateForecast.slice(0, 12).map((value, index) => ({
    label: `F+${index + 1}`,
    observedHeartRate: null as number | null,
    predictedHeartRate: value,
    bloodOxygen: null as number | null,
    sleepScore: null as number | null
  }));

  if (observed.length > 0 && forecast.length > 0) {
    const latestObserved = observed[observed.length - 1];
    forecast.unshift({
      label: "Now",
      observedHeartRate: null,
      predictedHeartRate: latestObserved.observedHeartRate,
      bloodOxygen: null,
      sleepScore: null
    });
  }

  const data = [...observed, ...forecast];

  return (
    <div className="card chart-card">
      <div className="card-header">
        <span className="live-badge">LIVE DATA</span>
        {heartRateForecast.length > 0 ? <span className="predicted-badge">PREDICTED HR</span> : null}
        {typeof forecastConfidence === "number" ? (
          <span className="confidence-badge">Forecast confidence: {Math.round(forecastConfidence * 100)}%</span>
        ) : null}
        <p className="timestamp-label">
          Last update: {vitals.length ? new Date(vitals[vitals.length - 1].timestamp).toLocaleTimeString() : "Waiting"}
        </p>
      </div>
      <h3>Observed Vitals</h3>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
          <XAxis dataKey="label" stroke="#9fb4cc" />
          <YAxis stroke="#9fb4cc" />
          <Tooltip />
          <Legend />
          <Line
            type="monotone"
            dataKey="observedHeartRate"
            stroke="#42a5f5"
            strokeWidth={3}
            dot={false}
            isAnimationActive
            name="Heart Rate (Observed)"
          />
          <Line
            type="monotone"
            dataKey="predictedHeartRate"
            stroke="#ff5ea8"
            strokeWidth={2.8}
            strokeDasharray="7 5"
            dot={false}
            connectNulls
            isAnimationActive
            name="Heart Rate (Predicted)"
          />
          <Line
            type="monotone"
            dataKey="bloodOxygen"
            stroke="#4dd0a8"
            strokeWidth={2.2}
            dot={false}
            isAnimationActive
            name="Blood Oxygen"
          />
          <Line
            type="monotone"
            dataKey="sleepScore"
            stroke="#ffd166"
            strokeWidth={2.2}
            dot={false}
            isAnimationActive
            name="Sleep Score"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
