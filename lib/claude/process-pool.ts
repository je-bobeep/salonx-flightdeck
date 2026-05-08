// Long-lived `claude -p --input-format stream-json --output-format stream-json`
// subprocess pool, keyed by scoping session id. One process per session, kept
// alive across turns. Phase B of T6.
//
// Why: the per-turn-spawn model paid Claude Code cold-start (~5-7s) and the
// MCP toolserver bootup on every turn. The probe in scripts/probe-stream-json.mjs
// confirmed that with --input-format stream-json we can write multiple user
// turns over one stdin and Claude Code emits a `result:success` event per turn
// as a clean boundary. See `docs/scoping-improvements.md#t6-probe-findings`.
//
// Public API mirrors `runClaudeTurn` in lib/claude/runner.ts so the call site
// in apps/dashboard/app/api/scoping/turn/route.ts barely changes.

import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { ensureMcpConfig, MCP_ALLOWED_TOOLS_WILDCARD } from "./mcp-config";

export type RawClaudeEvent = Record<string, unknown>;

export type PoolTurnOpts = {
  /** Scoping session id — pool key. Distinct from Claude Code's session UUID. */
  sessionId: string;
  /** Claude Code session UUID. Used as `--session-id` on first spawn,
   * `--resume` on re-spawn after eviction. */
  claudeSessionUuid: string;
  /** First turn only — system prompt baked into the spawn. Ignored on
   * re-spawns (Claude Code reads it from the persisted session via --resume). */
  systemPrompt?: string;
  /** Pre-augmented user message (the route already prepends the per-turn
   * CONTEXT block). Sent as a stream-json `user` event. */
  userMessage: string;
  /** Model alias or full id. Default 'opus'. */
  model?: string;
  /** Per-flow allowedTools — locks each flow to the propose_* tools it
   * legitimately needs. */
  allowedTools?: string[];
  /** Cancel an in-flight turn. On abort, kill the process, evict from pool —
   * next turn will respawn with --resume. */
  abortSignal?: AbortSignal;
  /** Extra disallowed tools beyond the defaults. */
  disallowedTools?: string[];
};

const DEFAULT_DISALLOWED_TOOLS = [
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
];

type Entry = {
  child: ChildProcessWithoutNullStreams;
  /** Identity hash. If a turn arrives with a different fingerprint (model
   * swap, allowlist changed, etc.) we evict + respawn. */
  fingerprint: string;
  /** Updated each time the entry serves a turn. Drives the idle reaper. */
  lastUsedMs: number;
  /** Currently-active turn, or null if idle. Used as a per-session mutex. */
  current: TurnState | null;
  /** Stderr accumulator — non-empty if the child ever logs to stderr. */
  stderrBuffer: string[];
  /** stdout NDJSON line buffer. */
  buffer: string;
  /** Set true once `child.on("close")` fires; protects against double-evict. */
  exited: boolean;
};

type TurnState = {
  /** Push a parsed event to the consumer iterator. */
  push: (e: RawClaudeEvent) => void;
  /** Mark the turn complete; iterator returns next pull. */
  done: () => void;
  /** Reject the iterator's pending pull with an error. */
  fail: (e: Error) => void;
};

type Registry = {
  entries: Map<string, Entry>;
  reapTimer: NodeJS.Timeout | null;
  shutdownInstalled: boolean;
};

// Global registry survives Next.js HMR module re-evaluation. Without this,
// every code change in dev would orphan the previous Map and its child
// processes (still running, now unreachable). See plan section "HMR-safe state".
const G = globalThis as unknown as { __flightdeckProcessPool?: Registry };

function registry(): Registry {
  if (!G.__flightdeckProcessPool) {
    G.__flightdeckProcessPool = {
      entries: new Map(),
      reapTimer: null,
      shutdownInstalled: false,
    };
  }
  return G.__flightdeckProcessPool;
}

const IDLE_MS = Number(process.env.FLIGHTDECK_POOL_IDLE_MS ?? 10 * 60 * 1000);
const REAP_INTERVAL_MS = 60_000;

function ensureLifecycle() {
  const r = registry();
  if (!r.reapTimer) {
    r.reapTimer = setInterval(() => reapIdle(), REAP_INTERVAL_MS);
    // Don't keep Node alive just for the reaper.
    r.reapTimer.unref?.();
  }
  if (!r.shutdownInstalled) {
    r.shutdownInstalled = true;
    const killAll = () => {
      for (const [, entry] of r.entries) {
        try {
          entry.child.kill("SIGTERM");
        } catch {
          /* ignore */
        }
      }
      r.entries.clear();
    };
    process.once("SIGINT", killAll);
    process.once("SIGTERM", killAll);
    process.once("exit", killAll);
  }
}

function fingerprintOf(opts: PoolTurnOpts): string {
  return JSON.stringify({
    model: opts.model ?? "opus",
    claudeUuid: opts.claudeSessionUuid,
    allowed: (opts.allowedTools ?? []).slice().sort(),
    disallowed: (opts.disallowedTools ?? []).slice().sort(),
  });
}

