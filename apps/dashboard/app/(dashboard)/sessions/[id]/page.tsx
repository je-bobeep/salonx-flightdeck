import { notFound } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { Badge } from "@/components/ui/badge";
import {
  getSession,
  listMessages,
  listProposedActions,
} from "@/lib/scoping-db";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * Session timeline / debug view. Lists every message + every proposal in
 * chronological order. Useful for auditing when Claude proposes badly,
 * eyeballing the recap, or seeing the per-turn CONTEXT block in raw form.
 */
export default async function SessionTimelinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) notFound();
  const messages = listMessages(id);
  const proposedActions = listProposedActions(id);

  const events = [
    ...messages.map((m) => ({
      kind: "msg" as const,
      ts: m.createdAtMs,
      data: m,
    })),
    ...proposedActions.map((a) => ({
      kind: "action" as const,
      ts: a.createdAtMs,
      data: a,
    })),
  ].sort((a, b) => a.ts - b.ts);

  return (
    <div className="flex h-full flex-col">
      <TopBar
        title={`Session ${id.slice(0, 12)}…`}
        queryKeyPrefix={["sessions"]}
      />
      <div className="flex-1 overflow-auto p-6">
        <div className="mb-4">
          <Link
            href="/sessions"
            className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900"
          >
            <ArrowLeft className="h-3 w-3" /> All sessions
          </Link>
        </div>

        <div className="mb-6 rounded-lg border border-neutral-200 bg-white p-4 shadow-card">
          <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
            <Badge tone="accent">{session.flow_type}</Badge>
            <Badge tone={session.status === "active" ? "warn" : "neutral"}>
              {session.status}
            </Badge>
            <span>
              created{" "}
              {formatDistanceToNow(session.created_at, { addSuffix: true })}
            </span>
          </div>
          <h2 className="mt-2 text-base font-semibold text-neutral-900">
            {session.ticket_title ?? "(detached)"}
          </h2>
          <dl className="mt-3 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
            <DT>Session id</DT>
            <DD className="font-mono">{session.id}</DD>
            <DT>Claude session</DT>
            <DD className="font-mono">
              {session.claude_session_uuid ?? "(none)"}
            </DD>
            <DT>Model</DT>
            <DD className="font-mono">{session.model}</DD>
            <DT>Ticket</DT>
            <DD className="font-mono">
              {session.ticket_record_id ?? "(none)"}
            </DD>
            <DT>Recap</DT>
            <DD>
              {session.recap_md ? (
                <span>
                  generated at message #{session.recap_at_turn} (
                  {session.recap_md.length} chars)
                </span>
              ) : (
                <span className="text-neutral-400">none yet</span>
              )}
            </DD>
          </dl>
          {session.recap_md ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-neutral-500 hover:text-neutral-800">
                Show recap markdown
              </summary>
              <pre className="mt-2 whitespace-pre-wrap rounded bg-neutral-50 p-3 font-sans text-xs text-neutral-800">
                {session.recap_md}
              </pre>
            </details>
          ) : null}
        </div>

        <h3 className="mb-2 text-xs uppercase tracking-wide text-neutral-500">
          Timeline ({events.length})
        </h3>
        <ul className="flex flex-col gap-2">
          {events.map((e, i) => (
            <li
              key={`${e.kind}-${i}`}
              className="rounded-md border border-neutral-200 bg-white p-3 text-xs shadow-card"
            >
              {e.kind === "msg" ? (
                <MessageBlock m={e.data} />
              ) : (
                <ActionBlock a={e.data} />
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function DT({ children }: { children: React.ReactNode }) {
  return (
    <dt className="self-baseline pt-0.5 text-neutral-500">{children}</dt>
  );
}
function DD({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <dd className={`min-w-0 self-baseline text-neutral-800 ${className ?? ""}`}>
      {children}
    </dd>
  );
}

type MessageRow = ReturnType<typeof listMessages>[number];
type ActionRow = ReturnType<typeof listProposedActions>[number];

function MessageBlock({ m }: { m: MessageRow }) {
  return (
    <>
      <div className="mb-1 flex items-center justify-between">
        <Badge tone={roleTone(m.role)}>{m.role}</Badge>
        <span className="text-[10px] text-neutral-400">
          {new Date(m.createdAtMs).toISOString()}
        </span>
      </div>
      <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-neutral-700">
        {pretty(m.contentJson)}
      </pre>
    </>
  );
}

function ActionBlock({ a }: { a: ActionRow }) {
  return (
    <>
      <div className="mb-1 flex items-center justify-between">
        <Badge tone="accent">propose</Badge>
        <Badge tone={stateTone(a.state)}>{a.state}</Badge>
      </div>
      <div className="text-[11px] font-medium text-neutral-900">{a.kind}</div>
      <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-neutral-700">
        {JSON.stringify(a.payload, null, 2)}
      </pre>
      {a.result !== null && a.result !== undefined ? (
        <details className="mt-1">
          <summary className="cursor-pointer text-[10px] text-neutral-500">
            result
          </summary>
          <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[10px] text-neutral-600">
            {JSON.stringify(a.result, null, 2)}
          </pre>
        </details>
      ) : null}
    </>
  );
}

function roleTone(role: string): "neutral" | "accent" | "warn" | "success" {
  if (role === "user") return "accent";
  if (role === "assistant") return "success";
  if (role === "tool_result") return "warn";
  return "neutral";
}
function stateTone(state: string): "neutral" | "warn" | "danger" | "success" {
  if (state === "pending") return "warn";
  if (state === "fired") return "success";
  if (state === "failed") return "danger";
  return "neutral";
}
function pretty(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

