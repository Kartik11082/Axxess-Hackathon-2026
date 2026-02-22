import { Prisma } from "@prisma/client";
import { store } from "../data/store";
import {
  AlertPreference,
  CaregiverOnboardingDraft,
  LifeStage,
  OnboardingResponses,
  PatientOnboardingDraft,
  PatientProfile,
  PredictionLog,
  PredictedTrendPoint,
  StreamingVitals
} from "../models/types";
import { prisma } from "./prisma";

function logInfo(message: string): void {
  // eslint-disable-next-line no-console
  console.log(`[domain-db] ${message}`);
}

function logWarn(message: string): void {
  // eslint-disable-next-line no-console
  console.warn(`[domain-db] ${message}`);
}

function toDbLifeStage(value?: LifeStage | null): "Early_adult" | "Mid_life" | "Senior" | null {
  if (!value) {
    return null;
  }
  if (value === "Early adult") {
    return "Early_adult";
  }
  if (value === "Mid-life") {
    return "Mid_life";
  }
  return "Senior";
}

function fromDbLifeStage(value?: "Early_adult" | "Mid_life" | "Senior" | null): LifeStage | null {
  if (!value) {
    return null;
  }
  if (value === "Early_adult") {
    return "Early adult";
  }
  if (value === "Mid_life") {
    return "Mid-life";
  }
  return "Senior";
}

function toDbAlertPreference(value: AlertPreference): "high_risk_only" | "all_alerts" | "emergency_only" {
  if (value === "high-risk-only") {
    return "high_risk_only";
  }
  if (value === "all-alerts") {
    return "all_alerts";
  }
  return "emergency_only";
}

function fromDbAlertPreference(value: "high_risk_only" | "all_alerts" | "emergency_only"): AlertPreference {
  if (value === "high_risk_only") {
    return "high-risk-only";
  }
  if (value === "all_alerts") {
    return "all-alerts";
  }
  return "emergency-only";
}

function asDate(value?: string): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseOnboardingResponses(raw: unknown): OnboardingResponses | null {
  if (!isRecord(raw)) {
    return null;
  }

  const unusualThirst = raw.unusualThirst;
  const wakeUpAtNight = raw.wakeUpAtNight;
  const breathlessDuringLightActivity = raw.breathlessDuringLightActivity;
  const fatigueAfterMeals = raw.fatigueAfterMeals;
  const monitorHeartRateRegularly = raw.monitorHeartRateRegularly;

  if (
    !isNumber(unusualThirst) ||
    !isNumber(wakeUpAtNight) ||
    !isNumber(breathlessDuringLightActivity) ||
    !isNumber(fatigueAfterMeals) ||
    !isNumber(monitorHeartRateRegularly)
  ) {
    return null;
  }

  return {
    unusualThirst,
    wakeUpAtNight,
    breathlessDuringLightActivity,
    fatigueAfterMeals,
    monitorHeartRateRegularly
  };
}

function parsePredictedTrend(raw: unknown): PredictedTrendPoint[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const points: PredictedTrendPoint[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) {
      continue;
    }

    const dayOffset = entry.dayOffset;
    const label = entry.label;
    const score = entry.score;
    if (!isNumber(dayOffset) || typeof label !== "string" || !isNumber(score)) {
      continue;
    }

    points.push({
      dayOffset,
      label,
      score
    });
  }

  return points;
}

function parseExplainability(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((entry): entry is string => typeof entry === "string").slice(0, 10);
}

function parseBeneficiariesJson(raw: unknown, patientId: string): PatientOnboardingDraft["beneficiaries"] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const beneficiaries: PatientOnboardingDraft["beneficiaries"] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) {
      continue;
    }

    const name = entry.name;
    const relationship = entry.relationship;
    const email = entry.email;
    const phone = entry.phone;
    const alertPreference = entry.alertPreference;

    if (
      typeof name !== "string" ||
      typeof relationship !== "string" ||
      typeof email !== "string" ||
      typeof phone !== "string" ||
      (alertPreference !== "high-risk-only" &&
        alertPreference !== "all-alerts" &&
        alertPreference !== "emergency-only")
    ) {
      continue;
    }

    beneficiaries.push({
      patientId,
      name,
      relationship,
      email,
      phone,
      alertPreference
    });
  }

  return beneficiaries;
}

