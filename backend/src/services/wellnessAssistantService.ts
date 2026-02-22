import {
  AssistantChatResponse,
  AssistantIntent,
  AssistantReply,
  AssistantUrgency,
  CoachingGoal,
  CoachingPlanItem,
  CoachingPlanResponse
} from "../models/types";
import { config } from "../config";
import { store } from "../data/store";
import { minutesAgoIso, nowIso } from "../utils/time";

interface ChatHistoryItem {
  role: "user" | "assistant";
  content: string;
}

interface PatientContext {
  patientId: string;
  patientName: string;
  baselineRisk: number;
  predictedDisease: string;
  latestPredictedRisk?: number;
  latestConfidence?: number;
  avgHeartRate: number;
  avgBloodOxygen: number;
  avgStepCount: number;
  avgSleepScore: number;
  heartRateTrend: number;
  bloodOxygenTrend: number;
  sleepTrend: number;
  topSignals: string[];
}

interface FeatherlessMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface FeatherlessCallOptions {
  responseFormatJson?: boolean;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  model?: string;
}

export class FeatherlessRateLimitError extends Error {
  retryAfterMs?: number;

  constructor(message: string, retryAfterMs?: number) {
    super(message);
    this.name = "FeatherlessRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

function toFixed2(value: number): number {
  return Number(value.toFixed(2));
}

function safeString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function safeArrayOfStrings(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const cleaned = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => Boolean(entry))
    .slice(0, 6);
  return cleaned.length > 0 ? cleaned : fallback;
}

function safeIntent(value: unknown): AssistantIntent {
  if (value === "triage" || value === "reminder" || value === "scheduling" || value === "general") {
    return value;
  }
  return "general";
}

function safeUrgency(value: unknown): AssistantUrgency {
  if (value === "low" || value === "moderate" || value === "high") {
    return value;
  }
  return "low";
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Unknown assistant service error.";
}

function parseRetryAfterMs(headers: Headers): number | undefined {
  const raw = headers.get("retry-after");
  if (!raw) {
    return undefined;
  }

  const asSeconds = Number(raw);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.round(asSeconds * 1000);
  }

  const asDateMs = Date.parse(raw);
  if (!Number.isNaN(asDateMs)) {
    return Math.max(0, asDateMs - Date.now());
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractMessageContent(message: unknown): string | null {
  if (!message || typeof message !== "object") {
    return null;
  }

  const record = message as Record<string, unknown>;
  const content = record.content;

  if (typeof content === "string" && content.trim()) {
    return content;
  }

  if (Array.isArray(content)) {
    const textParts = content
      .map((part) => {
        if (!part || typeof part !== "object") {
          return "";
        }
        const partRecord = part as Record<string, unknown>;
        const text = partRecord.text;
        if (typeof text === "string") {
          return text;
        }
        if (text && typeof text === "object") {
          const nested = text as Record<string, unknown>;
          return typeof nested.value === "string" ? nested.value : "";
        }
        return "";
      })
      .filter((text) => Boolean(text.trim()));

    if (textParts.length > 0) {
      return textParts.join("\n");
    }
  }

  const outputText = record.output_text;
  if (typeof outputText === "string" && outputText.trim()) {
    return outputText;
  }

  const reasoning = record.reasoning;
  if (typeof reasoning === "string" && reasoning.trim()) {
    return reasoning;
  }

  return null;
}

function extractChoiceContent(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const root = payload as Record<string, unknown>;
  const choices = root.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }

  const first = choices[0];
  if (!first || typeof first !== "object") {
    return null;
  }

  const choice = first as Record<string, unknown>;
  const messageText = extractMessageContent(choice.message);
  if (messageText) {
    return messageText;
  }

  const legacyText = choice.text;
  if (typeof legacyText === "string" && legacyText.trim()) {
    return legacyText;
  }

  return null;
}

function extractTextFromContentArray(content: unknown): string | null {
  if (!Array.isArray(content)) {
    return null;
  }

  const parts = content
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }
      const record = part as Record<string, unknown>;
      const text = record.text;
      if (typeof text === "string") {
        return text;
      }
      if (text && typeof text === "object") {
        const nested = text as Record<string, unknown>;
        return typeof nested.value === "string" ? nested.value : "";
      }
      return "";
    })
    .filter((value) => Boolean(value.trim()));

  return parts.length > 0 ? parts.join("\n") : null;
}

