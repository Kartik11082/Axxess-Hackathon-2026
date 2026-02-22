import { Router } from "express";
import { z } from "zod";
import { config } from "../config";
import { store } from "../data/store";
import { canAccessPatient } from "../middleware/access";
import { requireAuth } from "../middleware/auth";
import { requireOnboardingComplete } from "../middleware/onboarding";
import { minutesAgoIso, nowIso } from "../utils/time";

const predictHeartRateSchema = z.object({
  patientId: z.string().min(3),
  heartRates: z.array(z.number().finite()).min(12).max(4096),
  horizon: z.number().int().min(1).max(256).optional(),
  context: z.number().int().min(32).max(1024).optional()
});

const mockInputQuerySchema = z.object({
  horizon: z.coerce.number().int().min(1).max(256).default(6),
  window: z.coerce.number().int().min(12).max(240).default(24)
});

export const mlRoutes = Router();

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function buildHeartRateWindow(patientId: string, window: number): number[] {
  const recentVitals = store.getVitalsSince(patientId, minutesAgoIso(60)).slice(-window);
  const heartRates = recentVitals.map((item) => item.heartRate);

  if (heartRates.length === 0) {
    const latest = store.getLatestVitals(patientId);
    const base = latest?.heartRate ?? 80;
    const generated: number[] = [];
    for (let index = 0; index < window; index += 1) {
      const previous = generated[index - 1] ?? base;
      generated.push(clamp(previous + randomBetween(-3, 4), 55, 165));
    }
    return generated;
  }

  while (heartRates.length < window) {
    const earliest = heartRates[0] ?? 80;
    heartRates.unshift(clamp(earliest + randomBetween(-2, 2), 55, 165));
  }

  return heartRates.slice(-window);
}

function resolvePredictHeartRateUrl(): string {
  return "http://127.0.0.1:5001/predict-heart-rate";
}

mlRoutes.get("/mock-input/:patientId", requireAuth, requireOnboardingComplete, (req, res) => {
  const patientId = String(req.params.patientId ?? "");
  if (!patientId) {
    res.status(400).json({ error: "Missing patientId path parameter." });
    return;
  }

  if (!canAccessPatient(req, patientId)) {
    res.status(403).json({ error: "Forbidden for patient target." });
    return;
  }

  const parsedQuery = mockInputQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json({ error: "Invalid mock input query.", details: parsedQuery.error.flatten() });
    return;
  }

  const { horizon, window } = parsedQuery.data;
  const heartRates = buildHeartRateWindow(patientId, window);

  res.json({
    patientId,
    heartRates,
    horizon,
    generatedAt: nowIso(),
    source: "mock-realtime-vitals-window",
    windowSize: heartRates.length
  });
});

mlRoutes.post("/predict-heart-rate", requireAuth, requireOnboardingComplete, async (req, res) => {
  const parsed = predictHeartRateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid ML payload.", details: parsed.error.flatten() });
    return;
  }

  const { patientId, heartRates, horizon = 12, context } = parsed.data;
  if (!canAccessPatient(req, patientId)) {
    res.status(403).json({ error: "Forbidden for patient target." });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.mlApiTimeoutMs);

  try {
    const upstream = await fetch(resolvePredictHeartRateUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        patientId,
        heartRates,
        horizon,
        context
      }),
      signal: controller.signal
    });

    const responseText = await upstream.text();
    let parsedBody: unknown = null;
    try {
      parsedBody = JSON.parse(responseText);
    } catch {
      parsedBody = { raw: responseText };
    }

    if (!upstream.ok) {
      res.status(502).json({
        error: "ML service returned an error.",
        details: parsedBody
      });
      return;
    }

    res.status(200).json(parsedBody);
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    res.status(504).json({
      error: isAbort ? "ML service timed out." : "Unable to reach ML service.",
      details: error instanceof Error ? error.message : String(error)
    });
  } finally {
    clearTimeout(timeout);
  }
});
