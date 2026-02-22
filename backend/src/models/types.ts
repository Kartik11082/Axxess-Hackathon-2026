export type Role = "Patient" | "Caregiver";

export type PredictedDisease = "Cardiac" | "Diabetes" | "Stable";

export type ActivityLevel = "Low" | "Moderate" | "High";
export type LifeStage = "Early adult" | "Mid-life" | "Senior";
export type AlertPreference = "high-risk-only" | "all-alerts" | "emergency-only";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  onboardingCompleted: boolean;
  patientCode?: string;
  passwordHash: string;
}

export interface OnboardingResponses {
  unusualThirst: number;
  wakeUpAtNight: number;
  breathlessDuringLightActivity: number;
  fatigueAfterMeals: number;
  monitorHeartRateRegularly: number;
}

export interface PatientBasicInfo {
  preferredName: string;
  heightRange: string;
  activityLevel: ActivityLevel;
  lifeStage: LifeStage;
}

export interface InsuranceDetails {
  provider: string;
  memberIdEncrypted: string;
  memberIdMasked: string;
  groupNumberEncrypted: string;
  groupNumberMasked: string;
}

export interface PatientOnboardingDraft {
  userId: string;
  basicInfo: PatientBasicInfo | null;
  behavioralResponses: OnboardingResponses | null;
  insurance: InsuranceDetails | null;
  beneficiaries: Beneficiary[];
  consent: {
    dataUsageAccepted: boolean;
    wearableConsentAccepted: boolean;
    aiModelingAcknowledged: boolean;
    version: string;
    acceptedAt?: string;
  } | null;
  currentStep: number;
  completed: boolean;
  updatedAt: string;
}

export interface CaregiverProfessionalProfile {
  userId: string;
  licenseNumber?: string;
  specialization: string;
  yearsOfExperience: number;
  assignmentMode: "admin_assign_later" | "request_access";
  requestedPatientEmail?: string;
  requestedPatientCode?: string;
}

export interface CaregiverOnboardingDraft {
  userId: string;
  professionalProfile: CaregiverProfessionalProfile | null;
  consent: {
    hipaaAccepted: boolean;
    dataAccessAccepted: boolean;
    version: string;
    acceptedAt?: string;
  } | null;
  currentStep: number;
  completed: boolean;
  updatedAt: string;
}

export interface PatientProfile {
  userId: string;
  basicInfo: PatientBasicInfo | null;
  onboardingResponses: OnboardingResponses | null;
  insurance: InsuranceDetails | null;
  predictedDisease: PredictedDisease;
  initialRiskConfidence: "Low" | "Moderate" | "High";
  riskScore: number;
  wearableData: StreamingVitals[];
  insuranceIdMasked: string;
  onboardingCompletedAt?: string;
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
  forecastWindow: "Next 7 days";
  predictedTrend: PredictedTrendPoint[];
  riskMomentum: "Increasing" | "Improving" | "Stable";
  explainability: string[];
  icdCode: string;
  modelVersion: string;
}

export interface Beneficiary {
  patientId: string;
  name: string;
  relationship: string;
  email: string;
  phone: string;
  alertPreference: AlertPreference;
}

export interface CaregiverPatientMapping {
  caregiverId: string;
  patientId: string;
}

export interface PredictedTrendPoint {
  dayOffset: number;
  label: string;
  score: number;
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

export interface OutboundNotification {
  id: string;
  patientId: string;
  channel: "email" | "sms";
  recipient: string;
  timestamp: string;
  payload: string;
}

export interface AuditLogItem {
  id: string;
  actorUserId: string;
  action: string;
  patientId?: string;
  timestamp: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface ConsentLogItem {
  id: string;
  userId: string;
  role: Role;
  consentType: "patient_onboarding" | "caregiver_onboarding";
  version: string;
  acceptedAt: string;
  ipAddress: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface AuthTokenPayload {
  userId: string;
  role: Role;
  email: string;
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

export interface OnboardingStatus {
  userId: string;
  role: Role;
  onboardingCompleted: boolean;
  nextPath: string;
}