function extractProviderError(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const root = payload as Record<string, unknown>;
  const directError = root.error;

  if (typeof directError === "string" && directError.trim()) {
    return directError;
  }

  if (directError && typeof directError === "object") {
    const errorObj = directError as Record<string, unknown>;
    const message = errorObj.message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
    const detail = errorObj.detail;
    if (typeof detail === "string" && detail.trim()) {
      return detail;
    }
    const code = errorObj.code;
    if (typeof code === "string" && code.trim()) {
      return `Provider error code: ${code}`;
    }
  }

  const message = root.message;
  if (typeof message === "string" && message.trim()) {
    return message;
  }

  const detail = root.detail;
  if (typeof detail === "string" && detail.trim()) {
    return detail;
  }

  return null;
}

function extractAlternativeContent(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const root = payload as Record<string, unknown>;

  const directCandidates = [root.output_text, root.text, root.response, root.completion, root.generated_text];
  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }

  const messageContent = extractMessageContent(root.message);
  if (messageContent) {
    return messageContent;
  }

  // OpenAI responses-style: output: [{ content: [{ type: "output_text", text: "..." }] }]
  const output = root.output;
  if (Array.isArray(output)) {
    for (const item of output) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const outputItem = item as Record<string, unknown>;
      const directContent = outputItem.content;
      if (typeof directContent === "string" && directContent.trim()) {
        return directContent;
      }
      const contentFromArray = extractTextFromContentArray(directContent);
      if (contentFromArray) {
        return contentFromArray;
      }
    }
  }

  // Gemini-like shape: candidates[].content.parts[].text
  const candidates = root.candidates;
  if (Array.isArray(candidates)) {
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== "object") {
        continue;
      }
      const candidateObj = candidate as Record<string, unknown>;
      const contentObj = candidateObj.content;
      if (!contentObj || typeof contentObj !== "object") {
        continue;
      }
      const contentRec = contentObj as Record<string, unknown>;
      const partsText = extractTextFromContentArray(contentRec.parts);
      if (partsText) {
        return partsText;
      }
    }
  }

  const data = root.data;
  if (data && typeof data === "object") {
    const nested = extractAlternativeContent(data);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function summarizeMissingContent(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "Featherless response payload was not an object.";
  }

  const root = payload as Record<string, unknown>;
  const keys = Object.keys(root).slice(0, 20);
  const choices = root.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return `Featherless response did not include any choices (keys=${keys.join(",")}).`;
  }

  const first = choices[0];
  if (!first || typeof first !== "object") {
    return "Featherless first choice was not an object.";
  }

  const choice = first as Record<string, unknown>;
  const finishReason = typeof choice.finish_reason === "string" ? choice.finish_reason : "unknown";
  const message = choice.message;

  if (!message || typeof message !== "object") {
    return `Featherless choice missing message object (finish_reason=${finishReason}).`;
  }

  const messageRecord = message as Record<string, unknown>;
  const content = messageRecord.content;
  const contentShape = Array.isArray(content) ? "array" : typeof content;
  const hasLegacyText = typeof choice.text === "string";
  const refusal = typeof messageRecord.refusal === "string" ? messageRecord.refusal : "";

  const refusalNote = refusal ? `, refusal=${refusal}` : "";
  const choiceKeys = Object.keys(choice).slice(0, 20);
  return `Featherless message content unavailable (content_shape=${contentShape}, has_legacy_text=${hasLegacyText}, finish_reason=${finishReason}${refusalNote}, choice_keys=${choiceKeys.join(",")}).`;
}

function avg(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function trend(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }
  return toFixed2(values[values.length - 1] - values[0]);
}

function parseJsonFromModelOutput(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? content;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(candidate.slice(start, end + 1));
  }
  return JSON.parse(candidate);
}

function tryParseModelJson(content: string): unknown | null {
  try {
    return parseJsonFromModelOutput(content);
  } catch {
    return null;
  }
}

