import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import {
  AuditLogItem,
  Beneficiary,
  CaregiverOnboardingDraft,
  CaregiverPatientMapping,
  CaregiverProfessionalProfile,
  ConsentLogItem,
  NotificationItem,
  OnboardingResponses,
  OnboardingStatus,
  OutboundNotification,
  PatientOnboardingDraft,
  PatientProfile,
  PredictionLog,
  PredictedDisease,
  StreamingVitals,
  User
} from "../models/types";
import { maskGenericId } from "../utils/mask";
import { encryptSensitiveValue } from "../utils/crypto";
import { nowIso } from "../utils/time";

const demoPassword = bcrypt.hashSync("Password123!", 10);

function createInsuranceRecord(provider: string, memberId: string, groupNumber: string) {
  return {
    provider,
    memberIdEncrypted: encryptSensitiveValue(memberId),
    memberIdMasked: maskGenericId(memberId),
    groupNumberEncrypted: encryptSensitiveValue(groupNumber),
    groupNumberMasked: maskGenericId(groupNumber)
  };
}

const users: User[] = [
  {
    id: "pat-001",
    name: "Ava Thompson",
    email: "patient1@demo.com",
    role: "Patient",
    onboardingCompleted: true,
    patientCode: "PT-001",
    passwordHash: demoPassword
  },
  {
    id: "pat-002",
    name: "Noah Lee",
    email: "patient2@demo.com",
    role: "Patient",
    onboardingCompleted: false,
    patientCode: "PT-002",
    passwordHash: demoPassword
  },
  {
    id: "cg-001",
    name: "Jordan Smith",
    email: "caregiver@demo.com",
    role: "Caregiver",
    onboardingCompleted: true,
    passwordHash: demoPassword
  }
];

const seededInsurance = createInsuranceRecord("Axxess Shield", "INS-2026-884312", "GRP-44321");

const patientProfiles = new Map<string, PatientProfile>([
  [
    "pat-001",
    {
      userId: "pat-001",
      basicInfo: {
        preferredName: "Ava",
        heightRange: "5'4\" - 5'6\"",
        activityLevel: "Moderate",
        lifeStage: "Mid-life"
      },
      onboardingResponses: {
        unusualThirst: 2,
        wakeUpAtNight: 2,
        breathlessDuringLightActivity: 1,
        fatigueAfterMeals: 1,
        monitorHeartRateRegularly: 2
      },
      insurance: seededInsurance,
      predictedDisease: "Stable",
      initialRiskConfidence: "Low",
      riskScore: 0.28,
      wearableData: [],
      insuranceIdMasked: seededInsurance.memberIdMasked,
      onboardingCompletedAt: nowIso()
    }
  ],
  [
    "pat-002",
    {
      userId: "pat-002",
      basicInfo: null,
      onboardingResponses: null,
      insurance: null,
      predictedDisease: "Stable",
      initialRiskConfidence: "Low",
      riskScore: 0.33,
      wearableData: [],
      insuranceIdMasked: ""
    }
  ]
]);

const caregiverPatientMappings: CaregiverPatientMapping[] = [
  {
    caregiverId: "cg-001",
    patientId: "pat-001"
  },
  {
    caregiverId: "cg-001",
    patientId: "pat-002"
  }
];

const beneficiaries: Beneficiary[] = [
  {
    patientId: "pat-001",
    name: "Casey Thompson",
    relationship: "Spouse",
    email: "casey@example.com",
    phone: "+15550000001",
    alertPreference: "high-risk-only"
  },
  {
    patientId: "pat-002",
    name: "Mia Lee",
    relationship: "Daughter",
    email: "mia@example.com",
    phone: "+15550000002",
    alertPreference: "emergency-only"
  }
];

function emptyPatientOnboardingDraft(userId: string): PatientOnboardingDraft {
  return {
    userId,
    basicInfo: null,
    behavioralResponses: null,
    insurance: null,
    beneficiaries: [],
    consent: null,
    currentStep: 1,
    completed: false,
    updatedAt: nowIso()
  };
}

function emptyCaregiverOnboardingDraft(userId: string): CaregiverOnboardingDraft {
  return {
    userId,
    professionalProfile: null,
    consent: null,
    currentStep: 1,
    completed: false,
    updatedAt: nowIso()
  };
}

