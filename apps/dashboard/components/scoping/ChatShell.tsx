"use client";

import * as React from "react";
import { Send, Square, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProposedActionCard } from "./ProposedActionCard";

type Message = {
  id: string;
  role: string;
  contentJson: string;
  createdAtMs: number;
};

type Action = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  state: string;
  result: unknown;
};

type SessionPayload = {
  session: { id: string; flowType: string; status: string };
  messages: Message[];
  proposedActions: Action[];
};

export function ChatShell({ sessionId }: { sessionId: string }) {
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [actions, setActions] = React.useState<Action[]>([]);
  const [composerValue, setComposerValue] = React.useState("");
  const [streaming, setStreaming] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  /** Aborts an in-flight POST /turn — fetch cancellation propagates through
   * `req.signal` server-side, which kills the spawned `claude -p` subprocess
   * via runClaudeTurn's existing abortSignal plumbing. */
  const abortRef = React.useRef<AbortController | null>(null);

  const reloadSession = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/scoping/messages?session=${sessionId}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as SessionPayload;
      setMessages(body.messages);
      setActions(body.proposedActions);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [sessionId]);

  // Initial load
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await reloadSession();
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadSession]);

  // Pre-warm the long-lived `claude` subprocess for this session. For brand-
  // new sessions the warm-up is already done inside POST /api/scoping/session
  // (where the freshly-built system prompt is in scope). For RE-opens of
  // existing sessions, the pool entry has been evicted and the next turn
  // would otherwise pay the spawn tax. This fire-and-forget call wakes the
  // subprocess in the background while the user is reading the chat.
  React.useEffect(() => {
    fetch(`/api/scoping/session/${sessionId}/prewarm`, {
      method: "POST",
      keepalive: true,
    }).catch(() => {
      /* best-effort */
    });
  }, [sessionId]);

  // Panel unmount → evict the long-lived `claude` subprocess from the
  // server-side pool (T6). Non-destructive: Claude Code's persisted session
  // history isn't touched, so re-opening the panel later just re-spawns with
  // --resume. `keepalive: true` lets the request finish even though we're
  // navigating away — the user-action that closed the panel doesn't matter
  // (route change, tab close, etc.).
  React.useEffect(() => {
    return () => {
      try {
        fetch(`/api/scoping/session/${sessionId}/evict`, {
          method: "POST",
          keepalive: true,
        }).catch(() => {
          /* best-effort */
        });
      } catch {
        /* ignore */
      }
    };
  }, [sessionId]);

  // Auto-scroll on new content
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, actions, streaming]);

  // Cards in `pending` need approval; cards in `firing` are mid-Lark-write
  // (claimed atomically at approve-time but not yet flipped to fired/failed).
  // Both block the composer — the user shouldn't queue a new turn while a
  // write is in flight.
  const pendingActions = actions.filter(
    (a) => a.state === "pending" || a.state === "firing"
  );
  const pending = pendingActions[0];
  const composerDisabled = streaming || pending !== undefined;

  async function send() {
    const text = composerValue.trim();
    if (!text || composerDisabled) return;
    setComposerValue("");
    setError(null);
    // Optimistically append user message
    setMessages((prev) => [
      ...prev,
      {
        id: `local_${Date.now()}`,
        role: "user",
        contentJson: JSON.stringify({ text }),
        createdAtMs: Date.now(),
      },
    ]);
    setStreaming(true);

    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch("/api/scoping/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message: text }),
        signal: ac.signal,
      });
      if (!res.body) throw new Error("no response body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          handleStreamEvent(line);
        }
      }
    } catch (e) {
      // Don't surface AbortError as a red banner — it's a user action, not
      // a failure. Anything else is a real error.
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      // Reload to pick up server-side message IDs and any persisted proposals.
      await reloadSession();
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  function handleStreamEvent(line: string) {
    let evt: Record<string, unknown>;
    try {
      evt = JSON.parse(line);
    } catch {
      return;
    }
    if (evt.type === "_error") {
      setError(String(evt.message ?? "stream error"));
    }
    // We just append a synthetic message rendering for now — the post-stream
    // reload will pull canonical messages + actions from SQLite.
    if (evt.type === "assistant") {
      setMessages((prev) => [
        ...prev,
        {
          id: `stream_${Date.now()}_${prev.length}`,
          role: "assistant",
          contentJson: JSON.stringify(evt),
          createdAtMs: Date.now(),
        },
      ]);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 overflow-auto px-1 py-3">
        {messages.length === 0 ? (
          <div className="rounded border border-dashed border-neutral-200 p-6 text-center text-sm text-neutral-500">
            Loading session…
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {messages.map((m) => (
              <MessageItem key={m.id} message={m} actions={actions} />
            ))}
          </ul>
        )}
        {streaming ? (
          <div className="mt-3 flex items-center gap-2 text-xs text-neutral-500">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
            Claude is thinking…
          </div>
        ) : null}
        {error ? (
          <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        ) : null}
        {/* Pending-action cards rendered at the foot of the chat — always
            visible regardless of whether MessageItem managed to inline-attach
            them via the (fragile) payload-match heuristic. onResolved
            re-fetches so the card transitions out of "pending" once Approve
            / Reject finishes. */}
        {pendingActions.length > 0 ? (
          <div className="mt-4 flex flex-col gap-2">
            {pendingActions.map((a) => (
              <ProposedActionCard
                key={a.id}
                action={a}
                onResolved={() => {
                  void reloadSession();
                }}
              />
            ))}
          </div>
        ) : null}
      </div>
      <div className="shrink-0 border-t border-neutral-200 bg-white p-3">
        {pending ? (
          <div className="mb-2 rounded border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
            Approve or reject the pending action above before sending another
            message.
          </div>
        ) : null}
        <div className="flex items-end gap-2">
          <textarea
            value={composerValue}
            onChange={(e) => setComposerValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={
              pending
                ? "Resolve the pending action above first."
                : "Type a message. ⌘↵ to send."
            }
            disabled={composerDisabled}
            rows={3}
            className="flex-1 resize-none rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none disabled:bg-neutral-50 disabled:text-neutral-400"
          />
          {streaming ? (
            <Button variant="secondary" onClick={stop}>
              <Square className="h-3.5 w-3.5" />
              Stop
            </Button>
          ) : (
            <Button
              onClick={send}
              disabled={composerDisabled || !composerValue.trim()}
            >
              <Send className="h-3.5 w-3.5" />
              Send
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageItem({
  message,
  actions,
}: {
  message: Message;
  actions: Action[];
}) {
  if (message.role === "user") {
    const text = extractText(message.contentJson);
    return (
      <li className="flex justify-end">
        <div className="max-w-[85%] rounded-lg bg-neutral-900 px-3 py-2 text-sm text-white">
          {text}
        </div>
      </li>
    );
  }
  if (message.role === "assistant") {
    const blocks = extractAssistantBlocks(message.contentJson);
    return (
      <li className="flex flex-col gap-2">
        {blocks.map((b, i) => {
          if (b.type === "text") {
            return (
              <div
                key={i}
                className="max-w-[95%] whitespace-pre-wrap rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-900"
              >
                {b.text}
              </div>
            );
          }
          if (b.type === "tool_use") {
            // Try to surface the proposed action card alongside this tool_use
            const action = actions.find(
              (a) =>
                isProposeAction(b.name) &&
                JSON.stringify(a.payload).includes(JSON.stringify(b.input ?? {}))
            );
            if (action) {
              return <ProposedActionCard key={i} action={action} />;
            }
            return (
              <div
                key={i}
                className="flex items-center gap-1.5 self-start rounded border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-600"
              >
                <Wrench className="h-3 w-3" />
                <span>Used tool</span>
                <code className="font-mono text-[11px] text-neutral-700">
                  {String(b.name)}
                </code>
              </div>
            );
          }
          return null;
        })}
      </li>
    );
  }
  if (message.role === "tool_result") {
    return null; // collapsed by default
  }
  return null;
}

type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; name: string; input: unknown }
  | { type: "other" };

function extractAssistantBlocks(contentJson: string): Block[] {
  try {
    const parsed = JSON.parse(contentJson) as {
      message?: { content?: unknown[] };
      text?: string;
    };
    if (parsed.text) {
      return [{ type: "text", text: parsed.text }];
    }
    const content = parsed.message?.content ?? [];
    return content
      .map((b: unknown) => {
        if (!b || typeof b !== "object") return { type: "other" } as Block;
        const o = b as { type?: string; text?: string; name?: string; input?: unknown };
        if (o.type === "text" && typeof o.text === "string") {
          return { type: "text", text: o.text } as Block;
        }
        if (o.type === "tool_use" && typeof o.name === "string") {
          return { type: "tool_use", name: o.name, input: o.input ?? {} } as Block;
        }
        return { type: "other" } as Block;
      })
      .filter((b) => b.type !== "other");
  } catch {
    return [];
  }
}

function extractText(contentJson: string): string {
  try {
    const parsed = JSON.parse(contentJson) as { text?: string };
    return parsed.text ?? "";
  } catch {
    return "";
  }
}

function isProposeAction(toolName: string): boolean {
  return /^mcp__flightdeck__propose_/.test(toolName);
}
