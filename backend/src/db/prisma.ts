import type { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";

declare global {
  // eslint-disable-next-line no-var
  var __prisma__: PrismaClient | undefined;
}

let prismaClient: PrismaClient | null = null;

function normalizeRuntimeDatabaseUrl(rawUrl: string | undefined): string | undefined {
  if (!rawUrl || !rawUrl.startsWith("file:")) {
    return rawUrl;
  }

  const filePart = rawUrl.slice("file:".length);
  if (!filePart.startsWith("./") && !filePart.startsWith(".\\")) {
    return rawUrl;
  }

  // Force all relative SQLite paths to backend/prisma to avoid cwd-dependent resolution.
  const normalizedRelative = filePart
    .replace(/^[./\\]+/, "")
    .replace(/^prisma[\\/]+/, "");
  const backendRoot = path.resolve(__dirname, "..", "..");
  const dbFilePath = path.resolve(backendRoot, "prisma", normalizedRelative);

  fs.mkdirSync(path.dirname(dbFilePath), { recursive: true });
  if (!fs.existsSync(dbFilePath)) {
    fs.closeSync(fs.openSync(dbFilePath, "a"));
  }

  return `file:${dbFilePath.replace(/\\/g, "/")}`;
}

try {
  const { PrismaClient: PrismaCtor } = require("@prisma/client") as {
    PrismaClient: new (options?: unknown) => PrismaClient;
  };

  prismaClient =
    global.__prisma__ ??
    new PrismaCtor({
      datasources: {
        db: {
          url: normalizeRuntimeDatabaseUrl(process.env.DATABASE_URL)
        }
      },
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