const patientOnboardingDrafts = new Map<string, PatientOnboardingDraft>([["pat-002", emptyPatientOnboardingDraft("pat-002")]]);
const caregiverOnboardingDrafts = new Map<string, CaregiverOnboardingDraft>([["cg-001", { ...emptyCaregiverOnboardingDraft("cg-001"), completed: true }]]);
const caregiverProfiles = new Map<string, CaregiverProfessionalProfile>([
  [
    "cg-001",
    {
      userId: "cg-001",
      specialization: "Chronic Care",
      yearsOfExperience: 9,
      assignmentMode: "admin_assign_later"
    }
  ]
]);

const vitalsByPatient = new Map<string, StreamingVitals[]>();
const predictionLogsByPatient = new Map<string, PredictionLog[]>();
const notifications: NotificationItem[] = [];
const outboundNotifications: OutboundNotification[] = [];
const auditLogs: AuditLogItem[] = [];
const consentLogs: ConsentLogItem[] = [];

function getUserByEmail(email: string): User | undefined {
  return users.find((user) => user.email.toLowerCase() === email.toLowerCase());
}

function getUserById(userId: string): User | undefined {
  return users.find((user) => user.id === userId);
}

function getUserByPatientCode(patientCode: string): User | undefined {
  return users.find((user) => user.patientCode?.toLowerCase() === patientCode.toLowerCase());
}

function createUser(params: { name: string; email: string; role: "Patient" | "Caregiver"; passwordHash: string }): User {
  const userId = `${params.role === "Patient" ? "pat" : "cg"}-${uuidv4().slice(0, 8)}`;
  const user: User = {
    id: userId,
    name: params.name,
    email: params.email,
    role: params.role,
    onboardingCompleted: false,
    patientCode: params.role === "Patient" ? `PT-${Math.floor(1000 + Math.random() * 9000)}` : undefined,
    passwordHash: params.passwordHash
  };
  users.push(user);

  if (user.role === "Patient") {
    patientProfiles.set(user.id, {
      userId: user.id,
      basicInfo: null,
      onboardingResponses: null,
      insurance: null,
      predictedDisease: "Stable",
      initialRiskConfidence: "Low",
      riskScore: 0.2,
      wearableData: [],
      insuranceIdMasked: ""
    });
    patientOnboardingDrafts.set(user.id, emptyPatientOnboardingDraft(user.id));
  } else {
    caregiverOnboardingDrafts.set(user.id, emptyCaregiverOnboardingDraft(user.id));
  }

  return user;
}

function upsertUser(user: User): User {
  const existingById = users.find((item) => item.id === user.id);
  if (existingById) {
    existingById.name = user.name;
    existingById.email = user.email;
    existingById.role = user.role;
    existingById.onboardingCompleted = user.onboardingCompleted;
    existingById.patientCode = user.patientCode;
    existingById.passwordHash = user.passwordHash;
    return existingById;
  }

  const existingByEmail = users.find((item) => item.email.toLowerCase() === user.email.toLowerCase());
  if (existingByEmail) {
    existingByEmail.id = user.id;
    existingByEmail.name = user.name;
    existingByEmail.role = user.role;
    existingByEmail.onboardingCompleted = user.onboardingCompleted;
    existingByEmail.patientCode = user.patientCode;
    existingByEmail.passwordHash = user.passwordHash;
    return existingByEmail;
  }

  users.push({ ...user });

  if (user.role === "Patient") {
    if (!patientProfiles.has(user.id)) {
      patientProfiles.set(user.id, {
        userId: user.id,
        basicInfo: null,
        onboardingResponses: null,
        insurance: null,
        predictedDisease: "Stable",
        initialRiskConfidence: "Low",
        riskScore: 0.2,
        wearableData: [],
        insuranceIdMasked: ""
      });
    }
    if (!patientOnboardingDrafts.has(user.id)) {
      patientOnboardingDrafts.set(user.id, emptyPatientOnboardingDraft(user.id));
    }
  }

  if (user.role === "Caregiver") {
    if (!caregiverOnboardingDrafts.has(user.id)) {
      caregiverOnboardingDrafts.set(user.id, emptyCaregiverOnboardingDraft(user.id));
    }
  }

  return user;
}

function listPatients(): User[] {
  return users.filter((user) => user.role === "Patient");
}

