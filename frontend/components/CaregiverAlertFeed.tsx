"use client";

import { CaregiverAlertAction, LiveAlert } from "@/lib/types";

interface CaregiverAlertFeedProps {
  alerts: LiveAlert[];
  onAction: (
    alertId: string,
    action: Exclude<CaregiverAlertAction, "bulk_acknowledge">,
    note?: string
  ) => Promise<void> | void;
  onBulkAcknowledge: (tier?: 1 | 2 | 3) => Promise<void> | void;
}

function sortLiveAlerts(alerts: LiveAlert[]): LiveAlert[] {
  return [...alerts].sort((left, right) => {
    if (left.tier !== right.tier) {
      return right.tier - left.tier;
    }
    if (left.urgencyLevel !== right.urgencyLevel) {
      return right.urgencyLevel - left.urgencyLevel;
    }
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });
}

export function CaregiverAlertFeed({ alerts, onAction, onBulkAcknowledge }: CaregiverAlertFeedProps) {
  const ordered = sortLiveAlerts(alerts);
  const urgent = ordered.filter((alert) => alert.tier === 3 || alert.state === "ESCALATED");
  const nonCritical = ordered.filter((alert) => alert.tier < 3 && alert.state !== "ESCALATED");

  return (
    <section className="card caregiver-alert-feed">
      <div className="card-header">
        <h3>Urgent Action Required</h3>
        <div className="caregiver-alert-bulk-actions">
          <button type="button" className="ghost" onClick={() => onBulkAcknowledge(1)}>
            Ack Tier 1
          </button>
          <button type="button" className="ghost" onClick={() => onBulkAcknowledge(2)}>
            Ack Tier 2
          </button>
          <button type="button" className="ghost" onClick={() => onBulkAcknowledge()}>
            Ack All
          </button>
        </div>
      </div>

      <div className="caregiver-alert-section">
        <p className="small-copy">{urgent.length} critical/escalated alert(s)</p>
        <div className="caregiver-alert-list">
          {urgent.map((alert) => (
            <article key={alert.id} className="caregiver-alert-item critical">
              <div>
                <p className="alert-toast-title">
                  {alert.patientName} - {alert.title}
                </p>
                <p className="alert-toast-message">
                  State: {alert.state} | Points: {alert.riskPoints} | Urgency: {alert.urgencyLevel}
                </p>
                <p className="small-copy">{new Date(alert.updatedAt).toLocaleString()}</p>
              </div>
              <div className="caregiver-alert-actions">
                <button type="button" onClick={() => onAction(alert.id, "call_patient")}>
                  Call Patient
                </button>
                <button type="button" onClick={() => onAction(alert.id, "alert_staff")}>
                  Alert Staff
                </button>
                <button type="button" onClick={() => onAction(alert.id, "acknowledge")}>
                  Acknowledge
                </button>
                <button type="button" className="ghost" onClick={() => onAction(alert.id, "dismiss")}>
                  Dismiss
                </button>
              </div>
            </article>
          ))}
          {urgent.length === 0 ? <p className="small-copy">No urgent alerts right now.</p> : null}
        </div>
      </div>

      <div className="caregiver-alert-section">
        <h4>Recent Activity</h4>
        <div className="caregiver-alert-list">
          {nonCritical.map((alert) => (
            <article key={alert.id} className={`caregiver-alert-item tier-${alert.tier}`}>
              <div>
                <p className="alert-toast-title">
                  {alert.patientName} - {alert.title}
                </p>
                <p className="alert-toast-message">
                  Tier {alert.tier} | {alert.state}
                </p>
              </div>
              <div className="caregiver-alert-actions">
                <button type="button" onClick={() => onAction(alert.id, "acknowledge")}>
                  Acknowledge
                </button>
              </div>
            </article>
          ))}
          {nonCritical.length === 0 ? <p className="small-copy">No tier 1-2 alerts right now.</p> : null}
        </div>
      </div>
    </section>
  );
}
