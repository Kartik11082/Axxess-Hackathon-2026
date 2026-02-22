import { Server as HttpServer } from "http";
import WebSocket, { Server as WebSocketServer } from "ws";
import { config } from "../config";
import { store } from "../data/store";
import { persistStreamingVitals } from "../db/persistentDomain";
import { verifyToken } from "../auth/jwt";
import { AuthTokenPayload, StreamingVitals } from "../models/types";
import { runAndPersistPrediction } from "../services/predictionService";
import { liveAlertService } from "../services/liveAlertService";
import { minutesAgoIso } from "../utils/time";

interface SocketSession {
  auth?: AuthTokenPayload;
  subscribedPatientIds: Set<string>;
}

type ActivityState = "resting" | "light" | "active";

interface PatientBaseline {
  restingHeartRate: number;
  oxygenBaseline: number;
  sleepBaseline: number;
  activityBias: number;
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hashToSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function buildPatientBaseline(patientId: string): PatientBaseline {
  const seed = hashToSeed(patientId);
  return {
    restingHeartRate: 62 + (seed % 12),
    oxygenBaseline: 96 + ((seed >> 5) % 3),
    sleepBaseline: 68 + ((seed >> 9) % 17),
    activityBias: ((seed >> 13) % 7) - 3
  };
}

function driftTowards(current: number, target: number, maxDelta: number): number {
  const delta = target - current;
  if (Math.abs(delta) <= maxDelta) {
    return target;
  }
  return current + Math.sign(delta) * maxDelta;
}

function isNightHour(hour: number): boolean {
  return hour < 6 || hour >= 23;
}

function heartRateCircadianOffset(hour: number): number {
  if (hour < 5) {
    return -7;
  }
  if (hour < 8) {
    return -4;
  }
  if (hour < 12) {
    return 1;
  }
  if (hour < 18) {
    return 4;
  }
  if (hour < 22) {
    return 1;
  }
  return -2;
}

function sleepCircadianOffset(hour: number): number {
  if (hour < 6) {
    return 4;
  }
  if (hour < 10) {
    return 1;
  }
  if (hour < 18) {
    return -2;
  }
  if (hour < 22) {
    return -1;
  }
  return 2;
}

function pickActivityState(hour: number, baseline: PatientBaseline): ActivityState {
  let activeChance = 0.08;
  let lightChance = 0.48;

  if (hour >= 6 && hour <= 9) {
    activeChance = 0.18;
    lightChance = 0.58;
  } else if (hour >= 10 && hour <= 16) {
    activeChance = 0.12;
    lightChance = 0.62;
  } else if (hour >= 17 && hour <= 20) {
    activeChance = 0.16;
    lightChance = 0.56;
  } else if (hour >= 21 && hour <= 22) {
    activeChance = 0.07;
    lightChance = 0.4;
  } else {
    activeChance = 0.03;
    lightChance = 0.22;
  }

  const bias = baseline.activityBias * 0.01;
  const adjustedActiveChance = clamp(activeChance + bias, 0.02, 0.24);
  const roll = Math.random();

  if (roll < adjustedActiveChance) {
    return "active";
  }
  if (roll < adjustedActiveChance + lightChance) {
    return "light";
  }
  return "resting";
}

function initialStepCount(hour: number, activityBias: number): number {
  const base =
    hour < 6
      ? randomBetween(700, 1500)
      : hour < 10
        ? randomBetween(1800, 3600)
        : hour < 18
          ? randomBetween(2600, 6200)
          : hour < 22
            ? randomBetween(1700, 4200)
            : randomBetween(900, 2200);
  return clamp(base + activityBias * 180, 400, 9000);
}

function stepTargetForState(state: ActivityState, hour: number, activityBias: number): number {
  if (state === "resting") {
    const restingBase = isNightHour(hour) ? randomBetween(650, 1400) : randomBetween(900, 2200);
    return clamp(restingBase + activityBias * 120, 350, 4500);
  }

  if (state === "light") {
    const lightBase = isNightHour(hour) ? randomBetween(1000, 2400) : randomBetween(2200, 5600);
    return clamp(lightBase + activityBias * 160, 800, 8500);
  }

  const activeBase = isNightHour(hour) ? randomBetween(1800, 4800) : randomBetween(4500, 9200);
  return clamp(activeBase + activityBias * 220, 1200, 12000);
}

function generateVitals(patientId: string, tickCount: number, previous?: StreamingVitals): StreamingVitals {
  const now = new Date();
  const hour = now.getHours();
  const baseline = buildPatientBaseline(patientId);
  const activityState = pickActivityState(hour, baseline);
  // Rare anomaly windows preserve alert testing while keeping routine vitals realistic.
  const inAnomalyWindow = tickCount > 24 && tickCount % 44 >= 42;

  const sleepTargetBase = baseline.sleepBaseline + sleepCircadianOffset(hour) + (activityState === "active" ? -1 : 1);
  const sleepTarget = inAnomalyWindow
    ? sleepTargetBase - randomBetween(8, 12)
    : sleepTargetBase + randomBetween(-2, 2);
  const baseSleep = previous?.sleepScore ?? clamp(baseline.sleepBaseline + randomBetween(-4, 4), 50, 90);
  const sleepScore = Math.round(clamp(driftTowards(baseSleep, sleepTarget, 2), 42, 95));

  const hrTargetBase = baseline.restingHeartRate + heartRateCircadianOffset(hour);
  const hrActivityBoost = activityState === "active" ? randomBetween(18, 30) : activityState === "light" ? randomBetween(8, 15) : 0;
  const hrSleepPenalty = sleepScore < 58 ? 3 : 0;
  const hrAnomalyBoost = inAnomalyWindow ? randomBetween(16, 24) : 0;
  const hrTarget = hrTargetBase + hrActivityBoost + hrSleepPenalty + hrAnomalyBoost + randomBetween(-2, 2);
  const baseHeartRate = previous?.heartRate ?? clamp(hrTarget + randomBetween(-4, 4), 55, 120);
  const heartRate = Math.round(clamp(driftTowards(baseHeartRate, hrTarget, inAnomalyWindow ? 12 : 7), 52, 148));

  const oxygenTargetBase = baseline.oxygenBaseline + (activityState === "active" ? -1 : 0) + (sleepScore < 55 ? -1 : 0);
  const oxygenTarget = inAnomalyWindow
    ? oxygenTargetBase - randomBetween(2, 4)
    : oxygenTargetBase + randomBetween(-1, 1);
  const baseOxygen = previous?.bloodOxygen ?? clamp(oxygenTarget + randomBetween(-1, 1), 93, 99);
  const bloodOxygen = Math.round(clamp(driftTowards(baseOxygen, oxygenTarget, 1), 88, 99));

  const stepTargetBase = stepTargetForState(activityState, hour, baseline.activityBias);
  const stepTarget = stepTargetBase - (sleepScore < 55 ? 500 : 0) - (inAnomalyWindow ? randomBetween(900, 1600) : 0);
  const baseSteps = previous?.stepCount ?? initialStepCount(hour, baseline.activityBias);
  const stepCount = Math.round(clamp(driftTowards(baseSteps, stepTarget, inAnomalyWindow ? 260 : 140), 350, 12000));

  return {
    patientId,
    timestamp: now.toISOString(),
    heartRate,
    stepCount,
    bloodOxygen,
    sleepScore
  };
}

export class StreamingEngine {
  private wss: WebSocketServer;
  private socketSessions = new Map<WebSocket, SocketSession>();
  private streamTimers = new Map<string, NodeJS.Timeout>();
  private patientTickCounts = new Map<string, number>();
  private predictionTimer?: NodeJS.Timeout;
  private discoveryTimer?: NodeJS.Timeout;