function getOnboardingStatus(userId: string): OnboardingStatus | undefined {
  const user = getUserById(userId);
  if (!user) {
    return undefined;
  }

  const onboardingPath = user.role === "Patient" ? "/onboarding/patient" : "/onboarding/caregiver";
  const dashboardPath = user.role === "Patient" ? "/patient" : "/caregiver";

  return {
    userId: user.id,
    role: user.role,
    onboardingCompleted: user.onboardingCompleted,
    nextPath: user.onboardingCompleted ? dashboardPath : onboardingPath
  };
}

function getPatientOnboardingDraft(userId: string): PatientOnboardingDraft {
  const existing = patientOnboardingDrafts.get(userId);
  if (existing) {
    return existing;
  }
  const created = emptyPatientOnboardingDraft(userId);
  patientOnboardingDrafts.set(userId, created);
  return created;
}

function upsertPatientOnboardingDraft(
  userId: string,
  updates: Partial<Omit<PatientOnboardingDraft, "userId" | "updatedAt" | "completed">>
): PatientOnboardingDraft {
  const current = getPatientOnboardingDraft(userId);
  const next: PatientOnboardingDraft = {
    ...current,
    ...updates,
    beneficiaries: updates.beneficiaries ?? current.beneficiaries,
    updatedAt: nowIso()
  };
  patientOnboardingDrafts.set(userId, next);
  return next;
}

function setOnboardingResponses(
  patientId: string,
  onboardingResponses: OnboardingResponses,
  predictedDisease: PredictedDisease,
  riskScore: number,
  initialRiskConfidence: "Low" | "Moderate" | "High" = "Low"
): void {
  const existing = patientProfiles.get(patientId);
  if (!existing) {
    return;
  }

  patientProfiles.set(patientId, {
    ...existing,
    onboardingResponses,
    predictedDisease,
    riskScore,
    initialRiskConfidence
  });
}

function completePatientOnboarding(params: {
  userId: string;
  basicInfo: PatientOnboardingDraft["basicInfo"];
  behavioralResponses: PatientOnboardingDraft["behavioralResponses"];
  insurance: PatientOnboardingDraft["insurance"];
  beneficiaries: Beneficiary[];
  predictedDisease: PredictedDisease;
  baselineRiskScore: number;
  initialRiskConfidence: "Low" | "Moderate" | "High";
}): void {
  const user = getUserById(params.userId);
  const existing = patientProfiles.get(params.userId);
  if (!user || !existing) {
    return;
  }

  user.onboardingCompleted = true;

  patientProfiles.set(params.userId, {
    ...existing,
    basicInfo: params.basicInfo,
    onboardingResponses: params.behavioralResponses,
    insurance: params.insurance,
    predictedDisease: params.predictedDisease,
    initialRiskConfidence: params.initialRiskConfidence,
    riskScore: params.baselineRiskScore,
    insuranceIdMasked: params.insurance?.memberIdMasked ?? "",
    onboardingCompletedAt: nowIso()
  });

  replaceBeneficiaries(params.userId, params.beneficiaries);

  patientOnboardingDrafts.set(params.userId, {
    userId: params.userId,
    basicInfo: params.basicInfo,
    behavioralResponses: params.behavioralResponses,
    insurance: params.insurance,
    beneficiaries: params.beneficiaries,
    consent: getPatientOnboardingDraft(params.userId).consent,
    currentStep: 6,
    completed: true,
    updatedAt: nowIso()
  });
}

function getCaregiverOnboardingDraft(userId: string): CaregiverOnboardingDraft {
  const existing = caregiverOnboardingDrafts.get(userId);
  if (existing) {
    return existing;
  }
  const created = emptyCaregiverOnboardingDraft(userId);
  caregiverOnboardingDrafts.set(userId, created);
  return created;
}

function upsertCaregiverOnboardingDraft(
  userId: string,
  updates: Partial<Omit<CaregiverOnboardingDraft, "userId" | "updatedAt" | "completed">>
): CaregiverOnboardingDraft {
  const current = getCaregiverOnboardingDraft(userId);
  const next: CaregiverOnboardingDraft = {
    ...current,
    ...updates,
    updatedAt: nowIso()
  };
  caregiverOnboardingDrafts.set(userId, next);
  return next;
}

function setPatientOnboardingDraft(draft: PatientOnboardingDraft): void {
  patientOnboardingDrafts.set(draft.userId, {
    ...draft,
    beneficiaries: draft.beneficiaries.map((entry) => ({ ...entry })),
    updatedAt: draft.updatedAt
  });
}