function createPlanItem(item: Partial<CoachingPlanItem>, fallbackTitle: string): CoachingPlanItem {
  return {
    title: safeString(item.title, fallbackTitle),
    rationale: safeString(item.rationale, "Based on recent vitals and risk trend."),
    actions: safeArrayOfStrings(item.actions, ["Follow a small, sustainable step today."])
  };
}

function normalizePlanSection(raw: unknown, fallbackPrefix: string): CoachingPlanItem[] {
  if (!Array.isArray(raw)) {
    return [createPlanItem({}, `${fallbackPrefix} recommendation`)];
  }
  const items = raw
    .slice(0, 3)
    .map((entry, index) => createPlanItem((entry as Partial<CoachingPlanItem>) ?? {}, `${fallbackPrefix} recommendation ${index + 1}`));
  return items.length > 0 ? items : [createPlanItem({}, `${fallbackPrefix} recommendation`)];
}

function normalizeGoals(raw: unknown): CoachingGoal[] {
  if (!Array.isArray(raw)) {
    return [
      {
        metric: "Daily consistency",
        target: "Complete plan check-ins 5 days/week",
        window: "2 weeks",
        why: "Consistency improves signal quality and outcomes."
      }
    ];
  }
  const goals = raw
    .slice(0, 4)
    .map((entry) => {
      const item = entry as Partial<CoachingGoal>;
      return {
        metric: safeString(item.metric, "Health metric"),
        target: safeString(item.target, "Maintain steady trend"),
        window: safeString(item.window, "7 days"),
        why: safeString(item.why, "Supports safer risk trajectory.")
      };
    });
  return goals.length > 0
    ? goals
    : [
        {
          metric: "Daily consistency",
          target: "Complete plan check-ins 5 days/week",
          window: "2 weeks",
          why: "Consistency improves signal quality and outcomes."
        }
      ];
}

function collectTopSignals(context: Omit<PatientContext, "topSignals">): string[] {
  const signals: string[] = [];
  if (context.avgHeartRate >= 95 || context.heartRateTrend >= 8) {
    signals.push("Elevated or rising heart rate pattern");
  }
  if (context.avgBloodOxygen > 0 && context.avgBloodOxygen < 95) {
    signals.push("Blood oxygen below preferred range");
  }
  if (context.avgStepCount < 3200) {
    signals.push("Low activity baseline");
  }
  if (context.avgSleepScore > 0 && context.avgSleepScore < 65) {
    signals.push("Poor sleep quality trend");
  }
  if (signals.length === 0) {
    signals.push("No dominant instability signal detected");
  }
  return signals.slice(0, 3);
}

function buildPatientContext(patientId: string): PatientContext {
  const user = store.getUserById(patientId);
  const profile = store.getPatientProfile(patientId);
  const latestPrediction = store.getLatestPrediction(patientId);
  const vitalsWindow = store.getVitalsSince(patientId, minutesAgoIso(24 * 60)).slice(-80);
  const vitalsSource = vitalsWindow.length > 0 ? vitalsWindow : profile?.wearableData ?? [];

  const heartRates = vitalsSource.map((item) => item.heartRate);
  const oxygen = vitalsSource.map((item) => item.bloodOxygen);
  const steps = vitalsSource.map((item) => item.stepCount);
  const sleep = vitalsSource.map((item) => item.sleepScore);

  const contextBase = {
    patientId,
    patientName: user?.name ?? patientId,
    baselineRisk: profile?.riskScore ?? 0,
    predictedDisease: profile?.predictedDisease ?? "Stable",
    latestPredictedRisk: latestPrediction?.predictedRiskScore,
    latestConfidence: latestPrediction?.confidence,
    avgHeartRate: toFixed2(avg(heartRates)),
    avgBloodOxygen: toFixed2(avg(oxygen)),
    avgStepCount: Math.round(avg(steps)),
    avgSleepScore: toFixed2(avg(sleep)),
    heartRateTrend: trend(heartRates),
    bloodOxygenTrend: trend(oxygen),
    sleepTrend: trend(sleep)
  };

  return {
    ...contextBase,
    topSignals: collectTopSignals(contextBase)
  };
}

