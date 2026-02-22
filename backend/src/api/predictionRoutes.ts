import { Router } from "express";
import { z } from "zod";
import { store } from "../data/store";
import { canAccessPatient } from "../middleware/access";
import { requireAuth } from "../middleware/auth";
import { requireOnboardingComplete } from "../middleware/onboarding";
import { runAndPersistPrediction } from "../services/predictionService";

const vitalsSchema = z.object({
  patientId: z.string().min(3),
  timestamp: z.string().datetime(),
  heartRate: z.number().min(30).max(220),
  stepCount: z.number().min(0).max(100000),
  bloodOxygen: z.number().min(60).max(100),
  sleepScore: z.number().min(0).max(100)
});

const predictRiskSchema = z.object({
  patientId: z.string().min(3),
  samples: z.array(vitalsSchema).min(3).max(500)
});

export const predictionRoutes = Router();

predictionRoutes.post("/predict-risk", requireAuth, requireOnboardingComplete, (req, res) => {
  const parsed = predictRiskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid prediction payload.", details: parsed.error.flatten() });
    return;
  }

  const { patientId, samples } = parsed.data;
  if (!canAccessPatient(req, patientId)) {
    res.status(403).json({ error: "Forbidden for patient target." });
    return;
  }

  for (const sample of samples) {
    if (sample.patientId !== patientId) {
      res.status(400).json({ error: "Samples contain inconsistent patient IDs." });
      return;
    }
  }

  const prediction = runAndPersistPrediction({
    patientId,
    vitals: samples,
    shouldNotify: true
  });

  for (const sample of samples.slice(-5)) {
    store.appendVitals(sample);
  }

  res.json(prediction);
});
