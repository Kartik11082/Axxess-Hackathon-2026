"use client";

import { useEffect, useMemo, useState } from "react";
import { LiveAlert } from "@/lib/types";

interface AlertOverlayProps {
  alert: LiveAlert | null;
  onAcknowledge: (alertId: string, reason?: string) => Promise<void> | void;
  onEmergency: (alertId: string) => Promise<void> | void;
}

const DISMISS_REASONS = [
  { key: "exercising", label: "Exercising" },
  { key: "false_alarm", label: "False Alarm" },
  { key: "just_woke_up", label: "Just Woke Up" },
  { key: "other", label: "Other" }
] as const;

function secondsUntil(deadline?: string): number {
  if (!deadline) {
    return 0;
  }
  const diffMs = new Date(deadline).getTime() - Date.now();
  return Math.max(0, Math.ceil(diffMs / 1000));
}

export function AlertOverlay({ alert, onAcknowledge, onEmergency }: AlertOverlayProps) {
  const [reason, setReason] = useState("exercising");
  const [secondsLeft, setSecondsLeft] = useState(0);

  const countdownLabel = useMemo(() => {
    if (!alert?.stateDeadlineAt) {
      return "Caregiver escalation timer unavailable";
    }
    if (alert.state === "FIRED") {
      return "Escalates to caregiver watch in";
    }
    if (alert.state === "AWAITING_ACK") {
      return "Escalates to urgent mode in";
    }
    if (alert.state === "ESCALATED") {
      return "Returns to acknowledgment watch in";
    }
    if (alert.state === "BEING_REVIEWED") {
      return "Resolving in";
    }
    return "Status update in";
  }, [alert?.state, alert?.stateDeadlineAt]);

  useEffect(() => {
    setReason("exercising");
  }, [alert?.id]);

  useEffect(() => {
    if (!alert) {
      setSecondsLeft(0);
      return;
    }

    setSecondsLeft(secondsUntil(alert.stateDeadlineAt));
    const timer = setInterval(() => {
      setSecondsLeft(secondsUntil(alert.stateDeadlineAt));
    }, 1000);

    return () => clearInterval(timer);
  }, [alert?.id, alert?.stateDeadlineAt]);

  if (!alert) {
    return null;
  }

  return (
    <div className="alert-overlay-root" role="dialog" aria-modal="true" aria-label="Critical health alert">
      <div className="alert-overlay-card">
        <p className="alert-overlay-eyebrow">Tier 3 Critical Alert</p>
        <h2>{alert.title}</h2>
        <p className="alert-overlay-message">{alert.message}</p>

        <div className="alert-overlay-metrics">
          <div>
            <span>Risk points</span>
            <strong>{alert.riskPoints}</strong>
          </div>
          <div>
            <span>Urgency level</span>
            <strong>{alert.urgencyLevel}</strong>
          </div>
          <div>
            <span>State</span>
            <strong>{alert.state}</strong>
          </div>
          <div>
            <span>{countdownLabel}</span>
            <strong>{secondsLeft}s</strong>
          </div>
        </div>

        <div className="alert-overlay-signals">
          <p>Top contributing features:</p>
          <ul>
            {alert.topContributors.map((factor) => (
              <li key={factor}>{factor}</li>
            ))}
          </ul>
        </div>

        <div className="alert-overlay-actions">
          <p className="small-copy">Dismiss reason</p>
          <div className="reason-chip-row">
            {DISMISS_REASONS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={reason === item.key ? "reason-chip active" : "reason-chip"}
                onClick={() => setReason(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="alert-overlay-buttons">
            <button type="button" className="primary" onClick={() => onAcknowledge(alert.id, reason)}>
              I&apos;m Okay
            </button>
            <button type="button" className="danger" onClick={() => onEmergency(alert.id)}>
              Call Emergency
            </button>
          </div>
        </div>

        <p className="assistive">Model-based detection only. This is not a diagnosis.</p>
      </div>
    </div>
  );
}
