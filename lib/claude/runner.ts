import { spawn } from "node:child_process";
import {
  ensureMcpConfig,
  MCP_ALLOWED_TOOLS_WILDCARD,
  MCP_TOOL_PREFIX,
} from "./mcp-config";
import { sendTurn as poolSendTurn } from "./process-pool";

export type RunnerOptions = {
  /** Scoping session id — the pool key. Each session id holds one long-lived
   * `claude` subprocess across turns. */
  scopingSessionId: string;
  /** System prompt for the conversation. Required on the first turn; ignored when resume is set. */
  systemPrompt?: string;
  /** Current user message, sent on stdin. */
  userMessage: string;
  /** Claude Code session UUID to resume from (continues prior turns). */
  resume?: string;
  /** Pre-set session UUID for the very first turn. Lets caller persist it before the call. */
  sessionId?: string;
  /** Model alias (e.g. 'opus') or full id (e.g. 'claude-opus-4-7'). Default 'opus'. */
  model?: string;
  /** Cancel an in-flight turn. */
  abortSignal?: AbortSignal;
  /** Extra disallowed tools (beyond the defaults). Default disallows built-in editing. */
  disallowedTools?: string[];
  /** Override the default `mcp__flightdeck__*` wildcard. Used by the
   * scoping flows to lock down which propose_* tools each flow can fire
   * (e.g. weekly-review can't accidentally propose a dev ticket). */
  allowedTools?: string[];
};

/**
 * Pre-built allowedTool sets per scoping flow. Read tools (lark.read_*,
 * siblings.*) are available to every flow; writes are scoped to what each
 * flow legitimately needs.
 */
const READ_TOOLS = [
  `${MCP_TOOL_PREFIX}lark_read_bd_feedback`,
  `${MCP_TOOL_PREFIX}lark_read_feature_dev`,
  `${MCP_TOOL_PREFIX}lark_search_feature_dev`,
  `${MCP_TOOL_PREFIX}siblings_read_index`,
  `${MCP_TOOL_PREFIX}siblings_read_file`,
  `${MCP_TOOL_PREFIX}siblings_search_prd_index`,
  `${MCP_TOOL_PREFIX}siblings_git_log_grep`,
  `${MCP_TOOL_PREFIX}siblings_gh_pr_search`,
  `${MCP_TOOL_PREFIX}siblings_kb_search`,
  `${MCP_TOOL_PREFIX}siblings_code_grep`,
];

export const FLOW_ALLOWED_TOOLS: Record<string, string[]> = {
  "bd-to-dev": [
    ...READ_TOOLS,
    `${MCP_TOOL_PREFIX}propose_create_dev_ticket`,
    `${MCP_TOOL_PREFIX}propose_create_bd_dev_link`,
    `${MCP_TOOL_PREFIX}propose_update_bd_status`,
  ],
  "pair-sanity": [
    ...READ_TOOLS,
    `${MCP_TOOL_PREFIX}propose_update_bd_status`,
  ],
  "weekly-review": [
    ...READ_TOOLS,
    `${MCP_TOOL_PREFIX}propose_write_stakeholder_md`,
  ],
};

/**
 * Fail-closed lookup. An unknown flow_type doesn't fall through to the
 * wildcard (which would defeat the per-flow lockdown); it gets read tools
 * only, and a warn is logged so the gap is visible in server output.
 */
export function allowedToolsForFlow(flowType: string): string[] {
  const known = FLOW_ALLOWED_TOOLS[flowType];
  if (known) return known;
  console.warn(
    `[runner] unknown flow_type=${JSON.stringify(flowType)} — falling back to read-only tools. Add an entry to FLOW_ALLOWED_TOOLS.`
  );
  return READ_TOOLS;
}

// DEFAULT_DISALLOWED_TOOLS for the scoping flow lives in `./process-pool.ts`
// now (the single spawn site). runClaudeOneShot below has its own surface
// and doesn't need the same defaults.

export type RawClaudeEvent = Record<string, unknown>;

/**
 * Run one user turn for a scoping session against a long-lived `claude -p
 * --input-format stream-json --output-format stream-json` subprocess. The
 * actual subprocess management lives in `./process-pool.ts`; this wrapper
 * preserves the existing call-site contract (yield NDJSON events; complete
 * when the turn ends).
 *
 * Per-turn end is the `result` event (confirmed via the Phase-A probe). On
 * abort, the pool kills the child + drops the entry; the next turn for the
 * same scoping session re-spawns with `--resume` and Claude Code re-loads
 * the persisted history.
 */
