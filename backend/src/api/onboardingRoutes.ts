import { Router } from "express";
import { z } from "zod";
import { store } from "../data/store";
import {
  persistBeneficiaries,
  persistCaregiverOnboardingDraft,
  persistCaregiverProfile,
  persistPatientOnboardingDraft,
  persistPatientProfile
} from "../db/persistentDomain";
import { persistCaregiverMapping } from "../db/persistentMappings";
import { persistUser } from "../db/persistentUsers";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/role";
import { calculateInitialRiskAssessment } from "../services/riskModel";
import { encryptSensitiveValue } from "../utils/crypto";
import { maskGenericId } from "../utils/mask";
import { nowIso } from "../utils/time";

const basicInfoSchema = z.object({
  preferredName: z.string().trim().min(2).max(80),
  heightRange: z.string().trim().min(2).max(40),
  activityLevel: z.enum(["Low", "Moderate", "High"]),
  lifeStage: z.enum(["Early adult", "Mid-life", "Senior"])
});

const behavioralSchema = z.object({
  unusualThirst: z.number().int().min(0).max(4),
  wakeUpAtNight: z.number().int().min(0).max(4),
  breathlessDuringLightActivity: z.number().int().min(0).max(4),
  fatigueAfterMeals: z.number().int().min(0).max(4),
  monitorHeartRateRegularly: z.number().int().min(0).max(4)
});

const insuranceSchema = z.object({
  provider: z.string().trim().max(80).optional(),
  memberId: z.string().trim().max(80).optional(),
  groupNumber: z.string().trim().max(80).optional()
});

const beneficiarySchema = z.object({
  name: z.string().trim().min(2).max(120),
  relationship: z.string().trim().min(2).max(80),
  email: z.string().trim().email(),
  phone: z.string().trim().min(7).max(30),
  alertPreference: z.enum(["high-risk-only", "all-alerts", "emergency-only"])
});

const patientConsentSchema = z.object({
  dataUsageAccepted: z.boolean(),
  wearableConsentAccepted: z.boolean(),
  aiModelingAcknowledged: z.boolean(),
  version: z.string().trim().min(1).max(40)
});

const caregiverProfessionalSchema = z.object({
  licenseNumber: z.string().trim().max(80).optional(),
  specialization: z.string().trim().min(2).max(80),
  yearsOfExperience: z.number().int().min(0).max(60)
});

const caregiverAssignmentSchema = z
  .object({
    assignmentMode: z.enum(["admin_assign_later", "request_access"]),
    patientEmail: z.string().trim().email().optional(),
    patientCode: z.string().trim().min(3).max(30).optional()
  })
  .superRefine((value, ctx) => {
    if (value.assignmentMode === "request_access" && !value.patientEmail && !value.patientCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide patient email or patient code when requesting access.",
        path: ["patientEmail"]
      });
    }
  });

const caregiverConsentSchema = z.object({
  hipaaAccepted: z.boolean(),
  dataAccessAccepted: z.boolean(),
  version: z.string().trim().min(1).max(40)
});

function sanitizePatientDraftForClient(userId: string) {
  const draft = store.getPatientOnboardingDraft(userId);
  return {
    ...draft,
    insurance: draft.insurance
      ? {
          provider: draft.insurance.provider,
          memberIdMasked: draft.insurance.memberIdMasked,
          groupNumberMasked: draft.insurance.groupNumberMasked
        }
      : null
  };
}

export const onboardingRoutes = Router();

onboardingRoutes.get("/status", requireAuth, (req, res) => {
  const status = store.getOnboardingStatus(req.auth!.userId);
  if (!status) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  res.json(status);
});

onboardingRoutes.get("/patient/draft", requireAuth, requireRole("Patient"), (req, res) => {
  res.json({
    draft: sanitizePatientDraftForClient(req.auth!.userId)
  });
});

