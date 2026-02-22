"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "./AppHeader";
import { WellnessAssistantPanel } from "./WellnessAssistantPanel";
import { clearSession, getUser } from "@/lib/auth";

interface PatientWellnessPageProps {
  mode: "plan" | "assistant";
}

const MODE_META: Record<PatientWellnessPageProps["mode"], { titleSuffix: string; subtitle: string; status: string }> = {
  plan: {
    titleSuffix: "Coaching Plan",
    subtitle: "Diet and lifestyle planning",
    status: "Personalized plan workspace"
  },
  assistant: {
    titleSuffix: "Virtual Assistant",
    subtitle: "Symptom triage, reminders, scheduling",
    status: "Guided assistant workspace"
  }
};

export function PatientWellnessPage({ mode }: PatientWellnessPageProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [patientId, setPatientId] = useState("");
  const [patientName, setPatientName] = useState("Patient");

  useEffect(() => {
    const user = getUser();
    if (!user || user.role !== "Patient") {
      clearSession();
      router.replace("/");
      return;
    }
    setPatientId(user.id);
    setPatientName(user.name);
    setLoading(false);
  }, [router]);

  if (loading) {
    return <div className="full-center">Loading wellness workspace...</div>;
  }

  const meta = MODE_META[mode];

  return (
    <div className="dashboard-wrap">
      <AppHeader
        title={`${patientName} ${meta.titleSuffix}`}
        subtitle={meta.subtitle}
        status={meta.status}
        userId={patientId}
        showWellnessNav
      />

      <section className="dashboard-grid single-column">
        <WellnessAssistantPanel patientId={patientId} mode={mode} />
      </section>
    </div>
  );
}
