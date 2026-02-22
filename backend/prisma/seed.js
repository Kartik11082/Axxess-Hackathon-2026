/* eslint-disable no-console */
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const demoPasswordHash = bcrypt.hashSync("Password123!", 10);

async function upsertUser(user) {
  await prisma.user.upsert({
    where: { id: user.id },
    update: {
      name: user.name,
      email: user.email,
      role: user.role,
      onboardingCompleted: user.onboardingCompleted,
      patientCode: user.patientCode ?? null,
      passwordHash: user.passwordHash
    },
    create: user
  });
}

async function run() {
  await upsertUser({
    id: "pat-001",
    name: "Ava Thompson",
    email: "patient1@demo.com",
    role: "Patient",
    onboardingCompleted: true,
    patientCode: "PT-001",
    passwordHash: demoPasswordHash
  });

  await upsertUser({
    id: "pat-002",
    name: "Noah Lee",
    email: "patient2@demo.com",
    role: "Patient",
    onboardingCompleted: false,
    patientCode: "PT-002",
    passwordHash: demoPasswordHash
  });

  await upsertUser({
    id: "cg-001",
    name: "Jordan Smith",
    email: "caregiver@demo.com",
    role: "Caregiver",
    onboardingCompleted: true,
    passwordHash: demoPasswordHash
  });

  await prisma.patientProfile.upsert({
    where: { userId: "pat-001" },
    update: {
      preferredName: "Ava",
      heightRange: "5'4\" - 5'6\"",
      activityLevel: "Moderate",
      lifeStage: "Mid_life",
      unusualThirst: 2,
      wakeUpAtNight: 2,
      breathlessDuringLightActivity: 1,
      fatigueAfterMeals: 1,
      monitorHeartRateRegularly: 2,
      onboardingResponses: {
        unusualThirst: 2,
        wakeUpAtNight: 2,
        breathlessDuringLightActivity: 1,
        fatigueAfterMeals: 1,
        monitorHeartRateRegularly: 2
      },
      insuranceProvider: "Axxess Shield",
      insuranceMemberIdEncrypted: "seeded",
      insuranceMemberIdMasked: "********4312",
      insuranceGroupNumberEncrypted: "seeded",
      insuranceGroupNumberMasked: "***4321",
      predictedDisease: "Stable",
      initialRiskConfidence: "Low",
      riskScore: 0.28,
      wearableData: [],
      insuranceId: "seeded",
      insuranceIdMasked: "********4312"
    },
    create: {
      userId: "pat-001",
      preferredName: "Ava",
      heightRange: "5'4\" - 5'6\"",
      activityLevel: "Moderate",
      lifeStage: "Mid_life",
      unusualThirst: 2,
      wakeUpAtNight: 2,
      breathlessDuringLightActivity: 1,
      fatigueAfterMeals: 1,
      monitorHeartRateRegularly: 2,
      onboardingResponses: {
        unusualThirst: 2,
        wakeUpAtNight: 2,
        breathlessDuringLightActivity: 1,
        fatigueAfterMeals: 1,
        monitorHeartRateRegularly: 2
      },
      insuranceProvider: "Axxess Shield",
      insuranceMemberIdEncrypted: "seeded",
      insuranceMemberIdMasked: "********4312",
      insuranceGroupNumberEncrypted: "seeded",
      insuranceGroupNumberMasked: "***4321",
      predictedDisease: "Stable",
      initialRiskConfidence: "Low",
      riskScore: 0.28,
      wearableData: [],
      insuranceId: "seeded",
      insuranceIdMasked: "********4312",
      onboardingCompletedAt: new Date()
    }
  });

  await prisma.patientProfile.upsert({
    where: { userId: "pat-002" },
    update: {
      predictedDisease: "Stable",
      initialRiskConfidence: "Low",
      riskScore: 0.33,
      wearableData: []
    },
    create: {
      userId: "pat-002",
      predictedDisease: "Stable",
      initialRiskConfidence: "Low",
      riskScore: 0.33,
      wearableData: []
    }
  });

  await prisma.caregiverProfessionalProfile.upsert({
    where: { userId: "cg-001" },
    update: {
      specialization: "Chronic Care",
      yearsOfExperience: 9,
      assignmentMode: "admin_assign_later"
    },
    create: {
      userId: "cg-001",
      specialization: "Chronic Care",
      yearsOfExperience: 9,
      assignmentMode: "admin_assign_later"
    }
  });

  await prisma.caregiverPatientMapping.upsert({
    where: {
      caregiverId_patientId: {
        caregiverId: "cg-001",
        patientId: "pat-001"
      }
    },
    update: {},
    create: {
      caregiverId: "cg-001",
      patientId: "pat-001"
    }
  });

  await prisma.caregiverPatientMapping.upsert({
    where: {
      caregiverId_patientId: {
        caregiverId: "cg-001",
        patientId: "pat-002"
      }
    },
    update: {},
    create: {
      caregiverId: "cg-001",
      patientId: "pat-002"
    }
  });

  await prisma.beneficiary.upsert({
    where: {
      id: "ben-001"
    },
    update: {
      patientId: "pat-001",
      name: "Casey Thompson",
      relationship: "Spouse",
      email: "casey@example.com",
      phone: "+15550000001",
      alertPreference: "high_risk_only"
    },
    create: {
      id: "ben-001",
      patientId: "pat-001",
      name: "Casey Thompson",
      relationship: "Spouse",
      email: "casey@example.com",
      phone: "+15550000001",
      alertPreference: "high_risk_only"
    }
  });

  await prisma.beneficiary.upsert({
    where: {
      id: "ben-002"
    },
    update: {
      patientId: "pat-002",
      name: "Mia Lee",
      relationship: "Daughter",
      email: "mia@example.com",
      phone: "+15550000002",
      alertPreference: "emergency_only"
    },
    create: {
      id: "ben-002",
      patientId: "pat-002",
      name: "Mia Lee",
      relationship: "Daughter",
      email: "mia@example.com",
      phone: "+15550000002",
      alertPreference: "emergency_only"
    }
  });

  await prisma.patientOnboardingDraft.upsert({
    where: { userId: "pat-002" },
    update: {
      currentStep: 1,
      completed: false
    },
    create: {
      userId: "pat-002",
      currentStep: 1,
      completed: false
    }
  });

  await prisma.caregiverOnboardingDraft.upsert({
    where: { userId: "cg-001" },
    update: {
      currentStep: 3,
      completed: true
    },
    create: {
      userId: "cg-001",
      currentStep: 3,
      completed: true
    }
  });

  console.log("SQLite seed completed.");
}

run()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