function parseWearableData(raw: unknown, patientId: string): StreamingVitals[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const vitals: StreamingVitals[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) {
      continue;
    }

    const timestamp = entry.timestamp;
    const heartRate = entry.heartRate;
    const stepCount = entry.stepCount;
    const bloodOxygen = entry.bloodOxygen;
    const sleepScore = entry.sleepScore;

    if (
      typeof timestamp !== "string" ||
      !isNumber(heartRate) ||
      !isNumber(stepCount) ||
      !isNumber(bloodOxygen) ||
      !isNumber(sleepScore)
    ) {
      continue;
    }

    vitals.push({
      patientId,
      timestamp,
      heartRate,
      stepCount,
      bloodOxygen,
      sleepScore
    });
  }

  return vitals;
}

function createDbPatientProfileInput(profile: PatientProfile): {
  preferredName: string | null;
  heightRange: string | null;
  activityLevel: "Low" | "Moderate" | "High" | null;
  lifeStage: "Early_adult" | "Mid_life" | "Senior" | null;
  unusualThirst: number | null;
  wakeUpAtNight: number | null;
  breathlessDuringLightActivity: number | null;
  fatigueAfterMeals: number | null;
  monitorHeartRateRegularly: number | null;
  onboardingResponses: Prisma.InputJsonValue | null;
  insuranceProvider: string | null;
  insuranceMemberIdEncrypted: string | null;
  insuranceMemberIdMasked: string | null;
  insuranceGroupNumberEncrypted: string | null;
  insuranceGroupNumberMasked: string | null;
  predictedDisease: "Cardiac" | "Diabetes" | "Stable";
  initialRiskConfidence: string;
  riskScore: number;
  wearableData: Prisma.InputJsonValue | null;
  insuranceId: string | null;
  insuranceIdMasked: string;
  onboardingCompletedAt: Date | null;
} {
  return {
    preferredName: profile.basicInfo?.preferredName ?? null,
    heightRange: profile.basicInfo?.heightRange ?? null,
    activityLevel: profile.basicInfo?.activityLevel ?? null,
    lifeStage: toDbLifeStage(profile.basicInfo?.lifeStage),
    unusualThirst: profile.onboardingResponses?.unusualThirst ?? null,
    wakeUpAtNight: profile.onboardingResponses?.wakeUpAtNight ?? null,
    breathlessDuringLightActivity: profile.onboardingResponses?.breathlessDuringLightActivity ?? null,
    fatigueAfterMeals: profile.onboardingResponses?.fatigueAfterMeals ?? null,
    monitorHeartRateRegularly: profile.onboardingResponses?.monitorHeartRateRegularly ?? null,
    onboardingResponses: profile.onboardingResponses
      ? (profile.onboardingResponses as unknown as Prisma.InputJsonValue)
      : null,
    insuranceProvider: profile.insurance?.provider ?? null,
    insuranceMemberIdEncrypted: profile.insurance?.memberIdEncrypted ?? null,
    insuranceMemberIdMasked: profile.insurance?.memberIdMasked ?? null,
    insuranceGroupNumberEncrypted: profile.insurance?.groupNumberEncrypted ?? null,
    insuranceGroupNumberMasked: profile.insurance?.groupNumberMasked ?? null,
    predictedDisease: profile.predictedDisease,
    initialRiskConfidence: profile.initialRiskConfidence,
    riskScore: profile.riskScore,
    wearableData:
      profile.wearableData.length > 0 ? (profile.wearableData as unknown as Prisma.InputJsonValue) : null,
    insuranceId: profile.insurance?.memberIdEncrypted ?? null,
    insuranceIdMasked: profile.insuranceIdMasked,
    onboardingCompletedAt: asDate(profile.onboardingCompletedAt)
  };
}

