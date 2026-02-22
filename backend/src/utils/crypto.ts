import { createCipheriv, createHash, randomBytes } from "crypto";
import { config } from "../config";

function getKey(): Buffer {
  const base = config.phiEncryptionKey || config.jwtSecret;
  return createHash("sha256").update(base).digest();
}

export function encryptSensitiveValue(value: string): string {
  if (!value) {
    return "";
  }

  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}