export async function* runClaudeTurn(
  opts: RunnerOptions
): AsyncIterableIterator<RawClaudeEvent> {
  // Caller passes either `sessionId` (first turn) or `resume` — both reference
  // the same Claude Code session UUID; the difference is which CLI flag the
  // pool uses on the spawn. `resume` wins when both are set.
  const claudeSessionUuid = opts.resume ?? opts.sessionId;
  if (!claudeSessionUuid) {
    throw new Error(
      "[runner] runClaudeTurn requires either `sessionId` or `resume` (Claude Code session UUID)"
    );
  }
  yield* poolSendTurn({
    sessionId: opts.scopingSessionId,
    claudeSessionUuid,
    systemPrompt: opts.systemPrompt,
    userMessage: opts.userMessage,
    model: opts.model,
    allowedTools: opts.allowedTools,
    abortSignal: opts.abortSignal,
    disallowedTools: opts.disallowedTools,
  });
}

// --- One-shot helper -----------------------------------------------------

export type OneShotResult = {
  resultText: string;
  /** Parsed JSON if Claude returned valid JSON; otherwise null. */
  json: unknown | null;
  exitCode: number | null;
  stderr: string;
};

/**
 * Run `claude -p` to completion and return a single result. Use this for
 * classification / structured-output calls where streaming isn't needed.
 *
 * Uses --output-format json for the simplest single-result envelope, with
 * MCP servers attached so tool use is still possible. If `disableMcp` is set,
 * runs without our MCP toolserver entirely (cheap, no tool overhead).
 */
export async function runClaudeOneShot(opts: {
  systemPrompt?: string;
  userMessage: string;
  model?: string;
  cwd?: string;
  abortSignal?: AbortSignal;
  /** When true, don't load the flightdeck MCP server. Default true for the
   *  poller use case (no tools needed for classification). */
  disableMcp?: boolean;
  /** Extra disallowed built-in tools. */
  disallowedTools?: string[];
}): Promise<OneShotResult> {
  const args: string[] = ["-p", "--output-format", "json"];
  if (opts.disableMcp ?? true) {
    // Pass a valid (empty) MCP config — `{}` literal fails schema validation.
    args.push(
      "--strict-mcp-config",
      "--mcp-config",
      JSON.stringify({ mcpServers: {} })
    );
  } else {
    const mcpPath = ensureMcpConfig();
    args.push("--strict-mcp-config", "--mcp-config", mcpPath);
    args.push("--allowedTools", MCP_ALLOWED_TOOLS_WILDCARD);
  }
  if (opts.disallowedTools && opts.disallowedTools.length > 0) {
    args.push("--disallowedTools", opts.disallowedTools.join(" "));
  }
  if (opts.systemPrompt) {
    args.push("--system-prompt", opts.systemPrompt);
  }
  args.push("--model", opts.model ?? "sonnet");

  const child = spawn("claude", args, {
    cwd: opts.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });

  if (opts.abortSignal) {
    if (opts.abortSignal.aborted) {
      child.kill("SIGTERM");
    } else {
      opts.abortSignal.addEventListener(
        "abort",
        () => child.kill("SIGTERM"),
        { once: true }
      );
    }
  }

  child.stdin.end(opts.userMessage);

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (c: string) => (stdout += c));
  child.stderr.on("data", (c: string) => (stderr += c));

  const exitCode = await new Promise<number | null>((resolve) => {
    child.on("close", (code) => resolve(code));
    child.on("error", () => resolve(-1));
  });

  // claude --output-format json wraps the assistant result in
  // { type: "result", subtype: "success", result: "...", ... }
  let resultText = "";
  let envelope: unknown = null;
  try {
    envelope = JSON.parse(stdout);
    if (envelope && typeof envelope === "object") {
      const obj = envelope as { result?: unknown; type?: unknown };
      if (typeof obj.result === "string") resultText = obj.result;
    }
  } catch {
    // Couldn't parse the envelope; surface the raw stdout as resultText.
    resultText = stdout;
  }

  // Try to extract JSON from the result body. Tolerate ```json fences and
  // wrapping prose ("Here's the JSON: { ... }").
  let parsed: unknown = null;
  if (resultText) {
    const stripped = resultText
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();
    try {
      parsed = JSON.parse(stripped);
    } catch {
      // Fallback: find the first balanced JSON object in the text.
      const extracted = extractJsonObject(stripped);
      if (extracted) {
        try {
          parsed = JSON.parse(extracted);
        } catch {
          // give up
        }
      }
    }
  }

  return { resultText, json: parsed, exitCode, stderr };
}

/**
 * Find the first balanced top-level JSON object in `s`, ignoring braces inside
 * strings. Returns the substring or null if none found. Used as a fallback when
 * Claude wraps JSON output in prose.
 */
function extractJsonObject(s: string): string | null {
  let start = -1;
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (start === -1) {
      if (c === "{") {
        start = i;
        depth = 1;
      }
      continue;
    }
    if (inStr) {
      if (escape) {
        escape = false;
      } else if (c === "\\") {
        escape = true;
      } else if (c === '"') {
        inStr = false;
      }
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}
