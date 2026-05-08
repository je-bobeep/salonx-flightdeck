"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";

type AuthState =
  | { ok: true; name: string | null }
  | { ok: false; reason: "no-token" | "refresh-revoked" | "refresh-expired" | "error"; message?: string };

export function ReauthBanner() {
  const { data } = useQuery<AuthState>({
    queryKey: ["auth-state"],
    queryFn: async () => {
      const res = await fetch("/api/auth/state", { cache: "no-store" });
      return (await res.json()) as AuthState;
    },
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  if (!data || data.ok) return null;

  const reasonLabel: Record<typeof data.reason, string> = {
    "no-token": "Not signed in to Lark.",
    "refresh-revoked": "Lark session expired (refresh token revoked).",
    "refresh-expired": "Lark refresh token expired (>30 days).",
    error: data.message ?? "Couldn't verify Lark sign-in.",
  };

  return (
    <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-800">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span>{reasonLabel[data.reason]}</span>
      <a
        href="/auth/lark/start"
        className="ml-auto rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700"
      >
        Re-authorize
      </a>
    </div>
  );
}
