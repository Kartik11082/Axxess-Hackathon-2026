"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api";
import { clearSession, getUser, updateSessionUser } from "@/lib/auth";
import {
  BeneficiaryDraft,
  PatientBasicInfo,
  PatientBehavioralResponses,
  PatientConsentDraft,
  PatientOnboardingDraft
} from "@/lib/types";

interface PatientDraftResponse {
  draft: PatientOnboardingDraft;
}

interface PatientCompleteResponse {
  baselineRiskScore: number;
  probableDisease: "Cardiac" | "Diabetes" | "Stable";
  confidence: "Low";
  initialRiskAssessment: {
    diabetesScore: number;
    cardiacScore: number;
  };
  message: string;
  nextPath: string;
}

const likertLabels = ["Never", "Rarely", "Sometimes", "Often", "Very Often"];

const defaultBasicInfo: PatientBasicInfo = {
  preferredName: "",
  heightRange: "",
  activityLevel: "Moderate",
  lifeStage: "Mid-life"
};

const defaultBehavior: PatientBehavioralResponses = {
  unusualThirst: 1,
  wakeUpAtNight: 1,
  breathlessDuringLightActivity: 1,
  fatigueAfterMeals: 1,
  monitorHeartRateRegularly: 1
};

const defaultConsent: PatientConsentDraft = {
  dataUsageAccepted: false,
  wearableConsentAccepted: false,
  aiModelingAcknowledged: false,
  version: "2026.1"
};

const defaultBeneficiary: BeneficiaryDraft = {
  name: "",
  relationship: "",
  email: "",
  phone: "",
  alertPreference: "high-risk-only"
};

const heightRanges = [
  "Under 5'0\"",
  "5'0\" - 5'3\"",
  "5'4\" - 5'6\"",
  "5'7\" - 5'10\"",
  "5'11\" - 6'2\"",
  "Above 6'2\""
];

