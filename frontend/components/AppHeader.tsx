"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { apiRequest } from "@/lib/api";
import { clearSession } from "@/lib/auth";
import { usePathname, useRouter } from "next/navigation";

interface AppHeaderProps {
  title: string;
  subtitle: string;
  status: string;
  userId?: string;
  showAddPatientControl?: boolean;
  showWellnessNav?: boolean;
  onPatientMapped?: () => Promise<void> | void;
}

export function AppHeader({
  title,
  subtitle,
  status,
  userId,
  showAddPatientControl = false,
  showWellnessNav = false,
  onPatientMapped
}: AppHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [copied, setCopied] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [patientIdInput, setPatientIdInput] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const logout = () => {
    clearSession();
    router.push("/");
  };

  const copyUserId = async () => {
    if (!userId) {
      return;
    }
    try {
      await navigator.clipboard.writeText(userId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  const onAddPatient = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!patientIdInput.trim()) {
      setAddError("Enter a patient ID.");
      setAddSuccess(null);
      return;
    }

    setIsSubmitting(true);
    setAddError(null);
    setAddSuccess(null);
    try {
      await apiRequest<{ message: string }>("/api/caregiver/mappings", {
        method: "POST",
        body: JSON.stringify({
          patientId: patientIdInput.trim()
        })
      });
      setAddSuccess(`Patient ${patientIdInput.trim()} added.`);
      setPatientIdInput("");
      if (onPatientMapped) {
        await onPatientMapped();
      }
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "Unable to add patient.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <header className="app-header">
      <div>
        <p className="eyebrow">{subtitle}</p>
        <h1>{title}</h1>
      </div>
      <div className="header-actions">
        <span className="status-chip">{status}</span>
        {showWellnessNav ? (
          <div className="header-link-row">
            <Link href="/patient" className={`header-link-button ${pathname === "/patient" ? "active" : ""}`}>
              Home
            </Link>
            <Link
              href="/patient/coaching"
              className={`header-link-button ${pathname?.startsWith("/patient/coaching") ? "active" : ""}`}
            >
              Coaching
            </Link>
            <Link
              href="/patient/assistant"
              className={`header-link-button ${pathname?.startsWith("/patient/assistant") ? "active" : ""}`}
            >
              Assistant
            </Link>
          </div>
        ) : null}
        {userId ? (
          <button type="button" className="ghost id-button" onClick={copyUserId} title="Click to copy your user ID">
            {copied ? "Copied" : `ID: ${userId}`}
          </button>
        ) : null}
        {showAddPatientControl ? (
          <div className="add-patient-shell">
            <button type="button" className="ghost" onClick={() => setShowAddForm((current) => !current)}>
              {showAddForm ? "Close Add Patient" : "Add Patient"}
            </button>
            {showAddForm ? (
              <form className="add-patient-inline" onSubmit={onAddPatient}>
                <input
                  value={patientIdInput}
                  onChange={(event) => setPatientIdInput(event.target.value)}
                  placeholder="Enter patient ID"
                />
                <button type="submit" className="primary" disabled={isSubmitting}>
                  {isSubmitting ? "Adding..." : "Add"}
                </button>
              </form>
            ) : null}
            {addError ? <p className="header-note header-note-error">{addError}</p> : null}
            {addSuccess ? <p className="header-note">{addSuccess}</p> : null}
          </div>
        ) : null}
        <button type="button" className="ghost" onClick={logout}>
          Logout
        </button>
      </div>
    </header>
  );
}
