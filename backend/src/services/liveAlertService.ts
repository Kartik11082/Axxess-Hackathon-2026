import { v4 as uuidv4 } from "uuid";
import { config } from "../config";
import { store } from "../data/store";
import {
  AlertAuditEntry,
  AlertAuditSummary,
  AlertTier,
  AuthTokenPayload,
  CaregiverAlertAction,
  LiveAlert,
  LiveAlertState,
  StreamingVitals
} from "../models/types";
import { nowIso } from "../utils/time";

type AlertStreamEventType = "init" | "alert_upsert" | "alert_resolved" | "audit";
type AlertSeverity = LiveAlert["severity"];

interface AlertSubscriber {
  id: string;
  auth: AuthTokenPayload;
  write: (chunk: string) => void;
}

interface ScoredSignal {
  label: string;
  points: number;
  severity: "warning" | "critical";
}

interface ScoreResult {
  points: number;
  tier: AlertTier | 0;
  severity: AlertSeverity | null;
  flaggedVitals: string[];
  topContributors: string[];
  title: string;
  message: string;
}

type AlertActionResult =
  | {
      ok: true;
      alert: LiveAlert;
    }
  | {
      ok: false;
      error: "not_found" | "forbidden" | "already_resolved";
      message: string;
    };

const FIRED_TO_AWAITING_MS = 30_000;
const AWAITING_TO_ESCALATED_MS = 60_000;
const ESCALATED_TO_AWAITING_MS = 30_000;
const REVIEW_TO_RESOLVED_MS = 15_000;
const MINIMUM_SAMPLES_BEFORE_ALERTING = 12;
const SUBSCRIBER_GRACE_PERIOD_MS = 45_000;

