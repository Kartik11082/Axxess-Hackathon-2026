import { Router } from "express";
import { z } from "zod";
import { store } from "../data/store";
import { persistBeneficiaries } from "../db/persistentDomain";
import { canAccessPatient } from "../middleware/access";
import { requireAuth } from "../middleware/auth";
import { requireOnboardingComplete } from "../middleware/onboarding";
import { requireRole } from "../middleware/role";
import { logCaregiverAction } from "../services/auditService";
import { getPatientPredictionSeries } from "../services/predictionService";

const beneficiarySchema = z.object({
  name: z.string().min(2).max(120),
  relationship: z.string().min(2).max(80),
  email: z.string().email(),
  phone: z.string().min(7).max(30),
  alertPreference: z.enum(["high-risk-only", "all-alerts", "emergency-only"]).default("high-risk-only")
});

export const patientRoutes = Router();

function getParamAsString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

function sanitizeProfileForResponse(profile: NonNullable<ReturnType<typeof store.getPatientProfile>>) {
  return {
    ...profile,
    insurance: profile.insurance
      ? {
          provider: profile.insurance.provider,
          memberIdMasked: profile.insurance.memberIdMasked,
          groupNumberMasked: profile.insurance.groupNumberMasked
        }
      : null
  };
}

patientRoutes.get("/me", requireAuth, requireRole("Patient"), requireOnboardingComplete, (req, res) => {
  const profile = store.getPatientProfile(req.auth!.userId);
  const user = store.getUserById(req.auth!.userId);
  if (!profile || !user) {
    res.status(404).json({ error: "Patient profile not found." });
    return;
  }

  const latestPrediction = store.getLatestPrediction(req.auth!.userId);
  const latestVitals = store.getLatestVitals(req.auth!.userId);

  res.json({
    patient: {
      id: user.id,
      name: user.name,
      email: user.email
    },
    profile: sanitizeProfileForResponse(profile),
    latestVitals,
    latestPrediction
  });
});

patientRoutes.post("/me/beneficiaries", requireAuth, requireRole("Patient"), requireOnboardingComplete, async (req, res) => {
  const parsed = beneficiarySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid beneficiary payload.", details: parsed.error.flatten() });
    return;
  }

  store.addBeneficiary({
    patientId: req.auth!.userId,
    ...parsed.data
  });
  await persistBeneficiaries(req.auth!.userId);

  res.status(201).json({ message: "Beneficiary added." });
});

patientRoutes.get("/:patientId/vitals", requireAuth, requireOnboardingComplete, (req, res) => {
  const patientId = getParamAsString(req.params.patientId);
  if (!canAccessPatient(req, patientId)) {
    res.status(403).json({ error: "Forbidden." });
    return;
  }

  const profile = store.getPatientProfile(patientId);
  if (!profile) {
    res.status(404).json({ error: "Patient profile not found." });
    return;
  }

  if (req.auth!.role === "Caregiver") {
    logCaregiverAction({
      caregiverId: req.auth!.userId,
      patientId,
      action: "caregiver_view_vitals"
    });
  }

  res.json({
    patientId,
    latestVitals: store.getLatestVitals(patientId),
    recentVitals: profile.wearableData.slice(-100)
  });
});

patientRoutes.get("/:patientId/predictions", requireAuth, requireOnboardingComplete, (req, res) => {
  const patientId = getParamAsString(req.params.patientId);
  if (!canAccessPatient(req, patientId)) {
    res.status(403).json({ error: "Forbidden." });
    return;
  }

  if (req.auth!.role === "Caregiver") {
    logCaregiverAction({
      caregiverId: req.auth!.userId,
      patientId,
      action: "caregiver_view_predictions"
    });
  }

  res.json({
    patientId,
    latestPrediction: store.getLatestPrediction(patientId),
    predictionHistory: getPatientPredictionSeries(patientId),
    predictionLogs: store.getPredictionLogs(patientId)
  });
});
