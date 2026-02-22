import { Router } from "express";
import { store } from "../data/store";
import { canAccessPatient } from "../middleware/access";
import { requireAuth } from "../middleware/auth";
import { requireOnboardingComplete } from "../middleware/onboarding";
import { mapDiseaseToIcd } from "../services/riskModel";

export const insuranceRoutes = Router();

insuranceRoutes.use(requireAuth, requireOnboardingComplete);

insuranceRoutes.get("/check/:patientId", (req, res) => {
  const { patientId } = req.params;
  if (!canAccessPatient(req, patientId)) {
    res.status(403).json({ error: "Forbidden." });
    return;
  }

  const profile = store.getPatientProfile(patientId);
  if (!profile) {
    res.status(404).json({ error: "Patient not found." });
    return;
  }

  const latestPrediction = store.getLatestPrediction(patientId);
  const disease = latestPrediction?.predictedDisease ?? profile.predictedDisease;
  const icdCode = latestPrediction?.icdCode ?? mapDiseaseToIcd(disease);

  const compatibility =
    disease === "Stable"
      ? "No active coverage estimation required"
      : disease === "Cardiac"
        ? "Likely compatible with cardiology benefit category"
        : "Likely compatible with endocrine/chronic care category";

  res.json({
    patientId,
    predictedDisease: disease,
    icdCode,
    coverageCompatibility: compatibility
  });
});
