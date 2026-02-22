import type { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __prisma__: PrismaClient | undefined;
}

let prismaClient: PrismaClient | null = null;

try {
  const { PrismaClient: PrismaCtor } = require("@prisma/client") as {
    PrismaClient: new (options?: unknown) => PrismaClient;
  };

  prismaClient =
    global.__prisma__ ??
    new PrismaCtor({
      log: ["warn", "error"]
    });

  if (process.env.NODE_ENV !== "production" && prismaClient) {
    global.__prisma__ = prismaClient;
  }
} catch (error) {
  // eslint-disable-next-line no-console
  console.warn(
    "[db] Prisma client not ready yet. Run `npm run db:generate --workspace backend` and `npm run db:push --workspace backend`.",
    error
  );
}

export const prisma = prismaClient;
