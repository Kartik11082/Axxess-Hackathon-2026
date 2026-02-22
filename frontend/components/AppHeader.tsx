"use client";

import { clearSession } from "@/lib/auth";
import { useRouter } from "next/navigation";

interface AppHeaderProps {
  title: string;
  subtitle: string;
  status: string;
}

export function AppHeader({ title, subtitle, status }: AppHeaderProps) {
  const router = useRouter();

  const logout = () => {
    clearSession();
    router.push("/");
  };

  return (
    <header className="app-header">
      <div>
        <p className="eyebrow">{subtitle}</p>
        <h1>{title}</h1>
      </div>
      <div className="header-actions">
        <span className="status-chip">{status}</span>
        <button type="button" className="ghost" onClick={logout}>
          Logout
        </button>
      </div>
    </header>
  );
}
