// Server-side helpers for fetching the originating Lark thread for a BD row.
//
// Data linkage: the poller writes a row to `poller_ingest_log` for every BD row
// it creates (lib/services/lark-poller/state.ts:115-148). That row carries
// chat_id + message_id and (via Lark) the parent message's thread_id once
// replies exist. We reverse-look up by bd_record_id to find the source.
//
// Cache: SQLite table `lark_thread_cache` keyed by thread_id. TTL 24h. Manual
// refresh bypasses TTL. We persist the one-line Claude summary alongside the
// raw transcript to avoid re-running the summary call on every panel open.

import path from "node:path";
import Database from "better-sqlite3";
import {
  extractMessageText,
  listChatMessages,
  type LarkMessage,
} from "@flightdeck/lark/im";
import { getIngestByBdRecordId } from "@flightdeck/poller/state";
import { runClaudeOneShot } from "@flightdeck/claude/runner";

const TTL_MS = 24 * 60 * 60 * 1000;

function dbPath() {
  return process.env.FLIGHTDECK_DB_PATH
    ? path.resolve(process.env.FLIGHTDECK_DB_PATH)
    : path.resolve(process.cwd(), "../../.data/tokens.db");
}

let cachedDb: Database.Database | null = null;
function db() {
  if (cachedDb) return cachedDb;
  cachedDb = new Database(dbPath());
  cachedDb.pragma("journal_mode = WAL");
  return cachedDb;
}

type CachedRow = {
  thread_id: string;
  bd_record_id: string | null;
  messages_json: string;
  summary_text: string | null;
  fetched_at: number;
};

function readCache(threadId: string): CachedRow | null {
  return (
    (db()
      .prepare(
        `SELECT thread_id, bd_record_id, messages_json, summary_text, fetched_at
         FROM lark_thread_cache WHERE thread_id = ?`
      )
      .get(threadId) as CachedRow | undefined) ?? null
  );
}

function writeCacheViews(input: {
  threadId: string;
  bdRecordId: string | null;
  views: ThreadMessageView[];
  summary: string | null;
}) {
  db()
    .prepare(
      `INSERT INTO lark_thread_cache (thread_id, bd_record_id, messages_json, summary_text, fetched_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(thread_id) DO UPDATE SET
         bd_record_id  = excluded.bd_record_id,
         messages_json = excluded.messages_json,
         summary_text  = excluded.summary_text,
         fetched_at    = excluded.fetched_at`
    )
    .run(
      input.threadId,
      input.bdRecordId,
      JSON.stringify(input.views),
      input.summary,
      Date.now()
    );
}

export type ThreadMessageView = {
  messageId: string;
  msgType: string;
  /** Plain text if extractable; null when the message is media/file/post we
   *  surface as a typed placeholder instead. */
  text: string | null;
  /** "[image]" / "[file: name.pdf]" / "[post]" / null. Mutually exclusive with text. */
  placeholder: string | null;
  senderId: string | null;
  createMs: number;
  isParent: boolean;
};

export type ThreadContextResult =
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

function placeholderFor(msg: LarkMessage): string | null {
  if (msg.msg_type === "text") return null;
  if (msg.msg_type === "post") {
    // post is text-y; extractMessageText handles it. If it returned null,
    // surface as [post] so the user knows there's content they can't see.
    return "[post]";
  }
  if (msg.msg_type === "image") return "[image]";
  if (msg.msg_type === "file") {
    // best-effort filename
    try {
      const body = JSON.parse(msg.body?.content ?? "{}");
      const name = typeof body?.file_name === "string" ? body.file_name : null;
      return name ? `[file: ${name}]` : "[file]";
    } catch {
      return "[file]";
    }
  }
  if (msg.msg_type === "audio") return "[audio]";
  if (msg.msg_type === "media") return "[media]";
  if (msg.msg_type === "sticker") return "[sticker]";
  if (msg.msg_type === "interactive") return "[card]";
  if (msg.msg_type === "share_chat") return "[shared chat]";
  if (msg.msg_type === "share_user") return "[shared user]";
  return `[${msg.msg_type}]`;
}

function toView(msg: LarkMessage, parentMessageId: string): ThreadMessageView {
  const text = extractMessageText(msg);
  const placeholder = text ? null : placeholderFor(msg);
  return {
    messageId: msg.message_id,
    msgType: msg.msg_type,
    text,
    placeholder,
    senderId: msg.sender?.id ?? null,
    createMs: parseInt(msg.create_time, 10) || 0,
    isParent: msg.message_id === parentMessageId,
  };
}