function setCaregiverOnboardingDraft(draft: CaregiverOnboardingDraft): void {
  caregiverOnboardingDrafts.set(draft.userId, {
    ...draft,
    professionalProfile: draft.professionalProfile ? { ...draft.professionalProfile } : null,
    consent: draft.consent ? { ...draft.consent } : null
  });
}

function completeCaregiverOnboarding(params: {
  userId: string;
  profile: CaregiverProfessionalProfile;
}): void {
  const user = getUserById(params.userId);
  if (!user) {
    return;
  }
  user.onboardingCompleted = true;

  caregiverProfiles.set(params.userId, params.profile);

  caregiverOnboardingDrafts.set(params.userId, {
    ...getCaregiverOnboardingDraft(params.userId),
    professionalProfile: params.profile,
    currentStep: 3,
    completed: true,
    updatedAt: nowIso()
  });
}

function getCaregiverProfile(caregiverId: string): CaregiverProfessionalProfile | undefined {
  return caregiverProfiles.get(caregiverId);
}

function upsertCaregiverProfile(profile: CaregiverProfessionalProfile): void {
  caregiverProfiles.set(profile.userId, { ...profile });
}

function addConsentLog(entry: Omit<ConsentLogItem, "id">): ConsentLogItem {
  const log: ConsentLogItem = {
    id: uuidv4(),
    ...entry
  };
  consentLogs.unshift(log);
  return log;
}

function listConsentLogs(userId: string): ConsentLogItem[] {
  return consentLogs.filter((entry) => entry.userId === userId).slice(0, 100);
}

function getPatientProfile(patientId: string): PatientProfile | undefined {
  return patientProfiles.get(patientId);
}

function upsertPatientProfile(profile: PatientProfile): void {
  patientProfiles.set(profile.userId, {
    ...profile,
    wearableData: [...profile.wearableData]
  });
}

function setPatientRisk(patientId: string, predictedDisease: PredictedDisease, riskScore: number): void {
  const existing = patientProfiles.get(patientId);
  if (!existing) {
    return;
  }

  patientProfiles.set(patientId, {
    ...existing,
    predictedDisease,
    riskScore
  });
}

function addCaregiverMapping(caregiverId: string, patientId: string): void {
  const existing = caregiverPatientMappings.some(
    (mapping) => mapping.caregiverId === caregiverId && mapping.patientId === patientId
  );
  if (!existing) {
    caregiverPatientMappings.push({ caregiverId, patientId });
  }
}

function getCaregiverPatientIds(caregiverId: string): string[] {
  return caregiverPatientMappings
    .filter((mapping) => mapping.caregiverId === caregiverId)
    .map((mapping) => mapping.patientId);
}

function getCaregiverIdsByPatient(patientId: string): string[] {
  return caregiverPatientMappings
    .filter((mapping) => mapping.patientId === patientId)
    .map((mapping) => mapping.caregiverId);
}

function listCaregiverMappings(): CaregiverPatientMapping[] {
  return caregiverPatientMappings.map((mapping) => ({
    caregiverId: mapping.caregiverId,
    patientId: mapping.patientId
  }));
}

function addBeneficiary(beneficiary: Beneficiary): void {
  beneficiaries.push(beneficiary);
}

function replaceBeneficiaries(patientId: string, entries: Beneficiary[]): void {
  const preserved = beneficiaries.filter((beneficiary) => beneficiary.patientId !== patientId);
  beneficiaries.length = 0;
  beneficiaries.push(...preserved, ...entries.map((entry) => ({ ...entry, patientId })));
}

function getBeneficiariesByPatient(patientId: string): Beneficiary[] {
  return beneficiaries.filter((beneficiary) => beneficiary.patientId === patientId);
}

function listBeneficiaries(): Beneficiary[] {
  return beneficiaries.map((beneficiary) => ({ ...beneficiary }));
}

function appendVitals(vitals: StreamingVitals): void {
  const current = vitalsByPatient.get(vitals.patientId) ?? [];
  current.push(vitals);
  const bounded = current.slice(-1200);
  vitalsByPatient.set(vitals.patientId, bounded);

  const profile = patientProfiles.get(vitals.patientId);
  if (profile) {
    profile.wearableData = bounded.slice(-250);
  }
}