function LikertQuestion(props: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      {props.label}
      <select value={props.value} onChange={(event) => props.onChange(Number(event.target.value))}>
        {likertLabels.map((label, index) => (
          <option key={label} value={index}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function PatientOnboardingWizard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [lastSavedAt, setLastSavedAt] = useState<string>("");

  const [basicInfo, setBasicInfo] = useState<PatientBasicInfo>(defaultBasicInfo);
  const [behavior, setBehavior] = useState<PatientBehavioralResponses>(defaultBehavior);
  const [insurance, setInsurance] = useState({
    provider: "",
    memberId: "",
    groupNumber: "",
    memberIdMasked: "",
    groupNumberMasked: ""
  });
  const [beneficiaries, setBeneficiaries] = useState<BeneficiaryDraft[]>([]);
  const [consent, setConsent] = useState<PatientConsentDraft>(defaultConsent);
  const [completion, setCompletion] = useState<PatientCompleteResponse | null>(null);

  const progress = useMemo(() => Math.min(100, Math.round((step / 6) * 100)), [step]);

  useEffect(() => {
    const user = getUser();
    if (!user || user.role !== "Patient") {
      router.replace("/");
      return;
    }

    const load = async () => {
      try {
        const status = await apiRequest<{
          onboardingCompleted: boolean;
          nextPath: string;
        }>("/api/onboarding/status");

        if (status.onboardingCompleted) {
          router.replace("/patient");
          return;
        }

        const response = await apiRequest<PatientDraftResponse>("/api/onboarding/patient/draft");
        if (response.draft.basicInfo) {
          setBasicInfo(response.draft.basicInfo);
        }
        if (response.draft.behavioralResponses) {
          setBehavior(response.draft.behavioralResponses);
        }
        if (response.draft.insurance) {
          setInsurance((current) => ({
            ...current,
            provider: response.draft.insurance?.provider ?? "",
            memberIdMasked: response.draft.insurance?.memberIdMasked ?? "",
            groupNumberMasked: response.draft.insurance?.groupNumberMasked ?? ""
          }));
        }
        if (response.draft.beneficiaries.length > 0) {
          setBeneficiaries(response.draft.beneficiaries);
        }
        if (response.draft.consent) {
          setConsent(response.draft.consent);
        }
        setStep(Math.max(1, Math.min(5, response.draft.currentStep || 1)));
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
        apiRequest("/api/onboarding/patient/basic-info", {
          method: "PUT",
          body: JSON.stringify(basicInfo)
        })
      );
      return;
    }

    if (step === 2) {
      const payload =
        basicInfo.activityLevel === "High"
          ? {
              ...behavior,
              monitorHeartRateRegularly: 1
            }
          : behavior;
      await withSaveState(() =>
        apiRequest("/api/onboarding/patient/behavioral", {
          method: "PUT",
          body: JSON.stringify(payload)
        })
      );
      return;
    }

    if (step === 3) {
      await withSaveState(() =>
        apiRequest("/api/onboarding/patient/insurance", {
          method: "PUT",
          body: JSON.stringify({
            provider: insurance.provider,
            memberId: insurance.memberId,
            groupNumber: insurance.groupNumber
          })
        })
      );
      return;
    }

    if (step === 4) {
      await withSaveState(() =>
        apiRequest("/api/onboarding/patient/beneficiaries", {
          method: "PUT",
          body: JSON.stringify({
            beneficiaries: beneficiaries.filter((item) => item.name && item.relationship && item.email && item.phone)
          })
        })
      );
      return;
    }

    if (step === 5) {
      await withSaveState(() =>
        apiRequest("/api/onboarding/patient/consent", {
          method: "PUT",
          body: JSON.stringify(consent)
        })
      );
    }
  };

  const onNext = async () => {
    try {
      await saveCurrentStep();
      setStep((current) => Math.min(5, current + 1));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save step.");
    }
  };

  const onComplete = async () => {
    try {
      await saveCurrentStep();
      const response = await withSaveState(() =>
        apiRequest<PatientCompleteResponse>("/api/onboarding/patient/complete", {
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
      setStep(6);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to complete onboarding.");
    }
  };

  if (loading) {
    return <div className="full-center">Loading personalized health setup...</div>;
  }

  return (
    <main className="onboarding-shell">
      <section className="onboarding-card">
        <p className="eyebrow">Personalized Health Setup</p>
        <h1>Patient Onboarding</h1>
        <div className="progress-track" aria-label="Onboarding progress">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <p className="small-copy">
          Step {Math.min(step, 5)} of 5 {lastSavedAt ? `• Autosaved at ${lastSavedAt}` : ""}
        </p>

        {step === 1 ? (
          <div className="wizard-grid">
            <label>
              Preferred Name
              <input
                value={basicInfo.preferredName}
                onChange={(event) => setBasicInfo((current) => ({ ...current, preferredName: event.target.value }))}
                placeholder="How should we address you?"
              />
            </label>
            <label>
              Height Range
              <select
                value={basicInfo.heightRange}
                onChange={(event) => setBasicInfo((current) => ({ ...current, heightRange: event.target.value }))}
              >
                <option value="">Select range</option>
                {heightRanges.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Activity Level
              <select
                value={basicInfo.activityLevel}
                onChange={(event) =>
                  setBasicInfo((current) => ({
                    ...current,
                    activityLevel: event.target.value as PatientBasicInfo["activityLevel"]
                  }))
                }
              >
                <option value="Low">Low</option>
                <option value="Moderate">Moderate</option>
                <option value="High">High</option>
              </select>
            </label>
            <label>
              Life Stage
              <select
                value={basicInfo.lifeStage}
                onChange={(event) =>
                  setBasicInfo((current) => ({
                    ...current,
                    lifeStage: event.target.value as PatientBasicInfo["lifeStage"]
                  }))
                }
              >
                <option value="Early adult">Early adult</option>
                <option value="Mid-life">Mid-life</option>
                <option value="Senior">Senior</option>
              </select>
            </label>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="wizard-grid">
            <LikertQuestion
              label="How often do you feel unusually thirsty?"
              value={behavior.unusualThirst}
              onChange={(value) => setBehavior((current) => ({ ...current, unusualThirst: value }))}
            />
            <LikertQuestion
              label="How frequently do you wake up at night?"
              value={behavior.wakeUpAtNight}
              onChange={(value) => setBehavior((current) => ({ ...current, wakeUpAtNight: value }))}
            />
            <LikertQuestion
              label="Do you feel breathless during light activity?"
              value={behavior.breathlessDuringLightActivity}
              onChange={(value) => setBehavior((current) => ({ ...current, breathlessDuringLightActivity: value }))}
            />
            <LikertQuestion
              label="How often do you feel fatigue after meals?"
              value={behavior.fatigueAfterMeals}
              onChange={(value) => setBehavior((current) => ({ ...current, fatigueAfterMeals: value }))}
            />
            {basicInfo.activityLevel !== "High" ? (
              <LikertQuestion
                label="Do you monitor your heart rate regularly?"
                value={behavior.monitorHeartRateRegularly}
                onChange={(value) => setBehavior((current) => ({ ...current, monitorHeartRateRegularly: value }))}
              />
            ) : (
              <p className="small-copy">
                Cardiac question set is reduced for high-activity users to keep setup concise.
              </p>
            )}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="wizard-grid">
            <label>
              Insurance Provider (optional)
              <input
                value={insurance.provider}
                onChange={(event) => setInsurance((current) => ({ ...current, provider: event.target.value }))}
                placeholder="Provider"
              />
            </label>
            <label>
              Member ID (optional)
              <input
                value={insurance.memberId}
                onChange={(event) => setInsurance((current) => ({ ...current, memberId: event.target.value }))}
                placeholder={insurance.memberIdMasked || "Member ID"}
              />
            </label>
            <label>
              Group Number (optional)
              <input
                value={insurance.groupNumber}
                onChange={(event) => setInsurance((current) => ({ ...current, groupNumber: event.target.value }))}
                placeholder={insurance.groupNumberMasked || "Group Number"}
              />
            </label>
            <p className="small-copy">Member and group IDs are masked in UI and encrypted before backend persistence.</p>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="wizard-grid">
            <button
              type="button"
              className="ghost"
              onClick={() => setBeneficiaries((current) => [...current, { ...defaultBeneficiary }])}
            >
              Add Beneficiary
            </button>
            {beneficiaries.length === 0 ? (
              <p className="small-copy">No beneficiaries added yet. You can skip this step.</p>
            ) : null}
            {beneficiaries.map((beneficiary, index) => (
              <div key={`beneficiary-${index}`} className="sub-card">
                <label>
                  Name
                  <input
                    value={beneficiary.name}
                    onChange={(event) =>
                      setBeneficiaries((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, name: event.target.value } : item
                        )
                      )
                    }
                  />
                </label>
                <label>
                  Relationship
                  <input
                    value={beneficiary.relationship}
                    onChange={(event) =>
                      setBeneficiaries((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, relationship: event.target.value } : item
                        )
                      )
                    }
                  />
                </label>
                <label>
                  Email
                  <input
                    type="email"
                    value={beneficiary.email}
                    onChange={(event) =>
                      setBeneficiaries((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, email: event.target.value } : item
                        )
                      )
                    }
                  />
                </label>
                <label>
                  Phone
                  <input
                    value={beneficiary.phone}
                    onChange={(event) =>
                      setBeneficiaries((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, phone: event.target.value } : item
                        )
                      )
                    }
                  />
                </label>
                <label>
                  Alert Preference
                  <select
                    value={beneficiary.alertPreference}
                    onChange={(event) =>
                      setBeneficiaries((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                alertPreference: event.target.value as BeneficiaryDraft["alertPreference"]
                              }
                            : item
                        )
                      )
                    }
                  >
                    <option value="high-risk-only">High risk only</option>
                    <option value="all-alerts">All alerts</option>
                    <option value="emergency-only">Emergency only</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setBeneficiaries((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {step === 5 ? (
          <div className="wizard-grid">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={consent.dataUsageAccepted}
                onChange={(event) =>
                  setConsent((current) => ({ ...current, dataUsageAccepted: event.target.checked }))
                }
              />
              Data usage consent
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={consent.wearableConsentAccepted}
                onChange={(event) =>
                  setConsent((current) => ({ ...current, wearableConsentAccepted: event.target.checked }))
                }
              />
              Wearable data consent
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={consent.aiModelingAcknowledged}
                onChange={(event) =>
                  setConsent((current) => ({ ...current, aiModelingAcknowledged: event.target.checked }))
                }
              />
              AI-based risk modeling acknowledgment
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

        {step === 6 && completion ? (
          <div className="wizard-grid">
            <h2>Initial Risk Assessment Ready</h2>
            <p className="small-copy">{completion.message}</p>
            <div className="risk-headline">
              <div>
                <p>Initial Risk</p>
                <strong>{Math.round(completion.baselineRiskScore * 100)}%</strong>
              </div>
              <div>
                <p>Likely Focus</p>
                <strong>{completion.probableDisease}</strong>
              </div>
              <div>
                <p>Confidence</p>
                <strong>{completion.confidence} (wearable data needed)</strong>
              </div>
            </div>
            <button type="button" className="primary" onClick={() => router.push(completion.nextPath)}>
              Go to Dashboard
            </button>
          </div>
        ) : null}

        {error ? <p className="error-line">{error}</p> : null}

        {step <= 5 ? (
          <div className="wizard-actions">
            <button type="button" className="ghost" disabled={step === 1 || saving} onClick={() => setStep(step - 1)}>
              Back
            </button>
            {step < 5 ? (
              <button type="button" className="primary" disabled={saving} onClick={onNext}>
                {saving ? "Saving..." : "Save & Next"}
              </button>
            ) : (
              <button type="button" className="primary" disabled={saving} onClick={onComplete}>
                {saving ? "Finalizing..." : "Generate Initial Risk"}
              </button>
            )}
          </div>
        ) : null}
      </section>
    </main>
  );
}
