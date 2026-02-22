"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api";
import { clearSession, getToken, getUser } from "@/lib/auth";
import { useAlertStream, useInactivityLogout, useVitalsSocket } from "@/lib/hooks";
import {
  LiveAlert,
  HeartRatePredictionResponse,
  MockHeartRateInputPayload,
  NotificationItem,
  PredictionResponse,
  StreamingVitals
} from "@/lib/types";
import { AlertOverlay } from "./AlertOverlay";
import { AlertToastStack } from "./AlertToastStack";
import { AppHeader } from "./AppHeader";
import { HeartRateForecastPanel } from "./HeartRateForecastPanel";
import { LiveVitalsChart } from "./LiveVitalsChart";
import { NotificationPanel } from "./NotificationPanel";
import { PredictionInsights } from "./PredictionInsights";
import { RiskForecastChart } from "./RiskForecastChart";
import { TrendHeatmap } from "./TrendHeatmap";

interface PatientMeResponse {
  patient: {
    id: string;
    name: string;
  };
  latestVitals?: StreamingVitals;
  latestPrediction?: PredictionResponse;
}

interface PredictionsResponse {
  predictionHistory: Array<{ timestamp: string; riskScore: number; confidence: number }>;
  latestPrediction?: PredictionResponse;
}

interface NotificationsResponse {
  notifications: NotificationItem[];
}

interface InsuranceResponse {
  icdCode: string;
  coverageCompatibility: string;
}

function upsertLiveAlert(current: LiveAlert[], incoming: LiveAlert): LiveAlert[] {
  const existingIndex = current.findIndex((item) => item.id === incoming.id);
  if (existingIndex < 0) {
    return [incoming, ...current];
  }
  const next = [...current];
  next[existingIndex] = incoming;
  return next;
}

function sortLiveAlerts(left: LiveAlert, right: LiveAlert): number {
  if (left.tier !== right.tier) {
    return right.tier - left.tier;
  }
  if (left.urgencyLevel !== right.urgencyLevel) {
    return right.urgencyLevel - left.urgencyLevel;
  }
  return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
}

