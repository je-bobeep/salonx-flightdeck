"use client";

import * as React from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetBody,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChatShell } from "@/components/scoping/ChatShell";
import { BdThreadCard } from "@/components/panel/BdThreadCard";
import { BdThemePicker } from "@/components/panel/BdThemePicker";
import { DevThemePicker } from "@/components/panel/DevThemePicker";
import { Wand2, FileText, Network as NetworkIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BdRow, DevRow } from "@/lib/data-shapes";
import {
  EditableDate,
  EditableMultiSelect,
  EditableSelect,
  EditableText,
  EditableUserPicker,
} from "@/components/panel/EditableField";
import {
  DEV_MILESTONE_OPTIONS,
  DEV_PRIORITY_OPTIONS,
  DEV_REQUEST_TYPE_OPTIONS,
  DEV_STATUS_OPTIONS,
  KNOWN_ASSIGNEES,
} from "@/lib/field-options";

type PanelMode =
  | { kind: "bd"; recordId: string }
  | { kind: "dev"; recordId: string }
  | { kind: "pair"; bdRecordId: string; devRecordId: string }
  | null;

function readMode(searchParams: URLSearchParams): PanelMode {
  const kind = searchParams.get("kind");
  const id = searchParams.get("panel");
  if (!kind || !id) return null;
  if (kind === "bd") return { kind: "bd", recordId: id };
  if (kind === "dev") return { kind: "dev", recordId: id };
  if (kind === "pair") {
    const [bdId, devId] = id.split("+");
    if (!bdId || !devId) return null;
    return { kind: "pair", bdRecordId: bdId, devRecordId: devId };
  }
  return null;
}

