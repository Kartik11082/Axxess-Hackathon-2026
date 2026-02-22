"use client";

import { useEffect, useRef } from "react";
import { LiveAlert } from "@/lib/types";

interface AlertToastStackProps {
  alerts: LiveAlert[];
  onAcknowledge: (alertId: string, reason?: string) => Promise<void> | void;
}

export function AlertToastStack({ alerts, onAcknowledge }: AlertToastStackProps) {
  const scheduledAutoDismiss = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const alert of alerts) {
      if (alert.tier !== 1 || scheduledAutoDismiss.current.has(alert.id)) {
        continue;
      }
      scheduledAutoDismiss.current.add(alert.id);
      window.setTimeout(() => {
        void onAcknowledge(alert.id, "auto-dismissed-tier-1");
      }, 8000);
    }
  }, [alerts, onAcknowledge]);

  if (alerts.length === 0) {
    return null;
  }

  return (
    <div className="alert-toast-stack" aria-live="polite">
      {alerts.map((alert) => (
        <article key={alert.id} className={`alert-toast alert-toast-tier-${alert.tier}`}>
          <p className="alert-toast-title">{alert.title}</p>
          <p className="alert-toast-message">{alert.message}</p>
          <div className="alert-toast-meta">
            <span>{alert.state}</span>
            <span>{new Date(alert.updatedAt).toLocaleTimeString()}</span>
          </div>
          {alert.tier === 2 ? (
            <button type="button" onClick={() => onAcknowledge(alert.id, "patient-confirmed-safe")}>
              Confirm / Acknowledge
            </button>
          ) : null}
        </article>
      ))}
    </div>
  );
}