export function PatientDashboard() {
  const router = useRouter();
  const [patientId, setPatientId] = useState<string>("");
  const [patientName, setPatientName] = useState<string>("Patient");
  const [vitals, setVitals] = useState<StreamingVitals[]>([]);
  const [prediction, setPrediction] = useState<PredictionResponse | null>(null);
  const [heartRatePrediction, setHeartRatePrediction] = useState<HeartRatePredictionResponse | null>(null);
  const [mockInputPayload, setMockInputPayload] = useState<MockHeartRateInputPayload | null>(null);
  const [predictionHistory, setPredictionHistory] = useState<Array<{ timestamp: string; riskScore: number }>>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [liveAlerts, setLiveAlerts] = useState<LiveAlert[]>([]);
  const [insurance, setInsurance] = useState<InsuranceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const vitalsRef = useRef<StreamingVitals[]>([]);

  const logoutForInactivity = useCallback(() => {
    clearSession();
    router.push("/");
  }, [router]);

  useInactivityLogout(logoutForInactivity, 8 * 60 * 1000);

  useEffect(() => {
    setToken(getToken());
  }, []);

  useEffect(() => {
    const user = getUser();
    if (!user || user.role !== "Patient") {
      router.replace("/");
      return;
    }

    const load = async () => {
      try {
        const [me, predictions, alerts] = await Promise.all([
          apiRequest<PatientMeResponse>("/api/patients/me"),
          apiRequest<PredictionsResponse>(`/api/patients/${user.id}/predictions`),
          apiRequest<NotificationsResponse>("/api/notifications")
        ]);

        setPatientId(me.patient.id);
        setPatientName(me.patient.name);
        if (me.latestVitals) {
          setVitals([me.latestVitals]);
        }
        if (predictions.latestPrediction) {
          setPrediction(predictions.latestPrediction);
        }
        setPredictionHistory(predictions.predictionHistory.map((point) => ({ timestamp: point.timestamp, riskScore: point.riskScore })));
        setNotifications(alerts.notifications);
      } catch {
        clearSession();
        router.replace("/");
      } finally {
        setLoading(false);
      }
    };

    load().catch(() => {
      clearSession();
      router.replace("/");
    });
  }, [router]);

  useEffect(() => {
    if (!patientId) {
      return;
    }
    apiRequest<InsuranceResponse>(`/api/insurance/check/${patientId}`)
      .then(setInsurance)
      .catch(() => undefined);
  }, [patientId, prediction?.icdCode]);

  const onAcknowledge = useCallback(async (notificationId: string) => {
    await apiRequest(`/api/notifications/${notificationId}/ack`, { method: "POST" });
    const alerts = await apiRequest<NotificationsResponse>("/api/notifications");
    setNotifications(alerts.notifications);
  }, []);

  useVitalsSocket({
    token,
    patientId,
    onVitals: (incoming) => {
      setVitals((current) => {
        const next = [...current.slice(-60), incoming];
        vitalsRef.current = next;
        return next;
      });
    },
    onPrediction: (incoming) => {
      setPrediction(incoming);
      setPredictionHistory((current) => [...current.slice(-40), { timestamp: new Date().toISOString(), riskScore: incoming.predictedRiskScore }]);
    }
  });

  const { statusText: alertStreamStatus } = useAlertStream({
    token,
    onEvent: (event) => {
      if (event.type === "init") {
        setLiveAlerts(event.alerts);
        return;
      }
      if (event.type === "alert_upsert") {
        setLiveAlerts((current) => upsertLiveAlert(current, event.alert));
        return;
      }
      if (event.type === "alert_resolved") {
        setLiveAlerts((current) => upsertLiveAlert(current, event.alert));
      }
    }
  });

  useEffect(() => {
    vitalsRef.current = vitals;
  }, [vitals]);

  useEffect(() => {
    if (!patientId) {
      return;
    }

    const runCycle = () => {
      const samples = vitalsRef.current.slice(-20);
      if (samples.length < 6) {
        return;
      }
      apiRequest<PredictionResponse>("/api/predict-risk", {
        method: "POST",
        body: JSON.stringify({
          patientId,
          samples
        })
      })
        .then((response) => {
          setPrediction(response);
          setPredictionHistory((current) => [
            ...current.slice(-40),
            { timestamp: new Date().toISOString(), riskScore: response.predictedRiskScore }
          ]);
        })
        .catch(() => undefined);

      apiRequest<MockHeartRateInputPayload>(`/api/ml/mock-input/${patientId}?horizon=6&window=24`)
        .then((mockPayload) => {
          setMockInputPayload(mockPayload);
          return apiRequest<HeartRatePredictionResponse>("/api/ml/predict-heart-rate", {
            method: "POST",
            body: JSON.stringify(mockPayload)
          });
        })
        .then((response) => {
          setHeartRatePrediction(response);
        })
        .catch(() => undefined);
    };

    runCycle();
    const interval = setInterval(runCycle, 20_000);

    return () => clearInterval(interval);
  }, [patientId]);

  if (loading) {
    return <div className="full-center">Loading secure patient dashboard...</div>;
  }

  const latestVitals = vitals[vitals.length - 1];
  const activeLiveAlerts = liveAlerts.filter((alert) => alert.state !== "RESOLVED");
  const overlayAlert =
    [...activeLiveAlerts]
      .filter((alert) => (alert.tier === 3 || alert.state === "ESCALATED") && alert.state !== "BEING_REVIEWED")
      .sort(sortLiveAlerts)[0] ?? null;
  const toastAlerts = [...activeLiveAlerts]
    .filter((alert) => alert.tier <= 2 && alert.state !== "BEING_REVIEWED")
    .sort(sortLiveAlerts)
    .slice(0, 5);

  const onAcknowledgeLiveAlert = async (alertId: string, reason?: string) => {
    await apiRequest<{ alert: LiveAlert }>("/api/stream/acknowledge", {
      method: "POST",
      body: JSON.stringify({
        alertId,
        reason
      })
    });
  };

  const onEmergencyAction = async (alertId: string) => {
    await apiRequest<{ alert: LiveAlert }>("/api/stream/acknowledge", {
      method: "POST",
      body: JSON.stringify({
        alertId,
        reason: "emergency-requested"
      })
    });
  };

  return (
    <div className="dashboard-wrap">
      <AppHeader
        title={`${patientName} Monitoring Console`}
        subtitle="Patient Experience Layer"
        status={latestVitals ? `Streaming active | ${alertStreamStatus}` : "Awaiting stream"}
        userId={patientId}
        showWellnessNav
      />

      <AlertOverlay alert={overlayAlert} onAcknowledge={onAcknowledgeLiveAlert} onEmergency={onEmergencyAction} />
      <AlertToastStack alerts={toastAlerts} onAcknowledge={onAcknowledgeLiveAlert} />

      <section className="risk-headline">
        <div>
          <p>Current predicted risk</p>
          <strong>{prediction ? `${Math.round(prediction.predictedRiskScore * 100)}%` : "Pending..."}</strong>
        </div>
        <div>
          <p>Disease signal</p>
          <strong>{prediction?.predictedDisease ?? "Stable"}</strong>
        </div>
        <div>
          <p>ICD mapping</p>
          <strong>{prediction?.icdCode ?? "Waiting"}</strong>
        </div>
        <div>
          <p>Live heart rate</p>
          <strong>{latestVitals ? `${latestVitals.heartRate} bpm` : "..."}</strong>
        </div>
      </section>

      <section className="dashboard-grid two-column">
        <div className="column">
          <LiveVitalsChart
            vitals={vitals}
            heartRateForecast={heartRatePrediction?.predictedHeartRates ?? []}
            forecastConfidence={heartRatePrediction?.confidence}
          />
          <HeartRateForecastPanel prediction={heartRatePrediction} inputPayload={mockInputPayload} />
          <NotificationPanel notifications={notifications} onAcknowledge={onAcknowledge} />
        </div>
        <div className="column">
          <RiskForecastChart
            observedRiskSeries={predictionHistory}
            predictedTrend={prediction?.predictedTrend ?? []}
            confidence={prediction?.confidence}
          />
          <PredictionInsights prediction={prediction} insurance={insurance} />
          <TrendHeatmap trend={prediction?.predictedTrend ?? []} />
        </div>
      </section>
    </div>
  );
}