async function callFeatherless(messages: FeatherlessMessage[], options: FeatherlessCallOptions = {}): Promise<string> {
  if (!config.featherlessApiKey) {
    throw new Error("Missing FEATHERLESS_API_KEY.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.featherlessTimeoutMs);
  const maxRetries = Math.max(0, config.featherlessMaxRetries);
  const maxAttempts = maxRetries + 1;
  const selectedModel = typeof options.model === "string" && options.model.trim() ? options.model.trim() : config.featherlessModel;
  const selectedTemperature = typeof options.temperature === "number" ? options.temperature : 0.2;
  const selectedTopP = typeof options.topP === "number" ? options.topP : config.featherlessTopP;
  const selectedMaxTokens = typeof options.maxTokens === "number" ? Math.max(64, Math.round(options.maxTokens)) : undefined;

  const buildBody = (useStructuredResponse: boolean) => ({
    model: selectedModel,
    temperature: selectedTemperature,
    top_p: selectedTopP,
    ...(selectedMaxTokens ? { max_tokens: selectedMaxTokens } : {}),
    ...(useStructuredResponse ? { response_format: { type: "json_object" } } : {}),
    messages
  });

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (controller.signal.aborted) {
        throw new Error("Featherless request aborted.");
      }

      const tryRequest = async (useStructuredResponse: boolean) =>
        fetch(config.featherlessApiUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.featherlessApiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(buildBody(useStructuredResponse)),
          signal: controller.signal
        });

      let response = await tryRequest(Boolean(options.responseFormatJson));

    let payload = (await response.json().catch(() => ({}))) as {
      choices?: Array<Record<string, unknown>>;
      error?: unknown;
    };

      if (!response.ok && options.responseFormatJson && (response.status === 400 || response.status === 422)) {
        response = await tryRequest(false);
        payload = (await response.json().catch(() => ({}))) as {
          choices?: Array<Record<string, unknown>>;
          error?: unknown;
        };
      }

      if (response.ok) {
        const providerError = extractProviderError(payload);
        if (providerError) {
          throw new Error(`Featherless returned error payload: ${providerError}`);
        }

        const content = extractChoiceContent(payload) ?? extractAlternativeContent(payload);
        if (!content) {
          throw new Error(summarizeMissingContent(payload));
        }
        return content;
      }

      if (response.status === 429) {
        const retryAfterMsRaw = parseRetryAfterMs(response.headers);
        const retryAfterMs =
          typeof retryAfterMsRaw === "number"
            ? retryAfterMsRaw
            : Math.min(config.featherlessRetryBaseMs * 2 ** (attempt - 1), config.featherlessRetryMaxMs);

        if (attempt < maxAttempts) {
          await sleep(Math.min(retryAfterMs, config.featherlessRetryMaxMs));
          continue;
        }

        const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
        throw new FeatherlessRateLimitError(
          `Featherless request failed: Status 429 (retry after about ${retryAfterSeconds}s).`,
          retryAfterMs
        );
      }

      const errorMessage = typeof payload.error === "string" ? payload.error : `Status ${response.status}`;
      throw new Error(`Featherless request failed: ${errorMessage}`);
    }

    throw new Error("Featherless request exhausted retry attempts.");
  } finally {
    clearTimeout(timeout);
  }
}

async function repairModelOutputToJson(rawOutput: string, schemaHint: string): Promise<unknown | null> {
  try {
    const repairResponse = await callFeatherless(
      [
        {
          role: "system",
          content: "Convert the provided model output into valid JSON only. No markdown, no extra text."
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              schemaHint,
              rawOutput
            },
            null,
            2
          )
        }
      ],
      {
        responseFormatJson: true,
        temperature: 0,
        topP: 1,
        maxTokens: config.featherlessRepairMaxTokens,
        model: config.featherlessRepairModel
      }
    );
    return tryParseModelJson(repairResponse);
  } catch {
    return null;
  }
}

