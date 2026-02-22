"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE_URL, WS_URL } from "./config";
import { AlertStreamEvent, PredictionResponse, StreamingVitals } from "./types";

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

interface UseAlertStreamParams {
  token: string | null;
  onEvent: (event: AlertStreamEvent) => void;
}

function parseSseBlock(block: string): { eventName: string; data: string | null } {
  const lines = block.split("\n");
  let eventName = "message";
  const dataLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  return {
    eventName,
    data: dataLines.length > 0 ? dataLines.join("\n") : null
  };
}

export function useAlertStream(params: UseAlertStreamParams): { connected: boolean; statusText: string } {
  const [connected, setConnected] = useState(false);
  const [statusText, setStatusText] = useState("Alert stream idle");
  const onEventRef = useRef(params.onEvent);
  const retryRef = useRef<NodeJS.Timeout | null>(null);

  const stableToken = useMemo(() => params.token, [params.token]);

  useEffect(() => {
    onEventRef.current = params.onEvent;
  }, [params.onEvent]);

  useEffect(() => {
    if (!stableToken) {
      setConnected(false);
      setStatusText("No session token");
      return;
    }

    const abortController = new AbortController();
    let isCancelled = false;

    const connect = async () => {
      setStatusText("Connecting alert stream...");
      try {
        const response = await fetch(`${API_BASE_URL}/api/stream`, {
          method: "GET",
          headers: {
            Accept: "text/event-stream",
            Authorization: `Bearer ${stableToken}`
          },
          cache: "no-store",
          signal: abortController.signal
        });

        if (!response.ok || !response.body) {
          throw new Error(`Alert stream request failed (${response.status})`);
        }

        setConnected(true);
        setStatusText("Alert stream connected");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!isCancelled) {
          const chunk = await reader.read();
          if (chunk.done) {
            break;
          }
          buffer += decoder.decode(chunk.value, { stream: true });

          let separatorIndex = buffer.indexOf("\n\n");
          while (separatorIndex >= 0) {
            const rawBlock = buffer.slice(0, separatorIndex);
            buffer = buffer.slice(separatorIndex + 2);
            separatorIndex = buffer.indexOf("\n\n");

            const parsed = parseSseBlock(rawBlock);
            if (!parsed.data) {
              continue;
            }

            try {
              const payload = JSON.parse(parsed.data) as AlertStreamEvent;
              if (!payload || typeof payload !== "object" || !("type" in payload)) {
                continue;
              }
              onEventRef.current(payload);
            } catch {
              continue;
            }
          }
        }

        if (!isCancelled) {
          setConnected(false);
          setStatusText("Alert stream disconnected");
          retryRef.current = setTimeout(() => {
            void connect();
          }, 3000);
        }
      } catch {
        if (!isCancelled) {
          setConnected(false);
          setStatusText("Alert stream error, retrying...");
          retryRef.current = setTimeout(() => {
            void connect();
          }, 3000);
        }
      }
    };

    void connect();

    return () => {
      isCancelled = true;
      abortController.abort();
      if (retryRef.current) {
        clearTimeout(retryRef.current);
      }
    };
  }, [stableToken]);

  return { connected, statusText };
}
