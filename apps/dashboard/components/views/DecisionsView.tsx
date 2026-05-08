"use client";

import * as React from "react";
import Link from "next/link";
import MiniSearch from "minisearch";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  useDecisions,
  useDecisionsSearchIndex,
} from "@/lib/queries/data";
import {
  DECISION_KINDS,
  type DecisionKind,
  type DecisionListItem,
  type DecisionStatus,
} from "@/lib/decisions-shapes";

/** Kind → tone mapping for the chips. Picked so the eye separates the three
 * "directional" kinds (commit / decline / defer) from the rest, and so
 * `decline` reads as a stop signal. */
const KIND_TONE: Record<
  DecisionKind,
  "neutral" | "success" | "warn" | "danger" | "accent"
> = {
  commit: "accent",
  decline: "warn",
  defer: "neutral",
  tradeoff: "neutral",
  design: "accent",
  process: "neutral",
};

/** Status → tone mapping for the status filter chip. Active is the default
 * working state, so we use `accent`; superseded is neutral; reverted is warn
 * (a reverted decision is louder than a quietly superseded one). */
const STATUS_TONE: Record<
  DecisionStatus,
  "neutral" | "success" | "warn" | "danger" | "accent"
> = {
  active: "accent",
  superseded: "neutral",
  reverted: "warn",
};

const STATUSES: DecisionStatus[] = ["active", "superseded", "reverted"];

/** Same fields used by the server-side index builder. Keep in sync with
 * `lib/decisions-server.ts` if you wire a new field into search. */
const SEARCH_OPTIONS = {
  fields: ["title", "body", "kind", "stakeholders", "tags"],
  storeFields: ["id"],
};