export async function initializePersistentDomainData(): Promise<void> {
  if (!prisma) {
    logWarn("Prisma not initialized. Continuing with in-memory profile/vitals/prediction data only.");
    return;
  }

  try {
    const dbProfiles = await prisma.patientProfile.findMany();
    if (dbProfiles.length === 0) {
      for (const patient of store.listPatients()) {
        await persistPatientProfile(patient.id);
      }
      logInfo("Seeded in-memory patient profiles into SQLite.");
    } else {
      const knownPatientProfileIds = new Set<string>();
      for (const dbProfile of dbProfiles) {
        knownPatientProfileIds.add(dbProfile.userId);
        const lifeStage = fromDbLifeStage(dbProfile.lifeStage);
        const hasBasicInfo = Boolean(
          dbProfile.preferredName || dbProfile.heightRange || dbProfile.activityLevel || lifeStage
        );

        const onboardingFromColumns =
          dbProfile.unusualThirst !== null &&
          dbProfile.wakeUpAtNight !== null &&
          dbProfile.breathlessDuringLightActivity !== null &&
          dbProfile.fatigueAfterMeals !== null &&
          dbProfile.monitorHeartRateRegularly !== null
            ? {
                unusualThirst: dbProfile.unusualThirst,
                wakeUpAtNight: dbProfile.wakeUpAtNight,
                breathlessDuringLightActivity: dbProfile.breathlessDuringLightActivity,
                fatigueAfterMeals: dbProfile.fatigueAfterMeals,
                monitorHeartRateRegularly: dbProfile.monitorHeartRateRegularly
              }
            : null;
        const onboardingResponses = onboardingFromColumns ?? parseOnboardingResponses(dbProfile.onboardingResponses);

        const insurancePresent = Boolean(
          dbProfile.insuranceProvider ||
            dbProfile.insuranceMemberIdEncrypted ||
            dbProfile.insuranceGroupNumberEncrypted
        );

        store.upsertPatientProfile({
          userId: dbProfile.userId,
          basicInfo: hasBasicInfo
            ? {
                preferredName: dbProfile.preferredName ?? "",
                heightRange: dbProfile.heightRange ?? "",
                activityLevel: dbProfile.activityLevel ?? "Moderate",
                lifeStage: lifeStage ?? "Mid-life"
              }
            : null,
          onboardingResponses,
          insurance: insurancePresent
            ? {
                provider: dbProfile.insuranceProvider ?? "",
                memberIdEncrypted: dbProfile.insuranceMemberIdEncrypted ?? "",
                memberIdMasked: dbProfile.insuranceMemberIdMasked ?? "",
                groupNumberEncrypted: dbProfile.insuranceGroupNumberEncrypted ?? "",
                groupNumberMasked: dbProfile.insuranceGroupNumberMasked ?? ""
              }
            : null,
          predictedDisease: dbProfile.predictedDisease,
          initialRiskConfidence:
            dbProfile.initialRiskConfidence === "High" ||
            dbProfile.initialRiskConfidence === "Moderate" ||
            dbProfile.initialRiskConfidence === "Low"
              ? dbProfile.initialRiskConfidence
              : "Low",
          riskScore: dbProfile.riskScore,
          wearableData: parseWearableData(dbProfile.wearableData, dbProfile.userId),
          insuranceIdMasked: dbProfile.insuranceIdMasked,
          onboardingCompletedAt: dbProfile.onboardingCompletedAt?.toISOString()
        });
      }

      for (const patient of store.listPatients()) {
        if (!knownPatientProfileIds.has(patient.id)) {
          await persistPatientProfile(patient.id);
        }
      }
      logInfo(`Loaded ${dbProfiles.length} patient profiles from SQLite.`);
    }

    const dbBeneficiaries = await prisma.beneficiary.findMany({
      orderBy: {
        createdAt: "asc"
      }
    });
    if (dbBeneficiaries.length === 0) {
      const seededPatientIds = Array.from(new Set(store.listBeneficiaries().map((entry) => entry.patientId)));
      for (const patientId of seededPatientIds) {
        await persistBeneficiaries(patientId);
      }
      if (seededPatientIds.length > 0) {
        logInfo(`Seeded ${seededPatientIds.length} beneficiary groups into SQLite.`);
      }
    } else {
      const groups = new Map<string, PatientOnboardingDraft["beneficiaries"]>();
      for (const entry of dbBeneficiaries) {
        const current = groups.get(entry.patientId) ?? [];
        current.push({
          patientId: entry.patientId,
          name: entry.name,
          relationship: entry.relationship,
          email: entry.email,
          phone: entry.phone,
          alertPreference: fromDbAlertPreference(entry.alertPreference)
        });
        groups.set(entry.patientId, current);
      }

      const patientIds = new Set<string>([...store.listPatients().map((entry) => entry.id), ...groups.keys()]);
      for (const patientId of patientIds) {
        store.replaceBeneficiaries(patientId, groups.get(patientId) ?? []);
      }
      logInfo(`Loaded ${dbBeneficiaries.length} beneficiaries from SQLite.`);
    }

    const dbVitals = await prisma.streamingVitals.findMany({
      orderBy: [{ patientId: "asc" }, { timestamp: "asc" }]
    });
    if (dbVitals.length > 0) {
      const groups = new Map<string, StreamingVitals[]>();
      for (const entry of dbVitals) {
        const current = groups.get(entry.patientId) ?? [];
        current.push({
          patientId: entry.patientId,
          timestamp: entry.timestamp.toISOString(),
          heartRate: entry.heartRate,
          stepCount: entry.stepCount,
          bloodOxygen: entry.bloodOxygen,
          sleepScore: entry.sleepScore
        });
        groups.set(entry.patientId, current);
      }
      for (const [patientId, entries] of groups.entries()) {
        store.setVitalsHistory(patientId, entries);
      }
      logInfo(`Loaded ${dbVitals.length} vitals samples from SQLite.`);
    }

    const dbPredictionLogs = await prisma.predictionLog.findMany({
      orderBy: [{ patientId: "asc" }, { timestamp: "asc" }]
    });
    if (dbPredictionLogs.length > 0) {
      const groups = new Map<string, PredictionLog[]>();
      for (const entry of dbPredictionLogs) {
        const current = groups.get(entry.patientId) ?? [];
        current.push({
          patientId: entry.patientId,
          timestamp: entry.timestamp.toISOString(),
          predictedRiskScore: entry.predictedRiskScore,
          predictedDisease: entry.predictedDisease,
          confidence: entry.confidence,
          forecastWindow: entry.forecastWindow === "Next 7 days" ? "Next 7 days" : "Next 7 days",
          predictedTrend: parsePredictedTrend(entry.predictedTrend),
          riskMomentum: entry.riskMomentum,
          explainability: parseExplainability(entry.explainability),
          icdCode: entry.icdCode,
          modelVersion: entry.modelVersion
        });
        groups.set(entry.patientId, current);
      }

      for (const [patientId, entries] of groups.entries()) {
        store.setPredictionLogs(patientId, entries);
        const latest = entries[entries.length - 1];
        if (latest) {
          store.setPatientRisk(patientId, latest.predictedDisease, latest.predictedRiskScore);
        }
      }
      logInfo(`Loaded ${dbPredictionLogs.length} prediction logs from SQLite.`);
    }

    const dbCaregiverProfiles = await prisma.caregiverProfessionalProfile.findMany();
    for (const profile of dbCaregiverProfiles) {
      store.upsertCaregiverProfile({
        userId: profile.userId,
        licenseNumber: profile.licenseNumber ?? undefined,
        specialization: profile.specialization,
        yearsOfExperience: profile.yearsOfExperience,
        assignmentMode:
          profile.assignmentMode === "request_access" ? "request_access" : "admin_assign_later",
        requestedPatientEmail: profile.requestedPatientEmail ?? undefined,
        requestedPatientCode: profile.requestedPatientCode ?? undefined
      });
    }

    const dbPatientDrafts = await prisma.patientOnboardingDraft.findMany();
    for (const draft of dbPatientDrafts) {
      const lifeStage = fromDbLifeStage(draft.lifeStage);
      const behavior =
        draft.unusualThirst !== null &&
        draft.wakeUpAtNight !== null &&
        draft.breathlessDuringLightActivity !== null &&
        draft.fatigueAfterMeals !== null &&
        draft.monitorHeartRateRegularly !== null
          ? {
              unusualThirst: draft.unusualThirst,
              wakeUpAtNight: draft.wakeUpAtNight,
              breathlessDuringLightActivity: draft.breathlessDuringLightActivity,
              fatigueAfterMeals: draft.fatigueAfterMeals,
              monitorHeartRateRegularly: draft.monitorHeartRateRegularly
            }
          : null;

      store.setPatientOnboardingDraft({
        userId: draft.userId,
        basicInfo:
          draft.preferredName || draft.heightRange || draft.activityLevel || lifeStage
            ? {
                preferredName: draft.preferredName ?? "",
                heightRange: draft.heightRange ?? "",
                activityLevel: draft.activityLevel ?? "Moderate",
                lifeStage: lifeStage ?? "Mid-life"
              }
            : null,
        behavioralResponses: behavior,
        insurance:
          draft.insuranceProvider ||
          draft.insuranceMemberIdEncrypted ||
          draft.insuranceGroupNumberEncrypted
            ? {
                provider: draft.insuranceProvider ?? "",
                memberIdEncrypted: draft.insuranceMemberIdEncrypted ?? "",
                memberIdMasked: draft.insuranceMemberIdMasked ?? "",
                groupNumberEncrypted: draft.insuranceGroupNumberEncrypted ?? "",
                groupNumberMasked: draft.insuranceGroupNumberMasked ?? ""
              }
            : null,
        beneficiaries: parseBeneficiariesJson(draft.beneficiariesJson, draft.userId),
        consent:
          draft.consentDataUsageAccepted !== null ||
          draft.consentWearableAccepted !== null ||
          draft.consentAiModelingAcknowledged !== null
            ? {
                dataUsageAccepted: Boolean(draft.consentDataUsageAccepted),
                wearableConsentAccepted: Boolean(draft.consentWearableAccepted),
                aiModelingAcknowledged: Boolean(draft.consentAiModelingAcknowledged),
                version: draft.consentVersion ?? "v1",
                acceptedAt: draft.consentAcceptedAt?.toISOString()
              }
            : null,
        currentStep: draft.currentStep,
        completed: draft.completed,
        updatedAt: draft.updatedAt.toISOString()
      });
    }

    const dbCaregiverDrafts = await prisma.caregiverOnboardingDraft.findMany();
    for (const draft of dbCaregiverDrafts) {
      const onboardingDraft: CaregiverOnboardingDraft = {
        userId: draft.userId,
        professionalProfile:
          draft.specialization || draft.yearsOfExperience !== null
            ? {
                userId: draft.userId,
                licenseNumber: draft.licenseNumber ?? undefined,
                specialization: draft.specialization ?? "General Care",
                yearsOfExperience: draft.yearsOfExperience ?? 0,
                assignmentMode:
                  draft.assignmentMode === "request_access" ? "request_access" : "admin_assign_later",
                requestedPatientEmail: draft.requestedPatientEmail ?? undefined,
                requestedPatientCode: draft.requestedPatientCode ?? undefined
              }
            : null,
        consent:
          draft.consentHipaaAccepted !== null || draft.consentDataAccessAccepted !== null
            ? {
                hipaaAccepted: Boolean(draft.consentHipaaAccepted),
                dataAccessAccepted: Boolean(draft.consentDataAccessAccepted),
                version: draft.consentVersion ?? "v1",
                acceptedAt: draft.consentAcceptedAt?.toISOString()
              }
            : null,
        currentStep: draft.currentStep,
        completed: draft.completed,
        updatedAt: draft.updatedAt.toISOString()
      };
      store.setCaregiverOnboardingDraft(onboardingDraft);
    }
  } catch (error) {
    logWarn(`Domain DB init skipped: ${(error as Error).message}`);
  }
}