function buildFallbackCoachingPlan(context: PatientContext): CoachingPlanResponse {
  const nutritionActions =
    context.avgHeartRate > 95
      ? ["Limit late caffeine after 2 PM.", "Use balanced meals with protein + fiber at each main meal."]
      : ["Keep meals consistent in timing.", "Prioritize hydration with water through the day."];
  const activityActions =
    context.avgStepCount < 3500
      ? ["Add two 10-minute low-intensity walks.", "Stand/stretch every 60 minutes."]
      : ["Maintain current activity and include one mobility session.", "Keep heart rate in a conversational zone for recovery days."];
  const recoveryActions =
    context.avgSleepScore < 65
      ? ["Set a fixed sleep/wake window for 7 days.", "Reduce screen exposure 45 minutes before sleep."]
      : ["Preserve bedtime consistency and daytime sunlight exposure.", "Use a short breathing routine before bed."];
  const monitoringActions = [
    "Track morning resting heart rate daily.",
    "Review sleep and activity trend every 48 hours.",
    "Use dashboard risk trend as directional signal, not diagnosis."
  ];

  return {
    patientId: context.patientId,
    generatedAt: nowIso(),
    source: "fallback",
    summary: `Plan tuned to current risk (${Math.round((context.latestPredictedRisk ?? context.baselineRisk) * 100)}%) and recent wearable trends.`,
    sections: {
      nutrition: [
        {
          title: "Nutrition rhythm",
          rationale: "Stable meal timing and hydration can reduce physiologic variability.",
          actions: nutritionActions
        }
      ],
      activity: [
        {
          title: "Activity progression",
          rationale: "Gradual activity improves cardio-metabolic resilience with lower adherence drop-off.",
          actions: activityActions
        }
      ],
      recovery: [
        {
          title: "Sleep and recovery",
          rationale: "Improved recovery often lowers next-day risk volatility.",
          actions: recoveryActions
        }
      ],
      monitoring: [
        {
          title: "Monitoring loop",
          rationale: "Frequent low-friction check-ins improve intervention timing.",
          actions: monitoringActions
        }
      ]
    },
    goals: [
      {
        metric: "Resting heart rate",
        target: context.avgHeartRate > 0 ? `${Math.max(68, Math.round(context.avgHeartRate - 4))}-${Math.max(72, Math.round(context.avgHeartRate - 1))} bpm` : "Stable baseline",
        window: "7 days",
        why: "Lower resting trend generally aligns with improved recovery."
      },
      {
        metric: "Daily movement",
        target: `${Math.max(3500, context.avgStepCount + 700)}+ steps`,
        window: "10 days",
        why: "Incremental step gains reduce sedentary risk load."
      }
    ],
    cautions: [
      "If symptoms worsen suddenly, escalate to clinician/urgent care.",
      "This coaching plan supports care decisions and is not a diagnosis."
    ],
    disclaimer: "Educational guidance only. Seek licensed clinical advice for diagnosis or treatment."
  };
}

function detectIntent(message: string): AssistantIntent {
  const text = message.toLowerCase();
  if (/(symptom|pain|dizzy|breath|chest|fever|triage|unwell|nausea)/.test(text)) {
    return "triage";
  }
  if (/(medication|medicine|pill|dose|remind|reminder)/.test(text)) {
    return "reminder";
  }
  if (/(appointment|schedule|book|doctor|visit|consult)/.test(text)) {
    return "scheduling";
  }
  return "general";
}

