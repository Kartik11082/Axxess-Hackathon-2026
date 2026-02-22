"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api";
import { clearSession, getToken, getUser } from "@/lib/auth";
import { useInactivityLogout, useVitalsSocket } from "@/lib/hooks";
import {
  CaregiverPriorityItem,
  NotificationItem,
  PredictionResponse,
  StreamingVitals
} from "@/lib/types";
import { AppHeader } from "./AppHeader";
import { CaregiverPriorityTable } from "./CaregiverPriorityTable";
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

export function CaregiverDashboard() {
  const router = useRouter();
  const [caregiverName, setCaregiverName] = useState("Caregiver");
  const [prioritized, setPrioritized] = useState<CaregiverPriorityItem[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string>("");
  const [selectedPatientName, setSelectedPatientName] = useState<string>("Patient");
  const [vitals, setVitals] = useState<StreamingVitals[]>([]);
  const [prediction, setPrediction] = useState<PredictionResponse | null>(null);
  const [predictionHistory, setPredictionHistory] = useState<Array<{ timestamp: string; riskScore: number }>>([]);
  const [insurance, setInsurance] = useState<InsuranceResponse | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
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
    setVitals(detail.latestVitals ? [detail.latestVitals] : []);
    setPrediction(detail.latestPrediction ?? null);
    setPredictionHistory(
      detail.predictions.map((point) => ({
        timestamp: point.timestamp,
        riskScore: point.predictedRiskScore
      }))
    );
  }, []);

  useEffect(() => {
    const user = getUser();
    if (!user || user.role !== "Caregiver") {
      router.replace("/");
      return;
    }
    setCaregiverName(user.name);

    const load = async () => {
      try {
        const [patients, alerts] = await Promise.all([
          apiRequest<CaregiverPatientsResponse>("/api/caregiver/patients"),
          apiRequest<NotificationsResponse>("/api/notifications")
        ]);
        setPrioritized(patients.prioritizedAlerts);
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
  }, [loadPatientDetails, router]);

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

  if (loading) {
    return <div className="full-center">Loading caregiver command center...</div>;
  }

  return (
    <div className="dashboard-wrap">
      <AppHeader
        title={`${caregiverName} Command Center`}
        subtitle="Caregiver Operations Layer"
        status={selectedPatientId ? `Monitoring ${selectedPatientName}` : "No active patient selected"}
      />

      <section className="dashboard-grid single-column">
        <CaregiverPriorityTable rows={prioritized} onSelectPatient={onSelectPatient} />
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