export async function persistPatientOnboardingDraft(userId: string): Promise<void> {
  if (!prisma) {
    return;
  }

  const draft = store.getPatientOnboardingDraft(userId);
  try {
    await prisma.patientOnboardingDraft.upsert({
      where: {
        userId
      },
      update: {
        preferredName: draft.basicInfo?.preferredName ?? null,
        heightRange: draft.basicInfo?.heightRange ?? null,
        activityLevel: draft.basicInfo?.activityLevel ?? null,
        lifeStage: toDbLifeStage(draft.basicInfo?.lifeStage),
        unusualThirst: draft.behavioralResponses?.unusualThirst ?? null,
        wakeUpAtNight: draft.behavioralResponses?.wakeUpAtNight ?? null,
        breathlessDuringLightActivity: draft.behavioralResponses?.breathlessDuringLightActivity ?? null,
        fatigueAfterMeals: draft.behavioralResponses?.fatigueAfterMeals ?? null,
        monitorHeartRateRegularly: draft.behavioralResponses?.monitorHeartRateRegularly ?? null,
        insuranceProvider: draft.insurance?.provider ?? null,
        insuranceMemberIdEncrypted: draft.insurance?.memberIdEncrypted ?? null,
        insuranceMemberIdMasked: draft.insurance?.memberIdMasked ?? null,
        insuranceGroupNumberEncrypted: draft.insurance?.groupNumberEncrypted ?? null,
        insuranceGroupNumberMasked: draft.insurance?.groupNumberMasked ?? null,
        beneficiariesJson: draft.beneficiaries as unknown as Prisma.InputJsonValue,
        consentDataUsageAccepted: draft.consent?.dataUsageAccepted ?? null,
        consentWearableAccepted: draft.consent?.wearableConsentAccepted ?? null,
        consentAiModelingAcknowledged: draft.consent?.aiModelingAcknowledged ?? null,
        consentVersion: draft.consent?.version ?? null,
        consentAcceptedAt: asDate(draft.consent?.acceptedAt),
        currentStep: draft.currentStep,
        completed: draft.completed
      },
      create: {
        userId,
        preferredName: draft.basicInfo?.preferredName ?? null,
        heightRange: draft.basicInfo?.heightRange ?? null,
        activityLevel: draft.basicInfo?.activityLevel ?? null,
        lifeStage: toDbLifeStage(draft.basicInfo?.lifeStage),
        unusualThirst: draft.behavioralResponses?.unusualThirst ?? null,
        wakeUpAtNight: draft.behavioralResponses?.wakeUpAtNight ?? null,
        breathlessDuringLightActivity: draft.behavioralResponses?.breathlessDuringLightActivity ?? null,
        fatigueAfterMeals: draft.behavioralResponses?.fatigueAfterMeals ?? null,
        monitorHeartRateRegularly: draft.behavioralResponses?.monitorHeartRateRegularly ?? null,
        insuranceProvider: draft.insurance?.provider ?? null,
        insuranceMemberIdEncrypted: draft.insurance?.memberIdEncrypted ?? null,
        insuranceMemberIdMasked: draft.insurance?.memberIdMasked ?? null,
        insuranceGroupNumberEncrypted: draft.insurance?.groupNumberEncrypted ?? null,
        insuranceGroupNumberMasked: draft.insurance?.groupNumberMasked ?? null,
        beneficiariesJson: draft.beneficiaries as unknown as Prisma.InputJsonValue,
        consentDataUsageAccepted: draft.consent?.dataUsageAccepted ?? null,
        consentWearableAccepted: draft.consent?.wearableConsentAccepted ?? null,
        consentAiModelingAcknowledged: draft.consent?.aiModelingAcknowledged ?? null,
        consentVersion: draft.consent?.version ?? null,
        consentAcceptedAt: asDate(draft.consent?.acceptedAt),
        currentStep: draft.currentStep,
        completed: draft.completed
      }
    });
  } catch (error) {
    logWarn(`Failed to persist patient draft for ${userId}: ${(error as Error).message}`);
  }
}

