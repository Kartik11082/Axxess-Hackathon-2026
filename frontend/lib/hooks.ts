"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { WS_URL } from "./config";
import { PredictionResponse, StreamingVitals } from "./types";

export function useInactivityLogout(onLogout: () => void, timeoutMs = 10 * 60 * 1000): void {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const resetTimer = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(onLogout, timeoutMs);
    };

    const events = ["mousemove", "keydown", "click", "touchstart", "scroll"];
    events.forEach((eventName) => window.addEventListener(eventName, resetTimer, { passive: true }));
    resetTimer();

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      events.forEach((eventName) => window.removeEventListener(eventName, resetTimer));
    };
  }, [onLogout, timeoutMs]);
}

interface UseVitalsSocketParams {
  token: string | null;
  patientId?: string;
  onVitals: (vitals: StreamingVitals) => void;
  onPrediction: (prediction: PredictionResponse) => void;
}

export function useVitalsSocket(params: UseVitalsSocketParams): { connected: boolean; statusText: string } {
  const [connected, setConnected] = useState(false);
  const [statusText, setStatusText] = useState("Connecting...");
  const socketRef = useRef<WebSocket | null>(null);
  const onVitalsRef = useRef(params.onVitals);
  const onPredictionRef = useRef(params.onPrediction);

  const stableToken = useMemo(() => params.token, [params.token]);
  const stablePatientId = useMemo(() => params.patientId, [params.patientId]);

  useEffect(() => {
    onVitalsRef.current = params.onVitals;
    onPredictionRef.current = params.onPrediction;
  }, [params.onPrediction, params.onVitals]);

  useEffect(() => {
    if (!stableToken) {
      setConnected(false);
      setStatusText("No session token");
      return;
    }

    const socket = new WebSocket(WS_URL);
    socketRef.current = socket;

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "auth", token: stableToken }));
      setStatusText("Socket connected");
    });

    socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(event.data) as { type: string; payload?: unknown; message?: string };

        if (message.type === "auth_ok") {
          setConnected(true);
          if (stablePatientId) {
            socket.send(JSON.stringify({ type: "subscribe", patientId: stablePatientId }));
          }
          return;
        }

        if (message.type === "vitals" && message.payload) {
          onVitalsRef.current(message.payload as StreamingVitals);
          return;
        }

        if (message.type === "prediction" && message.payload) {
          onPredictionRef.current(message.payload as PredictionResponse);
          return;
        }

        if (message.type === "error") {
          setStatusText(message.message ?? "Socket error");
        }
      } catch {
        setStatusText("Socket parse error");
      }
    });

    socket.addEventListener("close", () => {
      setConnected(false);
      setStatusText("Disconnected");
    });

    socket.addEventListener("error", () => {
      setConnected(false);
      setStatusText("Socket error");
    });

    return () => {
      socket.close();
    };
  }, [stablePatientId, stableToken]);

  return { connected, statusText };
}