async function summarizeThread(
  views: ThreadMessageView[]
): Promise<string | null> {
  // Build a compact transcript. Cap input to keep prompt size predictable.
  const lines = views.map((v) => {
    const body = v.text ?? v.placeholder ?? "";
    return `${new Date(v.createMs).toISOString().slice(0, 16)}: ${body.slice(0, 240)}`;
  });
  const transcript = lines.join("\n").slice(0, 4000);
  if (!transcript.trim()) return null;
  try {
    const result = await runClaudeOneShot({
      systemPrompt:
        "You will receive a Lark IM thread that originated a BD feedback row. Output ONE plain sentence (no markdown, no JSON, no preamble) that captures the key context (customer name, urgency cues, deadline mentions if any). Maximum 30 words.",
      userMessage: transcript,
      model: "haiku",
      disableMcp: true,
    });
    const t = (result.resultText || "").trim();
    if (!t) return null;
    // Defensive trim — if Claude added quotes, strip them.
    return t.replace(/^["']|["']$/g, "").slice(0, 280);
  } catch (e) {
    console.warn(
      "[thread-context] summary failed: %s",
      e instanceof Error ? e.message : String(e)
    );
    return null;
  }
}

async function fetchThread(threadId: string): Promise<LarkMessage[]> {
  return listChatMessages({
    chatId: "",
    containerIdType: "thread",
    containerId: threadId,
    sortType: "ByCreateTimeAsc",
    pageSize: 50,
    maxMessages: 200,
  });
}

export async function getThreadForBd(
  bdRecordId: string,
  opts: { refresh?: boolean } = {}
): Promise<ThreadContextResult> {
  const ingest = getIngestByBdRecordId(bdRecordId);
  if (!ingest) {
    return { ok: false, reason: "no-source-thread" };
  }

  // The poller's parent message is the BD-source. If it has no replies yet,
  // Lark won't have assigned a thread_id; fall back to single-message view.
  // We need to fetch the parent message itself first to learn its thread_id.
  // The poller_ingest_log carries the message_id but not the thread_id, so we
  // do a single-message read by querying the chat with a tight time bracket.

  // Cheap path: try a chat-listing for one second around the message's ts.
  // This avoids a separate "get message by id" endpoint we don't have here.
  let parent: LarkMessage | null = null;
  try {
    const around = await listChatMessages({
      chatId: ingest.chatId,
      startTimeSec: Math.floor(ingest.messageCreateMs / 1000),
      endTimeSec: Math.floor(ingest.messageCreateMs / 1000) + 1,
      pageSize: 5,
      maxMessages: 5,
      all: false,
    });
    parent = around.find((m) => m.message_id === ingest.messageId) ?? null;
  } catch (e) {
    return {
      ok: false,
      reason: "fetch-failed",
      detail: e instanceof Error ? e.message : String(e),
    };
  }

  const threadId = parent?.thread_id ?? null;

  // No thread_id ⇒ no replies. Render the parent alone.
  if (!threadId) {
    if (!parent) {
      return {
        ok: false,
        reason: "fetch-failed",
        detail: "could not refetch parent message",
      };
    }
    const view = toView(parent, parent.message_id);
    const cacheKey = `single:${parent.message_id}`;
    if (!opts.refresh) {
      const cached = readCache(cacheKey);
      if (cached && Date.now() - cached.fetched_at < TTL_MS) {
        return {
          ok: true,
          source: {
            bdRecordId,
            messageId: ingest.messageId,
            chatId: ingest.chatId,
            threadId: null,
          },
          messages: JSON.parse(cached.messages_json) as ThreadMessageView[],
          summary: cached.summary_text,
          cacheAgeMs: Date.now() - cached.fetched_at,
          cacheHit: true,
        };
      }
    }
    const summary = await summarizeThread([view]);
    writeCacheViews({
      threadId: cacheKey,
      bdRecordId,
      views: [view],
      summary,
    });
    return {
      ok: true,
      source: {
        bdRecordId,
        messageId: ingest.messageId,
        chatId: ingest.chatId,
        threadId: null,
      },
      messages: [view],
      summary,
      cacheAgeMs: 0,
      cacheHit: false,
    };
  }

  // Thread case — TTL cache.
  if (!opts.refresh) {
    const cached = readCache(threadId);
    if (cached && Date.now() - cached.fetched_at < TTL_MS) {
      let views: ThreadMessageView[] = [];
      try {
        views = JSON.parse(cached.messages_json) as ThreadMessageView[];
      } catch {
        views = [];
      }
      if (views.length > 0) {
        return {
          ok: true,
          source: {
            bdRecordId,
            messageId: ingest.messageId,
            chatId: ingest.chatId,
            threadId,
          },
          messages: views,
          summary: cached.summary_text,
          cacheAgeMs: Date.now() - cached.fetched_at,
          cacheHit: true,
        };
      }
    }
  }

  let raw: LarkMessage[] = [];
  try {
    raw = await fetchThread(threadId);
  } catch (e) {
    return {
      ok: false,
      reason: "fetch-failed",
      detail: e instanceof Error ? e.message : String(e),
    };
  }

  // Sort oldest first (the API is supposed to honor sort_type but defensive).
  raw.sort(
    (a, b) => (parseInt(a.create_time, 10) || 0) - (parseInt(b.create_time, 10) || 0)
  );
  const views = raw.map((m) => toView(m, ingest.messageId));
  const summary = await summarizeThread(views);

  writeCacheViews({ threadId, bdRecordId, views, summary });

  return {
    ok: true,
    source: {
      bdRecordId,
      messageId: ingest.messageId,
      chatId: ingest.chatId,
      threadId,
    },
    messages: views,
    summary,
    cacheAgeMs: 0,
    cacheHit: false,
  };
}