export async function persistCaregiverOnboardingDraft(userId: string): Promise<void> {
  if (!prisma) {
    return;
  }

  const draft = store.getCaregiverOnboardingDraft(userId);
  try {
    await prisma.caregiverOnboardingDraft.upsert({
      where: {
        userId
      },
      update: {
        licenseNumber: draft.professionalProfile?.licenseNumber ?? null,
        specialization: draft.professionalProfile?.specialization ?? null,
        yearsOfExperience: draft.professionalProfile?.yearsOfExperience ?? null,
        assignmentMode: draft.professionalProfile?.assignmentMode ?? null,
        requestedPatientEmail: draft.professionalProfile?.requestedPatientEmail ?? null,
        requestedPatientCode: draft.professionalProfile?.requestedPatientCode ?? null,
        consentHipaaAccepted: draft.consent?.hipaaAccepted ?? null,
        consentDataAccessAccepted: draft.consent?.dataAccessAccepted ?? null,
        consentVersion: draft.consent?.version ?? null,
        consentAcceptedAt: asDate(draft.consent?.acceptedAt),
        currentStep: draft.currentStep,
        completed: draft.completed
      },
      create: {
        userId,
        licenseNumber: draft.professionalProfile?.licenseNumber ?? null,
        specialization: draft.professionalProfile?.specialization ?? null,
        yearsOfExperience: draft.professionalProfile?.yearsOfExperience ?? null,
        assignmentMode: draft.professionalProfile?.assignmentMode ?? null,
        requestedPatientEmail: draft.professionalProfile?.requestedPatientEmail ?? null,
        requestedPatientCode: draft.professionalProfile?.requestedPatientCode ?? null,
        consentHipaaAccepted: draft.consent?.hipaaAccepted ?? null,
        consentDataAccessAccepted: draft.consent?.dataAccessAccepted ?? null,
        consentVersion: draft.consent?.version ?? null,
        consentAcceptedAt: asDate(draft.consent?.acceptedAt),
        currentStep: draft.currentStep,
        completed: draft.completed
      }
    });
  } catch (error) {
    logWarn(`Failed to persist caregiver draft for ${userId}: ${(error as Error).message}`);
  }
}