function setVitalsHistory(patientId: string, vitals: StreamingVitals[]): void {
  const sorted = [...vitals].sort(
    (left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
  );
  const bounded = sorted.slice(-1200);
  vitalsByPatient.set(patientId, bounded);

  const profile = patientProfiles.get(patientId);
  if (profile) {
    profile.wearableData = bounded.slice(-250);
  }
}

function getLatestVitals(patientId: string): StreamingVitals | undefined {
  const current = vitalsByPatient.get(patientId) ?? [];
  return current[current.length - 1];
}

function getVitalsSince(patientId: string, sinceIso: string): StreamingVitals[] {
  const since = new Date(sinceIso).getTime();
  return (vitalsByPatient.get(patientId) ?? []).filter((item) => new Date(item.timestamp).getTime() >= since);
}

function addPredictionLog(prediction: PredictionLog): void {
  const current = predictionLogsByPatient.get(prediction.patientId) ?? [];
  current.push(prediction);
  predictionLogsByPatient.set(prediction.patientId, current.slice(-300));
}

function getPredictionLogs(patientId: string): PredictionLog[] {
  return predictionLogsByPatient.get(patientId) ?? [];
}

function getLatestPrediction(patientId: string): PredictionLog | undefined {
  const items = predictionLogsByPatient.get(patientId) ?? [];
  return items[items.length - 1];
}

function setPredictionLogs(patientId: string, logs: PredictionLog[]): void {
  const sorted = [...logs].sort(
    (left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
  );
  predictionLogsByPatient.set(patientId, sorted.slice(-300));
}

function addNotification(notification: Omit<NotificationItem, "id" | "timestamp" | "acknowledged">): NotificationItem {
  const record: NotificationItem = {
    id: uuidv4(),
    timestamp: nowIso(),
    acknowledged: false,
    ...notification
  };
  notifications.unshift(record);
  return record;
}

function listNotifications(userId: string): NotificationItem[] {
  return notifications.filter((item) => item.userId === userId).slice(0, 100);
}

function acknowledgeNotification(userId: string, notificationId: string): NotificationItem | undefined {
  const record = notifications.find((item) => item.userId === userId && item.id === notificationId);
  if (record) {
    record.acknowledged = true;
  }
  return record;
}

function addOutboundNotification(entry: Omit<OutboundNotification, "id" | "timestamp">): void {
  outboundNotifications.unshift({
    id: uuidv4(),
    timestamp: nowIso(),
    ...entry
  });
}

function listOutboundNotificationsByPatient(patientId: string): OutboundNotification[] {
  return outboundNotifications.filter((entry) => entry.patientId === patientId).slice(0, 100);
}

function addAuditLog(entry: Omit<AuditLogItem, "id" | "timestamp">): AuditLogItem {
  const record: AuditLogItem = {
    id: uuidv4(),
    timestamp: nowIso(),
    ...entry
  };
  auditLogs.unshift(record);
  return record;
}

function listAuditLogs(): AuditLogItem[] {
  return auditLogs.slice(0, 200);
}

function listAllUsers(): User[] {
  return users;
}

export const store = {
  getUserByEmail,
  getUserById,
  getUserByPatientCode,
  createUser,
  upsertUser,
  listPatients,
  getOnboardingStatus,
  getPatientOnboardingDraft,
  upsertPatientOnboardingDraft,
  setPatientOnboardingDraft,
  completePatientOnboarding,
  getCaregiverOnboardingDraft,
  upsertCaregiverOnboardingDraft,
  setCaregiverOnboardingDraft,
  completeCaregiverOnboarding,
  getCaregiverProfile,
  upsertCaregiverProfile,
  addConsentLog,
  listConsentLogs,
  setOnboardingResponses,
  getPatientProfile,
  upsertPatientProfile,
  setPatientRisk,
  addCaregiverMapping,
  getCaregiverPatientIds,
  getCaregiverIdsByPatient,
  listCaregiverMappings,
  addBeneficiary,
  replaceBeneficiaries,
  getBeneficiariesByPatient,
  listBeneficiaries,
  appendVitals,
  setVitalsHistory,
  getLatestVitals,
  getVitalsSince,
  addPredictionLog,
  getPredictionLogs,
  getLatestPrediction,
  setPredictionLogs,
  addNotification,
  listNotifications,
  acknowledgeNotification,
  addOutboundNotification,
  listOutboundNotificationsByPatient,
  addAuditLog,
  listAuditLogs,
  listAllUsers
};
