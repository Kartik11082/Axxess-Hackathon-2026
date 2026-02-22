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
}

export function LiveVitalsChart({ vitals }: LiveVitalsChartProps) {
  const data = vitals.slice(-24).map((item) => ({
    time: new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    heartRate: item.heartRate,
    bloodOxygen: item.bloodOxygen,
    sleepScore: item.sleepScore
  }));

  return (
    <div className="card chart-card">
      <div className="card-header">
        <span className="live-badge">LIVE DATA</span>
        <p className="timestamp-label">
          Last update: {vitals.length ? new Date(vitals[vitals.length - 1].timestamp).toLocaleTimeString() : "Waiting"}
        </p>
      </div>
      <h3>Observed Vitals</h3>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
          <XAxis dataKey="time" stroke="#9fb4cc" />
          <YAxis stroke="#9fb4cc" />
          <Tooltip />
          <Legend />
          <Line
            type="monotone"
            dataKey="heartRate"
            stroke="#42a5f5"
            strokeWidth={3}
            dot={false}
            isAnimationActive
            name="Heart Rate"
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
