import dotenv from "dotenv";

dotenv.config();

function parseBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  return defaultValue;
}

function parseNumberEnv(value: string | undefined, defaultValue: number): number {
  if (!value) {
    return defaultValue;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

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
  predictionRunIntervalMs: Number(process.env.PREDICTION_RUN_INTERVAL_MS ?? 15000),
  mlApiUrl: process.env.ML_API_URL ?? "http://127.0.0.1:5001",
  mlApiTimeoutMs: Number(process.env.ML_API_TIMEOUT_MS ?? 25000),
  featherlessApiUrl: process.env.FEATHERLESS_API_URL ?? "https://api.featherless.ai/v1/chat/completions",
  featherlessApiKey: process.env.FEATHERLESS_API_KEY ?? "",
  featherlessModel: process.env.FEATHERLESS_MODEL ?? "deepseek-ai/DeepSeek-V3-0324",
  featherlessChatModel: process.env.FEATHERLESS_CHAT_MODEL ?? process.env.FEATHERLESS_MODEL ?? "deepseek-ai/DeepSeek-V3-0324",
  featherlessCoachingModel:
    process.env.FEATHERLESS_COACHING_MODEL ?? process.env.FEATHERLESS_MODEL ?? "deepseek-ai/DeepSeek-V3-0324",
  featherlessRepairModel: process.env.FEATHERLESS_REPAIR_MODEL ?? process.env.FEATHERLESS_MODEL ?? "deepseek-ai/DeepSeek-V3-0324",
  featherlessTopP: parseNumberEnv(process.env.FEATHERLESS_TOP_P, 0.9),
  featherlessChatTemperature: parseNumberEnv(process.env.FEATHERLESS_CHAT_TEMPERATURE, 0.25),
  featherlessCoachingTemperature: parseNumberEnv(process.env.FEATHERLESS_COACHING_TEMPERATURE, 0.15),
  featherlessChatMaxTokens: parseNumberEnv(process.env.FEATHERLESS_CHAT_MAX_TOKENS, 900),
  featherlessCoachingMaxTokens: parseNumberEnv(process.env.FEATHERLESS_COACHING_MAX_TOKENS, 1400),
  featherlessRepairMaxTokens: parseNumberEnv(process.env.FEATHERLESS_REPAIR_MAX_TOKENS, 1200),
  featherlessTimeoutMs: Number(process.env.FEATHERLESS_TIMEOUT_MS ?? 25000),
  featherlessMaxRetries: Number(process.env.FEATHERLESS_MAX_RETRIES ?? 2),
  featherlessRetryBaseMs: Number(process.env.FEATHERLESS_RETRY_BASE_MS ?? 1200),
  featherlessRetryMaxMs: Number(process.env.FEATHERLESS_RETRY_MAX_MS ?? 10000),
  assistantRequireLlm: parseBooleanEnv(process.env.ASSISTANT_REQUIRE_LLM, true)
};
