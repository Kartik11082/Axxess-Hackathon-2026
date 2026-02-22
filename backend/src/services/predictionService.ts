import { store } from "../data/store";
import { CaregiverPriorityItem, PredictionLog, PredictionResponse, StreamingVitals } from "../models/types";
import { evaluateAndSendRiskNotifications } from "./notificationService";
import { runPredictionModel } from "./riskModel";

function toPredictionLog(prediction: PredictionResponse): PredictionLog {
  return {
    patientId: prediction.patientId,
    timestamp: new Date().toISOString(),
    predictedRiskScore: prediction.predictedRiskScore,
    predictedDisease: prediction.predictedDisease,
    confidence: prediction.confidence,
    forecastWindow: prediction.forecastWindow,
    predictedTrend: prediction.predictedTrend,
    riskMomentum: prediction.riskMomentum,
    explainability: prediction.explainability,
    icdCode: prediction.icdCode,
    modelVersion: "mock-risk-model-v1.0.0"
  };
}

export function runAndPersistPrediction(params: {
  patientId: string;
  vitals: StreamingVitals[];
  shouldNotify: boolean;
}): PredictionResponse {
  const previousPrediction = store.getLatestPrediction(params.patientId);
  const prediction = runPredictionModel({
    patientId: params.patientId,
    vitals: params.vitals,
    previousPrediction
  });

  store.addPredictionLog(toPredictionLog(prediction));
  store.setPatientRisk(params.patientId, prediction.predictedDisease, prediction.predictedRiskScore);

  if (params.shouldNotify) {
    evaluateAndSendRiskNotifications({
      patientId: params.patientId,
      prediction,
      recentVitals: params.vitals
    });
  }

  return prediction;
}

export function getPatientPredictionSeries(patientId: string): Array<{
  timestamp: string;
  riskScore: number;
  confidence: number;
}> {
  return store.getPredictionLogs(patientId).map((entry) => ({
    timestamp: entry.timestamp,
    riskScore: entry.predictedRiskScore,
    confidence: entry.confidence
  }));
}

function heatmapState(score: number): "Stable" | "Watch" | "High Risk" {
  if (score >= 0.75) {
    return "High Risk";
  }
  if (score >= 0.45) {
    return "Watch";
  }
  return "Stable";
}

export function buildCaregiverPriorityList(caregiverId: string): CaregiverPriorityItem[] {
  const patientIds = store.getCaregiverPatientIds(caregiverId);
  const prioritized: CaregiverPriorityItem[] = [];

  for (const patientId of patientIds) {
    const patientUser = store.getUserById(patientId);
    if (!patientUser) {
      continue;
    }

    const logs = store.getPredictionLogs(patientId);
    const latest = logs[logs.length - 1];
    const previous = logs[logs.length - 2];

    const riskScore = latest?.predictedRiskScore ?? store.getPatientProfile(patientId)?.riskScore ?? 0;
    const confidence = latest?.confidence ?? 0.6;
    const rateOfChange = latest && previous ? Number((latest.predictedRiskScore - previous.predictedRiskScore).toFixed(2)) : 0;
    const priorityScore = Number((riskScore * confidence * (1 + Math.max(rateOfChange, 0))).toFixed(3));

    prioritized.push({
      patientId,
      patientName: patientUser.name,
      riskScore,
      confidence,
      rateOfChange,
      priorityScore,
      state: heatmapState(riskScore)
    });
  }

  return prioritized.sort((a, b) => b.priorityScore - a.priorityScore);
}