onboardingRoutes.put("/patient/basic-info", requireAuth, requireRole("Patient"), async (req, res) => {
  const parsed = basicInfoSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid basic info payload.", details: parsed.error.flatten() });
    return;
  }

  const draft = store.upsertPatientOnboardingDraft(req.auth!.userId, {
    basicInfo: parsed.data,
    currentStep: 1
  });
  await persistPatientOnboardingDraft(req.auth!.userId);

  res.json({
    draft: sanitizePatientDraftForClient(req.auth!.userId),
    updatedAt: draft.updatedAt
  });
});

onboardingRoutes.put("/patient/behavioral", requireAuth, requireRole("Patient"), async (req, res) => {
  const parsed = behavioralSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid behavioral response payload.", details: parsed.error.flatten() });
    return;
  }

  const draft = store.upsertPatientOnboardingDraft(req.auth!.userId, {
    behavioralResponses: parsed.data,
    currentStep: 2
  });
  await persistPatientOnboardingDraft(req.auth!.userId);

  res.json({
    draft: sanitizePatientDraftForClient(req.auth!.userId),
    updatedAt: draft.updatedAt
  });
});

onboardingRoutes.put("/patient/insurance", requireAuth, requireRole("Patient"), async (req, res) => {
  const parsed = insuranceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid insurance payload.", details: parsed.error.flatten() });
    return;
  }

  const hasValues = Boolean(parsed.data.provider || parsed.data.memberId || parsed.data.groupNumber);

  const insurance = hasValues
    ? {
        provider: parsed.data.provider ?? "",
        memberIdEncrypted: encryptSensitiveValue(parsed.data.memberId ?? ""),
        memberIdMasked: maskGenericId(parsed.data.memberId ?? ""),
        groupNumberEncrypted: encryptSensitiveValue(parsed.data.groupNumber ?? ""),
        groupNumberMasked: maskGenericId(parsed.data.groupNumber ?? "")
      }
    : null;

  const draft = store.upsertPatientOnboardingDraft(req.auth!.userId, {
    insurance,
    currentStep: 3
  });
  await persistPatientOnboardingDraft(req.auth!.userId);

  res.json({
    draft: sanitizePatientDraftForClient(req.auth!.userId),
    updatedAt: draft.updatedAt
  });
});

onboardingRoutes.put("/patient/beneficiaries", requireAuth, requireRole("Patient"), async (req, res) => {
  const parsed = z.array(beneficiarySchema).max(6).safeParse(req.body?.beneficiaries ?? []);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid beneficiary payload.", details: parsed.error.flatten() });
    return;
  }

  const beneficiaries = parsed.data.map((item) => ({
    patientId: req.auth!.userId,
    ...item
  }));

  const draft = store.upsertPatientOnboardingDraft(req.auth!.userId, {
    beneficiaries,
    currentStep: 4
  });
  await persistPatientOnboardingDraft(req.auth!.userId);

  res.json({
    draft: sanitizePatientDraftForClient(req.auth!.userId),
    updatedAt: draft.updatedAt
  });
});

onboardingRoutes.put("/patient/consent", requireAuth, requireRole("Patient"), async (req, res) => {
  const parsed = patientConsentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid patient consent payload.", details: parsed.error.flatten() });
    return;
  }

  const draft = store.upsertPatientOnboardingDraft(req.auth!.userId, {
    consent: {
      ...parsed.data,
      acceptedAt: parsed.data.dataUsageAccepted && parsed.data.wearableConsentAccepted && parsed.data.aiModelingAcknowledged
        ? nowIso()
        : undefined
      },
    currentStep: 5
  });
  await persistPatientOnboardingDraft(req.auth!.userId);

  res.json({
    draft: sanitizePatientDraftForClient(req.auth!.userId),
    updatedAt: draft.updatedAt
  });
});