function buildFallbackAssistantReply(context: PatientContext, message: string): AssistantChatResponse {
  const intent = detectIntent(message);
  const highRiskSignal = (context.latestPredictedRisk ?? context.baselineRisk) >= 0.75 || context.avgBloodOxygen < 93;
  const urgency: AssistantUrgency = highRiskSignal && intent === "triage" ? "high" : intent === "triage" ? "moderate" : "low";

  const baseReply: AssistantReply = {
    intent,
    urgency,
    title:
      intent === "triage"
        ? "Symptom Triage Guidance"
        : intent === "reminder"
          ? "Medication Reminder Setup"
          : intent === "scheduling"
            ? "Appointment Planning Guidance"
            : "Health Assistant Guidance",
    overview:
      intent === "triage"
        ? "Reviewing your recent vitals, here are safe next steps while you seek clinical advice as needed."
        : intent === "reminder"
          ? "Here is a simple reminder routine linked to your current risk and recovery pattern."
          : intent === "scheduling"
            ? "Here is a practical appointment scheduling plan based on your current trends."
            : "Here are personalized next steps based on your dashboard signals.",
    bullets:
      intent === "triage"
        ? [
            `Current top signals: ${context.topSignals.join("; ")}.`,
            "Track symptom onset time, intensity, and trigger context.",
            "Avoid strenuous activity until symptoms stabilize."
          ]
        : intent === "reminder"
          ? [
              "Pair medication reminders with fixed daily anchors (breakfast/dinner).",
              "Use one confirmation tap per dose to reduce missed doses.",
              "Escalate missed-dose patterns to caregiver/clinician."
            ]
          : intent === "scheduling"
            ? [
                "Prioritize earliest available slot within your risk window.",
                "Prepare symptom/vitals summary before booking.",
                "Choose follow-up cadence before leaving appointment."
              ]
            : ["Continue daily vitals review.", "Use trend changes to decide when to escalate.", "Keep interventions small and consistent."],
    nextSteps:
      intent === "triage"
        ? ["Recheck vitals in 15-30 minutes.", "If symptoms intensify, seek urgent evaluation.", "Share trend chart with clinician."]
        : intent === "reminder"
          ? ["Set two reminder windows today.", "Confirm dose completion in-app notes.", "Review adherence in 72 hours."]
          : intent === "scheduling"
            ? ["Book primary care/cardiometabolic follow-up.", "Request earliest available review.", "Prepare current medication list."]
            : ["Keep following coaching plan sections.", "Ask assistant for symptom-specific guidance when needed."],
    redFlags:
      intent === "triage"
        ? ["Chest pain/pressure", "New severe breathlessness", "Confusion or fainting"]
        : ["Escalate to clinician for persistent worsening symptoms."],
    disclaimer: "Assistant output is guidance support, not diagnosis."
  };

  if (intent === "reminder") {
    baseReply.reminder = {
      task: "Medication check-in",
      when: "08:00 and 20:00",
      frequency: "Daily"
    };
  }
  if (intent === "scheduling" || intent === "triage") {
    baseReply.appointment = {
      specialty: context.predictedDisease === "Cardiac" ? "Cardiology / Primary Care" : "Primary Care / Endocrinology",
      timeframe: urgency === "high" ? "Within 24 hours" : "Within 3-7 days",
      reason: "Trend-based risk and symptom review"
    };
  }

  return {
    patientId: context.patientId,
    generatedAt: nowIso(),
    source: "fallback",
    reply: baseReply
  };
}

function normalizeAssistantReply(raw: unknown): AssistantReply {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const reminderRaw = obj.reminder as Record<string, unknown> | undefined;
  const appointmentRaw = obj.appointment as Record<string, unknown> | undefined;

  return {
    intent: safeIntent(obj.intent),
    urgency: safeUrgency(obj.urgency),
    title: safeString(obj.title, "Assistant Guidance"),
    overview: safeString(obj.overview, "Guidance generated from your current health trends."),
    bullets: safeArrayOfStrings(obj.bullets, ["No detailed bullet guidance returned."]),
    nextSteps: safeArrayOfStrings(obj.nextSteps, ["Monitor trends and escalate if symptoms worsen."]),
    reminder:
      reminderRaw && typeof reminderRaw === "object"
        ? {
            task: safeString(reminderRaw.task, "Reminder task"),
            when: safeString(reminderRaw.when, "Set a daily time"),
            frequency: safeString(reminderRaw.frequency, "Daily")
          }
        : undefined,
    appointment:
      appointmentRaw && typeof appointmentRaw === "object"
        ? {
            specialty: safeString(appointmentRaw.specialty, "Primary Care"),
            timeframe: safeString(appointmentRaw.timeframe, "Within 1 week"),
            reason: safeString(appointmentRaw.reason, "Trend review")
          }
        : undefined,
    redFlags: safeArrayOfStrings(obj.redFlags, ["Seek urgent clinical care for severe or worsening symptoms."]),
    disclaimer: safeString(obj.disclaimer, "Assistant output is guidance support, not diagnosis.")
  };
}

