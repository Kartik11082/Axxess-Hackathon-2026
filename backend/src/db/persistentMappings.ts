import { prisma } from "./prisma";
import { store } from "../data/store";

function logInfo(message: string): void {
  // eslint-disable-next-line no-console
  console.log(`[mapping-db] ${message}`);
}

function logWarn(message: string): void {
  // eslint-disable-next-line no-console
  console.warn(`[mapping-db] ${message}`);
}

export async function initializePersistentMappings(): Promise<void> {
  if (!prisma) {
    logWarn("Prisma not initialized. Continuing with in-memory mappings only.");
    return;
  }

  try {
    const dbMappings = await prisma.caregiverPatientMapping.findMany();

    if (dbMappings.length === 0) {
      const seedMappings = store.listCaregiverMappings();
      if (seedMappings.length > 0) {
        for (const mapping of seedMappings) {
          await prisma.caregiverPatientMapping.upsert({
            where: {
              caregiverId_patientId: {
                caregiverId: mapping.caregiverId,
                patientId: mapping.patientId
              }
            },
            update: {},
            create: {
              caregiverId: mapping.caregiverId,
              patientId: mapping.patientId
            }
          });
        }
        logInfo(`Seeded ${seedMappings.length} in-memory mappings into SQLite.`);
      } else {
        logInfo("No seed mappings found. Starting with empty mapping table.");
      }
      return;
    }

    for (const mapping of dbMappings) {
      store.addCaregiverMapping(mapping.caregiverId, mapping.patientId);
    }

    logInfo(`Loaded ${dbMappings.length} caregiver-patient mappings from SQLite.`);
  } catch (error) {
    logWarn(`Database init skipped: ${(error as Error).message}`);
  }
}

export async function persistCaregiverMapping(caregiverId: string, patientId: string): Promise<void> {
  if (!prisma) {
    logWarn("Prisma not initialized. Mapping persisted only in memory.");
    return;
  }

  try {
    await prisma.caregiverPatientMapping.upsert({
      where: {
        caregiverId_patientId: {
          caregiverId,
          patientId
        }
      },
      update: {},
      create: {
        caregiverId,
        patientId
      }
    });
  } catch (error) {
    logWarn(`Failed to persist mapping ${caregiverId} -> ${patientId}: ${(error as Error).message}`);
  }
}
