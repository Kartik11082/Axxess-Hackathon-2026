-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false,
    "patientCode" TEXT,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PatientProfile" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "preferredName" TEXT,
    "heightRange" TEXT,
    "activityLevel" TEXT,
    "lifeStage" TEXT,
    "unusualThirst" INTEGER,
    "wakeUpAtNight" INTEGER,
    "breathlessDuringLightActivity" INTEGER,
    "fatigueAfterMeals" INTEGER,
    "monitorHeartRateRegularly" INTEGER,
    "onboardingResponses" JSONB,
    "insuranceProvider" TEXT,
    "insuranceMemberIdEncrypted" TEXT,
    "insuranceMemberIdMasked" TEXT,
    "insuranceGroupNumberEncrypted" TEXT,
    "insuranceGroupNumberMasked" TEXT,
    "predictedDisease" TEXT NOT NULL DEFAULT 'Stable',
    "initialRiskConfidence" TEXT NOT NULL DEFAULT 'Low',
    "riskScore" REAL NOT NULL DEFAULT 0,
    "wearableData" JSONB,
    "insuranceId" TEXT,
    "insuranceIdMasked" TEXT NOT NULL DEFAULT '',
    "onboardingCompletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PatientProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PatientOnboardingDraft" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "preferredName" TEXT,
    "heightRange" TEXT,
    "activityLevel" TEXT,
    "lifeStage" TEXT,
    "unusualThirst" INTEGER,
    "wakeUpAtNight" INTEGER,
    "breathlessDuringLightActivity" INTEGER,
    "fatigueAfterMeals" INTEGER,
    "monitorHeartRateRegularly" INTEGER,
    "insuranceProvider" TEXT,
    "insuranceMemberIdEncrypted" TEXT,
    "insuranceMemberIdMasked" TEXT,
    "insuranceGroupNumberEncrypted" TEXT,
    "insuranceGroupNumberMasked" TEXT,
    "beneficiariesJson" JSONB,
    "consentDataUsageAccepted" BOOLEAN,
    "consentWearableAccepted" BOOLEAN,
    "consentAiModelingAcknowledged" BOOLEAN,
    "consentVersion" TEXT,
    "consentAcceptedAt" DATETIME,
    "currentStep" INTEGER NOT NULL DEFAULT 1,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PatientOnboardingDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CaregiverProfessionalProfile" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "licenseNumber" TEXT,
    "specialization" TEXT NOT NULL,
    "yearsOfExperience" INTEGER NOT NULL,
    "assignmentMode" TEXT NOT NULL,
    "requestedPatientEmail" TEXT,
    "requestedPatientCode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CaregiverProfessionalProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CaregiverOnboardingDraft" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "licenseNumber" TEXT,
    "specialization" TEXT,
    "yearsOfExperience" INTEGER,
    "assignmentMode" TEXT,
    "requestedPatientEmail" TEXT,
    "requestedPatientCode" TEXT,
    "consentHipaaAccepted" BOOLEAN,
    "consentDataAccessAccepted" BOOLEAN,
    "consentVersion" TEXT,
    "consentAcceptedAt" DATETIME,
    "currentStep" INTEGER NOT NULL DEFAULT 1,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CaregiverOnboardingDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StreamingVitals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientId" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL,
    "heartRate" INTEGER NOT NULL,
    "stepCount" INTEGER NOT NULL,
    "bloodOxygen" INTEGER NOT NULL,
    "sleepScore" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StreamingVitals_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PredictionLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientId" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL,
    "predictedRiskScore" REAL NOT NULL,
    "predictedDisease" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "forecastWindow" TEXT NOT NULL,
    "predictedTrend" JSONB NOT NULL,
    "riskMomentum" TEXT NOT NULL,
    "explainability" JSONB NOT NULL,
    "icdCode" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PredictionLog_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Beneficiary" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "alertPreference" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Beneficiary_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CaregiverPatientMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caregiverId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CaregiverPatientMapping_caregiverId_fkey" FOREIGN KEY ("caregiverId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CaregiverPatientMapping_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotificationItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NotificationItem_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OutboundNotification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OutboundNotification_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLogItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "patientId" TEXT,
    "timestamp" DATETIME NOT NULL,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLogItem_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConsentLogItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "consentType" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "acceptedAt" DATETIME NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConsentLogItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_patientCode_key" ON "User"("patientCode");

-- CreateIndex
CREATE INDEX "StreamingVitals_patientId_timestamp_idx" ON "StreamingVitals"("patientId", "timestamp");

-- CreateIndex
CREATE INDEX "PredictionLog_patientId_timestamp_idx" ON "PredictionLog"("patientId", "timestamp");

-- CreateIndex
CREATE INDEX "Beneficiary_patientId_idx" ON "Beneficiary"("patientId");

-- CreateIndex
CREATE INDEX "CaregiverPatientMapping_caregiverId_idx" ON "CaregiverPatientMapping"("caregiverId");

-- CreateIndex
CREATE INDEX "CaregiverPatientMapping_patientId_idx" ON "CaregiverPatientMapping"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "CaregiverPatientMapping_caregiverId_patientId_key" ON "CaregiverPatientMapping"("caregiverId", "patientId");

-- CreateIndex
CREATE INDEX "NotificationItem_userId_timestamp_idx" ON "NotificationItem"("userId", "timestamp");

-- CreateIndex
CREATE INDEX "OutboundNotification_patientId_timestamp_idx" ON "OutboundNotification"("patientId", "timestamp");

-- CreateIndex
CREATE INDEX "AuditLogItem_actorUserId_timestamp_idx" ON "AuditLogItem"("actorUserId", "timestamp");

-- CreateIndex
CREATE INDEX "ConsentLogItem_userId_acceptedAt_idx" ON "ConsentLogItem"("userId", "acceptedAt");