onboardingRoutes.post("/patient/complete", requireAuth, requireRole("Patient"), async (req, res) => {
  const userId = req.auth!.userId;
  const draft = store.getPatientOnboardingDraft(userId);

  if (!draft.basicInfo || !draft.behavioralResponses || !draft.consent) {
    res.status(400).json({ error: "Onboarding draft is incomplete. Please finish all required steps." });
    return;
  }

  if (!draft.consent.dataUsageAccepted || !draft.consent.wearableConsentAccepted || !draft.consent.aiModelingAcknowledged) {
    res.status(400).json({ error: "All patient consent items must be accepted." });
    return;
  }

  const assessment = calculateInitialRiskAssessment({
    responses: draft.behavioralResponses,
    activityLevel: draft.basicInfo.activityLevel,
    lifeStage: draft.basicInfo.lifeStage
  });

  store.completePatientOnboarding({
    userId,
    basicInfo: draft.basicInfo,
    behavioralResponses: draft.behavioralResponses,
    insurance: draft.insurance,
    beneficiaries: draft.beneficiaries,
    predictedDisease: assessment.probableDisease,
    baselineRiskScore: assessment.baselineRiskScore,
    initialRiskConfidence: assessment.confidenceLabel
  });

  store.addConsentLog({
    userId,
    role: "Patient",
    consentType: "patient_onboarding",
    version: draft.consent.version,
    acceptedAt: draft.consent.acceptedAt ?? nowIso(),
    ipAddress: req.ip ?? "unknown",
    metadata: {
      dataUsageAccepted: draft.consent.dataUsageAccepted,
      wearableConsentAccepted: draft.consent.wearableConsentAccepted,
      aiModelingAcknowledged: draft.consent.aiModelingAcknowledged
    }
  });
  await Promise.all([
    persistPatientProfile(userId),
    persistBeneficiaries(userId),
    persistPatientOnboardingDraft(userId),
    (async () => {
      const user = store.getUserById(userId);
      if (user) {
        await persistUser(user);
      }
    })()
  ]);

  res.json({
    baselineRiskScore: assessment.baselineRiskScore,
    probableDisease: assessment.probableDisease,
    confidence: assessment.confidenceLabel,
    initialRiskAssessment: {
      diabetesScore: assessment.diabetesScore,
      cardiacScore: assessment.cardiacScore
    },
    message:
      assessment.probableDisease === "Cardiac"
        ? "Based on your responses, we will monitor your cardiovascular trends closely."
        : assessment.probableDisease === "Diabetes"
          ? "Based on your responses, we will monitor metabolic health trends closely."
          : "Based on your responses, we will continue routine monitoring and trend detection.",
    nextPath: "/patient"
  });
});

onboardingRoutes.get("/caregiver/draft", requireAuth, requireRole("Caregiver"), (req, res) => {
  res.json({
    draft: store.getCaregiverOnboardingDraft(req.auth!.userId)
  });
});

onboardingRoutes.put("/caregiver/professional", requireAuth, requireRole("Caregiver"), async (req, res) => {
  const parsed = caregiverProfessionalSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid professional profile payload.", details: parsed.error.flatten() });
    return;
  }

  const current = store.getCaregiverOnboardingDraft(req.auth!.userId);
  const draft = store.upsertCaregiverOnboardingDraft(req.auth!.userId, {
    professionalProfile: {
      userId: req.auth!.userId,
      licenseNumber: parsed.data.licenseNumber,
      specialization: parsed.data.specialization,
      yearsOfExperience: parsed.data.yearsOfExperience,
      assignmentMode: current.professionalProfile?.assignmentMode ?? "admin_assign_later",
      requestedPatientCode: current.professionalProfile?.requestedPatientCode,
      requestedPatientEmail: current.professionalProfile?.requestedPatientEmail
    },
    currentStep: 1
  });
  await persistCaregiverOnboardingDraft(req.auth!.userId);

  res.json({
    draft,
    updatedAt: draft.updatedAt
  });
});

