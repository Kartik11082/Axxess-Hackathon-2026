import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? "dev-only-jwt-secret-change-me",
  phiEncryptionKey: process.env.PHI_ENCRYPTION_KEY ?? "",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "30m",
  signupRateLimitWindowMs: Number(process.env.SIGNUP_RATE_LIMIT_WINDOW_MS ?? 15 * 60_000),
  signupRateLimitMax: Number(process.env.SIGNUP_RATE_LIMIT_MAX ?? 12),
  predictionRiskThreshold: Number(process.env.PREDICTION_RISK_THRESHOLD ?? 0.75),
  predictionConfidenceThreshold: Number(process.env.PREDICTION_CONFIDENCE_THRESHOLD ?? 0.85),
  sustainedHrThreshold: Number(process.env.SUSTAINED_HR_THRESHOLD ?? 125),
  sustainedHrSamples: Number(process.env.SUSTAINED_HR_SAMPLES ?? 3),
  streamMinIntervalMs: Number(process.env.STREAM_MIN_INTERVAL_MS ?? 3000),
  streamMaxIntervalMs: Number(process.env.STREAM_MAX_INTERVAL_MS ?? 5000),
  predictionWindowMinutes: Number(process.env.PREDICTION_WINDOW_MINUTES ?? 10),
  predictionRunIntervalMs: Number(process.env.PREDICTION_RUN_INTERVAL_MS ?? 15000)
};