export async function generateCoachingPlan(
  patientId: string,
  options?: { allowFallbackOnError?: boolean }
): Promise<CoachingPlanResponse> {
  const context = buildPatientContext(patientId);
  const allowFallbackOnError = options?.allowFallbackOnError ?? !config.assistantRequireLlm;

  const systemPrompt = `You are a digital health coaching assistant.
Return plain text only (no JSON, no markdown code fences).
Write a short, practical, non-alarmist coaching plan. Do not diagnose.`;

  const userPrompt = JSON.stringify(
    {
      task: "Generate a personalized diet and lifestyle coaching plan from patient trend context.",
      format: "Plain text only. Use short headings and bullet-style lines.",
      patientContext: context
    },
    null,
    2
  );

  try {
    const content = await callFeatherless([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ], {
      responseFormatJson: false,
      temperature: config.featherlessCoachingTemperature,
      topP: config.featherlessTopP,
      maxTokens: config.featherlessCoachingMaxTokens,
      model: config.featherlessCoachingModel
    });
    const summary = content.trim();
    if (!summary) {
      throw new Error("Coaching plan LLM returned empty content.");
    }
    console.log("[assistant][coach-plan] Raw LLM response:", summary);

    return {
      patientId: context.patientId,
      generatedAt: nowIso(),
      source: "llm",
      summary,
      sections: {
        nutrition: [],
        activity: [],
        recovery: [],
        monitoring: []
      },
      goals: [],
      cautions: ["This plan is guidance support and not a diagnosis."],
      disclaimer: "Educational guidance only. Seek licensed clinical advice for treatment decisions."
    };
  } catch (error) {
    console.error("[assistant][coach-plan] LLM generation failed:", getErrorMessage(error));
    if (!allowFallbackOnError) {
      if (error instanceof FeatherlessRateLimitError) {
        throw error;
      }
      throw new Error(`Coaching plan requires LLM response: ${getErrorMessage(error)}`);
    }
    return buildFallbackCoachingPlan(context);
  }
}

export async function generateAssistantChat(params: {
  patientId: string;
  message: string;
  history?: ChatHistoryItem[];
  options?: { allowFallbackOnError?: boolean };
}): Promise<AssistantChatResponse> {
  const context = buildPatientContext(params.patientId);
  const history = (params.history ?? []).slice(-6);
  const fallback = buildFallbackAssistantReply(context, params.message);
  const allowFallbackOnError = params.options?.allowFallbackOnError ?? !config.assistantRequireLlm;

  const systemPrompt = `You are a virtual care assistant for symptom triage, medication reminders, and appointment planning.
Return ONLY valid JSON. No markdown. Keep language clear and safety-first. Never provide diagnosis.`;

  const userPrompt = JSON.stringify(
    {
      task: "Respond to user message with structured assistant output.",
      outputSchema: {
        intent: "triage | reminder | scheduling | general",
        urgency: "low | moderate | high",
        title: "string",
        overview: "string",
        bullets: ["string"],
        nextSteps: ["string"],
        reminder: { task: "string", when: "string", frequency: "string" },
        appointment: { specialty: "string", timeframe: "string", reason: "string" },
        redFlags: ["string"],
        disclaimer: "string"
      },
      patientContext: context,
      conversation: {
        history,
        currentMessage: params.message
      }
    },
    null,
    2
  );

  try {
    const content = await callFeatherless([
      { role: "system", content: systemPrompt },
      ...history.map((item) => ({
        role: item.role,
        content: item.content
      })),
      { role: "user", content: userPrompt }
    ], {
      responseFormatJson: true,
      temperature: config.featherlessChatTemperature,
      topP: config.featherlessTopP,
      maxTokens: config.featherlessChatMaxTokens,
      model: config.featherlessChatModel
    });
    const parsed =
      tryParseModelJson(content) ??
      (await repairModelOutputToJson(
        content,
        "intent, urgency, title, overview, bullets[], nextSteps[], reminder, appointment, redFlags[], disclaimer"
      ));
    if (!parsed) {
      throw new Error("Unable to parse assistant JSON.");
    }
    return {
      patientId: context.patientId,
      generatedAt: nowIso(),
      source: "llm",
      reply: normalizeAssistantReply(parsed)
    };
  } catch (error) {
    if (!allowFallbackOnError) {
      if (error instanceof FeatherlessRateLimitError) {
        throw error;
      }
      throw new Error(`Assistant chat requires LLM response: ${getErrorMessage(error)}`);
    }
    console.error("[assistant][chat] LLM generation failed, returning fallback:", getErrorMessage(error));
    return fallback;
  }
}