function buildArgs(opts: PoolTurnOpts, isFreshSession: boolean): string[] {
  const mcpConfigPath = ensureMcpConfig();
  const allowed =
    opts.allowedTools && opts.allowedTools.length > 0
      ? opts.allowedTools.join(" ")
      : MCP_ALLOWED_TOOLS_WILDCARD;
  const args = [
    "-p",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--verbose",
    "--strict-mcp-config",
    "--mcp-config", mcpConfigPath,
    "--allowedTools", allowed,
    "--disallowedTools",
    [...DEFAULT_DISALLOWED_TOOLS, ...(opts.disallowedTools ?? [])].join(" "),
    "--model", opts.model ?? "opus",
  ];
  if (isFreshSession) {
    // First time we're spawning for this Claude session UUID. --session-id
    // tells Claude Code to mint state under that uuid; --system-prompt seeds
    // the conversation.
    if (opts.systemPrompt) {
      args.push("--system-prompt", opts.systemPrompt);
    }
    args.push("--session-id", opts.claudeSessionUuid);
  } else {
    // Resume mode — Claude Code re-loads the persisted history under the
    // existing uuid. No system prompt (it's already in the persisted state).
    args.push("--resume", opts.claudeSessionUuid);
  }
  return args;
}

function spawnChild(opts: PoolTurnOpts, isFreshSession: boolean): Entry {
  const args = buildArgs(opts, isFreshSession);
  const child = spawn("claude", args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });
  const entry: Entry = {
    child,
    fingerprint: fingerprintOf(opts),
    lastUsedMs: Date.now(),
    current: null,
    stderrBuffer: [],
    buffer: "",
    exited: false,
  };

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    entry.buffer += chunk;
    let nl;
    while ((nl = entry.buffer.indexOf("\n")) >= 0) {
      const line = entry.buffer.slice(0, nl);
      entry.buffer = entry.buffer.slice(nl + 1);
      if (!line.length) continue;
      let evt: RawClaudeEvent;
      try {
        evt = JSON.parse(line) as RawClaudeEvent;
      } catch {
        evt = { type: "_unparsed", line };
      }
      const cur = entry.current;
      if (!cur) {
        // No active turn — drop the event. Shouldn't happen in normal flow
        // but defensive against race conditions.
        continue;
      }
      cur.push(evt);
      // Per-turn end marker (confirmed via probe — see docs).
      if (evt.type === "result") {
        cur.done();
      }
    }
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (c: string) => entry.stderrBuffer.push(c));

  child.on("close", (code) => {
    entry.exited = true;
    const cur = entry.current;
    if (cur) {
      // Push a stderr summary event so the consumer can surface it.
      const stderr = entry.stderrBuffer.join("");
      if (stderr.length > 0 || code !== 0) {
        cur.push({ type: "_stderr", text: stderr, exitCode: code });
      }
      cur.done();
    }
    // Remove from pool — caller will re-spawn on next turn.
    const r = registry();
    for (const [sid, e] of r.entries) {
      if (e === entry) r.entries.delete(sid);
    }
  });

  child.on("error", (err) => {
    entry.exited = true;
    entry.stderrBuffer.push(`spawn error: ${err.message}`);
    const cur = entry.current;
    if (cur) cur.fail(err);
  });

  return entry;
}

/**
 * Spawn a process for this session WITHOUT sending a user turn. The process
 * idles waiting for stdin. By the time the user types their first message,
 * Claude Code's init + MCP toolserver boot are already done, so the first
 * turn skips the cold-start tax (~5-10s of subprocess startup that otherwise
 * lands inside the user's perceived first-token latency).
 *
 * Idempotent. No-op if a process for this session is already in the pool.
 */
export function warmUp(opts: {
  sessionId: string;
  claudeSessionUuid: string;
  systemPrompt?: string;
  model?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
}): void {
  ensureLifecycle();
  const r = registry();
  const fakeOpts: PoolTurnOpts = {
    sessionId: opts.sessionId,
    claudeSessionUuid: opts.claudeSessionUuid,
    systemPrompt: opts.systemPrompt,
    userMessage: "", // unused — we don't write stdin
    model: opts.model,
    allowedTools: opts.allowedTools,
    disallowedTools: opts.disallowedTools,
  };
  const existing = r.entries.get(opts.sessionId);
  if (existing && !existing.exited) {
    if (existing.fingerprint === fingerprintOf(fakeOpts)) return; // already warm
    evict(opts.sessionId);
  }
  // Spawn fresh. systemPrompt presence flags this as "first ever turn for
  // this Claude session UUID" — same flag the spawn args build uses.
  const isFirstEverTurn = !!opts.systemPrompt;
  const entry = spawnChild(fakeOpts, isFirstEverTurn);
  r.entries.set(opts.sessionId, entry);
}

