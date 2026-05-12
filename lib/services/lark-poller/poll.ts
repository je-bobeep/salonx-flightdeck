// Single-cycle poll. Reads new IM messages since the last watermark, classifies
// them with Claude, and writes BD Feedback rows. Idempotent via poller_ingest_log.

import {
  extractMessageText,
  listChatMessages,
  type LarkMessage,
} from "@flightdeck/lark/im";
import { listFields } from "@flightdeck/lark/bitable";
import { TRACKER } from "@flightdeck/lark/wiki";
import { POLLER_CONFIG } from "./config";
import {
  classifyMessage,
  detectPriority,
  type Classification,
  type DetectedPriority,
} from "./classify";
import { ingestMessage } from "./ingest";
import { isWorkflowEnabled } from "./killswitch";
import {
  getPollerState,
  hasIngested,
  logIngest,
  recentIngestLog,
  upsertPollerState,
} from "./state";

export type PollSummary = {
  chatId: string;
  startedAt: number;
  finishedAt: number;
  fetched: number;
  ingested: number;
  skipped: number;
  failed: number;
  results: Array<{
    messageId: string;
    state: "ingested" | "skipped" | "failed";
    bdNumber?: string;
    bdRecordId?: string;
    detectedPriority?: DetectedPriority;
    error?: string;
    reason?: string;
  }>;
};

let cachedCategories: string[] | null = null;
async function loadKnownCategories(): Promise<string[]> {
  // Only use the cache when it actually has entries — caching an empty array
  // would mean a single failed lookup poisons the rest of the process
  // lifetime. listFields() has its own 5-min TTL, so re-asking is cheap.
  if (cachedCategories && cachedCategories.length > 0) return cachedCategories;
  const fields = await listFields(
    TRACKER.appToken,
    TRACKER.tables.bdFeedback
  );
  const categoryField = fields.find((f) => f.fieldName === "Category");
  if (!categoryField) return [];
  // Lark MultiSelect property includes options[].name
  const prop = categoryField.property as
    | { options?: Array<{ name?: unknown }> }
    | undefined;
  const names = (prop?.options ?? [])
    .map((o) => o.name)
    .filter((n): n is string => typeof n === "string");
  cachedCategories = names;
  return names;
}

/**
 * Run a single poll cycle. Safe to call manually from a route handler or on
 * a setInterval. Always updates the watermark, even on partial failure
 * (failed messages live in poller_ingest_log with state='failed' and won't
 * retry until the user manually re-runs).
 */
export async function pollOnce(opts: { log?: (s: string) => void } = {}): Promise<PollSummary> {
  const log = opts.log ?? (() => {});
  const chatId = POLLER_CONFIG.chatId;
  const startedAt = Date.now();

  // KILLSWITCH check FIRST — before any Lark API call or DB write. Allows
  // hot-disable without restarting the systemd unit: edit KILLSWITCH.md,
  // wait for the next cycle.
  const ks = isWorkflowEnabled("lark-bd-poller");
  if (!ks.enabled) {
    log(`[poller] killswitch off${ks.reason ? ` (${ks.reason})` : ""}, skipping cycle`);
    return {
      chatId,
      startedAt,
      finishedAt: Date.now(),
      fetched: 0,
      ingested: 0,
      skipped: 0,
      failed: 0,
      results: [],
    };
  }

  const summary: PollSummary = {
    chatId,
    startedAt,
    finishedAt: 0,
    fetched: 0,
    ingested: 0,
    skipped: 0,
    failed: 0,
    results: [],
  };

  const state = getPollerState(chatId);
  const lastSeenMs =
    state?.lastSeenCreateMs ?? Date.now() - POLLER_CONFIG.initialLookbackMs;
  // Lark IM API uses UNIX SECONDS for start_time, not ms. Add 1s so we
  // exclude the boundary message (already processed on the prior cycle).
  const startTimeSec = Math.floor(lastSeenMs / 1000) + 1;

  log(`[poller] chat=${chatId} since=${new Date(lastSeenMs).toISOString()}`);

  let messages: LarkMessage[] = [];
  try {
    messages = await listChatMessages({
      chatId,
      startTimeSec,
      sortType: "ByCreateTimeAsc",
      pageSize: 50,
    });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    log(`[poller] fetch failed: ${errMsg}`);
    upsertPollerState({
      chatId,
      lastSeenCreateMs: lastSeenMs,
      lastSeenMessageId: state?.lastSeenMessageId ?? null,
      lastRunAt: startedAt,
      lastRunProcessed: 0,
      lastRunError: `fetch: ${errMsg}`,
    });
    summary.finishedAt = Date.now();
    return summary;
  }

  summary.fetched = messages.length;
  log(`[poller] fetched ${messages.length} message(s)`);

  // Cap to maxMessagesPerCycle to prevent runaway costs on backfill
  const toProcess = messages.slice(0, POLLER_CONFIG.maxMessagesPerCycle);

  // Load known categories once per cycle (cached for the process lifetime)
  let knownCategories: string[] = [];
  try {
    knownCategories = await loadKnownCategories();
  } catch (e) {
    log(
      `[poller] warning: failed to load known Category options: ${
        e instanceof Error ? e.message : String(e)
      }`
    );
  }

  let newestProcessedMs = lastSeenMs;
  let newestProcessedId: string | null = state?.lastSeenMessageId ?? null;

  for (const msg of toProcess) {
    const createMs = parseInt(msg.create_time, 10);
    if (!Number.isFinite(createMs)) continue;

    if (hasIngested(msg.message_id)) {
      log(`[poller] skip ${msg.message_id} (already in log)`);
      newestProcessedMs = Math.max(newestProcessedMs, createMs);
      newestProcessedId = msg.message_id;
      continue;
    }

    const result = await processOne(msg, knownCategories, log);
    summary.results.push(result);
    if (result.state === "ingested") summary.ingested++;
    else if (result.state === "skipped") summary.skipped++;
    else summary.failed++;

    newestProcessedMs = Math.max(newestProcessedMs, createMs);
    newestProcessedId = msg.message_id;
  }

  upsertPollerState({
    chatId,
    lastSeenCreateMs: newestProcessedMs,
    lastSeenMessageId: newestProcessedId,
    lastRunAt: startedAt,
    lastRunProcessed: summary.results.length,
    lastRunError: summary.failed > 0 ? `${summary.failed} failed` : null,
  });

  summary.finishedAt = Date.now();
  return summary;
}