export function DecisionsView() {
  const list = useDecisions();
  const idx = useDecisionsSearchIndex();

  const [query, setQuery] = React.useState("");
  const [selectedKinds, setSelectedKinds] = React.useState<Set<DecisionKind>>(
    new Set()
  );
  // Default to active. Click again to clear (== "all statuses").
  const [selectedStatus, setSelectedStatus] = React.useState<
    DecisionStatus | null
  >("active");
  const [selectedStakeholders, setSelectedStakeholders] = React.useState<
    Set<string>
  >(new Set());

  // Hydrate MiniSearch from the serialized JSON. Memoized so we don't re-parse
  // on every keystroke. Returns `null` until the index payload is available.
  const search = React.useMemo<MiniSearch | null>(() => {
    if (!idx.data || !idx.data.ok) return null;
    try {
      return MiniSearch.loadJSON(idx.data.serialized, SEARCH_OPTIONS);
    } catch {
      // Bad payload — fall back to "no full-text search", filters still work.
      return null;
    }
  }, [idx.data]);

  const decisions: DecisionListItem[] =
    list.data && list.data.ok ? list.data.decisions : [];

  // Derive the stakeholder universe from the current decisions. We deliberately
  // don't pre-bake this list — if a stakeholder field is removed from every
  // decision, the chip should disappear with it.
  const allStakeholders = React.useMemo(() => {
    const s = new Set<string>();
    for (const d of decisions) {
      for (const sh of d.frontmatter.stakeholders ?? []) s.add(sh);
    }
    return Array.from(s).sort();
  }, [decisions]);

  // Apply search → filters in that order. Search restricts to a candidate id
  // set; an empty query means "all decisions are candidates".
  const filtered = React.useMemo(() => {
    let candidates: DecisionListItem[] = decisions;

    if (query.trim() && search) {
      const hits = search.search(query.trim(), { prefix: true, fuzzy: 0.2 });
      const hitIds = new Set(hits.map((h) => String(h.id)));
      candidates = candidates.filter((d) => hitIds.has(d.slug));
    }

    if (selectedKinds.size > 0) {
      candidates = candidates.filter((d) =>
        d.frontmatter.kind.some((k) => selectedKinds.has(k))
      );
    }

    if (selectedStatus) {
      candidates = candidates.filter(
        (d) => d.frontmatter.status === selectedStatus
      );
    }

    if (selectedStakeholders.size > 0) {
      candidates = candidates.filter((d) =>
        (d.frontmatter.stakeholders ?? []).some((sh) =>
          selectedStakeholders.has(sh)
        )
      );
    }

    // Date desc — frontmatter.date is `YYYY-MM-DD`, so lexicographic sort works.
    return candidates
      .slice()
      .sort((a, b) => b.frontmatter.date.localeCompare(a.frontmatter.date));
  }, [
    decisions,
    query,
    search,
    selectedKinds,
    selectedStatus,
    selectedStakeholders,
  ]);

  function toggleKind(k: DecisionKind) {
    setSelectedKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function toggleStakeholder(sh: string) {
    setSelectedStakeholders((prev) => {
      const next = new Set(prev);
      if (next.has(sh)) next.delete(sh);
      else next.add(sh);
      return next;
    });
  }

  function toggleStatus(s: DecisionStatus) {
    setSelectedStatus((prev) => (prev === s ? null : s));
  }

  if (list.isLoading) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-6 text-sm text-neutral-500">
        Loading…
      </div>
    );
  }
  if (list.error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        {list.error instanceof Error
          ? list.error.message
          : String(list.error)}
      </div>
    );
  }
  if (list.data && !list.data.ok) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        {list.data.error}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 className="text-base font-semibold tracking-tight text-neutral-900">
          Decisions
        </h2>
        <p className="text-xs text-neutral-500">
          Product decisions, alignments, and tradeoffs. New ones via the{" "}
          <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-[11px] text-neutral-700">
            new-decision.sh
          </code>{" "}
          script or{" "}
          <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-[11px] text-neutral-700">
            /log-decision
          </code>{" "}
          in a Claude Code session.
        </p>
      </header>

      <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4 shadow-card">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            search
              ? "Search decisions (title, body, tags, stakeholders)…"
              : idx.isLoading
                ? "Loading search index…"
                : "Search unavailable — index failed to load"
          }
          className="h-9 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none"
        />

        <div className="flex flex-col gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-neutral-500">Kind</span>
            {DECISION_KINDS.map((k) => {
              const active = selectedKinds.has(k);
              return (
                <FilterChip
                  key={k}
                  active={active}
                  tone={KIND_TONE[k]}
                  onClick={() => toggleKind(k)}
                >
                  {k}
                </FilterChip>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-neutral-500">Status</span>
            {STATUSES.map((s) => (
              <FilterChip
                key={s}
                active={selectedStatus === s}
                tone={STATUS_TONE[s]}
                onClick={() => toggleStatus(s)}
              >
                {s}
              </FilterChip>
            ))}
          </div>
          {allStakeholders.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-neutral-500">Stakeholders</span>
              {allStakeholders.map((sh) => (
                <FilterChip
                  key={sh}
                  active={selectedStakeholders.has(sh)}
                  tone="neutral"
                  onClick={() => toggleStakeholder(sh)}
                >
                  {sh}
                </FilterChip>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {decisions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-10 text-center text-sm text-neutral-500">
          No decisions yet — start one with{" "}
          <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-[11px] text-neutral-700">
            ./scripts/new-decision.sh &quot;Title&quot;
          </code>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-10 text-center text-sm text-neutral-500">
          No decisions match the current filters.
        </div>
      ) : (
        <section className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-card">
          <ul className="divide-y divide-neutral-100">
            {filtered.map((d) => (
              <DecisionRow key={d.slug} d={d} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function DecisionRow({ d }: { d: DecisionListItem }) {
  const stakeholders = d.frontmatter.stakeholders ?? [];
  return (
    <li className="px-4 py-3 hover:bg-neutral-50">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link
          href={`/decisions/${d.slug}`}
          className="text-sm font-semibold text-neutral-900 hover:underline"
        >
          {d.frontmatter.title}
        </Link>
        <span className="text-xs text-neutral-500">{d.frontmatter.date}</span>
        <span className="flex flex-wrap items-center gap-1">
          {d.frontmatter.kind.map((k) => (
            <Badge key={k} tone={KIND_TONE[k]}>
              {k}
            </Badge>
          ))}
        </span>
        {stakeholders.length > 0 ? (
          <span className="text-xs text-neutral-500">
            {stakeholders.join(", ")}
          </span>
        ) : null}
      </div>
      {d.summary ? (
        <p className="mt-1 line-clamp-1 text-xs text-neutral-600">
          {d.summary}
        </p>
      ) : null}
    </li>
  );
}

function FilterChip({
  children,
  active,
  tone,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  tone: "neutral" | "success" | "warn" | "danger" | "accent";
  onClick: () => void;
}) {
  // Mirrors the Badge tone language but as a clickable button. Inactive chips
  // are muted; active chips light up with the tone colour and a ring.
  const toneActive: Record<typeof tone, string> = {
    neutral: "bg-neutral-200 text-neutral-800 ring-neutral-300",
    success: "bg-green-100 text-green-800 ring-green-300",
    warn: "bg-amber-100 text-amber-800 ring-amber-300",
    danger: "bg-red-100 text-red-800 ring-red-300",
    accent: "bg-blue-100 text-blue-800 ring-blue-300",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset transition-colors",
        active
          ? toneActive[tone]
          : "bg-white text-neutral-600 ring-neutral-200 hover:bg-neutral-50"
      )}
    >
      {children}
    </button>
  );
}
