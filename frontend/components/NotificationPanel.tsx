"use client";

import { NotificationItem } from "@/lib/types";

interface NotificationPanelProps {
  notifications: NotificationItem[];
  onAcknowledge: (notificationId: string) => void;
}

export function NotificationPanel({ notifications, onAcknowledge }: NotificationPanelProps) {
  return (
    <div className="card notification-card">
      <h3>Notifications</h3>
      {notifications.length === 0 ? <p className="small-copy">No active alerts.</p> : null}
      <div className="notification-list">
        {notifications.map((item) => (
          <div key={item.id} className={`notification-item severity-${item.severity}`}>
            <div>
              <p className="notification-title">{item.title}</p>
              <p className="notification-message">{item.message}</p>
              <small>{new Date(item.timestamp).toLocaleString()}</small>
            </div>
            {!item.acknowledged ? (
              <button type="button" onClick={() => onAcknowledge(item.id)}>
                Ack
              </button>
            ) : (
              <span className="ack-tag">Acknowledged</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
