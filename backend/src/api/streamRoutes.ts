import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { requireOnboardingComplete } from "../middleware/onboarding";
import { requireRole } from "../middleware/role";
import { liveAlertService } from "../services/liveAlertService";

const acknowledgeSchema = z.object({
  alertId: z.string().min(1),
  reason: z.string().max(300).optional()
});

const actionSchema = z.object({
  alertId: z.string().min(1),
  action: z.enum(["acknowledge", "call_patient", "alert_staff", "dismiss"]),
  note: z.string().max(300).optional()
});

const bulkAcknowledgeSchema = z.object({
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional()
});

export const streamRoutes = Router();

streamRoutes.get("/", requireAuth, requireOnboardingComplete, (req, res) => {
  const auth = req.auth!;

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  res.write("retry: 3000\n\n");

  const subscriberId = liveAlertService.addSubscriber({
    auth,
    write: (chunk) => {
      res.write(chunk);
    }
  });

  const heartbeat = setInterval(() => {
    res.write(`: keepalive ${Date.now()}\n\n`);
  }, 15_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    liveAlertService.removeSubscriber(subscriberId);
    res.end();
  });
});

streamRoutes.post("/acknowledge", requireAuth, requireOnboardingComplete, (req, res) => {
  const parsed = acknowledgeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid acknowledge payload.", details: parsed.error.flatten() });
    return;
  }

  const result = liveAlertService.acknowledgeAlert({
    alertId: parsed.data.alertId,
    actor: req.auth!,
    reason: parsed.data.reason
  });

  if (!result.ok) {
    const status = result.error === "forbidden" ? 403 : result.error === "already_resolved" ? 409 : 404;
    res.status(status).json({ error: result.message });
    return;
  }

  res.json({
    alert: result.alert
  });
});

streamRoutes.post("/action", requireAuth, requireRole("Caregiver"), requireOnboardingComplete, (req, res) => {
  const parsed = actionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid action payload.", details: parsed.error.flatten() });
    return;
  }

  const result = liveAlertService.caregiverAction({
    alertId: parsed.data.alertId,
    caregiverId: req.auth!.userId,
    action: parsed.data.action,
    note: parsed.data.note
  });

  if (!result.ok) {
    const status = result.error === "forbidden" ? 403 : result.error === "already_resolved" ? 409 : 404;
    res.status(status).json({ error: result.message });
    return;
  }

  res.json({
    alert: result.alert
  });
});

streamRoutes.post("/bulk-acknowledge", requireAuth, requireRole("Caregiver"), requireOnboardingComplete, (req, res) => {
  const parsed = bulkAcknowledgeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid bulk acknowledge payload.", details: parsed.error.flatten() });
    return;
  }

  const result = liveAlertService.bulkAcknowledge({
    caregiverId: req.auth!.userId,
    tier: parsed.data.tier
  });

  res.json({
    acknowledgedCount: result.acknowledgedCount,
    alertIds: result.alertIds
  });
});

streamRoutes.get("/audit-log", requireAuth, requireOnboardingComplete, (req, res) => {
  const auth = req.auth!;
  const entries = liveAlertService.getAuditLog(auth);
  const summary = liveAlertService.getAuditSummary(auth);

  res.json({
    entries,
    summary
  });
});