  constructor(server: HttpServer) {
    this.wss = new WebSocketServer({
      server,
      path: "/ws"
    });
  }

  start(): void {
    this.wss.on("connection", (socket) => {
      const session: SocketSession = {
        subscribedPatientIds: new Set()
      };

      this.socketSessions.set(socket, session);

      const authTimeout = setTimeout(() => {
        if (!session.auth) {
          socket.close(1008, "Authentication required.");
        }
      }, 10_000);

      socket.on("message", (raw) => {
        let payload: unknown;
        try {
          payload = JSON.parse(raw.toString());
        } catch {
          socket.send(JSON.stringify({ type: "error", message: "Invalid JSON message." }));
          return;
        }

        this.handleClientMessage(socket, session, payload);
      });

      socket.on("close", () => {
        clearTimeout(authTimeout);
        this.socketSessions.delete(socket);
      });
    });

    this.ensurePatientStreams();

    // Discover and start streams for newly created patients without restart.
    this.discoveryTimer = setInterval(() => {
      this.ensurePatientStreams();
    }, 5_000);

    this.predictionTimer = setInterval(() => {
      void this.runScheduledPredictions();
    }, config.predictionRunIntervalMs);
  }

  stop(): void {
    for (const timer of this.streamTimers.values()) {
      clearTimeout(timer);
    }
    this.streamTimers.clear();
    if (this.predictionTimer) {
      clearInterval(this.predictionTimer);
      this.predictionTimer = undefined;
    }
    if (this.discoveryTimer) {
      clearInterval(this.discoveryTimer);
      this.discoveryTimer = undefined;
    }
    this.wss.close();
  }

