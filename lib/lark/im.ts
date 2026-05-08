import { z } from "zod";
import { larkFetch } from "./client";

// Wire shape for `GET /open-apis/im/v1/messages`. Lark returns create_time
// and update_time as STRINGS of milliseconds (yes, really — strings).
// `body.content` is a JSON string whose shape depends on msg_type:
//   - text:  { "text": "..." }
//   - post:  { "title": "...", "content": [[...]] } (rich text)
//   - image: { "image_key": "..." }
//   - file:  { "file_key": "...", "file_name": "..." }
//   - share_chat / sticker / interactive / etc.
//
// We surface the raw body to callers so they can decide what to do with
// non-text messages (the poller currently skips them).

const LarkMessage = z.object({
  message_id: z.string(),
  parent_id: z.string().optional(),
  thread_id: z.string().optional(),
  msg_type: z.string(),
  create_time: z.string(),
  update_time: z.string().optional(),
  chat_id: z.string().optional(),
  sender: z
    .object({
      id: z.string(),
      id_type: z.string(),
      sender_type: z.string(),
      tenant_key: z.string().optional(),
    })
    .optional(),
  body: z.object({ content: z.string() }),
  mentions: z
    .array(
      z.object({
        key: z.string(),
        id: z.string().optional(),
        id_type: z.string().optional(),
        name: z.string().optional(),
      })
    )
    .optional(),
  upper_message_id: z.string().optional(),
  deleted: z.boolean().optional(),
  updated: z.boolean().optional(),
});

export type LarkMessage = z.infer<typeof LarkMessage>;

const ListMessagesResponse = z.object({
  code: z.number(),
  data: z
    .object({
      has_more: z.boolean().optional(),
      page_token: z.string().optional(),
      items: z.array(LarkMessage).optional(),
    })
    .optional(),
});

type ListOpts = {
  chatId: string;
  /** Inclusive lower bound (Unix seconds; Lark accepts seconds, not ms). */
  startTimeSec?: number;
  /** Inclusive upper bound. */
  endTimeSec?: number;
  /** Max per page; capped at 50 by Lark. Default 50. */
  pageSize?: number;
  /** "ByCreateTimeAsc" (default) or "ByCreateTimeDesc". */
  sortType?: "ByCreateTimeAsc" | "ByCreateTimeDesc";
  /** If true (default), auto-paginate to get every match. */
  all?: boolean;
  /** Default "chat". When "thread", `containerId` must be set to the thread_id. */
  containerIdType?: "chat" | "thread";
  /** Override the container_id used in the request. Required for thread. */
  containerId?: string;
  /** Defensive cap on auto-pagination. Threads in BD-x-Eng rarely exceed 50;
   *  the cap protects against runaway responses. */
  maxMessages?: number;
};

/**
 * List messages in a chat / thread. The user must be a member of the chat
 * (UAT scope `im:message:readonly`).
 */
export async function listChatMessages(opts: ListOpts): Promise<LarkMessage[]> {
  const out: LarkMessage[] = [];
  let pageToken: string | undefined;
  const pageSize = Math.min(opts.pageSize ?? 50, 50);
  const all = opts.all ?? true;
  const maxMessages = opts.maxMessages ?? 200;
  const containerIdType = opts.containerIdType ?? "chat";
  const containerId = opts.containerId ?? opts.chatId;
  do {
    const json = await larkFetch({
      path: "/im/v1/messages",
      query: {
        container_id_type: containerIdType,
        container_id: containerId,
        start_time: opts.startTimeSec,
        end_time: opts.endTimeSec,
        page_size: pageSize,
        page_token: pageToken,
        sort_type: opts.sortType ?? "ByCreateTimeAsc",
      },
    });
    const parsed = ListMessagesResponse.parse(json);
    for (const m of parsed.data?.items ?? []) {
      out.push(m);
      if (out.length >= maxMessages) break;
    }
    if (out.length >= maxMessages) break;
    pageToken = parsed.data?.has_more ? parsed.data.page_token : undefined;
    if (!all) break;
  } while (pageToken);
  return out;
}

// --- Body parsing helpers -------------------------------------------------

/**
 * Pull a plain-text representation out of a Lark message body. Returns null
 * for message types we don't handle (image, file, sticker, interactive, etc).
 */
export function extractMessageText(msg: LarkMessage): string | null {
  if (!msg.body?.content) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(msg.body.content);
  } catch {
    return null;
  }
  if (msg.msg_type === "text") {
    if (parsed && typeof parsed === "object" && "text" in parsed) {
      const t = (parsed as { text?: unknown }).text;
      return typeof t === "string" ? stripMentionTokens(t) : null;
    }
    return null;
  }
  if (msg.msg_type === "post") {
    return extractPostText(parsed);
  }
  return null;
}

/**
 * Lark @mentions appear inline as `@_user_1` / `@_user_2` placeholders. Strip
 * them for classification — we don't need the noise.
 */
function stripMentionTokens(t: string): string {
  return t.replace(/@_user_\d+/g, "").replace(/\s+/g, " ").trim();
}

function extractPostText(parsed: unknown): string {
  // Post body shape: { title, content: [ [ {tag, text|user_id|href|...}, ... ], ... ] }
  if (!parsed || typeof parsed !== "object") return "";
  const obj = parsed as { title?: unknown; content?: unknown };
  const title = typeof obj.title === "string" ? obj.title.trim() : "";
  const lines: string[] = [];
  if (Array.isArray(obj.content)) {
    for (const para of obj.content) {
      if (!Array.isArray(para)) continue;
      const segs: string[] = [];
      for (const seg of para) {
        if (seg && typeof seg === "object" && "text" in seg) {
          const t = (seg as { text?: unknown }).text;
          if (typeof t === "string") segs.push(t);
        }
      }
      const line = segs.join("").trim();
      if (line) lines.push(line);
    }
  }
  const body = lines.join("\n").trim();
  if (title && body) return `${title}\n\n${body}`;
  return title || body;
}