onboardingRoutes.put("/caregiver/assignment", requireAuth, requireRole("Caregiver"), async (req, res) => {
  const parsed = caregiverAssignmentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid assignment payload.", details: parsed.error.flatten() });
    return;
  }

  const current = store.getCaregiverOnboardingDraft(req.auth!.userId);
  const profile = current.professionalProfile ?? {
    userId: req.auth!.userId,
    specialization: "General Care",
    yearsOfExperience: 0,
    assignmentMode: "admin_assign_later" as const
  };

  const draft = store.upsertCaregiverOnboardingDraft(req.auth!.userId, {
    professionalProfile: {
      ...profile,
      assignmentMode: parsed.data.assignmentMode,
      requestedPatientEmail: parsed.data.patientEmail,
      requestedPatientCode: parsed.data.patientCode
    },
    currentStep: 2
  });
  await persistCaregiverOnboardingDraft(req.auth!.userId);

  res.json({
    draft,
    updatedAt: draft.updatedAt
  });
});

onboardingRoutes.put("/caregiver/consent", requireAuth, requireRole("Caregiver"), async (req, res) => {
  const parsed = caregiverConsentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid caregiver consent payload.", details: parsed.error.flatten() });
    return;
  }

  const draft = store.upsertCaregiverOnboardingDraft(req.auth!.userId, {
    consent: {
      ...parsed.data,
      acceptedAt: parsed.data.hipaaAccepted && parsed.data.dataAccessAccepted ? nowIso() : undefined
    },
    currentStep: 3
  });
  await persistCaregiverOnboardingDraft(req.auth!.userId);

  res.json({
    draft,
    updatedAt: draft.updatedAt
  });
});

onboardingRoutes.post("/caregiver/complete", requireAuth, requireRole("Caregiver"), async (req, res) => {
  const userId = req.auth!.userId;
  const draft = store.getCaregiverOnboardingDraft(userId);

  if (!draft.professionalProfile || !draft.consent) {
    res.status(400).json({ error: "Onboarding draft is incomplete. Please finish all required steps." });
    return;
  }

  if (!draft.consent.hipaaAccepted || !draft.consent.dataAccessAccepted) {
    res.status(400).json({ error: "All caregiver consent items must be accepted." });
    return;
  }

  let mappedPatientId: string | null = null;

  if (draft.professionalProfile.assignmentMode === "request_access") {
    const patientByEmail = draft.professionalProfile.requestedPatientEmail
      ? store.getUserByEmail(draft.professionalProfile.requestedPatientEmail)
      : undefined;
    const patientByCode = draft.professionalProfile.requestedPatientCode
      ? store.getUserByPatientCode(draft.professionalProfile.requestedPatientCode)
      : undefined;

    const patient = patientByEmail ?? patientByCode;
    if (patient && patient.role === "Patient") {
      store.addCaregiverMapping(userId, patient.id);
      await persistCaregiverMapping(userId, patient.id);
      mappedPatientId = patient.id;
    }
  }

  store.completeCaregiverOnboarding({
    userId,
    profile: draft.professionalProfile
  });

  store.addConsentLog({
    userId,
    role: "Caregiver",
    consentType: "caregiver_onboarding",
    version: draft.consent.version,
    acceptedAt: draft.consent.acceptedAt ?? nowIso(),
    ipAddress: req.ip ?? "unknown",
    metadata: {
      hipaaAccepted: draft.consent.hipaaAccepted,
      dataAccessAccepted: draft.consent.dataAccessAccepted,
      assignmentMode: draft.professionalProfile.assignmentMode
    }
  });
  await Promise.all([
    persistCaregiverProfile(userId),
    persistCaregiverOnboardingDraft(userId),
    (async () => {
      const user = store.getUserById(userId);
      if (user) {
        await persistUser(user);
      }
    })()
  ]);

  res.json({
    message: "Caregiver onboarding completed successfully.",
    mappedPatientId,
    nextPath: "/caregiver"
  });
});
