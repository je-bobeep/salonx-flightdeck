"use client";

import * as React from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useLinkage } from "@/lib/queries/data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AgingBadges } from "./AgingBadge";
import { HeadlineNumber } from "./HeadlineNumber";
import { RisingBadge } from "./RisingBadge";
import { ArrowRight, ChevronDown, ChevronRight, Wand2 } from "lucide-react";
import type {
  BdRow,
  CoverageEntry,
  DevRow,
  LinkageData,
} from "@/lib/data-shapes";
import { isActive } from "@/lib/status";
import { formatLarkDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export function LinkageView() {
  const { data, isLoading, error } = useLinkage();

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

  // Coverage % of Immediate-priority BD rows: linked / (linked + unlinked).
  const allBd = Object.values(data.bdById);
  const immediateAll = allBd.filter((b) => b.priority === "Immediate");
  const immediateLinked = data.pairs.filter(
    (p) => p.bd.priority === "Immediate"
  );
  const immediateLinkedIds = new Set(
    immediateLinked.map((p) => p.bd.recordId)
  );
  const immediateLinkedCount = immediateLinkedIds.size;
  const immediateTotal = Math.max(immediateAll.length, immediateLinkedCount);
  const coveragePct =
    immediateTotal === 0
      ? null
      : Math.round((immediateLinkedCount / immediateTotal) * 100);

  const activePairs = data.pairs.filter((p) => isActive(p.dev.status));
  const archivePairs = data.pairs.filter((p) => !isActive(p.dev.status));

  return (
    <div className="flex flex-col gap-6">
      {coveragePct !== null ? (
        <HeadlineNumber
          value={`${coveragePct}%`}
          label="Coverage of Immediate-priority BD rows"
          helper={`${immediateLinkedCount} of ${immediateTotal} are linked to a Feature Dev ticket.`}
          tone={
            coveragePct >= 90
              ? "success"
              : coveragePct >= 70
                ? "warn"
                : "danger"
          }
        />
      ) : null}

      <Section
        title="Coverage by theme"
        count={data.coverage.length}
        helper="How well each user-facing theme is served by Feature Dev work. Themes are clustered from BD feedback."
      >
        {data.coverage.length === 0 ? (
          data.themesUnavailable ? (
            <p className="px-4 py-6 text-center text-sm text-amber-800">
              Theme clustering is unavailable — open Triage and click{" "}
              <em>Re-cluster</em> to recompute.
            </p>
          ) : (
            <p className="px-4 py-6 text-center text-sm text-neutral-500">
              No theme cluster cached yet — open Triage and click{" "}
              <em>Re-cluster</em> on the Top themes card to generate one.
            </p>
          )
        ) : (
          <ul className="divide-y divide-neutral-100">
            {data.coverage.map((c) => (
              <CoverageCard
                key={c.theme.id}
                entry={c}
                bdById={data.bdById}
                pushDev={data.orphanDevByTheme?.[c.theme.id] ?? []}
              />
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Active linkages"
        count={activePairs.length}
        helper="BD rows whose Dev work is still in flight (not Released)."
      >
        <ul className="divide-y divide-neutral-100">
          {activePairs.map(({ bd, dev }) => (
            <PairRow
              key={`${bd.recordId}:${dev.recordId}`}
              bd={bd}
              dev={dev}
              active
            />
          ))}
        </ul>
      </Section>

      <Section
        title="Tickets without feedback"
        count={data.orphanDev.length}
        helper="Dev work without a BD source. Often planned-from-strategy or tech-debt."
      >
        <ul className="divide-y divide-neutral-100">
          {data.orphanDev.map((dev) => (
            <DevOnly key={dev.recordId} dev={dev} />
          ))}
        </ul>
      </Section>

      <Section
        title="Archive (released linkages)"
        count={archivePairs.length}
        helper="Linked pairs whose Dev work has shipped."
        defaultCollapsed
      >
        <ul className="divide-y divide-neutral-100">
          {archivePairs.map(({ bd, dev }) => (
            <PairRow
              key={`${bd.recordId}:${dev.recordId}`}
              bd={bd}
              dev={dev}
            />
          ))}
        </ul>
      </Section>
    </div>
  );
}

function Section({
  title,
  count,
  helper,
  children,
  defaultCollapsed = false,
}: {
  title: string;
  count: number;
  helper: string;
  children: React.ReactNode;
  defaultCollapsed?: boolean;
}) {
  const [open, setOpen] = React.useState(!defaultCollapsed);
  return (
    <section className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-card">
      <header
        className="flex cursor-pointer items-baseline justify-between border-b border-neutral-100 px-4 py-2 hover:bg-neutral-50"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>
          <span className="text-xs text-neutral-500">{count}</span>
        </div>
        <p className="text-xs text-neutral-500">
          {helper} {open ? "" : "(click to expand)"}
        </p>
      </header>
      {open ? (
        count === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-neutral-500">none</p>
        ) : (
          children
        )
      ) : null}
    </section>
  );
}

function CoverageCard({
  entry,
  bdById,
  pushDev,
}: {
  entry: CoverageEntry;
  bdById: LinkageData["bdById"];
  pushDev: DevRow[];
}) {
  const [expanded, setExpanded] = React.useState(false);
  const total = entry.coveredBdCount + entry.uncoveredBdCount;
  const coveredPct = total === 0 ? 0 : entry.coveredBdCount / total;
  const tone =
    coveredPct >= 0.8
      ? "bg-green-500"
      : coveredPct >= 0.4
        ? "bg-amber-500"
        : "bg-red-500";

  return (
    <li className="px-4 py-3">
      <button
        type="button"
        className="flex w-full items-start gap-3 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="mt-0.5 text-neutral-400">
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-neutral-900">
              {entry.theme.name}
            </h3>
            {entry.theme.rising ? <RisingBadge /> : null}
            <span className="text-xs text-neutral-500">
              {entry.coveredBdCount} covered · {entry.uncoveredBdCount}{" "}
              uncovered
            </span>
          </div>
          {entry.theme.description ? (
            <p className="mt-0.5 text-xs text-neutral-500">
              {entry.theme.description}
            </p>
          ) : null}
          {/* Coverage bar */}
          {total > 0 ? (
            <div className="mt-2 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-neutral-100">
              <div
                className={cn("h-full", tone)}
                style={{ width: `${Math.round(coveredPct * 100)}%` }}
              />
            </div>
          ) : null}
        </div>
      </button>

      {expanded ? (
        <div className="mt-3 ml-7 grid gap-3 text-sm">
          {entry.devTickets.length > 0 ? (
            <div>
              <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                Linked Dev tickets
              </h4>
              <ul className="divide-y divide-neutral-100 rounded-md border border-neutral-200">
                {entry.devTickets.map((d) => (
                  <CoverageDevRow key={d.recordId} ticket={d} />
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-xs text-neutral-500">
              No Dev ticket covers this theme yet.
            </p>
          )}
          {entry.uncoveredBdIds.length > 0 ? (
            <div>
              <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                Uncovered BD rows ({entry.uncoveredBdIds.length})
              </h4>
              <ul className="divide-y divide-neutral-100 rounded-md border border-neutral-200">
                {entry.uncoveredBdIds.map((id) => {
                  const bd = bdById[id];
                  if (!bd) return null;
                  return <CoverageBdRow key={id} bd={bd} />;
                })}
              </ul>
            </div>
          ) : null}
          {pushDev.length > 0 ? (
            <div>
              <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                Push (no BD link) ({pushDev.length})
              </h4>
              <ul className="divide-y divide-neutral-100 rounded-md border border-neutral-200">
                {pushDev.map((d) => (
                  <CoveragePushDevRow key={d.recordId} dev={d} />
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function CoveragePushDevRow({ dev }: { dev: DevRow }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function open() {
    const next = new URLSearchParams(searchParams.toString());
    next.set("panel", dev.recordId);
    next.set("kind", "dev");
    next.delete("flow");
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <li
      className="grid grid-cols-[1fr_auto_auto_auto] items-baseline gap-3 px-3 py-2 text-xs cursor-pointer hover:bg-neutral-50"
      onClick={open}
    >
      <span className="truncate text-neutral-800">{dev.description}</span>
      <Badge tone="neutral">{dev.status || "—"}</Badge>
      <span className="text-neutral-500">ETA {formatLarkDate(dev.eta)}</span>
      <span className="text-neutral-500">
        Rel {formatLarkDate(dev.releaseDate)}
      </span>
    </li>
  );
}

function CoverageDevRow({
  ticket,
}: {
  ticket: CoverageEntry["devTickets"][number];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function open() {
    const next = new URLSearchParams(searchParams.toString());
    next.set("panel", ticket.recordId);
    next.set("kind", "dev");
    next.delete("flow");
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <li
      className="grid grid-cols-[1fr_auto_auto_auto] items-baseline gap-3 px-3 py-2 text-xs cursor-pointer hover:bg-neutral-50"
      onClick={open}
    >
      <span className="truncate text-neutral-800">{ticket.description}</span>
      <Badge tone="neutral">{ticket.status || "—"}</Badge>
      <span className="text-neutral-500">ETA {formatLarkDate(ticket.eta)}</span>
      <span className="text-neutral-500">
        Rel {formatLarkDate(ticket.releaseDate)}
      </span>
    </li>
  );
}

function CoverageBdRow({ bd }: { bd: BdRow }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function open() {
    const next = new URLSearchParams(searchParams.toString());
    next.set("panel", bd.recordId);
    next.set("kind", "bd");
    next.delete("flow");
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <li
      className="grid grid-cols-[6ch_1fr_auto] items-baseline gap-3 px-3 py-2 text-xs cursor-pointer hover:bg-neutral-50"
      onClick={open}
    >
      <span className="font-mono text-neutral-500">#{bd.number}</span>
      <span className="truncate text-neutral-800">
        {bd.translate || bd.item}
      </span>
      <span className="flex items-center gap-1.5">
        {bd.priority ? <Badge tone="neutral">{bd.priority}</Badge> : null}
        {bd.fromPocMerchant ? <Badge tone="accent">POC</Badge> : null}
        {bd.ageDays !== null ? (
          <span className="text-neutral-500">{bd.ageDays}d</span>
        ) : null}
      </span>
    </li>
  );
}

function PairRow({
  bd,
  dev,
  active = false,
}: {
  bd: BdRow;
  dev: DevRow;
  active?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function openPair(autoSanity = false) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("panel", `${bd.recordId}+${dev.recordId}`);
    next.set("kind", "pair");
    if (autoSanity) next.set("flow", "pair-sanity");
    else next.delete("flow");
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <li
      className="grid grid-cols-[1fr_auto_1fr_auto_auto] items-start gap-3 px-4 py-3 cursor-pointer hover:bg-neutral-50"
      onClick={() => openPair(false)}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-xs text-neutral-500">
          <span className="font-mono">BD #{bd.number}</span>
          {bd.priority ? <Badge tone="neutral">{bd.priority}</Badge> : null}
          {bd.fromPocMerchant ? <Badge tone="accent">POC</Badge> : null}
        </div>
        <div className="mt-0.5 truncate text-sm text-neutral-800">
          {bd.translate || bd.item}
        </div>
      </div>
      <ArrowRight className="mt-1 h-4 w-4 text-neutral-300" />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-xs text-neutral-500">
          <span>Dev</span>
          <Badge tone={active ? "accent" : "success"}>{dev.status || "—"}</Badge>
          {dev.sprint ? <span className="font-mono">{dev.sprint}</span> : null}
        </div>
        <div className="mt-0.5 truncate text-sm text-neutral-800">
          {dev.description}
        </div>
      </div>
      <div className="flex flex-col items-end text-[11px] text-neutral-500">
        <span>ETA {formatLarkDate(dev.eta)}</span>
        <span>Rel {formatLarkDate(dev.releaseDate)}</span>
      </div>
      <div className="flex shrink-0 items-start" onClick={(e) => e.stopPropagation()}>
        {active ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => openPair(true)}
            title="Run pair-sanity check"
          >
            <Wand2 className="h-3.5 w-3.5" />
            Sanity
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function DevOnly({ dev }: { dev: DevRow }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  function open() {
    const next = new URLSearchParams(searchParams.toString());
    next.set("panel", dev.recordId);
    next.set("kind", "dev");
    next.delete("flow");
    router.push(`${pathname}?${next.toString()}`);
  }
  return (
    <li
      className="grid grid-cols-[1fr_auto_auto] items-start gap-3 px-4 py-3 cursor-pointer hover:bg-neutral-50"
      onClick={open}
    >
      <div className="min-w-0">
        <div className="truncate text-sm text-neutral-800">{dev.description}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-neutral-500">
          <Badge tone="neutral">{dev.status || "—"}</Badge>
          {dev.milestone ? (
            <span className="truncate" title={dev.milestone}>
              {dev.milestone}
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex flex-col items-end text-[11px] text-neutral-500">
        <span>ETA {formatLarkDate(dev.eta)}</span>
        <span>Rel {formatLarkDate(dev.releaseDate)}</span>
      </div>
      <AgingBadges signals={dev.aging} />
    </li>
  );
}
