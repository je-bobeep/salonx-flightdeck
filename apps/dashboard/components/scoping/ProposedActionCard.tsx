"use client";

import * as React from "react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Clock, Wand2 } from "lucide-react";

type Action = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  state: string;
  result: unknown;
};

const KIND_LABEL: Record<string, string> = {
  "lark.create_dev_ticket": "Create Feature Dev row",
  "lark.update_bd_status": "Update BD Status",
  "lark.create_bd_dev_link": "Link BD ↔ Dev",
  "propose.write_stakeholder_md": "Write stakeholder Markdown",
};

export function ProposedActionCard({
  action,
  onResolved,
}: {
  action: Action;
  onResolved?: (kind: "approved" | "rejected", result: unknown) => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function approve() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/lark/proposed-action/${action.id}/approve`,
        { method: "POST" }
      );
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
      } else {
        onResolved?.("approved", body.result);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/lark/proposed-action/${action.id}/reject`,
        { method: "POST" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `HTTP ${res.status}`);
      } else {
        onResolved?.("rejected", null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-blue-200 bg-blue-50/30">
      <CardHeader className="border-blue-100">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-1.5">
            <Wand2 className="h-3.5 w-3.5 text-blue-700" />
            <span>{KIND_LABEL[action.kind] ?? action.kind}</span>
          </CardTitle>
          <StateBadge state={action.state} />
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        <ActionPayload kind={action.kind} payload={action.payload} />
        {error ? (
          <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
            {error}
          </div>
        ) : null}
        {action.state === "pending" ? (
          <div className="flex gap-2">
            <Button onClick={approve} disabled={busy}>
              <CheckCircle2 className="h-3.5 w-3.5" />
              Approve
            </Button>
            <Button variant="secondary" onClick={reject} disabled={busy}>
              <XCircle className="h-3.5 w-3.5" />
              Reject
            </Button>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function StateBadge({ state }: { state: string }) {
  if (state === "pending") {
    return (
      <Badge tone="warn">
        <Clock className="mr-0.5 h-3 w-3" />
        pending approval
      </Badge>
    );
  }
  if (state === "firing") {
    // Pre-claimed by approve route; Lark write is in flight. Distinct from
    // `pending` so a stuck-`firing` row is visually identifiable in the
    // timeline view if the post-write state update never landed.
    return (
      <Badge tone="warn">
        <Clock className="mr-0.5 h-3 w-3 animate-pulse" />
        firing…
      </Badge>
    );
  }
  if (state === "fired") {
    return (
      <Badge tone="success">
        <CheckCircle2 className="mr-0.5 h-3 w-3" />
        fired
      </Badge>
    );
  }
  if (state === "rejected") {
    return <Badge tone="neutral">rejected</Badge>;
  }
  if (state === "failed") {
    return <Badge tone="danger">failed</Badge>;
  }
  return <Badge tone="neutral">{state}</Badge>;
}

function ActionPayload({
  kind,
  payload,
}: {
  kind: string;
  payload: Record<string, unknown>;
}) {
  if (kind === "lark.create_dev_ticket") {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <Field label="Description">
          <span className="font-medium text-neutral-900">
            {String(payload.description ?? "(missing)")}
          </span>
        </Field>
        <Field label="Story description">
          <pre className="whitespace-pre-wrap font-sans text-sm text-neutral-800">
            {String(payload.story_description ?? "")}
          </pre>
        </Field>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <Field label="Request type" small>
            {String(payload.request_type ?? "—")}
          </Field>
          <Field label="Priority" small>
            {String(payload.priority ?? "—")}
          </Field>
          <Field label="Milestone" small>
            {String(payload.milestone ?? "—")}
          </Field>
          <Field label="Sprint" small>
            {String(payload.sprint ?? "—")}
          </Field>
          {Array.isArray(payload.module) ? (
            <Field label="Module" small>
              {(payload.module as string[]).join(", ") || "—"}
            </Field>
          ) : null}
          {Array.isArray(payload.product) ? (
            <Field label="Product" small>
              {(payload.product as string[]).join(", ") || "—"}
            </Field>
          ) : null}
        </div>
        {payload.bd_record_id ? (
          <Field label="Linked BD" small>
            <span className="font-mono text-xs">
              {String(payload.bd_record_id)}
            </span>
          </Field>
        ) : null}
      </div>
    );
  }
  if (kind === "lark.update_bd_status") {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <Field label="BD record">
          <span className="font-mono text-xs">{String(payload.bd_record_id)}</span>
        </Field>
        <Field label="New status">
          <Badge tone="warn">{String(payload.new_status)}</Badge>
        </Field>
        {payload.verdict_text ? (
          <Field label="Verdict">
            <pre className="whitespace-pre-wrap font-sans text-sm text-neutral-800">
              {String(payload.verdict_text)}
            </pre>
          </Field>
        ) : null}
      </div>
    );
  }
  if (kind === "lark.create_bd_dev_link") {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <Field label="BD record">
          <span className="font-mono text-xs">{String(payload.bd_record_id)}</span>
        </Field>
        <Field label="Dev record">
          <span className="font-mono text-xs">{String(payload.dev_record_id)}</span>
        </Field>
        {payload.rationale ? (
          <Field label="Why">{String(payload.rationale)}</Field>
        ) : null}
      </div>
    );
  }
  if (kind === "propose.write_stakeholder_md") {
    return (
      <div className="flex flex-col gap-2 text-sm">
        {payload.title_hint ? (
          <Field label="Title">{String(payload.title_hint)}</Field>
        ) : null}
        <Field label="Markdown body">
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-white p-2 font-sans text-xs text-neutral-700 ring-1 ring-neutral-200">
            {String(payload.markdown ?? "")}
          </pre>
        </Field>
        <p className="text-xs text-neutral-500">
          Saves to <code>scoping-outputs/&lt;date&gt;-stakeholder.md</code>{" "}
          (numeric suffix on collision — never overwrites).
        </p>
      </div>
    );
  }
  return (
    <pre className="overflow-auto rounded bg-neutral-100 p-2 text-xs">
      {JSON.stringify(payload, null, 2)}
    </pre>
  );
}

function Field({
  label,
  small,
  children,
}: {
  label: string;
  small?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className={
          small
            ? "text-[11px] uppercase tracking-wide text-neutral-500"
            : "text-xs uppercase tracking-wide text-neutral-500"
        }
      >
        {label}
      </span>
      <div>{children}</div>
    </div>
  );
}
