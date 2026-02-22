"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api";
import { clearSession, getToken, getUser } from "@/lib/auth";
import { useInactivityLogout, useVitalsSocket } from "@/lib/hooks";
import { NotificationItem, PredictionResponse, StreamingVitals } from "@/lib/types";
import { AppHeader } from "./AppHeader";
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

export function PatientDashboard() {
  const router = useRouter();
  const [patientId, setPatientId] = useState<string>("");
  const [patientName, setPatientName] = useState<string>("Patient");
  const [vitals, setVitals] = useState<StreamingVitals[]>([]);
  const [prediction, setPrediction] = useState<PredictionResponse | null>(null);
  const [predictionHistory, setPredictionHistory] = useState<Array<{ timestamp: string; riskScore: number }>>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
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

  useEffect(() => {
    vitalsRef.current = vitals;
  }, [vitals]);

  useEffect(() => {
    if (!patientId) {
      return;
    }

    const interval = setInterval(() => {
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
    }, 20_000);

    return () => clearInterval(interval);
  }, [patientId]);

  if (loading) {
    return <div className="full-center">Loading secure patient dashboard...</div>;
  }

  const latestVitals = vitals[vitals.length - 1];

  return (
    <div className="dashboard-wrap">
      <AppHeader
        title={`${patientName} Monitoring Console`}
        subtitle="Patient Experience Layer"
        status={latestVitals ? "Streaming active" : "Awaiting stream"}
      />

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
          <LiveVitalsChart vitals={vitals} />
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
