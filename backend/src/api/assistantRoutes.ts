import { Router } from "express";
import { z } from "zod";
import { store } from "../data/store";
import { canAccessPatient } from "../middleware/access";
import { requireAuth } from "../middleware/auth";
import { requireOnboardingComplete } from "../middleware/onboarding";
import { FeatherlessRateLimitError, generateAssistantChat, generateCoachingPlan } from "../services/wellnessAssistantService";

const coachPlanSchema = z.object({
  patientId: z.string().min(3).optional()
});

const chatSchema = z.object({
  patientId: z.string().min(3).optional(),
  message: z.string().min(2).max(2000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(2000)
      })
    )
    .max(12)
    .optional()
});

export const assistantRoutes = Router();

assistantRoutes.use(requireAuth, requireOnboardingComplete);

function resolveTargetPatientId(req: Parameters<typeof canAccessPatient>[0], requestedPatientId?: string): string | null {
  if (!req.auth) {
    return null;
  }

  if (req.auth.role === "Patient") {
    if (requestedPatientId && requestedPatientId !== req.auth.userId) {
      return null;
    }
    return req.auth.userId;
  }

  const target = requestedPatientId;
  if (!target) {
    return null;
  }
  return canAccessPatient(req, target) ? target : null;
}

function maybeCreateAssistantNotifications(params: {
  actorId: string;
  actorRole: "Patient" | "Caregiver";
  patientId: string;
  title: string;
  urgency: "low" | "moderate" | "high";
  reminderTask?: string;
  appointmentHint?: string;
}): void {
  const severity = params.urgency === "high" ? "critical" : params.urgency === "moderate" ? "warning" : "info";

  if (params.urgency !== "high" && !params.reminderTask && !params.appointmentHint) {
    return;
  }

  if (params.urgency === "high") {
    store.addNotification({
      userId: params.patientId,
      patientId: params.patientId,
      severity,
      title: "Virtual Assistant Escalation",
      message: "Assistant detected high-risk symptom context. Please review immediately."
    });

    for (const caregiverId of store.getCaregiverIdsByPatient(params.patientId)) {
      store.addNotification({
        userId: caregiverId,
        patientId: params.patientId,
        severity,
        title: "Patient Assistant Escalation",
        message: "Patient symptom triage flagged as high urgency."
      });
    }
    return;
  }

  if (params.reminderTask) {
    store.addNotification({
      userId: params.patientId,
      patientId: params.patientId,
      severity: "info",
      title: "Medication Reminder Suggestion",
      message: params.reminderTask
    });
  }

  if (params.appointmentHint) {
    store.addNotification({
      userId: params.patientId,
      patientId: params.patientId,
      severity: "info",
      title: "Appointment Planning Suggestion",
      message: params.appointmentHint
    });
  }
}

assistantRoutes.post("/coach-plan", async (req, res) => {
  const parsed = coachPlanSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid coaching payload.", details: parsed.error.flatten() });
    return;
  }

  const patientId = resolveTargetPatientId(req, parsed.data.patientId);
  if (!patientId) {
    res.status(403).json({ error: "Forbidden patient target." });
    return;
  }

  const patient = store.getUserById(patientId);
  if (!patient || patient.role !== "Patient") {
    res.status(404).json({ error: "Patient not found." });
    return;
  }

  try {
    const plan = await generateCoachingPlan(patientId, { allowFallbackOnError: true });
    res.json(plan);
  } catch (error) {
    if (error instanceof FeatherlessRateLimitError) {
      const retryAfterSeconds = error.retryAfterMs ? Math.max(1, Math.ceil(error.retryAfterMs / 1000)) : 30;
      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.status(429).json({
        error: `LLM rate limit reached. Retry in about ${retryAfterSeconds}s.`,
        details: error.message
      });
      return;
    }
    res.status(502).json({
      error: "Unable to generate coaching plan from LLM.",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

assistantRoutes.post("/chat", async (req, res) => {
  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid assistant payload.", details: parsed.error.flatten() });
    return;
  }

  const patientId = resolveTargetPatientId(req, parsed.data.patientId);
  if (!patientId) {
    res.status(403).json({ error: "Forbidden patient target." });
    return;
  }

  const patient = store.getUserById(patientId);
  if (!patient || patient.role !== "Patient") {
    res.status(404).json({ error: "Patient not found." });
    return;
  }

  try {
    const output = await generateAssistantChat({
      patientId,
      message: parsed.data.message,
      history: parsed.data.history,
      options: { allowFallbackOnError: true }
    });

    maybeCreateAssistantNotifications({
      actorId: req.auth!.userId,
      actorRole: req.auth!.role,
      patientId,
      title: output.reply.title,
      urgency: output.reply.urgency,
      reminderTask: output.reply.reminder?.task,
      appointmentHint: output.reply.appointment
        ? `${output.reply.appointment.specialty} - ${output.reply.appointment.timeframe}`
        : undefined
    });

    res.json(output);
  } catch (error) {
    if (error instanceof FeatherlessRateLimitError) {
      const retryAfterSeconds = error.retryAfterMs ? Math.max(1, Math.ceil(error.retryAfterMs / 1000)) : 30;
      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.status(429).json({
        error: `LLM rate limit reached. Retry in about ${retryAfterSeconds}s.`,
        details: error.message
      });
      return;
    }
    res.status(502).json({
      error: "Unable to generate assistant response from LLM.",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});