export function TicketPanelHost() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const mode = readMode(new URLSearchParams(searchParams.toString()));
  const flow = searchParams.get("flow");
  const sessionId = searchParams.get("session");

  function close() {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("panel");
    next.delete("kind");
    next.delete("flow");
    next.delete("session");
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  if (!mode && !sessionId) return null;

  return (
    <Sheet open={true} onOpenChange={(open) => (open ? null : close())}>
      <SheetContent width="xl">
        {sessionId ? (
          <SessionShell sessionId={sessionId} />
        ) : mode ? (
          <SummaryWithFlows mode={mode} initialFlow={flow ?? undefined} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function SessionShell({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const { data } = useQuery({
    queryKey: ["session-meta", sessionId],
    queryFn: async () => {
      const res = await fetch(`/api/scoping/messages?session=${sessionId}`, {
        cache: "no-store",
      });
      if (!res.ok) return null;
      return (await res.json()) as {
        session: {
          id: string;
          flowType: string;
          ticketTitle: string | null;
        };
      };
    },
  });

  function backToSummary() {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("session");
    next.delete("flow");
    router.push(`${pathname}?${next.toString()}`);
  }

  const title = data?.session.ticketTitle ?? "Scoping session";

  return (
    <>
      <SheetHeader>
        <SheetTitle asChild>
          <h2 className="text-base font-semibold tracking-tight text-neutral-900">
            {title}
          </h2>
        </SheetTitle>
        <p className="text-xs text-neutral-500">
          Flow: <span className="font-mono">{data?.session.flowType}</span>
        </p>
        {searchParams.get("panel") ? (
          <button
            onClick={backToSummary}
            className="mt-1 self-start text-xs text-neutral-500 hover:text-neutral-900"
          >
            ← back to summary
          </button>
        ) : null}
      </SheetHeader>
      <SheetBody className="p-0">
        <ChatShell sessionId={sessionId} />
      </SheetBody>
    </>
  );
}

function SummaryWithFlows({
  mode,
  initialFlow,
}: {
  mode: NonNullable<PanelMode>;
  initialFlow?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [starting, setStarting] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // Investigation toggle: when on, the bd-to-dev / pair-sanity prompt
  // mandates a codebase-grep + PRD lookup phase before drafting / verdicting,
  // and the Story description's Background must cite anchors. Off by default
  // — adds 15-30s + tool budget per scope.
  const [investigation, setInvestigation] = React.useState(false);

  // Auto-start if a `flow` param was in the URL
  const autoStartedRef = React.useRef(false);
  React.useEffect(() => {
    if (initialFlow && !autoStartedRef.current) {
      autoStartedRef.current = true;
      void startFlow(initialFlow);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFlow]);

  async function startFlow(flowType: string) {
    setStarting(flowType);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        flowType,
        investigationEnabled: investigation,
      };
      if (mode.kind === "bd") {
        body.flowType = "bd-to-dev";
        body.ticketRecordId = mode.recordId;
        body.ticketKind = "bd";
      } else if (mode.kind === "pair") {
        body.flowType = "pair-sanity";
        body.pairBdRecordId = mode.bdRecordId;
        body.pairDevRecordId = mode.devRecordId;
      } else if (mode.kind === "dev") {
        // No native flow on a Dev row alone in v1; user has to pick a pair.
        setError("No scoping flow available on a Dev-only panel yet.");
        return;
      }
      const res = await fetch("/api/scoping/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      const j = (await res.json()) as { sessionId: string };
      const next = new URLSearchParams(searchParams.toString());
      next.set("session", j.sessionId);
      router.push(`${pathname}?${next.toString()}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(null);
    }
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle asChild>
          <h2 className="text-base font-semibold tracking-tight text-neutral-900">
            {mode.kind === "bd"
              ? "BD Feedback"
              : mode.kind === "pair"
                ? "BD ↔ Dev pair"
                : "Feature Dev ticket"}
          </h2>
        </SheetTitle>
      </SheetHeader>
      <SheetBody className="flex flex-col gap-4">
        <Summary mode={mode} />
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
            Scoping
          </div>
          <div className="flex flex-wrap gap-2">
            {mode.kind === "bd" ? (
              <Button
                onClick={() => startFlow("bd-to-dev")}
                disabled={starting !== null}
              >
                <Wand2 className="h-3.5 w-3.5" />
                {starting === "bd-to-dev"
                  ? "Starting…"
                  : "Scope this for dev"}
              </Button>
            ) : null}
            {mode.kind === "pair" ? (
              <Button
                onClick={() => startFlow("pair-sanity")}
                disabled={starting !== null}
              >
                <NetworkIcon className="h-3.5 w-3.5" />
                {starting === "pair-sanity"
                  ? "Starting…"
                  : "Run pair-sanity check"}
              </Button>
            ) : null}
          </div>
          {(mode.kind === "bd" || mode.kind === "pair") ? (
            <label
              className="mt-3 flex cursor-pointer items-start gap-2 text-[11px] text-neutral-600"
              title="When on, Claude greps salon-x + reads PRDs before drafting. Adds 15-30s but grounds the Background in cited anchors instead of inferences."
            >
              <input
                type="checkbox"
                checked={investigation}
                onChange={(e) => setInvestigation(e.target.checked)}
                disabled={starting !== null}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium text-neutral-800">
                  Investigate codebase first
                </span>{" "}
                — grep salon-x + check PRDs / shipped PRs before drafting.
                Slower (~15-30s) but Background gets cited anchors instead of
                guesses.
              </span>
            </label>
          ) : null}
          {error ? (
            <div className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
              {error}
            </div>
          ) : null}
        </div>
      </SheetBody>
    </>
  );
}

function Summary({ mode }: { mode: NonNullable<PanelMode> }) {
  if (mode.kind === "bd") {
    return <BdSummary recordId={mode.recordId} />;
  }
  if (mode.kind === "dev") {
    return <DevSummary recordId={mode.recordId} />;
  }
  if (mode.kind === "pair") {
    return (
      <div className="flex flex-col gap-3">
        <BdSummary recordId={mode.bdRecordId} />
        <BdDevDivider />
        <DevSummary recordId={mode.devRecordId} />
      </div>
    );
  }
  return null;
}

function BdDevDivider() {
  return (
    <div className="flex items-center gap-2 text-xs text-neutral-400">
      <div className="h-px flex-1 bg-neutral-200" />
      <span>linked to</span>
      <div className="h-px flex-1 bg-neutral-200" />
    </div>
  );
}

function BdSummary({ recordId }: { recordId: string }) {
  const { data } = useQuery({
    queryKey: ["bd-row", recordId],
    queryFn: async () => {
      const res = await fetch(
        `/api/data/bd?recordId=${encodeURIComponent(recordId)}`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { row: BdRow };
    },
  });
  if (!data) {
    return <PlaceholderRow label="Loading BD row…" />;
  }
  const r = data.row;
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <div className="mb-1 flex items-center gap-2 text-xs text-neutral-500">
        <span className="font-mono">BD #{r.number}</span>
        {r.priority ? <Badge tone="neutral">{r.priority}</Badge> : null}
        {r.fromPocMerchant ? <Badge tone="accent">POC</Badge> : null}
      </div>
      <div className="text-sm font-medium text-neutral-900">
        {r.translate || r.item}
      </div>
      {r.translate && r.item && r.translate !== r.item ? (
        <div className="mt-0.5 text-xs text-neutral-500">{r.item}</div>
      ) : null}
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <KV k="Status" v={r.status || "—"} />
        <KV k="Category" v={r.category.join(", ") || "—"} />
        <KV k="Sub-category" v={r.subCategory.trim() || "—"} />
        <KV
          k="Logged"
          v={r.dateRecordedMs ? new Date(r.dateRecordedMs).toLocaleDateString() : "—"}
        />
        <KV k="Age" v={r.ageDays !== null ? `${r.ageDays} days` : "—"} />
        <KV k="Created by" v={r.createdByName || "—"} />
      </dl>
      <BdThemePicker bdRecordId={recordId} />
      <BdThreadCard bdRecordId={recordId} />
    </div>
  );
}

function DevSummary({ recordId }: { recordId: string }) {
  const queryClient = useQueryClient();
  const queryKey = React.useMemo(() => ["dev-row", recordId], [recordId]);
  const { data } = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await fetch(
        `/api/data/dev?recordId=${encodeURIComponent(recordId)}`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { row: DevRow };
    },
  });

  // Single PATCH helper — sends one field at a time, sets the fresh row in
  // the query cache so the panel re-renders with confirmed-from-Lark values,
  // and invalidates list queries so other views catch up on next refetch.
  const patchField = React.useCallback(
    async (field: string, value: unknown) => {
      const res = await fetch(
        `/api/data/dev/${encodeURIComponent(recordId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ field, value }),
        }
      );
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      // Set fresh single-row cache + invalidate everything that depends on
      // Dev rows (Roadmap, Sprint, Linkage, Today, Triage's critical-fix
      // strip). These all live under their own query keys.
      queryClient.setQueryData(queryKey, body);
      for (const key of [
        "roadmap",
        "sprint",
        "linkage",
        "today",
        "triage",
      ]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
    [recordId, queryKey, queryClient]
  );

  if (!data) {
    return <PlaceholderRow label="Loading Dev row…" />;
  }
  const r = data.row;
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <div className="mb-1 flex items-center gap-2 text-xs text-neutral-500">
        <span>Dev</span>
        <Badge tone="neutral">{r.status || "—"}</Badge>
        {r.sprint ? <span className="font-mono">{r.sprint}</span> : null}
      </div>
      {/* Title (Description field) — editable inline. */}
      <div className="text-sm font-medium text-neutral-900">
        <EditableText
          value={r.description}
          placeholder="(no description)"
          onSave={(v) => patchField("description", v)}
        />
      </div>

      {/* Story description — pinned right under the title, expanded by
          default, editable as a multiline textarea. This is the primary
          surface jiaen reads/edits, so don't bury it under a <details>. */}
      <div className="mt-3">
        <div className="mb-1 text-[11px] uppercase tracking-wide text-neutral-500">
          Story description
        </div>
        <div className="rounded bg-neutral-50 p-2 text-xs text-neutral-700">
          <EditableText
            multiline
            value={r.storyDescription}
            placeholder="(empty — click to add)"
            onSave={(v) => patchField("storyDescription", v)}
          />
        </div>
      </div>

      {/* Field grid — every cell is click-to-edit. */}
      <dl className="mt-3 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs">
        <DT>Status</DT>
        <DD>
          <EditableSelect
            value={r.status}
            options={DEV_STATUS_OPTIONS}
            onSave={(v) => patchField("status", v)}
          />
        </DD>

        <DT>Priority</DT>
        <DD>
          <EditableSelect
            value={r.priority}
            options={DEV_PRIORITY_OPTIONS}
            onSave={(v) => patchField("priority", v)}
          />
        </DD>

        <DT>Milestone</DT>
        <DD>
          <EditableSelect
            value={r.milestone}
            options={DEV_MILESTONE_OPTIONS}
            onSave={(v) => patchField("milestone", v)}
          />
        </DD>

        <DT>Request type</DT>
        <DD>
          <EditableSelect
            value={r.requestType}
            options={DEV_REQUEST_TYPE_OPTIONS}
            onSave={(v) => patchField("requestType", v)}
          />
        </DD>

        <DT>Sprint</DT>
        <DD>
          <EditableText
            value={r.sprint}
            placeholder="(no sprint)"
            onSave={(v) => patchField("sprint", v)}
          />
        </DD>

        <DT>Assignee</DT>
        <DD>
          <EditableUserPicker
            value={r.assignees}
            options={KNOWN_ASSIGNEES}
            onSave={(v) =>
              patchField(
                "assignees",
                v.map((u) => u.id)[0] ?? ""
              )
            }
          />
        </DD>

        <DT>External ETA</DT>
        <DD>
          <EditableDate
            value={r.eta}
            onSave={(v) => patchField("eta", v)}
          />
        </DD>

        <DT>
          <span title="Internal target date — Lark `Internal ETA` field. Used for dev planning.">
            Internal target
          </span>
        </DT>
        <DD>
          <InternalTargetField
            value={r.internalTargetDate}
            externalEta={r.eta}
            onSave={(v) => patchField("internalTargetDate", v)}
          />
        </DD>

        <DT>Release Date</DT>
        <DD>
          <EditableDate
            value={r.releaseDate}
            onSave={(v) => patchField("releaseDate", v)}
          />
        </DD>

        <DT>Module</DT>
        <DD>
          <EditableMultiSelect
            value={r.module}
            options={[]}
            placeholder="(none)"
            onSave={(v) => patchField("module", v)}
          />
        </DD>

        <DT>Product</DT>
        <DD>
          <EditableMultiSelect
            value={r.product}
            options={[]}
            placeholder="(none)"
            onSave={(v) => patchField("product", v)}
          />
        </DD>
      </dl>
      <DevThemePicker devRecordId={recordId} />
    </div>
  );
}

// InternalTargetField — wraps EditableDate for the Lark `Internal ETA` field.
// Writes go through the standard Dev PATCH path (passed in as `onSave`), the
// same one ETA / Release Date use. Renders the buffer-vs-external-ETA drift
// hint underneath.
function InternalTargetField({
  value,
  externalEta,
  onSave,
}: {
  value: string;
  externalEta: string;
  onSave: (v: string) => Promise<void>;
}) {
  // Drift hint — quietly informational. No alarm spam.
  let hint: { text: string; tone: "neutral" | "warn" } | null = null;
  if (value && externalEta) {
    const internalMs = Date.parse(value + "T00:00:00Z");
    const externalMs = Date.parse(externalEta);
    if (Number.isFinite(internalMs) && Number.isFinite(externalMs)) {
      const days = Math.round((externalMs - internalMs) / (24 * 60 * 60 * 1000));
      if (days > 0) {
        hint = {
          text: `Buffer: ${days}d before external commitment`,
          tone: "neutral",
        };
      } else if (days < 0) {
        hint = {
          text: `Internal target is AFTER external commitment (${Math.abs(days)}d gap)`,
          tone: "warn",
        };
      }
    }
  }

  return (
    <div className="flex flex-col gap-0.5">
      <EditableDate value={value} onSave={onSave} />
      {hint ? (
        <span
          className={cn(
            "text-[10px]",
            hint.tone === "warn" ? "text-amber-700" : "text-neutral-500"
          )}
        >
          {hint.text}
        </span>
      ) : null}
    </div>
  );
}

function DT({ children }: { children: React.ReactNode }) {
  return (
    <dt className="self-baseline pt-0.5 text-neutral-500">{children}</dt>
  );
}

function DD({ children }: { children: React.ReactNode }) {
  return <dd className="min-w-0 self-baseline">{children}</dd>;
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-neutral-500">{k}</dt>
      <dd className="text-neutral-800">{v}</dd>
    </>
  );
}

function PlaceholderRow({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-3 text-xs text-neutral-500">
      {label}
    </div>
  );
}
