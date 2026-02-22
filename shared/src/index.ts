export type Role = "Patient" | "Caregiver";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  passwordHash: string;
}

export interface OnboardingResponses {
  extremeThirst: number;
  mildActivityBreathless: number;
  wakeUpAtNight: number;
  daytimeFatigue: number;
}

export interface PatientProfile {
  userId: string;
  onboardingResponses: OnboardingResponses | null;
  predictedDisease: PredictedDisease;
  riskScore: number;
  wearableData: StreamingVitals[];
  insuranceId: string;
}

export interface StreamingVitals {
  patientId: string;
  timestamp: string;
  heartRate: number;
  stepCount: number;
  bloodOxygen: number;
  sleepScore: number;
}

export interface PredictionLog {
  patientId: string;
  timestamp: string;
  predictedRiskScore: number;
  predictedDisease: PredictedDisease;
  confidence: number;
  forecastWindow: string;
  modelVersion: string;
}

export interface Beneficiary {
  patientId: string;
  name: string;
  relationship: string;
  email: string;
  phone: string;
}

export interface CaregiverPatientMapping {
  caregiverId: string;
  patientId: string;
}

export type PredictedDisease = "Cardiac" | "Diabetes" | "Stable";

export interface PredictedTrendPoint {
  dayOffset: number;
  score: number;
  label: string;
}

export interface PredictionResponse {
  patientId: string;
  predictedRiskScore: number;
  predictedDisease: PredictedDisease;
  confidence: number;
  forecastWindow: "Next 7 days";
  predictedTrend: PredictedTrendPoint[];
  riskMomentum: "Increasing" | "Improving" | "Stable";
  explainability: string[];
  icdCode: string;
}

export interface NotificationItem {
  id: string;
  userId: string;
  patientId: string;
  timestamp: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  acknowledged: boolean;
}

export interface AuditLogItem {
  id: string;
  actorUserId: string;
  action: string;
  patientId?: string;
  timestamp: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface CaregiverPriorityItem {
  patientId: string;
  patientName: string;
  riskScore: number;
  confidence: number;
  rateOfChange: number;
  priorityScore: number;
  state: "Stable" | "Watch" | "High Risk";
}
