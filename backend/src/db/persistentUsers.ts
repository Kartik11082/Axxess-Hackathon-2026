import { prisma } from "./prisma";
import { store } from "../data/store";
import { User } from "../models/types";

function logInfo(message: string): void {
  // eslint-disable-next-line no-console
  console.log(`[user-db] ${message}`);
}

function logWarn(message: string): void {
  // eslint-disable-next-line no-console
  console.warn(`[user-db] ${message}`);
}

function fromDbUser(dbUser: {
  id: string;
  name: string;
  email: string;
  role: "Patient" | "Caregiver";
  onboardingCompleted: boolean;
  patientCode: string | null;
  passwordHash: string;
}): User {
  return {
    id: dbUser.id,
    name: dbUser.name,
    email: dbUser.email,
    role: dbUser.role,
    onboardingCompleted: dbUser.onboardingCompleted,
    patientCode: dbUser.patientCode ?? undefined,
    passwordHash: dbUser.passwordHash
  };
}

export async function initializePersistentUsers(): Promise<void> {
  if (!prisma) {
    logWarn("Prisma not initialized. Continuing with in-memory users only.");
    return;
  }

  try {
    const dbUsers = await prisma.user.findMany();
    if (dbUsers.length === 0) {
      const seedUsers = store.listAllUsers();
      for (const user of seedUsers) {
        await prisma.user.upsert({
          where: {
            id: user.id
          },
          update: {
            name: user.name,
            email: user.email,
            role: user.role,
            onboardingCompleted: user.onboardingCompleted,
            patientCode: user.patientCode ?? null,
            passwordHash: user.passwordHash
          },
          create: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            onboardingCompleted: user.onboardingCompleted,
            patientCode: user.patientCode ?? null,
            passwordHash: user.passwordHash
          }
        });
      }
      logInfo(`Seeded ${seedUsers.length} in-memory users into SQLite.`);
      return;
    }

    for (const dbUser of dbUsers) {
      store.upsertUser(fromDbUser(dbUser));
    }
    logInfo(`Loaded ${dbUsers.length} users from SQLite.`);
  } catch (error) {
    logWarn(`User DB init skipped: ${(error as Error).message}`);
  }
}

export async function persistUser(user: User): Promise<void> {
  if (!prisma) {
    logWarn("Prisma not initialized. User persisted only in memory.");
    return;
  }

  try {
    await prisma.user.upsert({
      where: {
        id: user.id
      },
      update: {
        name: user.name,
        email: user.email,
        role: user.role,
        onboardingCompleted: user.onboardingCompleted,
        patientCode: user.patientCode ?? null,
        passwordHash: user.passwordHash
      },
      create: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        onboardingCompleted: user.onboardingCompleted,
        patientCode: user.patientCode ?? null,
        passwordHash: user.passwordHash
      }
    });
  } catch (error) {
    logWarn(`Failed to persist user ${user.email}: ${(error as Error).message}`);
  }
}

export async function findPersistentUserByEmail(email: string): Promise<User | null> {
  if (!prisma) {
    return null;
  }

  try {
    const dbUser = await prisma.user.findUnique({
      where: {
        email
      }
    });
    if (!dbUser) {
      return null;
    }
    const user = fromDbUser(dbUser);
    store.upsertUser(user);
    return user;
  } catch (error) {
    logWarn(`Failed to lookup user by email ${email}: ${(error as Error).message}`);
    return null;
  }
}

export async function findPersistentUserById(userId: string): Promise<User | null> {
  if (!prisma) {
    return null;
  }

  try {
    const dbUser = await prisma.user.findUnique({
      where: {
        id: userId
      }
    });
    if (!dbUser) {
      return null;
    }
    const user = fromDbUser(dbUser);
    store.upsertUser(user);
    return user;
  } catch (error) {
    logWarn(`Failed to lookup user by id ${userId}: ${(error as Error).message}`);
    return null;
  }
}