export async function persistCaregiverProfile(userId: string): Promise<void> {
  if (!prisma) {
    return;
  }

  const profile = store.getCaregiverProfile(userId);
  if (!profile) {
    return;
  }

  try {
    await prisma.caregiverProfessionalProfile.upsert({
      where: {
        userId
      },
      update: {
        licenseNumber: profile.licenseNumber ?? null,
        specialization: profile.specialization,
        yearsOfExperience: profile.yearsOfExperience,
        assignmentMode: profile.assignmentMode,
        requestedPatientEmail: profile.requestedPatientEmail ?? null,
        requestedPatientCode: profile.requestedPatientCode ?? null
      },
      create: {
        userId,
        licenseNumber: profile.licenseNumber ?? null,
        specialization: profile.specialization,
        yearsOfExperience: profile.yearsOfExperience,
        assignmentMode: profile.assignmentMode,
        requestedPatientEmail: profile.requestedPatientEmail ?? null,
        requestedPatientCode: profile.requestedPatientCode ?? null
      }
    });
  } catch (error) {
    logWarn(`Failed to persist caregiver profile for ${userId}: ${(error as Error).message}`);
  }
}

export async function persistPatientProfile(userId: string): Promise<void> {
  if (!prisma) {
    return;
  }

  const profile = store.getPatientProfile(userId);
  if (!profile) {
    return;
  }

  try {
    const dbInput = createDbPatientProfileInput(profile);
    await prisma.patientProfile.upsert({
      where: {
        userId
      },
      update: dbInput,
      create: {
        userId,
        ...dbInput
      }
    });
  } catch (error) {
    logWarn(`Failed to persist patient profile for ${userId}: ${(error as Error).message}`);
  }
}