function toIsoFromNow(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function scoreToTier(points: number): AlertTier | 0 {
  if (points >= 5) {
    return 3;
  }
  if (points >= 3) {
    return 2;
  }
  if (points >= 1) {
    return 1;
  }
  return 0;
}

function tierToSeverity(tier: AlertTier): AlertSeverity {
  if (tier === 3) {
    return "critical";
  }
  if (tier === 2) {
    return "warning";
  }
  return "info";
}

function scoreSignals(vitals: StreamingVitals): ScoreResult {
  const signals: ScoredSignal[] = [];

  if (vitals.bloodOxygen < 90) {
    signals.push({ label: "Blood oxygen desaturation", points: 6, severity: "critical" });
  } else if (vitals.bloodOxygen < 94) {
    signals.push({ label: "Blood oxygen below normal", points: 3, severity: "warning" });
  }

  if (vitals.heartRate >= 130) {
    signals.push({ label: "Heart rate critically elevated", points: 4, severity: "critical" });
  } else if (vitals.heartRate >= 110) {
    signals.push({ label: "Heart rate elevated", points: 2, severity: "warning" });
  }

  if (vitals.stepCount <= 800) {
    signals.push({ label: "Very low activity", points: 2, severity: "critical" });
  } else if (vitals.stepCount <= 1400) {
    signals.push({ label: "Reduced activity", points: 1, severity: "warning" });
  }

  if (vitals.sleepScore < 45) {
    signals.push({ label: "Poor recovery sleep", points: 2, severity: "critical" });
  } else if (vitals.sleepScore < 60) {
    signals.push({ label: "Sleep trend degraded", points: 1, severity: "warning" });
  }

  const recentVitals = store.getVitalsSince(vitals.patientId, new Date(Date.now() - 2 * 60_000).toISOString()).slice(-3);
  const sustainedHrSpike =
    recentVitals.length === 3 &&
    recentVitals.every((item) => item.heartRate >= config.sustainedHrThreshold);

  if (sustainedHrSpike) {
    signals.push({ label: "Sustained heart rate spike", points: 3, severity: "critical" });
  }

  const points = signals.reduce((sum, signal) => sum + signal.points, 0);
  const tier = scoreToTier(points);

  if (tier === 0) {
    return {
      points,
      tier,
      severity: null,
      flaggedVitals: [],
      topContributors: [],
      title: "",
      message: ""
    };
  }

  const topContributors = [...signals]
    .sort((left, right) => right.points - left.points)
    .slice(0, 3)
    .map((item) => item.label);

  const flaggedVitals = Array.from(new Set(topContributors));
  const severity = tierToSeverity(tier);
  const multiSystem = tier === 3 && signals.length >= 3;
  const title =
    tier === 3
      ? multiSystem
        ? "Multi-System Critical Alert"
        : "Critical Physiologic Alert"
      : tier === 2
        ? "Physiologic Warning"
        : "Vital Drift Notice";
  const message =
    tier === 3
      ? "Immediate review recommended. One or more vitals crossed critical thresholds."
      : tier === 2
        ? "Vitals indicate moderate risk. Confirm patient status."
        : "Minor vital drift detected. Continue monitoring.";

  return {
    points,
    tier,
    severity,
    flaggedVitals,
    topContributors,
    title,
    message
  };
}

function sortAlerts(left: LiveAlert, right: LiveAlert): number {
  if (left.tier !== right.tier) {
    return right.tier - left.tier;
  }
  if (left.urgencyLevel !== right.urgencyLevel) {
    return right.urgencyLevel - left.urgencyLevel;
  }
  return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
}

function shouldNotifyBeneficiary(preference: "high-risk-only" | "all-alerts" | "emergency-only", tier: AlertTier): boolean {
  if (preference === "all-alerts") {
    return true;
  }
  if (preference === "high-risk-only") {
    return tier >= 2;
  }
  return tier === 3;
}

function cloneAlert(alert: LiveAlert): LiveAlert {
  return {
    ...alert,
    flaggedVitals: [...alert.flaggedVitals],
    topContributors: [...alert.topContributors]
  };
}

export class LiveAlertService {
  private alertsById = new Map<string, LiveAlert>();
  private activeAlertIdByPatient = new Map<string, string>();
  private subscribers = new Map<string, AlertSubscriber>();
  private cooldowns = new Map<string, number>();
  private sampleCountByPatient = new Map<string, number>();
  private gracePeriodByPatient = new Map<string, number>();
  private auditTrail: AlertAuditEntry[] = [];
  private stateMachineTimer?: NodeJS.Timeout;

  start(): void {
    if (this.stateMachineTimer) {
      return;
    }
    this.stateMachineTimer = setInterval(() => {
      this.advanceStateMachine();
    }, 1000);
  }

  stop(): void {
    if (this.stateMachineTimer) {
      clearInterval(this.stateMachineTimer);
      this.stateMachineTimer = undefined;
    }
    this.subscribers.clear();
  }

  addSubscriber(params: { auth: AuthTokenPayload; write: (chunk: string) => void }): string {
    const id = uuidv4();
    this.subscribers.set(id, {
      id,
      auth: params.auth,
      write: params.write
    });

    if (params.auth.role === "Patient") {
      this.gracePeriodByPatient.set(params.auth.userId, Date.now() + SUBSCRIBER_GRACE_PERIOD_MS);
    } else {
      for (const patientId of store.getCaregiverPatientIds(params.auth.userId)) {
        const existingGrace = this.gracePeriodByPatient.get(patientId) ?? 0;
        this.gracePeriodByPatient.set(patientId, Math.max(existingGrace, Date.now() + 20_000));
      }
    }

    this.sendToSubscriber(id, "init", {
      alerts: this.getVisibleActiveAlerts(params.auth),
      auditSummary: this.getAuditSummary(params.auth)
    });

    return id;
  }

  removeSubscriber(subscriberId: string): void {
    this.subscribers.delete(subscriberId);
  }

  processVitals(vitals: StreamingVitals): void {
    const observedCount = (this.sampleCountByPatient.get(vitals.patientId) ?? 0) + 1;
    this.sampleCountByPatient.set(vitals.patientId, observedCount);

    // Grace period: avoid firing alerts immediately when dashboard session starts.
    if (observedCount < MINIMUM_SAMPLES_BEFORE_ALERTING) {
      return;
    }

    const graceUntil = this.gracePeriodByPatient.get(vitals.patientId) ?? 0;
    if (Date.now() < graceUntil) {
      return;
    }

    const score = scoreSignals(vitals);
    if (score.tier === 0 || score.severity === null) {
      return;
    }

    const existingId = this.activeAlertIdByPatient.get(vitals.patientId);
    const existingAlert = existingId ? this.alertsById.get(existingId) : undefined;

    if (existingAlert && existingAlert.state !== "RESOLVED") {
      if (score.tier > existingAlert.tier) {
        this.resolveAlertInternal(existingAlert, "Superseded by higher-tier alert");
      } else if (score.tier === existingAlert.tier) {
        this.refreshAlert(existingAlert, score);
        return;
      } else {
        return;
      }
    }

    if (this.isOnCooldown(vitals.patientId, score.tier)) {
      return;
    }

    const now = nowIso();
    const patientName = store.getUserById(vitals.patientId)?.name ?? vitals.patientId;
    const created: LiveAlert = {
      id: uuidv4(),
      patientId: vitals.patientId,
      patientName,
      tier: score.tier,
      severity: score.severity,
      state: "FIRED",
      riskPoints: score.points,
      urgencyLevel: 1,
      title: score.title,
      message: score.message,
      flaggedVitals: score.flaggedVitals,
      topContributors: score.topContributors,
      firedAt: now,
      updatedAt: now,
      stateDeadlineAt: toIsoFromNow(FIRED_TO_AWAITING_MS)
    };

    this.alertsById.set(created.id, created);
    this.activeAlertIdByPatient.set(created.patientId, created.id);
    this.setCooldown(created.patientId, created.tier);
    this.fanOutLegacyNotifications(created);
    this.broadcast("alert_upsert", { alert: cloneAlert(created) }, created.patientId);
  }

  acknowledgeAlert(params: { alertId: string; actor: AuthTokenPayload; reason?: string }): AlertActionResult {
    const alert = this.alertsById.get(params.alertId);
    if (!alert) {
      return {
        ok: false,
        error: "not_found",
        message: "Alert not found."
      };
    }
    if (!this.canAccessPatient(params.actor, alert.patientId)) {
      return {
        ok: false,
        error: "forbidden",
        message: "Access denied."
      };
    }
    if (alert.state === "RESOLVED") {
      return {
        ok: false,
        error: "already_resolved",
        message: "Alert already resolved."
      };
    }

    alert.acknowledgedAt = nowIso();
    this.transitionState(alert, "BEING_REVIEWED");
    this.recordAudit({
      alert,
      actorUserId: params.actor.userId,
      actorRole: params.actor.role,
      action: "acknowledge",
      note: params.reason
    });

    return {
      ok: true,
      alert: cloneAlert(alert)
    };
  }

  caregiverAction(params: {
    alertId: string;
    caregiverId: string;
    action: Exclude<CaregiverAlertAction, "bulk_acknowledge">;
    note?: string;
  }): AlertActionResult {
    const alert = this.alertsById.get(params.alertId);
    if (!alert) {
      return {
        ok: false,
        error: "not_found",
        message: "Alert not found."
      };
    }
    const caregiverAuth: AuthTokenPayload = {
      userId: params.caregiverId,
      role: "Caregiver",
      email: ""
    };
    if (!this.canAccessPatient(caregiverAuth, alert.patientId)) {
      return {
        ok: false,
        error: "forbidden",
        message: "Caregiver cannot act on this patient."
      };
    }
    if (alert.state === "RESOLVED") {
      return {
        ok: false,
        error: "already_resolved",
        message: "Alert already resolved."
      };
    }

    if (params.action === "dismiss") {
      this.recordAudit({
        alert,
        actorUserId: params.caregiverId,
        actorRole: "Caregiver",
        action: params.action,
        note: params.note
      });
      this.resolveAlertInternal(alert, params.note ?? "Dismissed by caregiver");
      return {
        ok: true,
        alert: cloneAlert(alert)
      };
    }

    this.transitionState(alert, "BEING_REVIEWED");
    this.recordAudit({
      alert,
      actorUserId: params.caregiverId,
      actorRole: "Caregiver",
      action: params.action,
      note: params.note
    });

    return {
      ok: true,
      alert: cloneAlert(alert)
    };
  }

  bulkAcknowledge(params: { caregiverId: string; tier?: AlertTier }): { acknowledgedCount: number; alertIds: string[] } {
    const caregiverAuth: AuthTokenPayload = {
      userId: params.caregiverId,
      role: "Caregiver",
      email: ""
    };
    let acknowledgedCount = 0;
    const alertIds: string[] = [];

    for (const alert of this.alertsById.values()) {
      if (alert.state === "RESOLVED") {
        continue;
      }
      if (params.tier && alert.tier !== params.tier) {
        continue;
      }
      if (!this.canAccessPatient(caregiverAuth, alert.patientId)) {
        continue;
      }

      const action = this.caregiverAction({
        alertId: alert.id,
        caregiverId: params.caregiverId,
        action: "acknowledge",
        note: "Bulk acknowledge"
      });
      if (action.ok) {
        acknowledgedCount += 1;
        alertIds.push(alert.id);
      }
    }

    return {
      acknowledgedCount,
      alertIds
    };
  }

  getVisibleActiveAlerts(auth: AuthTokenPayload): LiveAlert[] {
    return [...this.alertsById.values()]
      .filter((alert) => alert.state !== "RESOLVED" && this.canAccessPatient(auth, alert.patientId))
      .sort(sortAlerts)
      .map(cloneAlert);
  }

  getAuditLog(auth: AuthTokenPayload): AlertAuditEntry[] {
    return this.auditTrail
      .filter((entry) => this.canAccessPatient(auth, entry.patientId))
      .slice(0, 200)
      .map((entry) => ({ ...entry }));
  }

  getAuditSummary(auth: AuthTokenPayload): AlertAuditSummary {
    const logs = this.getAuditLog(auth);
    if (logs.length === 0) {
      return {
        totalActions: 0,
        averageResponseMs: null
      };
    }

    const totalResponse = logs.reduce((sum, entry) => sum + entry.responseTimeMs, 0);
    return {
      totalActions: logs.length,
      averageResponseMs: Math.round(totalResponse / logs.length),
      lastActionAt: logs[0].timestamp
    };
  }

  private refreshAlert(alert: LiveAlert, score: ScoreResult): void {
    const hasDelta =
      alert.riskPoints !== score.points ||
      alert.title !== score.title ||
      alert.message !== score.message ||
      alert.flaggedVitals.join("|") !== score.flaggedVitals.join("|");

    if (!hasDelta) {
      return;
    }

    alert.riskPoints = score.points;
    alert.title = score.title;
    alert.message = score.message;
    alert.flaggedVitals = score.flaggedVitals;
    alert.topContributors = score.topContributors;
    this.broadcast("alert_upsert", { alert: cloneAlert(alert) }, alert.patientId);
  }

  private advanceStateMachine(): void {
    const now = Date.now();
    for (const activeAlertId of this.activeAlertIdByPatient.values()) {
      const alert = this.alertsById.get(activeAlertId);
      if (!alert || alert.state === "RESOLVED" || !alert.stateDeadlineAt) {
        continue;
      }

      const deadline = new Date(alert.stateDeadlineAt).getTime();
      if (now < deadline) {
        continue;
      }

      if (alert.state === "FIRED") {
        this.transitionState(alert, "AWAITING_ACK");
      } else if (alert.state === "AWAITING_ACK") {
        alert.urgencyLevel = Math.min(alert.urgencyLevel + 1, 5);
        this.transitionState(alert, "ESCALATED");
      } else if (alert.state === "ESCALATED") {
        this.transitionState(alert, "AWAITING_ACK");
      } else if (alert.state === "BEING_REVIEWED") {
        this.resolveAlertInternal(alert, "Resolved after review");
      }
    }
  }

  private transitionState(alert: LiveAlert, nextState: LiveAlertState): void {
    alert.state = nextState;
    alert.updatedAt = nowIso();

    if (nextState === "FIRED") {
      alert.stateDeadlineAt = toIsoFromNow(FIRED_TO_AWAITING_MS);
    } else if (nextState === "AWAITING_ACK") {
      alert.stateDeadlineAt = toIsoFromNow(AWAITING_TO_ESCALATED_MS);
    } else if (nextState === "ESCALATED") {
      alert.stateDeadlineAt = toIsoFromNow(ESCALATED_TO_AWAITING_MS);
    } else if (nextState === "BEING_REVIEWED") {
      alert.stateDeadlineAt = toIsoFromNow(REVIEW_TO_RESOLVED_MS);
    } else if (nextState === "RESOLVED") {
      alert.stateDeadlineAt = undefined;
      alert.resolvedAt = nowIso();
    }

    this.broadcast("alert_upsert", { alert: cloneAlert(alert) }, alert.patientId);
  }

  private resolveAlertInternal(alert: LiveAlert, reason: string): void {
    alert.state = "RESOLVED";
    alert.updatedAt = nowIso();
    alert.resolvedAt = nowIso();
    alert.stateDeadlineAt = undefined;

    const activeForPatient = this.activeAlertIdByPatient.get(alert.patientId);
    if (activeForPatient === alert.id) {
      this.activeAlertIdByPatient.delete(alert.patientId);
    }

    this.recordAudit({
      alert,
      actorUserId: "system",
      actorRole: "System",
      action: "acknowledge",
      note: reason
    });
    this.broadcast("alert_resolved", { alert: cloneAlert(alert) }, alert.patientId);
  }

  private recordAudit(params: {
    alert: LiveAlert;
    actorUserId: string;
    actorRole: AlertAuditEntry["actorRole"];
    action: AlertAuditEntry["action"];
    note?: string;
  }): void {
    const now = nowIso();
    const responseTimeMs = Math.max(0, Date.now() - new Date(params.alert.firedAt).getTime());
    const entry: AlertAuditEntry = {
      id: uuidv4(),
      alertId: params.alert.id,
      patientId: params.alert.patientId,
      actorUserId: params.actorUserId,
      actorRole: params.actorRole,
      action: params.action,
      timestamp: now,
      responseTimeMs,
      note: params.note
    };

    this.auditTrail.unshift(entry);
    this.auditTrail = this.auditTrail.slice(0, 500);

    store.addAuditLog({
      actorUserId: params.actorUserId,
      action: `live_alert_${params.action}`,
      patientId: params.alert.patientId,
      metadata: {
        alertId: params.alert.id,
        tier: params.alert.tier,
        state: params.alert.state,
        responseTimeMs,
        note: params.note ?? null
      }
    });

    this.broadcast("audit", { entry, summary: this.getAuditSummaryForPatient(params.alert.patientId) }, params.alert.patientId);
  }

  private getAuditSummaryForPatient(patientId: string): AlertAuditSummary {
    const logs = this.auditTrail.filter((entry) => entry.patientId === patientId);
    if (logs.length === 0) {
      return {
        totalActions: 0,
        averageResponseMs: null
      };
    }
    const total = logs.reduce((sum, entry) => sum + entry.responseTimeMs, 0);
    return {
      totalActions: logs.length,
      averageResponseMs: Math.round(total / logs.length),
      lastActionAt: logs[0].timestamp
    };
  }

  private fanOutLegacyNotifications(alert: LiveAlert): void {
    store.addNotification({
      userId: alert.patientId,
      patientId: alert.patientId,
      severity: alert.severity,
      title: alert.title,
      message: alert.message
    });

    for (const caregiverId of store.getCaregiverIdsByPatient(alert.patientId)) {
      store.addNotification({
        userId: caregiverId,
        patientId: alert.patientId,
        severity: alert.severity,
        title: alert.title,
        message: alert.message
      });
    }

    for (const beneficiary of store.getBeneficiariesByPatient(alert.patientId)) {
      if (!shouldNotifyBeneficiary(beneficiary.alertPreference, alert.tier)) {
        continue;
      }

      store.addOutboundNotification({
        patientId: alert.patientId,
        channel: "email",
        recipient: beneficiary.email,
        payload: "Patient risk threshold exceeded."
      });
      store.addOutboundNotification({
        patientId: alert.patientId,
        channel: "sms",
        recipient: beneficiary.phone,
        payload: "Patient risk threshold exceeded."
      });
    }
  }

  private isOnCooldown(patientId: string, tier: AlertTier): boolean {
    const key = `${patientId}:${tier}`;
    const cooldownEndsAt = this.cooldowns.get(key) ?? 0;
    return cooldownEndsAt > Date.now();
  }

  private setCooldown(patientId: string, tier: AlertTier): void {
    const key = `${patientId}:${tier}`;
    const cooldownMs = tier === 3 ? 60_000 : tier === 2 ? 180_000 : 90_000;
    this.cooldowns.set(key, Date.now() + cooldownMs);
  }

  private canAccessPatient(auth: AuthTokenPayload, patientId: string): boolean {
    if (auth.role === "Patient") {
      return auth.userId === patientId;
    }
    return store.getCaregiverPatientIds(auth.userId).includes(patientId);
  }

  private sendToSubscriber(subscriberId: string, eventType: AlertStreamEventType, payload: Record<string, unknown>): void {
    const subscriber = this.subscribers.get(subscriberId);
    if (!subscriber) {
      return;
    }

    const envelope = JSON.stringify({
      type: eventType,
      ...payload
    });

    try {
      subscriber.write(`event: ${eventType}\n`);
      subscriber.write(`data: ${envelope}\n\n`);
    } catch {
      this.subscribers.delete(subscriberId);
    }
  }

  private broadcast(eventType: AlertStreamEventType, payload: Record<string, unknown>, patientId: string): void {
    for (const [subscriberId, subscriber] of this.subscribers.entries()) {
      if (!this.canAccessPatient(subscriber.auth, patientId)) {
        continue;
      }
      this.sendToSubscriber(subscriberId, eventType, payload);
    }
  }
}

export const liveAlertService = new LiveAlertService();
