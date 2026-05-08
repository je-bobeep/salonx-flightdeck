"use client";

import { useQuery } from "@tanstack/react-query";
import { useSessions } from "@/lib/queries/data";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { useRouter } from "next/navigation";
import type { SessionRow } from "@/lib/data-shapes";

type TelemetryRollup = {
  daysBack: number;
  totalSessions: number;
  byFlowType: Record<string, number>;
  sessionsWithProposal: number;
  approvedActions: number;
  rejectedActions: number;
  abandonedSessions: number;
  avgUserTurns: number;
};

function ScopingUsageTile() {
  const { data, isLoading, error } = useQuery<{
    ok: boolean;
    rollup: TelemetryRollup;
  }>({
    queryKey: ["scoping-telemetry", 30],
    queryFn: async () => {
      const res = await fetch("/api/data/scoping-telemetry?days=30", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    },
    staleTime: 60_000,
  });

  if (isLoading || !data?.ok) {
    return (
      <p className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-[11px] text-neutral-500">
        Loading scope-usage stats…{error ? " (failed)" : ""}
      </p>
    );
  }
  const r = data.rollup;
  const approvalRate =
    r.totalSessions > 0
      ? Math.round((r.approvedActions / r.totalSessions) * 100)
      : 0;
  return (
    <div
      className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-[11px] text-neutral-700"
      title="Scope feature is on probation. These numbers feed the keep/kill decision."
    >
      <span className="font-medium">Last {r.daysBack}d:</span>{" "}
      {r.totalSessions} session{r.totalSessions === 1 ? "" : "s"} ·{" "}
      {r.sessionsWithProposal} with proposal ·{" "}
      <span
        className={
          r.approvedActions > 0
            ? "text-neutral-900 font-medium"
            : "text-amber-700"
        }
      >
        {r.approvedActions} approved
      </span>{" "}
      ({approvalRate}%) · {r.abandonedSessions} abandoned · avg{" "}
      {r.avgUserTurns} turns/session
    </div>
  );
}

const FLOW_LABELS: Record<string, string> = {
  "bd-to-dev": "BD → Dev ticket",
  "pair-sanity": "Pair sanity check",
  "weekly-review": "Weekly review",
};

/** Pick the route + query that re-opens the slide-over panel attached to this
 * session. Without this, closing the panel abandons the session — which is
 * the literal opposite of the Sessions view's JTBD. */
function resumeHrefFor(s: SessionRow): string {
  const params = new URLSearchParams();
  params.set("session", s.id);
  if (s.flowType === "weekly-review") {
    return `/sprint?${params.toString()}`;
  }
  if (s.ticketRecordId && s.ticketKind) {
    if (s.ticketKind === "pair") {
      // ticket_record_id format: bdId+devId
      const [bdId, devId] = s.ticketRecordId.split("+");
      if (bdId && devId) {
        params.set("panel", bdId);
        params.set("kind", "pair");
        params.set("pair", devId);
      }
    } else {
      params.set("panel", s.ticketRecordId);
      params.set("kind", s.ticketKind);
    }
  }
  // bd-to-dev panels live on /triage; pair-sanity panels live on /linkage.
  const base = s.flowType === "pair-sanity" ? "/linkage" : "/triage";
  return `${base}?${params.toString()}`;
}

export function SessionsView() {
  const router = useRouter();
  const { data, isLoading, error } = useSessions();

  if (isLoading) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-6 text-sm text-neutral-500">
        Loading…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        {error instanceof Error ? error.message : String(error)}
      </div>
    );
  }
  const sessions = data?.sessions ?? [];

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <ScopingUsageTile />
        <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-10 text-center text-sm text-neutral-500">
          No scoping sessions yet. Open a row in Triage or Linkage to start one.
        </div>
      </div>
    );
  }

  // Surface sessions with pending approvals first — this is the inbox view.
  const ordered = sessions
    .slice()
    .sort((a, b) => {
      const ap = a.pendingActions ?? 0;
      const bp = b.pendingActions ?? 0;
      if (ap !== bp) return bp - ap;
      return b.updatedAtMs - a.updatedAtMs;
    });

  return (
    <div className="flex flex-col gap-3">
      <ScopingUsageTile />
      <section className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-card">
        <ul className="divide-y divide-neutral-100">
        {ordered.map((s) => (
          <li
            key={s.id}
            onClick={() => router.push(resumeHrefFor(s))}
            className="grid cursor-pointer grid-cols-[auto_1fr_auto_auto_auto_auto] items-center gap-3 px-4 py-3 hover:bg-neutral-50"
          >
            <Badge tone="accent">{FLOW_LABELS[s.flowType] ?? s.flowType}</Badge>
            <div className="min-w-0">
              <div className="truncate text-sm text-neutral-800">
                {s.ticketTitle ||
                  (s.ticketRecordId
                    ? `Ticket ${s.ticketRecordId}`
                    : "(detached)")}
              </div>
              <div className="text-xs text-neutral-500">
                Model: <span className="font-mono">{s.model}</span>
              </div>
            </div>
            {s.pendingActions > 0 ? (
              <Badge tone="warn">
                {s.pendingActions} pending
              </Badge>
            ) : (
              <span />
            )}
            <Badge tone={s.status === "active" ? "warn" : "neutral"}>
              {s.status}
            </Badge>
            <span className="text-xs text-neutral-500">
              {formatDistanceToNow(s.updatedAtMs, { addSuffix: true })}
            </span>
            <a
              href={`/sessions/${s.id}`}
              onClick={(e) => e.stopPropagation()}
              className="text-[11px] text-neutral-500 underline-offset-2 hover:text-neutral-900 hover:underline"
              title="Timeline / debug view — every message + proposal in chronological order"
            >
              timeline
            </a>
          </li>
        ))}
        </ul>
      </section>
    </div>
  );
}
