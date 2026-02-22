"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api";
import { clearSession, getToken, getUser } from "@/lib/auth";
import { useAlertStream, useInactivityLogout, useVitalsSocket } from "@/lib/hooks";
import {
  CaregiverAlertAction,
  CaregiverPriorityItem,
  HeartRatePredictionResponse,
  LiveAlert,
  MockHeartRateInputPayload,
  NotificationItem,
  PredictionResponse,
  StreamingVitals
} from "@/lib/types";
import { AppHeader } from "./AppHeader";
import { CaregiverAlertFeed } from "./CaregiverAlertFeed";
import { CaregiverPriorityTable } from "./CaregiverPriorityTable";
import { HeartRateForecastPanel } from "./HeartRateForecastPanel";
import { LiveVitalsChart } from "./LiveVitalsChart";
import { NotificationPanel } from "./NotificationPanel";
import { PredictionInsights } from "./PredictionInsights";
import { RiskForecastChart } from "./RiskForecastChart";
import { TrendHeatmap } from "./TrendHeatmap";

interface CaregiverPatientsResponse {
  patients: Array<{ id: string; name: string }>;
  prioritizedAlerts: CaregiverPriorityItem[];
}

interface CaregiverPatientDetailResponse {
  patient: {
    id: string;
    name: string;
  };
  latestVitals?: StreamingVitals;
  latestPrediction?: PredictionResponse;
  predictions: Array<{
    timestamp: string;
    predictedRiskScore: number;
  }>;
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

export function CaregiverDashboard() {
  const router = useRouter();
  const [caregiverName, setCaregiverName] = useState("Caregiver");
  const [caregiverId, setCaregiverId] = useState("");
  const [prioritized, setPrioritized] = useState<CaregiverPriorityItem[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string>("");
  const [selectedPatientName, setSelectedPatientName] = useState<string>("Patient");
  const [vitals, setVitals] = useState<StreamingVitals[]>([]);
  const [prediction, setPrediction] = useState<PredictionResponse | null>(null);
  const [heartRatePrediction, setHeartRatePrediction] = useState<HeartRatePredictionResponse | null>(null);
  const [mockInputPayload, setMockInputPayload] = useState<MockHeartRateInputPayload | null>(null);
  const [predictionHistory, setPredictionHistory] = useState<Array<{ timestamp: string; riskScore: number }>>([]);
  const [insurance, setInsurance] = useState<InsuranceResponse | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [liveAlerts, setLiveAlerts] = useState<LiveAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState<string | null>(null);

  const logoutForInactivity = useCallback(() => {
    clearSession();
    router.push("/");
  }, [router]);

  useInactivityLogout(logoutForInactivity, 8 * 60 * 1000);

  useEffect(() => {
    setToken(getToken());
  }, []);

  const loadPatientDetails = useCallback(async (patientId: string) => {
    const detail = await apiRequest<CaregiverPatientDetailResponse>(`/api/caregiver/patients/${patientId}`);
    setSelectedPatientName(detail.patient.name);
    const latestVitals = detail.latestVitals ? [detail.latestVitals] : [];
    setVitals(latestVitals);
    setHeartRatePrediction(null);
    setMockInputPayload(null);
    setPrediction(detail.latestPrediction ?? null);
    setPredictionHistory(
      detail.predictions.map((point) => ({
        timestamp: point.timestamp,
        riskScore: point.predictedRiskScore
      }))
    );
  }, []);

  const refreshPatientList = useCallback(async (): Promise<CaregiverPatientsResponse> => {
    const patients = await apiRequest<CaregiverPatientsResponse>("/api/caregiver/patients");
    setPrioritized(patients.prioritizedAlerts);
    return patients;
  }, []);

  useEffect(() => {
    const user = getUser();
    if (!user || user.role !== "Caregiver") {
      router.replace("/");
      return;
    }
    setCaregiverName(user.name);
    setCaregiverId(user.id);

    const load = async () => {
      try {
        const [patients, alerts] = await Promise.all([
          refreshPatientList(),
          apiRequest<NotificationsResponse>("/api/notifications")
        ]);
        setNotifications(alerts.notifications);

        const firstPatientId = patients.prioritizedAlerts[0]?.patientId ?? patients.patients[0]?.id ?? "";
        if (firstPatientId) {
          setSelectedPatientId(firstPatientId);
          await loadPatientDetails(firstPatientId);
        }
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
  }, [loadPatientDetails, refreshPatientList, router]);

  const onPatientMapped = useCallback(async () => {
    const patients = await refreshPatientList();
    if (!selectedPatientId) {
      const firstPatientId = patients.prioritizedAlerts[0]?.patientId ?? patients.patients[0]?.id ?? "";
      if (firstPatientId) {
        setSelectedPatientId(firstPatientId);
        await loadPatientDetails(firstPatientId);
      }
    }
  }, [loadPatientDetails, refreshPatientList, selectedPatientId]);

  useEffect(() => {
    if (!selectedPatientId) {
      return;
    }
    apiRequest<InsuranceResponse>(`/api/insurance/check/${selectedPatientId}`)
      .then(setInsurance)
      .catch(() => undefined);
  }, [selectedPatientId, prediction?.icdCode]);

  useVitalsSocket({
    token,
    patientId: selectedPatientId,
    onVitals: (incoming) => {
      setVitals((current) => [...current.slice(-60), incoming]);
    },
    onPrediction: (incoming) => {
      setPrediction(incoming);
      setPredictionHistory((current) => [
        ...current.slice(-40),
        { timestamp: new Date().toISOString(), riskScore: incoming.predictedRiskScore }
      ]);
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
    if (!selectedPatientId) {
      return;
    }

    const runCycle = () => {
      apiRequest<MockHeartRateInputPayload>(`/api/ml/mock-input/${selectedPatientId}?horizon=6&window=24`)
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
  }, [selectedPatientId]);

  const onSelectPatient = useCallback(
    async (patientId: string) => {
      setSelectedPatientId(patientId);
      await loadPatientDetails(patientId);
    },
    [loadPatientDetails]
  );

  const onAcknowledge = useCallback(async (notificationId: string) => {
    await apiRequest(`/api/notifications/${notificationId}/ack`, { method: "POST" });
    const alerts = await apiRequest<NotificationsResponse>("/api/notifications");
    setNotifications(alerts.notifications);
  }, []);

  const onCaregiverAction = useCallback(
    async (alertId: string, action: Exclude<CaregiverAlertAction, "bulk_acknowledge">, note?: string) => {
      await apiRequest<{ alert: LiveAlert }>("/api/stream/action", {
        method: "POST",
        body: JSON.stringify({
          alertId,
          action,
          note
        })
      });
    },
    []
  );

  const onBulkAcknowledge = useCallback(async (tier?: 1 | 2 | 3) => {
    await apiRequest<{ acknowledgedCount: number; alertIds: string[] }>("/api/stream/bulk-acknowledge", {
      method: "POST",
      body: JSON.stringify(tier ? { tier } : {})
    });
  }, []);

  if (loading) {
    return <div className="full-center">Loading caregiver command center...</div>;
  }

  const activeLiveAlerts = [...liveAlerts]
    .filter((alert) => alert.state !== "RESOLVED")
    .sort(sortLiveAlerts);

  return (
    <div className="dashboard-wrap">
      <AppHeader
        title={`${caregiverName} Command Center`}
        subtitle="Caregiver Operations Layer"
        status={
          selectedPatientId
            ? `Monitoring ${selectedPatientName} | ${alertStreamStatus}`
            : `No active patient selected | ${alertStreamStatus}`
        }
        userId={caregiverId}
        showAddPatientControl
        onPatientMapped={onPatientMapped}
      />

      <section className="dashboard-grid single-column">
        <CaregiverAlertFeed alerts={activeLiveAlerts} onAction={onCaregiverAction} onBulkAcknowledge={onBulkAcknowledge} />
        <CaregiverPriorityTable rows={prioritized} onSelectPatient={onSelectPatient} />
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