export async function persistBeneficiaries(patientId: string): Promise<void> {
  if (!prisma) {
    return;
  }

  const entries = store.getBeneficiariesByPatient(patientId);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.beneficiary.deleteMany({
        where: {
          patientId
        }
      });

      if (entries.length > 0) {
        await tx.beneficiary.createMany({
          data: entries.map((entry) => ({
            patientId,
            name: entry.name,
            relationship: entry.relationship,
            email: entry.email,
            phone: entry.phone,
            alertPreference: toDbAlertPreference(entry.alertPreference)
          }))
        });
      }
    });
  } catch (error) {
    logWarn(`Failed to persist beneficiaries for ${patientId}: ${(error as Error).message}`);
  }
}

export async function persistStreamingVitals(vitals: StreamingVitals): Promise<void> {
  if (!prisma) {
    return;
  }

  try {
    await prisma.streamingVitals.create({
      data: {
        patientId: vitals.patientId,
        timestamp: new Date(vitals.timestamp),
        heartRate: vitals.heartRate,
        stepCount: vitals.stepCount,
        bloodOxygen: vitals.bloodOxygen,
        sleepScore: vitals.sleepScore
      }
    });
  } catch (error) {
    logWarn(`Failed to persist streaming vitals for ${vitals.patientId}: ${(error as Error).message}`);
  }
}

export async function persistPredictionLog(log: PredictionLog): Promise<void> {
  if (!prisma) {
    return;
  }

  try {
    await prisma.predictionLog.create({
      data: {
        patientId: log.patientId,
        timestamp: new Date(log.timestamp),
        predictedRiskScore: log.predictedRiskScore,
        predictedDisease: log.predictedDisease,
        confidence: log.confidence,
        forecastWindow: log.forecastWindow,
        predictedTrend: log.predictedTrend as unknown as Prisma.InputJsonValue,
        riskMomentum: log.riskMomentum,
        explainability: log.explainability as unknown as Prisma.InputJsonValue,
        icdCode: log.icdCode,
        modelVersion: log.modelVersion
      }
    });
  } catch (error) {
    logWarn(`Failed to persist prediction for ${log.patientId}: ${(error as Error).message}`);
  }
}
