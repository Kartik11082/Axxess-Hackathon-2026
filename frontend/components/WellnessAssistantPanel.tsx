"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api";
import { AssistantChatResponse, AssistantReply, CoachingPlanResponse } from "@/lib/types";

type AssistantTab = "plan" | "assistant";
type WellnessPanelMode = "combined" | "plan" | "assistant";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text?: string;
  reply?: AssistantReply;
  source?: "llm" | "fallback";
  timestamp: string;
}

interface WellnessAssistantPanelProps {
  patientId: string;
  mode?: WellnessPanelMode;
}

function formatAssistantReplyForHistory(reply: AssistantReply): string {
  return [
    reply.title,
    reply.overview,
    ...reply.bullets,
    ...reply.nextSteps.map((step) => `Next: ${step}`)
  ].join("\n");
}

function createMessageId(): string {
  return `${Date.now()}-${Math.round(Math.random() * 100000)}`;
}

function urgencyLabelClass(urgency: AssistantReply["urgency"]): string {
  if (urgency === "high") {
    return "assistant-urgency-high";
  }
  if (urgency === "moderate") {
    return "assistant-urgency-moderate";
  }
  return "assistant-urgency-low";
}

function sourceLabel(source?: ChatMessage["source"]): string {
  if (source === "llm") {
    return "LLM";
  }
  if (source === "fallback") {
    return "Fallback";
  }
  return "System";
}

function sourceClass(source?: ChatMessage["source"]): string {
  if (source === "llm") {
    return "wellness-source-llm";
  }
  if (source === "fallback") {
    return "wellness-source-fallback";
  }
  return "wellness-source-system";
}

