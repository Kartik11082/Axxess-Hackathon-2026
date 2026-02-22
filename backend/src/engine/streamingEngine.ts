import { Server as HttpServer } from "http";
import WebSocket, { Server as WebSocketServer } from "ws";
import { config } from "../config";
import { store } from "../data/store";
import { persistStreamingVitals } from "../db/persistentDomain";
import { verifyToken } from "../auth/jwt";
import { AuthTokenPayload, StreamingVitals } from "../models/types";
import { runAndPersistPrediction } from "../services/predictionService";
import { minutesAgoIso } from "../utils/time";

interface SocketSession {
  auth?: AuthTokenPayload;
  subscribedPatientIds: Set<string>;
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function generateVitals(patientId: string, previous?: StreamingVitals): StreamingVitals {
  const baseHr = previous?.heartRate ?? randomBetween(72, 98);
  const heartRate = clamp(baseHr + randomBetween(-4, 7), 58, 155);

  const baseSteps = previous?.stepCount ?? randomBetween(600, 4500);
  const stepCount = clamp(baseSteps + randomBetween(0, 120), 300, 13000);

  const baseOxygen = previous?.bloodOxygen ?? randomBetween(94, 98);
  const bloodOxygen = clamp(baseOxygen + randomBetween(-1, 1), 88, 99);

  const baseSleep = previous?.sleepScore ?? randomBetween(55, 87);
  const sleepScore = clamp(baseSleep + randomBetween(-2, 2), 35, 95);

  return {
    patientId,
    timestamp: new Date().toISOString(),
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
  private predictionTimer?: NodeJS.Timeout;

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

    for (const patient of store.listPatients()) {
      this.schedulePatientStream(patient.id);
    }

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
    this.wss.close();
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
    const tick = (): void => {
      const previous = store.getLatestVitals(patientId);
      const nextVitals = generateVitals(patientId, previous);
      store.appendVitals(nextVitals);
      void persistStreamingVitals(nextVitals);
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
