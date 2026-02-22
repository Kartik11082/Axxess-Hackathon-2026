export type Role = "Patient" | "Caregiver";
export type ActivityLevel = "Low" | "Moderate" | "High";
export type LifeStage = "Early adult" | "Mid-life" | "Senior";
export type AlertPreference = "high-risk-only" | "all-alerts" | "emergency-only";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  onboardingCompleted: boolean;
  patientCode?: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
  nextPath: string;
}

export interface OnboardingStatus {
  userId: string;
  role: Role;
  onboardingCompleted: boolean;
  nextPath: string;
}

export interface StreamingVitals {
  patientId: string;
  timestamp: string;
  heartRate: number;
  stepCount: number;
  bloodOxygen: number;
  sleepScore: number;
}

export type PredictedDisease = "Cardiac" | "Diabetes" | "Stable";

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

export interface PatientSummary {
  id: string;
  name: string;
  predictedDisease: PredictedDisease;
  riskScore: number;
  insuranceId: string;
  latestPrediction?: PredictionResponse;
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

export interface PatientBehavioralResponses {
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

export interface PatientInsuranceDraft {
  provider: string;
  memberId: string;
  groupNumber: string;
}

export interface BeneficiaryDraft {
  name: string;
  relationship: string;
  email: string;
  phone: string;
  alertPreference: AlertPreference;
}

export interface PatientConsentDraft {
  dataUsageAccepted: boolean;
  wearableConsentAccepted: boolean;
  aiModelingAcknowledged: boolean;
  version: string;
}

export interface PatientOnboardingDraft {
  userId: string;
  basicInfo: PatientBasicInfo | null;
  behavioralResponses: PatientBehavioralResponses | null;
  insurance: {
    provider: string;
    memberIdMasked: string;
    groupNumberMasked: string;
  } | null;
  beneficiaries: BeneficiaryDraft[];
  consent: PatientConsentDraft | null;
  currentStep: number;
  completed: boolean;
  updatedAt: string;
}

export interface CaregiverProfessionalDraft {
  licenseNumber?: string;
  specialization: string;
  yearsOfExperience: number;
}

export interface CaregiverAssignmentDraft {
  assignmentMode: "admin_assign_later" | "request_access";
  patientEmail?: string;
  patientCode?: string;
}

export interface CaregiverConsentDraft {
  hipaaAccepted: boolean;
  dataAccessAccepted: boolean;
  version: string;
}

export interface CaregiverOnboardingDraft {
  userId: string;
  professionalProfile: {
    userId: string;
    licenseNumber?: string;
    specialization: string;
    yearsOfExperience: number;
    assignmentMode: "admin_assign_later" | "request_access";
    requestedPatientEmail?: string;
    requestedPatientCode?: string;
  } | null;
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
