"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api";
import { clearSession, getUser, updateSessionUser } from "@/lib/auth";
import { CaregiverOnboardingDraft } from "@/lib/types";

interface CaregiverDraftResponse {
  draft: CaregiverOnboardingDraft;
}

interface CaregiverCompleteResponse {
  message: string;
  mappedPatientId: string | null;
  nextPath: string;
}

export function CaregiverOnboardingWizard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [lastSavedAt, setLastSavedAt] = useState("");
  const [completion, setCompletion] = useState<CaregiverCompleteResponse | null>(null);

  const [professional, setProfessional] = useState({
    licenseNumber: "",
    specialization: "",
    yearsOfExperience: 0
  });
  const [assignment, setAssignment] = useState({
    assignmentMode: "admin_assign_later" as "admin_assign_later" | "request_access",
    patientEmail: "",
    patientCode: ""
  });
  const [consent, setConsent] = useState({
    hipaaAccepted: false,
    dataAccessAccepted: false,
    version: "2026.1"
  });

  const progress = useMemo(() => Math.min(100, Math.round((step / 4) * 100)), [step]);

  useEffect(() => {
    const user = getUser();
    if (!user || user.role !== "Caregiver") {
      router.replace("/");
      return;
    }

    const load = async () => {
      try {
        const status = await apiRequest<{ onboardingCompleted: boolean }>("/api/onboarding/status");
        if (status.onboardingCompleted) {
          router.replace("/caregiver");
          return;
        }

        const response = await apiRequest<CaregiverDraftResponse>("/api/onboarding/caregiver/draft");
        if (response.draft.professionalProfile) {
          setProfessional({
            licenseNumber: response.draft.professionalProfile.licenseNumber ?? "",
            specialization: response.draft.professionalProfile.specialization,
            yearsOfExperience: response.draft.professionalProfile.yearsOfExperience
          });
          setAssignment({
            assignmentMode: response.draft.professionalProfile.assignmentMode,
            patientEmail: response.draft.professionalProfile.requestedPatientEmail ?? "",
            patientCode: response.draft.professionalProfile.requestedPatientCode ?? ""
          });
        }
        if (response.draft.consent) {
          setConsent({
            hipaaAccepted: response.draft.consent.hipaaAccepted,
            dataAccessAccepted: response.draft.consent.dataAccessAccepted,
            version: response.draft.consent.version
          });
        }
        setStep(Math.max(1, Math.min(3, response.draft.currentStep || 1)));
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

  const withSaveState = async <T,>(operation: () => Promise<T>): Promise<T> => {
    setSaving(true);
    setError(null);
    try {
      const result = await operation();
      setLastSavedAt(new Date().toLocaleTimeString());
      return result;
    } finally {
      setSaving(false);
    }
  };

  const saveCurrentStep = async (): Promise<void> => {
    if (step === 1) {
      await withSaveState(() =>
        apiRequest("/api/onboarding/caregiver/professional", {
          method: "PUT",
          body: JSON.stringify(professional)
        })
      );
      return;
    }
    if (step === 2) {
      await withSaveState(() =>
        apiRequest("/api/onboarding/caregiver/assignment", {
          method: "PUT",
          body: JSON.stringify({
            assignmentMode: assignment.assignmentMode,
            patientEmail: assignment.patientEmail || undefined,
            patientCode: assignment.patientCode || undefined
          })
        })
      );
      return;
    }
    if (step === 3) {
      await withSaveState(() =>
        apiRequest("/api/onboarding/caregiver/consent", {
          method: "PUT",
          body: JSON.stringify(consent)
        })
      );
    }
  };

  const onNext = async () => {
    try {
      await saveCurrentStep();
      setStep((current) => Math.min(3, current + 1));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save step.");
    }
  };

  const onComplete = async () => {
    try {
      await saveCurrentStep();
      const response = await withSaveState(() =>
        apiRequest<CaregiverCompleteResponse>("/api/onboarding/caregiver/complete", {
          method: "POST"
        })
      );
      const user = getUser();
      if (user) {
        updateSessionUser({
          ...user,
          onboardingCompleted: true
        });
      }
      setCompletion(response);
      setStep(4);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to complete onboarding.");
    }
  };

  if (loading) {
    return <div className="full-center">Loading caregiver onboarding...</div>;
  }

  return (
    <main className="onboarding-shell">
      <section className="onboarding-card">
        <p className="eyebrow">Caregiver Access Setup</p>
        <h1>Caregiver Onboarding</h1>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <p className="small-copy">
          Step {Math.min(step, 3)} of 3 {lastSavedAt ? `• Autosaved at ${lastSavedAt}` : ""}
        </p>

        {step === 1 ? (
          <div className="wizard-grid">
            <label>
              License Number (optional)
              <input
                value={professional.licenseNumber}
                onChange={(event) =>
                  setProfessional((current) => ({ ...current, licenseNumber: event.target.value }))
                }
              />
            </label>
            <label>
              Specialization
              <input
                value={professional.specialization}
                onChange={(event) =>
                  setProfessional((current) => ({ ...current, specialization: event.target.value }))
                }
              />
            </label>
            <label>
              Years of Experience
              <input
                type="number"
                min={0}
                max={60}
                value={professional.yearsOfExperience}
                onChange={(event) =>
                  setProfessional((current) => ({
                    ...current,
                    yearsOfExperience: Number(event.target.value)
                  }))
                }
              />
            </label>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="wizard-grid">
            <label>
              Assignment Preference
              <select
                value={assignment.assignmentMode}
                onChange={(event) =>
                  setAssignment((current) => ({
                    ...current,
                    assignmentMode: event.target.value as "admin_assign_later" | "request_access"
                  }))
                }
              >
                <option value="admin_assign_later">Admin assigns patients later</option>
                <option value="request_access">Request access now</option>
              </select>
            </label>
            {assignment.assignmentMode === "request_access" ? (
              <>
                <label>
                  Patient Email (optional if code used)
                  <input
                    type="email"
                    value={assignment.patientEmail}
                    onChange={(event) =>
                      setAssignment((current) => ({ ...current, patientEmail: event.target.value }))
                    }
                  />
                </label>
                <label>
                  Patient Code (optional if email used)
                  <input
                    value={assignment.patientCode}
                    onChange={(event) =>
                      setAssignment((current) => ({ ...current, patientCode: event.target.value }))
                    }
                  />
                </label>
              </>
            ) : (
              <p className="small-copy">You can request patient mapping later from caregiver settings.</p>
            )}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="wizard-grid">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={consent.hipaaAccepted}
                onChange={(event) => setConsent((current) => ({ ...current, hipaaAccepted: event.target.checked }))}
              />
              HIPAA confidentiality agreement
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={consent.dataAccessAccepted}
                onChange={(event) =>
                  setConsent((current) => ({ ...current, dataAccessAccepted: event.target.checked }))
                }
              />
              Data access policy acceptance
            </label>
            <label>
              Consent Version
              <input
                value={consent.version}
                onChange={(event) => setConsent((current) => ({ ...current, version: event.target.value }))}
              />
            </label>
          </div>
        ) : null}

        {step === 4 && completion ? (
          <div className="wizard-grid">
            <h2>Caregiver Onboarding Completed</h2>
            <p className="small-copy">{completion.message}</p>
            {completion.mappedPatientId ? (
              <p className="small-copy">Initial patient access requested and mapped: {completion.mappedPatientId}</p>
            ) : (
              <p className="small-copy">No patient mapped yet. Admin assignment remains active.</p>
            )}
            <button type="button" className="primary" onClick={() => router.push(completion.nextPath)}>
              Go to Dashboard
            </button>
          </div>
        ) : null}

        {error ? <p className="error-line">{error}</p> : null}

        {step <= 3 ? (
          <div className="wizard-actions">
            <button type="button" className="ghost" disabled={step === 1 || saving} onClick={() => setStep(step - 1)}>
              Back
            </button>
            {step < 3 ? (
              <button type="button" className="primary" disabled={saving} onClick={onNext}>
                {saving ? "Saving..." : "Save & Next"}
              </button>
            ) : (
              <button type="button" className="primary" disabled={saving} onClick={onComplete}>
                {saving ? "Finalizing..." : "Complete Onboarding"}
              </button>
            )}
          </div>
        ) : null}
      </section>
    </main>
  );
}
