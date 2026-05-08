"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ThreadMessageView = {
  messageId: string;
  msgType: string;
  text: string | null;
  placeholder: string | null;
  senderId: string | null;
  createMs: number;
  isParent: boolean;
};

type ThreadResponse =
  | {
      ok: true;
      source: {
        bdRecordId: string;
        messageId: string;
        chatId: string;
        threadId: string | null;
      };
      messages: ThreadMessageView[];
      summary: string | null;
      cacheAgeMs: number;
      cacheHit: boolean;
    }
  | { ok: false; reason: "no-source-thread" | "fetch-failed"; detail?: string };

export function BdThreadCard({ bdRecordId }: { bdRecordId: string }) {
  const [open, setOpen] = React.useState(false);
  const [hasFetched, setHasFetched] = React.useState(false);
  const queryClient = useQueryClient();
  const queryKey = React.useMemo(
    () => ["bd-thread", bdRecordId] as const,
    [bdRecordId]
  );

  const { data, isFetching, error } = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await fetch(
        `/api/data/bd/${encodeURIComponent(bdRecordId)}/thread`,
        { cache: "no-store" }
      );
      const json = (await res.json()) as ThreadResponse;
      return json;
    },
    enabled: hasFetched,
    staleTime: Infinity,
  });

  const refresh = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/data/bd/${encodeURIComponent(bdRecordId)}/thread?refresh=1`,
        { cache: "no-store" }
      );
      return (await res.json()) as ThreadResponse;
    },
    onSuccess: (fresh) => {
      queryClient.setQueryData(queryKey, fresh);
    },
  });

  function trigger() {
    setHasFetched(true);
    setOpen(true);
  }

  // Header — always rendered; click toggles open/fetch.
  const replyCount = data && data.ok ? Math.max(0, data.messages.length - 1) : null;
  const cacheAgeMin =
    data && data.ok ? Math.floor(data.cacheAgeMs / 60_000) : null;

  return (
    <section className="mt-3 overflow-hidden rounded-lg border border-neutral-200 bg-white">
      <header className="flex items-center justify-between gap-2 border-b border-neutral-100 px-3 py-2">
        <button
          type="button"
          onClick={() => (hasFetched ? setOpen((v) => !v) : trigger())}
          className="flex flex-1 items-center gap-2 text-left text-xs font-medium text-neutral-700 hover:text-neutral-900"
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          <MessageSquare className="h-3.5 w-3.5 text-blue-500" />
          <span>Thread context</span>
          {hasFetched && data && data.ok && replyCount !== null ? (
            <span className="text-neutral-500">
              ({replyCount} {replyCount === 1 ? "reply" : "replies"})
            </span>
          ) : null}
          {!hasFetched ? (
            <span className="text-neutral-400">— click to fetch</span>
          ) : null}
        </button>
        {hasFetched && data && data.ok ? (
          <div className="flex items-center gap-2">
            {cacheAgeMin !== null && cacheAgeMin > 0 ? (
              <span className="text-[10px] text-neutral-400">
                cached {cacheAgeMin}m ago
              </span>
            ) : null}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => refresh.mutate()}
              disabled={refresh.isPending || isFetching}
              title="Re-fetch the thread from Lark"
            >
              <RefreshCw
                className={cn(
                  "h-3.5 w-3.5",
                  (refresh.isPending || isFetching) && "animate-spin"
                )}
              />
            </Button>
          </div>
        ) : null}
      </header>

      {open ? (
        <div className="px-3 py-3">
          {!hasFetched || isFetching ? (
            <p className="text-xs text-neutral-500">Loading thread…</p>
          ) : error ? (
            <p className="text-xs text-amber-700">
              Couldn&apos;t load thread:{" "}
              {error instanceof Error ? error.message : String(error)}
            </p>
          ) : data && data.ok === false ? (
            <p className="text-xs text-neutral-500">
              {data.reason === "no-source-thread"
                ? "No source thread for this row (created manually or before the poller logged it)."
                : `Fetch failed${data.detail ? `: ${data.detail}` : "."}`}
            </p>
          ) : data && data.ok ? (
            <ThreadBody data={data} />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ThreadBody({
  data,
}: {
  data: Extract<ThreadResponse, { ok: true }>;
}) {
  return (
    <div className="flex flex-col gap-3">
      {data.summary ? (
        <p className="rounded-md border border-blue-100 bg-blue-50/40 px-2.5 py-1.5 text-xs italic text-blue-900">
          {data.summary}
        </p>
      ) : null}
      {data.messages.length === 0 ? (
        <p className="text-xs text-neutral-500">Thread is empty.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.messages.map((m) => (
            <li
              key={m.messageId}
              className={cn(
                "rounded border px-2.5 py-1.5 text-xs",
                m.isParent
                  ? "border-blue-200 bg-blue-50/30"
                  : "border-neutral-200 bg-white"
              )}
            >
              <div className="mb-1 flex items-center justify-between text-[10px] text-neutral-500">
                <span className="font-mono">
                  {m.senderId ? m.senderId.slice(-6) : "—"}
                  {m.isParent ? " · parent" : ""}
                </span>
                <span>
                  {new Date(m.createMs).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              {m.text ? (
                <p className="whitespace-pre-wrap text-neutral-800">{m.text}</p>
              ) : (
                <Badge tone="neutral">{m.placeholder ?? "[unknown]"}</Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
