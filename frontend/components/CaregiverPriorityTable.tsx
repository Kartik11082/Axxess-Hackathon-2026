"use client";

import { CaregiverPriorityItem } from "@/lib/types";

interface CaregiverPriorityTableProps {
  rows: CaregiverPriorityItem[];
  onSelectPatient: (patientId: string) => void;
}

export function CaregiverPriorityTable({ rows, onSelectPatient }: CaregiverPriorityTableProps) {
  return (
    <div className="card">
      <h3>Caregiver Alert Prioritization</h3>
      <table className="priority-table">
        <thead>
          <tr>
            <th>Patient</th>
            <th>Risk</th>
            <th>Confidence</th>
            <th>Rate of Change</th>
            <th>Priority Score</th>
            <th>Heatmap</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.patientId}>
              <td>{row.patientName}</td>
              <td>{Math.round(row.riskScore * 100)}%</td>
              <td>{Math.round(row.confidence * 100)}%</td>
              <td>{row.rateOfChange >= 0 ? `+${row.rateOfChange}` : row.rateOfChange}</td>
              <td>{row.priorityScore}</td>
              <td>
                <span className={`state-pill state-${row.state.toLowerCase().replace(" ", "-")}`}>{row.state}</span>
              </td>
              <td>
                <button type="button" onClick={() => onSelectPatient(row.patientId)}>
                  Open
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