/** Drop the pool entry for sessionId and SIGTERM the child. Idempotent. */
export function evict(sessionId: string): void {
  const r = registry();
  const entry = r.entries.get(sessionId);
  if (!entry) return;
  r.entries.delete(sessionId);
  if (!entry.exited) {
    try {
      entry.child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
}

/** Sweep entries idle longer than IDLE_MS. */
export function reapIdle(): void {
  const r = registry();
  const now = Date.now();
  for (const [sid, entry] of r.entries) {
    if (entry.current) continue; // active turn — don't kill mid-stream
    if (now - entry.lastUsedMs >= IDLE_MS) {
      r.entries.delete(sid);
      try {
        entry.child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }
  }
}

function userEvent(text: string): string {
  return (
    JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text }],
      },
    }) + "\n"
  );
}

/**
 * Send one user turn through the pool. Async-iterates Claude's stream-json
 * events. Completes when the per-turn `result` event arrives (confirmed
 * boundary; see probe findings).
 *
 * On abort: kills the child + evicts from pool. The next sendTurn for this
 * sessionId will respawn with --resume.
 *
 * On per-session concurrency: rejects if a turn is already in flight for
 * this sessionId. The UI's composerDisabled invariant should prevent this,
 * but defensive-in-depth.
 */
export async function* sendTurn(
  opts: PoolTurnOpts
): AsyncIterableIterator<RawClaudeEvent> {
  ensureLifecycle();
  const r = registry();

  let entry = r.entries.get(opts.sessionId);
  if (entry && entry.fingerprint !== fingerprintOf(opts)) {
    // Model / allowlist changed — evict and respawn fresh.
    evict(opts.sessionId);
    entry = undefined;
  }
  if (entry && entry.exited) {
    // Stale entry from a process that already closed.
    r.entries.delete(opts.sessionId);
    entry = undefined;
  }
  let isFreshSpawn = false;
  let isFirstEverTurn = false;
  if (!entry) {
    isFreshSpawn = true;
    // "First ever turn" means we haven't recorded anything in Claude Code's
    // session storage yet. We approximate this with: was systemPrompt passed?
    // The route only passes it on the first user turn (see turn/route.ts).
    isFirstEverTurn = !!opts.systemPrompt;
    entry = spawnChild(opts, isFirstEverTurn);
    r.entries.set(opts.sessionId, entry);
  }
  if (entry.current) {
    throw new Error(
      `[process-pool] session ${opts.sessionId} already has a turn in flight`
    );
  }

  // Plumb the abort signal — on abort, evict (kills the child, drops entry,
  // close handler cleans up). The current turn's promise rejects via fail().
  const onAbort = () => evict(opts.sessionId);
  if (opts.abortSignal) {
    if (opts.abortSignal.aborted) {
      evict(opts.sessionId);
      throw new Error("aborted before first turn");
    }
    opts.abortSignal.addEventListener("abort", onAbort, { once: true });
  }

  // Build a queue + per-pull promise so we can yield events as they arrive.
  const queue: RawClaudeEvent[] = [];
  let resolveNext: (() => void) | null = null;
  let rejectNext: ((e: Error) => void) | null = null;
  let done = false;
  let failure: Error | null = null;

  entry.current = {
    push(evt) {
      queue.push(evt);
      resolveNext?.();
      resolveNext = null;
      rejectNext = null;
    },
    done() {
      done = true;
      resolveNext?.();
      resolveNext = null;
      rejectNext = null;
    },
    fail(err) {
      failure = err;
      rejectNext?.(err);
      resolveNext = null;
      rejectNext = null;
    },
  };

  // Write the user event AFTER setting up `current` so any racing stdout is
  // captured by the dispatcher.
  try {
    entry.child.stdin.write(userEvent(opts.userMessage));
  } catch (err) {
    entry.current = null;
    opts.abortSignal?.removeEventListener("abort", onAbort);
    throw err instanceof Error ? err : new Error(String(err));
  }

  try {
    while (true) {
      if (queue.length > 0) {
        const evt = queue.shift()!;
        yield evt;
        continue;
      }
      if (done) break;
      if (failure) throw failure;
      await new Promise<void>((resolve, reject) => {
        resolveNext = resolve;
        rejectNext = reject;
      });
    }
    // Drain anything that landed between the last loop check and `done`.
    while (queue.length > 0) {
      yield queue.shift()!;
    }
  } finally {
    if (entry) {
      entry.current = null;
      entry.lastUsedMs = Date.now();
    }
    opts.abortSignal?.removeEventListener("abort", onAbort);
  }

  // Note: `isFreshSpawn` / `isFirstEverTurn` are computed but only used
  // inside spawnChild via buildArgs. They're declared here so future
  // observability hooks (turn-count logging, etc.) can read them.
  void isFreshSpawn;
  void isFirstEverTurn;
}

/** Test/debug helper — exposes the pool's current size. */
export function poolSize(): number {
  return registry().entries.size;
}
