"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api";
import { getRouteForUser, getToken, getUser, saveSession } from "@/lib/auth";
import { AuthResponse, Role } from "@/lib/types";

export function LoginPanel() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("patient1@demo.com");
  const [password, setPassword] = useState("Password123!");
  const [role, setRole] = useState<Role>("Patient");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const token = getToken();
    const user = getUser();
    if (token && user) {
      router.replace(getRouteForUser(user));
    }
  }, [router]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response =
        mode === "login"
          ? await apiRequest<AuthResponse>("/api/auth/login", {
              method: "POST",
              authenticated: false,
              body: JSON.stringify({ email, password })
            })
          : await apiRequest<AuthResponse>("/api/auth/register", {
              method: "POST",
              authenticated: false,
              body: JSON.stringify({ name: fullName.trim(), email, password, role })
            });

      saveSession(response.token, response.user);
      router.push(response.nextPath || getRouteForUser(response.user));
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Login failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const quickFill = (quickRole: "Patient" | "Caregiver") => {
    if (quickRole === "Patient") {
      setEmail("patient1@demo.com");
    } else {
      setEmail("caregiver@demo.com");
    }
    setRole(quickRole);
    setPassword("Password123!");
  };

  return (
    <section className="login-shell">
      <div className="login-brand">
        <p className="eyebrow">Predictive Care Operating Layer</p>
        <h1>Axxess Sentinel</h1>
        <p>
          Real-time wearable monitoring and risk forecasting with strict caregiver assignment controls and
          auditability.
        </p>
        <div className="demo-buttons">
          <button type="button" onClick={() => quickFill("Patient")} className="ghost">
            Use Patient Demo
          </button>
          <button type="button" onClick={() => quickFill("Caregiver")} className="ghost">
            Use Caregiver Demo
          </button>
        </div>
      </div>

      <form className="login-card" onSubmit={onSubmit}>
        <div className="auth-mode-toggle">
          <button
            type="button"
            className={mode === "login" ? "primary" : "ghost"}
            onClick={() => setMode("login")}
          >
            Sign In
          </button>
          <button
            type="button"
            className={mode === "signup" ? "primary" : "ghost"}
            onClick={() => setMode("signup")}
          >
            Sign Up
          </button>
        </div>
        {mode === "signup" ? (
          <>
            <label>
              Full Name
              <input
                type="text"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                required
                autoComplete="name"
              />
            </label>
            <label>
              Role
              <select value={role} onChange={(event) => setRole(event.target.value as Role)}>
                <option value="Patient">Patient</option>
                <option value="Caregiver">Caregiver</option>
              </select>
            </label>
          </>
        ) : null}
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoComplete="email"
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            autoComplete="current-password"
          />
        </label>
        {error ? <p className="error-line">{error}</p> : null}
        <button type="submit" className="primary" disabled={submitting}>
          {submitting ? "Processing..." : mode === "login" ? "Secure Sign In" : "Create Account"}
        </button>
        <p className="assistive">
          New users are routed into role-based onboarding. Auto logout after inactivity is enforced.
        </p>
      </form>
    </section>
  );
}
