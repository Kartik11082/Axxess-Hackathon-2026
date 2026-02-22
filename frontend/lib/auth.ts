import { AuthUser } from "./types";

const TOKEN_KEY = "axxess_token";
const USER_KEY = "axxess_user";

export function saveSession(token: string, user: AuthUser): void {
  if (typeof window === "undefined") {
    return;
  }
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser(): AuthUser | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = localStorage.getItem(USER_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  if (typeof window === "undefined") {
    return;
  }
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function updateSessionUser(nextUser: AuthUser): void {
  if (typeof window === "undefined") {
    return;
  }
  localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
}

export function getRouteForUser(user: AuthUser): string {
  if (!user.onboardingCompleted) {
    return user.role === "Patient" ? "/onboarding/patient" : "/onboarding/caregiver";
  }
  return user.role === "Patient" ? "/patient" : "/caregiver";
}
