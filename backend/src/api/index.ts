import { Router } from "express";
import { authRoutes } from "./authRoutes";
import { onboardingRoutes } from "./onboardingRoutes";
import { patientRoutes } from "./patientRoutes";
import { caregiverRoutes } from "./caregiverRoutes";
import { predictionRoutes } from "./predictionRoutes";
import { notificationRoutes } from "./notificationRoutes";
import { insuranceRoutes } from "./insuranceRoutes";

export const apiRouter = Router();

apiRouter.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "Axxess predictive care backend"
  });
});

apiRouter.get("/demo-credentials", (_req, res) => {
  res.json({
    note: "Mock accounts for local testing",
    accounts: [
      {
        role: "Patient",
        email: "patient1@demo.com",
        password: "Password123!"
      },
      {
        role: "Patient",
        email: "patient2@demo.com",
        password: "Password123!"
      },
      {
        role: "Caregiver",
        email: "caregiver@demo.com",
        password: "Password123!"
      }
    ]
  });
});

apiRouter.use("/auth", authRoutes);
apiRouter.use("/onboarding", onboardingRoutes);
apiRouter.use("/patients", patientRoutes);
apiRouter.use("/caregiver", caregiverRoutes);
apiRouter.use("/", predictionRoutes);
apiRouter.use("/notifications", notificationRoutes);
apiRouter.use("/insurance", insuranceRoutes);