async function processOne(
  msg: LarkMessage,
  knownCategories: string[],
  log: (s: string) => void
): Promise<PollSummary["results"][number]> {
  const createMs = parseInt(msg.create_time, 10);

  // Skip threaded replies — only top-level messages become BD rows.
  if (msg.parent_id) {
    logIngest({
      messageId: msg.message_id,
      chatId: msg.chat_id ?? POLLER_CONFIG.chatId,
      messageCreateMs: createMs,
      bdRecordId: null,
      bdNumber: null,
      state: "skipped",
      detectedPriority: null,
      category: null,
      subCategory: null,
      error: "thread reply",
      rawText: null,
    });
    return {
      messageId: msg.message_id,
      state: "skipped",
      reason: "thread reply",
    };
  }

  const text = extractMessageText(msg);
  if (!text || text.length < POLLER_CONFIG.minTextLength) {
    logIngest({
      messageId: msg.message_id,
      chatId: msg.chat_id ?? POLLER_CONFIG.chatId,
      messageCreateMs: createMs,
      bdRecordId: null,
      bdNumber: null,
      state: "skipped",
      detectedPriority: null,
      category: null,
      subCategory: null,
      error: text === null ? `non-text msg_type: ${msg.msg_type}` : "too short",
      rawText: text,
    });
    return {
      messageId: msg.message_id,
      state: "skipped",
      reason: text === null ? `non-text msg_type: ${msg.msg_type}` : "too short",
    };
  }

  const priority = detectPriority(text);
  log(
    `[poller] classify ${msg.message_id} priority=${priority ?? "-"} (${text.slice(0, 80)}…)`
  );

  let classification: Classification | null;
  try {
    classification = await classifyMessage({
      text,
      knownCategories,
    });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    logIngest({
      messageId: msg.message_id,
      chatId: msg.chat_id ?? POLLER_CONFIG.chatId,
      messageCreateMs: createMs,
      bdRecordId: null,
      bdNumber: null,
      state: "failed",
      detectedPriority: priority,
      category: null,
      subCategory: null,
      error: `classify: ${err}`,
      rawText: text,
    });
    return { messageId: msg.message_id, state: "failed", error: `classify: ${err}` };
  }

  if (!classification) {
    logIngest({
      messageId: msg.message_id,
      chatId: msg.chat_id ?? POLLER_CONFIG.chatId,
      messageCreateMs: createMs,
      bdRecordId: null,
      bdNumber: null,
      state: "failed",
      detectedPriority: priority,
      category: null,
      subCategory: null,
      error: "classify: no JSON returned",
      rawText: text,
    });
    return {
      messageId: msg.message_id,
      state: "failed",
      error: "classify: no JSON returned",
    };
  }

  if (!classification.isFeedback) {
    logIngest({
      messageId: msg.message_id,
      chatId: msg.chat_id ?? POLLER_CONFIG.chatId,
      messageCreateMs: createMs,
      bdRecordId: null,
      bdNumber: null,
      state: "skipped",
      detectedPriority: priority,
      category: classification.category.join(", ") || null,
      subCategory: classification.subCategory || null,
      error: `chitchat: ${classification.reasoning.slice(0, 100)}`,
      rawText: text,
    });
    return {
      messageId: msg.message_id,
      state: "skipped",
      reason: `chitchat (${classification.reasoning.slice(0, 80)})`,
    };
  }

  try {
    const ingest = await ingestMessage({
      message: msg,
      text,
      classification,
      priority,
    });
    logIngest({
      messageId: msg.message_id,
      chatId: msg.chat_id ?? POLLER_CONFIG.chatId,
      messageCreateMs: createMs,
      bdRecordId: ingest.bdRecordId,
      bdNumber: ingest.bdNumber,
      state: "ingested",
      detectedPriority: priority,
      category: classification.category.join(", ") || null,
      subCategory: classification.subCategory || null,
      error: null,
      rawText: text,
    });
    log(
      `[poller] ingested #${ingest.bdNumber} (${ingest.bdRecordId}) priority=${priority ?? "-"} cat=${classification.category.join("|") || "-"}`
    );
    return {
      messageId: msg.message_id,
      state: "ingested",
      bdNumber: ingest.bdNumber,
      bdRecordId: ingest.bdRecordId,
      detectedPriority: priority,
    };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    logIngest({
      messageId: msg.message_id,
      chatId: msg.chat_id ?? POLLER_CONFIG.chatId,
      messageCreateMs: createMs,
      bdRecordId: null,
      bdNumber: null,
      state: "failed",
      detectedPriority: priority,
      category: classification.category.join(", ") || null,
      subCategory: classification.subCategory || null,
      error: `write: ${err}`,
      rawText: text,
    });
    return { messageId: msg.message_id, state: "failed", error: `write: ${err}` };
  }
}

// Exposed for the admin UI / dashboard.
export { recentIngestLog, getPollerState };