export function WellnessAssistantPanel({ patientId, mode = "combined" }: WellnessAssistantPanelProps) {
  const lockedTab: AssistantTab | null = mode === "plan" ? "plan" : mode === "assistant" ? "assistant" : null;
  const [activeTab, setActiveTab] = useState<AssistantTab>(lockedTab ?? "plan");
  const [plan, setPlan] = useState<CoachingPlanResponse | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  const loadPlan = useCallback(async () => {
    if (!patientId) {
      return;
    }
    setPlanLoading(true);
    setPlanError(null);
    try {
      const response = await apiRequest<CoachingPlanResponse>("/api/assistant/coach-plan", {
        method: "POST",
        body: JSON.stringify({ patientId })
      });
      setPlan(response);
    } catch (error) {
      setPlanError(error instanceof Error ? error.message : "Failed to load coaching plan.");
    } finally {
      setPlanLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    void loadPlan();
  }, [loadPlan]);

  useEffect(() => {
    if (lockedTab) {
      setActiveTab(lockedTab);
    }
  }, [lockedTab]);

  useEffect(() => {
    const speechCtor = typeof window !== "undefined" ? (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition : null;
    setVoiceSupported(Boolean(speechCtor));
  }, []);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  useEffect(() => {
    if (activeTab !== "assistant" || messages.length > 0) {
      return;
    }
    setMessages([
      {
        id: createMessageId(),
        role: "assistant",
        timestamp: new Date().toISOString(),
        reply: {
          intent: "general",
          urgency: "low",
          title: "Virtual Care Assistant",
          overview: "Ask me symptoms, medication timing, or appointment planning and I will return structured guidance.",
          bullets: [
            "Example: I feel short of breath after stairs.",
            "Example: Help me set medication reminders.",
            "Example: Should I schedule a cardiology follow-up?"
          ],
          nextSteps: ["Describe your concern in one sentence to begin."],
          redFlags: ["For severe or rapidly worsening symptoms, seek urgent clinical care."],
          disclaimer: "Assistant output supports care planning and is not diagnosis."
        }
      }
    ]);
  }, [activeTab, messages.length]);

  const startVoiceCapture = () => {
    const SpeechRecognitionCtor = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      const transcript = event?.results?.[0]?.[0]?.transcript ?? "";
      setInput((current) => `${current} ${transcript}`.trim());
    };
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    recognition.onerror = () => {
      setListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  };

  const stopVoiceCapture = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setListening(false);
  };

  const speakAssistantReply = (reply: AssistantReply) => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      return;
    }
    const speech = new SpeechSynthesisUtterance(
      [reply.title, reply.overview, ...reply.nextSteps.map((step) => `Next, ${step}`)].join(". ")
    );
    speech.rate = 1;
    speech.pitch = 1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(speech);
  };

  const sendMessage = async (event?: FormEvent) => {
    event?.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || chatBusy || !patientId) {
      return;
    }

    const userMessage: ChatMessage = {
      id: createMessageId(),
      role: "user",
      text: trimmed,
      timestamp: new Date().toISOString()
    };

    setMessages((current) => [...current, userMessage]);
    setInput("");
    setChatBusy(true);
    setChatError(null);

    try {
      const historyPayload = messages.slice(-8).map((message) => ({
        role: message.role,
        content: message.role === "assistant" && message.reply ? formatAssistantReplyForHistory(message.reply) : message.text ?? ""
      }));

      const response = await apiRequest<AssistantChatResponse>("/api/assistant/chat", {
        method: "POST",
        body: JSON.stringify({
          patientId,
          message: trimmed,
          history: historyPayload
        })
      });

      const assistantMessage: ChatMessage = {
        id: createMessageId(),
        role: "assistant",
        reply: response.reply,
        source: response.source,
        timestamp: response.generatedAt
      };
      setMessages((current) => [...current, assistantMessage]);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Assistant request failed.");
    } finally {
      setChatBusy(false);
    }
  };

  return (
    <section className="card wellness-panel">
      <div className="card-header">
        <h3>{activeTab === "plan" ? "Lifestyle Coaching Plan" : "Virtual Assistant"}</h3>
        {mode === "combined" ? (
          <div className="wellness-tabs">
            <button
              type="button"
              className={activeTab === "plan" ? "primary" : "ghost"}
              onClick={() => setActiveTab("plan")}
            >
              Coaching Plan
            </button>
            <button
              type="button"
              className={activeTab === "assistant" ? "primary" : "ghost"}
              onClick={() => setActiveTab("assistant")}
            >
              Assistant
            </button>
          </div>
        ) : null}
      </div>

      {activeTab === "plan" ? (
        <div className="wellness-plan-body">
          <div className="wellness-plan-header">
            <p className="small-copy">Raw LLM coaching response.</p>
            <button type="button" className="ghost" onClick={() => void loadPlan()} disabled={planLoading}>
              {planLoading ? "Refreshing..." : "Refresh Plan"}
            </button>
          </div>
          {planError ? <p className="error-line">{planError}</p> : null}
          {!plan && !planError ? <p className="small-copy">Generating plan...</p> : null}
          {plan ? (
            <article className="sub-card">
              <p className="wellness-source">
                Source: {plan.source.toUpperCase()} | {new Date(plan.generatedAt).toLocaleString()}
              </p>
              <textarea
                className="wellness-plan-textbox"
                value={plan.summary}
                readOnly
                aria-label="Coaching plan text response"
              />
              <p className="assistive">{plan.disclaimer}</p>
            </article>
          ) : null}
        </div>
      ) : (
        <div className="wellness-chat-body">
          <p className="small-copy">
            Ask for symptom triage, medication reminders, or appointment planning. Output is structured and non-diagnostic.
          </p>
          <div className="wellness-chat-log">
            {messages.length === 0 ? <p className="small-copy">No conversation yet.</p> : null}
            {messages.map((message) =>
              message.role === "user" ? (
                <article key={message.id} className="wellness-chat-message user">
                  <p>{message.text}</p>
                  <small>{new Date(message.timestamp).toLocaleTimeString()}</small>
                </article>
              ) : (
                <article key={message.id} className="wellness-chat-message assistant">
                  {message.reply ? (
                    <>
                      <div className="wellness-assistant-header">
                        <strong>{message.reply.title}</strong>
                        <div className="wellness-assistant-tags">
                          <span className={`wellness-urgency ${urgencyLabelClass(message.reply.urgency)}`}>
                            {message.reply.intent} | {message.reply.urgency}
                          </span>
                          <span className={`wellness-source-badge ${sourceClass(message.source)}`}>{sourceLabel(message.source)}</span>
                        </div>
                      </div>
                      {message.source === "fallback" ? (
                        <p className="wellness-source-warning">
                          LLM response was unavailable for this turn, so deterministic fallback guidance was used.
                        </p>
                      ) : null}
                      <p>{message.reply.overview}</p>
                      <div className="wellness-assistant-columns">
                        <div>
                          <p className="wellness-item-title">Key Guidance</p>
                          <ul>
                            {message.reply.bullets.map((bullet) => (
                              <li key={bullet}>{bullet}</li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <p className="wellness-item-title">Next Steps</p>
                          <ul>
                            {message.reply.nextSteps.map((step) => (
                              <li key={step}>{step}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                      {message.reply.reminder ? (
                        <div className="wellness-meta-card">
                          <p className="wellness-item-title">Reminder</p>
                          <p className="small-copy">
                            {message.reply.reminder.task} | {message.reply.reminder.when} ({message.reply.reminder.frequency})
                          </p>
                        </div>
                      ) : null}
                      {message.reply.appointment ? (
                        <div className="wellness-meta-card">
                          <p className="wellness-item-title">Appointment Suggestion</p>
                          <p className="small-copy">
                            {message.reply.appointment.specialty} | {message.reply.appointment.timeframe}
                          </p>
                          <p className="small-copy">{message.reply.appointment.reason}</p>
                        </div>
                      ) : null}
                      <div className="wellness-meta-card">
                        <p className="wellness-item-title">Red Flags</p>
                        <ul>
                          {message.reply.redFlags.map((flag) => (
                            <li key={flag}>{flag}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="wellness-assistant-footer">
                        <small>{new Date(message.timestamp).toLocaleTimeString()}</small>
                        <button type="button" className="ghost" onClick={() => speakAssistantReply(message.reply!)}>
                          Speak
                        </button>
                      </div>
                      <p className="assistive">{message.reply.disclaimer}</p>
                    </>
                  ) : null}
                </article>
              )
            )}
          </div>
          {chatError ? <p className="error-line">{chatError}</p> : null}
          <form className="wellness-chat-form" onSubmit={sendMessage}>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Example: I feel dizzy after walking, what should I do?"
            />
            <div className="wellness-chat-actions">
              {voiceSupported ? (
                <button type="button" className="ghost" onClick={listening ? stopVoiceCapture : startVoiceCapture}>
                  {listening ? "Stop Voice" : "Voice Input"}
                </button>
              ) : null}
              <button type="submit" className="primary" disabled={chatBusy || !input.trim()}>
                {chatBusy ? "Thinking..." : "Send"}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
