import { config } from "../config";
import { store } from "../data/store";
import { PredictionResponse, StreamingVitals } from "../models/types";

function shouldSendToBeneficiary(params: {
  preference: "high-risk-only" | "all-alerts" | "emergency-only";
  severity: "info" | "warning" | "critical";
  title: string;
}): boolean {
  if (params.preference === "all-alerts") {
    return true;
  }
  if (params.preference === "high-risk-only") {
    return params.severity === "critical" || params.title === "Risk Threshold Exceeded";
  }
  return params.title === "Sustained Heart Rate Spike";
}

export function evaluateAndSendRiskNotifications(params: {
  patientId: string;
  prediction: PredictionResponse;
  recentVitals: StreamingVitals[];
}): void {
  const { patientId, prediction, recentVitals } = params;
  const notificationsToCreate: Array<{
    severity: "info" | "warning" | "critical";
    title: string;
    message: string;
  }> = [];

  if (prediction.predictedRiskScore > config.predictionRiskThreshold) {
    notificationsToCreate.push({
      severity: "critical",
      title: "Risk Threshold Exceeded",
      message: "Patient risk threshold exceeded."
    });
  }

  if (prediction.confidence > config.predictionConfidenceThreshold) {
    notificationsToCreate.push({
      severity: "warning",
      title: "High Confidence Prediction",
      message: "Model confidence exceeded configured threshold."
    });
  }

  const latestHrSamples = recentVitals.slice(-config.sustainedHrSamples).map((vital) => vital.heartRate);
  const sustainedHrSpike =
    latestHrSamples.length === config.sustainedHrSamples &&
    latestHrSamples.every((value) => value > config.sustainedHrThreshold);

  if (sustainedHrSpike) {
    notificationsToCreate.push({
      severity: "critical",
      title: "Sustained Heart Rate Spike",
      message: "Sustained heart-rate anomaly detected."
    });
  }

  if (notificationsToCreate.length === 0) {
    return;
  }

  const caregiverIds = store.getCaregiverIdsByPatient(patientId);
  const beneficiaries = store.getBeneficiariesByPatient(patientId);

  for (const notification of notificationsToCreate) {
    store.addNotification({
      userId: patientId,
      patientId,
      severity: notification.severity,
      title: notification.title,
      message: notification.message
    });

    for (const caregiverId of caregiverIds) {
      store.addNotification({
        userId: caregiverId,
        patientId,
        severity: notification.severity,
        title: notification.title,
        message: notification.message
      });
    }

    for (const beneficiary of beneficiaries) {
      if (
        !shouldSendToBeneficiary({
          preference: beneficiary.alertPreference,
          severity: notification.severity,
          title: notification.title
        })
      ) {
        continue;
      }
      store.addOutboundNotification({
        patientId,
        channel: "email",
        recipient: beneficiary.email,
        payload: "Patient risk threshold exceeded."
      });
      store.addOutboundNotification({
        patientId,
        channel: "sms",
        recipient: beneficiary.phone,
        payload: "Patient risk threshold exceeded."
      });
    }
  }
}
