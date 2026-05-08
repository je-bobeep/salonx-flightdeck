"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSprint } from "@/lib/queries/data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AgingBadges } from "./AgingBadge";
import { HeadlineNumber } from "./HeadlineNumber";
import { isActive, statusBucket } from "@/lib/status";
import { FileText } from "lucide-react";
import type { DevRow } from "@/lib/data-shapes";
import { formatLarkDate } from "@/lib/format";

const STATUS_TONE: Record<string, "neutral" | "accent" | "warn" | "success"> = {
  "Pending PM PRD": "neutral",
  "Pending PRD": "neutral",
  "Ready for Development": "accent",
  Ready: "accent",
  "In Progress": "accent",
  "In Review": "warn",
  "In Testing": "warn",
  "Ready for Release": "warn",
  Done: "success",
  Released: "success",
};

export function SprintView() {
  const { data, isLoading, error } = useSprint();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [starting, setStarting] = React.useState(false);
  const [startError, setStartError] = React.useState<string | null>(null);

  async function startWeeklyReview() {
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch("/api/scoping/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flowType: "weekly-review" }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setStartError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      const j = (await res.json()) as { sessionId: string };
      const next = new URLSearchParams(searchParams.toString());
      next.set("session", j.sessionId);
      router.push(`${pathname}?${next.toString()}`);
    } catch (e) {
      setStartError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }

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
  if (!data) return null;

  // Compute current-sprint metrics for the headline
  const current = data.sprints[0];
  const currentRows = current?.assignees.flatMap((a) => a.rows) ?? [];
  const currentActive = currentRows.filter((r) => isActive(r.status));
  // `noEta` = no internal target AND no external ETA. Internal target is the
  // planning-relevant date (merge plan); external is the commitment.
  const noEta = currentActive.filter(
    (r) => !r.internalTargetDate && !r.eta
  ).length;
  const stuck = currentActive.filter((r) =>
    r.aging.some((s) => s.kind === "dev-status-stale")
  ).length;
  const noEtaPct =
    currentActive.length === 0
      ? 0
      : Math.round((noEta / currentActive.length) * 100);

  const headline =
    currentActive.length === 0
      ? null
      : noEtaPct >= 50
        ? {
            value: noEta,
            unit: `of ${currentActive.length}`,
            label: `${current?.label ?? "Current sprint"} tickets without an ETA`,
            helper:
              "Sprint commitment isn't credible without ETAs. Triage them or push to next sprint.",
            tone: "danger" as const,
          }
        : stuck > 0
          ? {
              value: stuck,
              label: "Tickets stuck > 7 days in active sprint",
              helper:
                "These haven't moved status in over a week. Worth a sprint check-in.",
              tone: "warn" as const,
            }
          : {
              value: currentActive.length,
              label: `Active tickets in ${current?.label ?? "current sprint"}`,
              helper: "All active tickets have ETAs. Sprint commitment looks credible.",
              tone: "success" as const,
            };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          {headline ? (
            <HeadlineNumber
              {...headline}
              cta={
                <Button onClick={startWeeklyReview} disabled={starting}>
                  <FileText className="h-3.5 w-3.5" />
                  {starting ? "Starting…" : "Draft weekly update"}
                </Button>
              }
            />
          ) : null}
          {startError ? (
            <div className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">
              {startError}
            </div>
          ) : null}
        </div>
      </div>

      {data.sprints.length === 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-6 text-sm text-neutral-500">
          No sprint data — make sure the Sprint field is populated on Feature Dev rows.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.sprints.map((s, i) => (
            <SprintColumn
              key={s.label}
              label={s.label}
              tag={i === 0 ? "This week" : "Next"}
              assignees={s.assignees}
            />
          ))}
          {data.sprints.length === 1 ? (
            <NoNextSprintPlaceholder />
          ) : null}
        </div>
      )}
    </div>
  );
}

function NoNextSprintPlaceholder() {
  return (
    <section className="overflow-hidden rounded-lg border border-dashed border-neutral-300 bg-white">
      <header className="flex items-baseline gap-2 border-b border-neutral-100 px-4 py-2">
        <Badge tone="neutral">Next</Badge>
        <span className="text-xs text-neutral-500">not detected</span>
      </header>
      <div className="px-4 py-6 text-center text-sm text-neutral-500">
        No tickets pulled into a future Sprint label yet.
      </div>
    </section>
  );
}

function SprintColumn({
  label,
  tag,
  assignees,
}: {
  label: string;
  tag: string;
  assignees: { name: string; rows: DevRow[] }[];
}) {
  const total = assignees.reduce((acc, a) => acc + a.rows.length, 0);
  const active = assignees.reduce(
    (acc, a) => acc + a.rows.filter((r) => isActive(r.status)).length,
    0
  );
  return (
    <section className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-card">
      <header className="flex items-baseline justify-between border-b border-neutral-100 px-4 py-2">
        <div className="flex items-baseline gap-2">
          <Badge tone="accent">{tag}</Badge>
          <span className="font-mono text-xs text-neutral-700">{label}</span>
        </div>
        <span className="text-xs text-neutral-500">
          {active} active · {total} total
        </span>
      </header>
      <div className="flex flex-col">
        {assignees.map((a) => (
          <AssigneeBlock key={a.name} name={a.name} rows={a.rows} />
        ))}
      </div>
    </section>
  );
}

function AssigneeBlock({ name, rows }: { name: string; rows: DevRow[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const active = rows.filter((r) => isActive(r.status)).length;
  const inProgress = rows.filter((r) => r.status === "In Progress").length;
  const done = rows.filter((r) => statusBucket(r.status) === "done").length;

  function openDev(devRecordId: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("panel", devRecordId);
    next.set("kind", "dev");
    next.delete("flow");
    router.push(`${pathname}?${next.toString()}`);
  }

  function openPair(bdRecordId: string, devRecordId: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("panel", `${bdRecordId}+${devRecordId}`);
    next.set("kind", "pair");
    next.set("flow", "pair-sanity");
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="border-t border-neutral-100 first:border-t-0">
      <div className="flex items-baseline justify-between bg-neutral-50/60 px-4 py-1.5 text-xs font-medium text-neutral-700">
        <span>{name}</span>
        <span className="text-neutral-500">
          {active} active · {inProgress} in progress · {done} done
        </span>
      </div>
      <ul className="divide-y divide-neutral-100">
        {rows.map((r) => (
          <li
            key={r.recordId}
            className="grid grid-cols-[auto_1fr_auto] items-start gap-2 px-4 py-2 cursor-pointer hover:bg-neutral-50"
            onClick={() => openDev(r.recordId)}
          >
            <Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status || "—"}</Badge>
            <div className="min-w-0">
              <div className="truncate text-sm text-neutral-800" title={r.description}>
                {r.description || "(no description)"}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-neutral-500">
                {r.eta ? (
                  <span>ETA: {formatLarkDate(r.eta)}</span>
                ) : (
                  <Badge tone="warn">no ETA</Badge>
                )}
                {r.bdLinkIds.length > 0 ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openPair(r.bdLinkIds[0], r.recordId);
                    }}
                    className="text-neutral-500 underline-offset-2 hover:text-neutral-900 hover:underline"
                  >
                    pair-sanity
                  </button>
                ) : null}
              </div>
            </div>
            <AgingBadges signals={r.aging} />
          </li>
        ))}
      </ul>
    </div>
  );
}
