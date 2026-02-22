"use client";

import { ReactNode, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api";
import { clearSession, getToken, getRouteForUser, getUser } from "@/lib/auth";
import { OnboardingStatus, Role } from "@/lib/types";

interface AuthGateProps {
  allowedRole: Role;
  children: ReactNode;
}

export function AuthGate({ allowedRole, children }: AuthGateProps) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const token = getToken();
    const user = getUser();
    if (!token || !user) {
      router.replace("/");
      return;
    }

    if (user.role !== allowedRole) {
      router.replace(user.role === "Patient" ? "/patient" : "/caregiver");
      return;
    }

    apiRequest<{ user: { role: Role; onboardingCompleted: boolean }; onboarding: OnboardingStatus }>("/api/auth/me")
      .then((response) => {
        if (response.user.role !== allowedRole) {
          router.replace("/");
          return;
        }
        if (!response.user.onboardingCompleted) {
          router.replace(getRouteForUser({ ...user, onboardingCompleted: false }));
          return;
        }
        setAllowed(true);
      })
      .catch(() => {
        clearSession();
        router.replace("/");
      });
  }, [allowedRole, router]);

  if (!allowed) {
    return (
      <div className="full-center">
        <div className="loading-card">Validating secure session...</div>
      </div>
    );
  }

  return <>{children}</>;
}