  private ensurePatientStreams(): void {
    for (const patient of store.listPatients()) {
      if (this.streamTimers.has(patient.id)) {
        continue;
      }
      this.schedulePatientStream(patient.id);
    }
  }

  private handleClientMessage(socket: WebSocket, session: SocketSession, payload: unknown): void {
    if (typeof payload !== "object" || payload === null) {
      socket.send(JSON.stringify({ type: "error", message: "Invalid message shape." }));
      return;
    }

    const message = payload as Record<string, unknown>;

    if (message.type === "auth") {
      if (typeof message.token !== "string") {
        socket.send(JSON.stringify({ type: "error", message: "Token missing." }));
        return;
      }
      try {
        const auth = verifyToken(message.token);
        const onboarding = store.getOnboardingStatus(auth.userId);
        if (!onboarding?.onboardingCompleted) {
          socket.send(
            JSON.stringify({
              type: "error",
              message: "Complete onboarding before subscribing to live streams."
            })
          );
          socket.close(1008, "Onboarding incomplete.");
          return;
        }
        session.auth = auth;
        if (auth.role === "Patient") {
          session.subscribedPatientIds.add(auth.userId);
        } else {
          for (const patientId of store.getCaregiverPatientIds(auth.userId)) {
            session.subscribedPatientIds.add(patientId);
          }
        }
        socket.send(JSON.stringify({ type: "auth_ok" }));
      } catch {
        socket.send(JSON.stringify({ type: "error", message: "Authentication failed." }));
      }
      return;
    }

    if (!session.auth) {
      socket.send(JSON.stringify({ type: "error", message: "Authenticate first." }));
      return;
    }

    if (message.type === "subscribe" && typeof message.patientId === "string") {
      if (this.canSubscribe(session.auth, message.patientId)) {
        session.subscribedPatientIds.add(message.patientId);
        socket.send(JSON.stringify({ type: "subscribed", patientId: message.patientId }));
      } else {
        socket.send(JSON.stringify({ type: "error", message: "Forbidden subscription target." }));
      }
    }
  }

  private canSubscribe(auth: AuthTokenPayload, patientId: string): boolean {
    if (auth.role === "Patient") {
      return auth.userId === patientId;
    }
    return store.getCaregiverPatientIds(auth.userId).includes(patientId);
  }

  private schedulePatientStream(patientId: string): void {
    if (this.streamTimers.has(patientId)) {
      return;
    }

    const tick = (): void => {
      const previous = store.getLatestVitals(patientId);
      const nextTickCount = (this.patientTickCounts.get(patientId) ?? 0) + 1;
      this.patientTickCounts.set(patientId, nextTickCount);
      const nextVitals = generateVitals(patientId, nextTickCount, previous);
      store.appendVitals(nextVitals);
      void persistStreamingVitals(nextVitals);
      liveAlertService.processVitals(nextVitals);
      this.broadcastVitals(nextVitals);

      const delay = randomBetween(config.streamMinIntervalMs, config.streamMaxIntervalMs);
      const timer = setTimeout(tick, delay);
      this.streamTimers.set(patientId, timer);
    };

    tick();
  }

  private broadcastVitals(vitals: StreamingVitals): void {
    for (const [socket, session] of this.socketSessions.entries()) {
      if (socket.readyState !== WebSocket.OPEN) {
        continue;
      }
      if (!session.auth) {
        continue;
      }
      if (!session.subscribedPatientIds.has(vitals.patientId)) {
        continue;
      }

      socket.send(
        JSON.stringify({
          type: "vitals",
          payload: vitals
        })
      );
    }
  }

  private broadcastPrediction(patientId: string, prediction: unknown): void {
    for (const [socket, session] of this.socketSessions.entries()) {
      if (socket.readyState !== WebSocket.OPEN) {
        continue;
      }
      if (!session.auth) {
        continue;
      }
      if (!session.subscribedPatientIds.has(patientId)) {
        continue;
      }

      socket.send(
        JSON.stringify({
          type: "prediction",
          payload: prediction
        })
      );
    }
  }

  private async runScheduledPredictions(): Promise<void> {
    const since = minutesAgoIso(config.predictionWindowMinutes);
    const patients = store.listPatients();

    for (const patient of patients) {
      const windowVitals = store.getVitalsSince(patient.id, since);
      if (windowVitals.length < 4) {
        continue;
      }

      const prediction = await runAndPersistPrediction({
        patientId: patient.id,
        vitals: windowVitals,
        shouldNotify: true
      });

      this.broadcastPrediction(patient.id, prediction);
    }
  }
}
