"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useToday } from "@/lib/queries/data";
import { HeadlineNumber } from "./HeadlineNumber";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, Wand2, FileText } from "lucide-react";
import type { DecisionsListResponse } from "@/lib/decisions-shapes";

export function TodayView() {
  const { data, isLoading, error } = useToday();

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

  const { bd, sprint, roadmap } = data;

  // Pick the single most actionable headline. Priority order:
  // 1. Sprint-no-ETA (commitment-not-credible) — most urgent
  // 2. BD stale >30d — long-tail merchant ask sitting
  // 3. Immediate coverage gap
  // 4. Rising themes not on roadmap
  // 5. "All clear" celebration
  const headline = pickHeadline(data);

  return (
    <div className="flex flex-col gap-6">
      <HeadlineNumber {...headline} />

      <div className="grid gap-4 md:grid-cols-2">
        {/* Triage briefing */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>BD Feedback queue</CardTitle>
              <Link
                href="/triage"
                className="text-xs text-neutral-500 hover:text-neutral-900"
              >
                Open triage →
              </Link>
            </div>
          </CardHeader>
          <CardBody className="flex flex-col gap-2 text-sm">
            <Stat label="Unaddressed" value={bd.unaddressed} />
            <Stat
              label="From POC merchant"
              value={bd.pocCount}
              tone={bd.pocCount > 0 ? "accent" : "neutral"}
              helper="Higher signal — merchant directly asked"
            />
            <Stat
              label="Stale 14–30 days"
              value={bd.stale14d}
              tone={bd.stale14d > 0 ? "warn" : "neutral"}
            />
            <Stat
              label="Stale > 30 days"
              value={bd.stale30d}
              tone={bd.stale30d > 0 ? "danger" : "neutral"}
              helper="You've forgotten about these"
            />
            <Stat
              label="Filed in last 7 days"
              value={bd.newLast7d}
              tone="neutral"
            />
          </CardBody>
        </Card>

        {/* Sprint briefing */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>
                {sprint.label
                  ? `Current sprint — ${sprint.label}`
                  : "Current sprint"}
              </CardTitle>
              <Link
                href="/sprint"
                className="text-xs text-neutral-500 hover:text-neutral-900"
              >
                Open sprint →
              </Link>
            </div>
          </CardHeader>
          <CardBody className="flex flex-col gap-2 text-sm">
            <Stat label="Active tickets" value={sprint.active} helper={`of ${sprint.total} total in sprint`} />
            <Stat
              label="Without ETA"
              value={sprint.noEta}
              tone={sprint.noEta > 0 ? "danger" : "success"}
              helper={
                sprint.active > 0
                  ? `${sprint.active === 0 ? 0 : Math.round((sprint.noEta / sprint.active) * 100)}% of active`
                  : ""
              }
            />
            <Stat
              label="Stuck > 7 days"
              value={sprint.stuck}
              tone={sprint.stuck > 0 ? "warn" : "success"}
            />
            <Stat
              label="Without milestone"
              value={sprint.noMilestone}
              tone={sprint.noMilestone > 0 ? "warn" : "neutral"}
            />
            <div className="pt-1">
              <Link href="/sprint?flow=weekly-review">
                <Button size="sm" variant="secondary">
                  <FileText className="h-3.5 w-3.5" />
                  Draft weekly stakeholder update
                </Button>
              </Link>
            </div>
          </CardBody>
        </Card>

        {/* Roadmap briefing */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Roadmap shape</CardTitle>
              <Link
                href="/roadmap"
                className="text-xs text-neutral-500 hover:text-neutral-900"
              >
                Open roadmap →
              </Link>
            </div>
          </CardHeader>
          <CardBody className="flex flex-col gap-2 text-sm">
            <Stat
              label="Rising themes not on roadmap"
              value={roadmap.risingNotOnRoadmap}
              tone={roadmap.risingNotOnRoadmap > 0 ? "warn" : "success"}
              helper={
                roadmap.risingNotOnRoadmap > 0
                  ? "Demand is rising but no Dev ticket exists yet"
                  : "Every rising theme has at least one ticket queued"
              }
            />
            <Stat
              label="Aging themes with zero coverage"
              value={roadmap.uncoveredImmediateThemes}
              tone={
                roadmap.uncoveredImmediateThemes > 0 ? "danger" : "success"
              }
              helper="Themes where the median BD age is > 14d AND no Dev ticket covers them"
            />
          </CardBody>
        </Card>

        {/* Coverage briefing */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Coverage</CardTitle>
              <Link
                href="/linkage"
                className="text-xs text-neutral-500 hover:text-neutral-900"
              >
                Open linkage →
              </Link>
            </div>
          </CardHeader>
          <CardBody className="flex flex-col gap-2 text-sm">
            <Stat
              label="Immediate BD coverage"
              value={
                bd.immediateCoveragePct === null
                  ? "—"
                  : `${bd.immediateCoveragePct}%`
              }
              tone={
                bd.immediateCoveragePct === null
                  ? "neutral"
                  : bd.immediateCoveragePct >= 90
                    ? "success"
                    : bd.immediateCoveragePct >= 70
                      ? "warn"
                      : "danger"
              }
              helper={`${bd.immediateLinked} of ${bd.immediateTotal} Immediate-priority BD rows linked to a Dev ticket`}
            />
          </CardBody>
        </Card>

        {/* Decisions captured this week — a recency cue, not a target. */}
        <DecisionsThisWeekTile />
      </div>
    </div>
  );
}

/** Small peer tile that counts decisions whose frontmatter.date falls in the
 * current ISO Mon-Sun window. Reuses the `["decisions"]` query key so it
 * shares cache with the /decisions page hook. */
function DecisionsThisWeekTile() {
  const { data, isLoading } = useQuery<DecisionsListResponse>({
    queryKey: ["decisions"],
    queryFn: async () => {
      const res = await fetch("/api/data/decisions", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as DecisionsListResponse;
    },
    staleTime: 60_000,
  });

  const { start, end } = isoWeekBounds(new Date());
  const count =
    data && data.ok
      ? data.decisions.filter((d) => {
          const ds = d.frontmatter.date;
          return ds >= start && ds <= end;
        }).length
      : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Decisions log</CardTitle>
          <Link
            href="/decisions?range=this-week"
            className="text-xs text-neutral-500 hover:text-neutral-900"
          >
            Open log →
          </Link>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-2 text-sm">
        <Stat
          label="Captured this week"
          value={isLoading ? "…" : count}
          tone="neutral"
          helper="Mon–Sun. A recency cue — not a target."
        />
      </CardBody>
    </Card>
  );
}

/** ISO week (Mon-Sun) bounds for the given date, returned as YYYY-MM-DD
 * strings so we can compare directly against frontmatter.date strings. */
function isoWeekBounds(now: Date): { start: string; end: string } {
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const day = d.getUTCDay(); // 0=Sun ... 6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const start = new Date(d);
  start.setUTCDate(d.getUTCDate() + diffToMonday);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  const fmt = (x: Date) => x.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

function Stat({
  label,
  value,
  helper,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  helper?: string;
  tone?: "neutral" | "warn" | "danger" | "accent" | "success";
}) {
  const toneColor =
    tone === "danger"
      ? "text-red-700"
      : tone === "warn"
        ? "text-amber-700"
        : tone === "accent"
          ? "text-blue-700"
          : tone === "success"
            ? "text-green-700"
            : "text-neutral-900";
  return (
    <div className="flex items-baseline justify-between gap-2">
      <div className="flex flex-col">
        <span className="text-sm text-neutral-700">{label}</span>
        {helper ? (
          <span className="text-xs text-neutral-500">{helper}</span>
        ) : null}
      </div>
      <span className={`tabular-nums text-base font-semibold ${toneColor}`}>
        {value}
      </span>
    </div>
  );
}

function pickHeadline(data: import("@/lib/data-shapes").TodayData) {
  const { bd, sprint, roadmap } = data;
  const sprintLabel = sprint.label ?? "current sprint";

  // The dashboard exists to prevent merchant asks from quietly lapsing — so
  // the long-tail "stale > 30d" signal outranks anything else when the queue
  // has actually rotted.
  if (bd.stale30d > 10) {
    return {
      value: bd.stale30d,
      label: "BD feedback rows over 30 days unaddressed",
      helper: "These are the merchant asks you've quietly let lapse.",
      tone: "danger" as const,
      cta: (
        <Link href="/triage">
          <Button size="sm">
            Open triage <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </Link>
      ),
    };
  }

  // POC-merchant aged rows are the "did we forget Asano-san's request" signal
  // — the original reason this dashboard exists. Rank above sprint hygiene.
  if (bd.pocStale >= 3) {
    return {
      value: bd.pocStale,
      label: "POC merchant rows aged > 14d",
      helper:
        "Asano-san's POC merchants asked for these and we haven't acted. High signal of slipping trust.",
      tone: "warn" as const,
      cta: (
        <Link href="/triage">
          <Button size="sm" variant="secondary">
            Open triage <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </Link>
      ),
    };
  }

  // Sprint hygiene only fires when the sprint is non-trivial — small sprints
  // (1-2 active tickets) constantly trip 50% with one re-estimate, drowning
  // the headline in noise.
  if (
    sprint.active >= 5 &&
    sprint.noEta >= 3 &&
    sprint.noEta / Math.max(sprint.active, 1) >= 0.5
  ) {
    return {
      value: sprint.noEta,
      unit: `of ${sprint.active}`,
      label: `${sprintLabel} tickets without an ETA`,
      helper:
        "Sprint commitment isn't credible without ETAs. Triage them or push to next sprint.",
      tone: "danger" as const,
      cta: (
        <Link href="/sprint">
          <Button size="sm">
            Fix in sprint view <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </Link>
      ),
    };
  }

  if (bd.stale30d > 0) {
    return {
      value: bd.stale30d,
      label: "BD feedback rows over 30 days unaddressed",
      helper: "These are the merchant asks you've quietly let lapse.",
      tone: "warn" as const,
      cta: (
        <Link href="/triage">
          <Button size="sm" variant="secondary">
            Open triage <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </Link>
      ),
    };
  }

  if (
    bd.immediateCoveragePct !== null &&
    bd.immediateCoveragePct < 80
  ) {
    return {
      value: `${bd.immediateCoveragePct}%`,
      label: "Coverage of Immediate-priority BD rows",
      helper: `${bd.immediateLinked} of ${bd.immediateTotal} are linked to a Dev ticket. Below 80% means triage backlog.`,
      tone: "warn" as const,
      cta: (
        <Link href="/linkage">
          <Button size="sm" variant="secondary">
            Open linkage <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </Link>
      ),
    };
  }

  // Rising signal is only meaningful when we actually clustered with Claude;
  // the deterministic fallback bakes `rising:false` into every theme, so a
  // "0 rising" headline would be a false all-clear.
  if (roadmap.risingNotOnRoadmap > 0 && !roadmap.fallbackThemes) {
    return {
      value: roadmap.risingNotOnRoadmap,
      label: "Rising themes not on the roadmap",
      helper: "Demand is climbing in BD feedback, but no Dev ticket has been queued yet.",
      tone: "warn" as const,
      cta: (
        <Link href="/roadmap">
          <Button size="sm" variant="secondary">
            Open roadmap <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </Link>
      ),
    };
  }

  return {
    value: "All clear",
    label: "No urgent decisions waiting",
    helper:
      "Triage is empty, sprint commitments look credible, coverage is healthy. Good time to scope something.",
    tone: "success" as const,
    cta: (
      <Link href="/triage">
        <Button size="sm" variant="secondary">
          <Wand2 className="h-3.5 w-3.5" />
          Scan triage anyway
        </Button>
      </Link>
    ),
  };
}
