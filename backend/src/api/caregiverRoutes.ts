import { Router } from "express";
import { z } from "zod";
import { store } from "../data/store";
import { requireAuth } from "../middleware/auth";
import { requireOnboardingComplete } from "../middleware/onboarding";
import { requireRole } from "../middleware/role";
import { logCaregiverAction } from "../services/auditService";
import { buildCaregiverPriorityList } from "../services/predictionService";

const mappingSchema = z.object({
  patientId: z.string().min(3)
});

export const caregiverRoutes = Router();

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

caregiverRoutes.use(requireAuth, requireRole("Caregiver"), requireOnboardingComplete);

caregiverRoutes.get("/patients", (req, res) => {
  const caregiverId = req.auth!.userId;
  const patientIds = store.getCaregiverPatientIds(caregiverId);

  logCaregiverAction({
    caregiverId,
    action: "caregiver_list_assigned_patients"
  });

  const patients = patientIds
    .map((patientId) => {
      const user = store.getUserById(patientId);
      const profile = store.getPatientProfile(patientId);
      if (!user || !profile) {
        return null;
      }
      return {
        id: user.id,
        name: user.name,
        predictedDisease: profile.predictedDisease,
        riskScore: profile.riskScore,
        latestPrediction: store.getLatestPrediction(patientId),
        insuranceId: profile.insuranceIdMasked
      };
    })
    .filter(Boolean);

  res.json({
    patients,
    prioritizedAlerts: buildCaregiverPriorityList(caregiverId)
  });
});

caregiverRoutes.get("/patients/:patientId", (req, res) => {
  const caregiverId = req.auth!.userId;
  const { patientId } = req.params;
  const assignedPatientIds = store.getCaregiverPatientIds(caregiverId);
  if (!assignedPatientIds.includes(patientId)) {
    res.status(403).json({ error: "Caregiver is not assigned to this patient." });
    return;
  }

  const user = store.getUserById(patientId);
  const profile = store.getPatientProfile(patientId);
  if (!user || !profile) {
    res.status(404).json({ error: "Patient not found." });
    return;
  }

  logCaregiverAction({
    caregiverId,
    patientId,
    action: "caregiver_view_patient_detail"
  });

  res.json({
    patient: {
      id: user.id,
      name: user.name,
      email: user.email
    },
    profile: {
      ...sanitizeProfileForResponse(profile)
    },
    latestVitals: store.getLatestVitals(patientId),
    latestPrediction: store.getLatestPrediction(patientId),
    predictions: store.getPredictionLogs(patientId)
  });
});

caregiverRoutes.post("/mappings", (req, res) => {
  const parsed = mappingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid mapping payload.", details: parsed.error.flatten() });
    return;
  }

  const caregiverId = req.auth!.userId;
  const patient = store.getUserById(parsed.data.patientId);

  if (!patient || patient.role !== "Patient") {
    res.status(404).json({ error: "Patient not found." });
    return;
  }

  store.addCaregiverMapping(caregiverId, parsed.data.patientId);
  logCaregiverAction({
    caregiverId,
    patientId: parsed.data.patientId,
    action: "caregiver_add_mapping"
  });

  res.status(201).json({ message: "Mapping created." });
});

caregiverRoutes.get("/alerts/prioritized", (req, res) => {
  const caregiverId = req.auth!.userId;
  const prioritized = buildCaregiverPriorityList(caregiverId);

  logCaregiverAction({
    caregiverId,
    action: "caregiver_view_prioritized_alerts"
  });

  res.json({
    prioritized
  });
});

caregiverRoutes.get("/audit", (req, res) => {
  const caregiverId = req.auth!.userId;

  const auditLogs = store
    .listAuditLogs()
    .filter((entry) => entry.actorUserId === caregiverId)
    .slice(0, 100);

  res.json({
    auditLogs
  });
});
