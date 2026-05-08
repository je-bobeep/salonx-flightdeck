#!/usr/bin/env node
// Phase-A probe for T6 (long-lived runner per scoping session).
//
// Spawns ONE `claude -p --input-format stream-json --output-format stream-json`
// process, feeds it two user messages separated by a sleep, and dumps every
// stdout event to /tmp/probe-stream-json.json with a wall-clock timestamp.
//
// What we're confirming:
//   1. Stdin wire format — what shape of NDJSON does Claude actually accept?
//   2. End-of-turn marker — does each turn cleanly emit a `result` event or
//      an `assistant` event with a `stop_reason`?
//   3. Two-turn behaviour — does the second user message produce a second
//      response without restarting the process?
//   4. --replay-user-messages — does it echo our user event back as an
//      explicit handshake?
//
// Run: node scripts/probe-stream-json.mjs

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const OUT_FILE = "/tmp/probe-stream-json.json";
const PROBE_TIMEOUT_MS = 240_000;
const REPLAY_FLAG = process.argv.includes("--replay");

const args = [
  "-p",
  "--input-format", "stream-json",
  "--output-format", "stream-json",
  "--verbose",
  "--strict-mcp-config",
  "--mcp-config", JSON.stringify({ mcpServers: {} }),
  "--model", "haiku",
  "--system-prompt",
  "You are participating in a wire-format probe. Reply briefly (one short sentence) to each user message.",
];
if (REPLAY_FLAG) args.push("--replay-user-messages");

console.error(`[probe] spawning: claude ${args.map((a) => (a.includes(" ") ? JSON.stringify(a) : a)).join(" ")}`);

const child = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"] });

const events = [];
let stderrBuf = "";
let buffer = "";
const startMs = Date.now();

function ts() {
  return Date.now() - startMs;
}

function record(label, payload) {
  events.push({ atMs: ts(), label, payload });
  console.error(`[probe ${ts().toString().padStart(6, " ")}ms] ${label}`);
}

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl);
    buffer = buffer.slice(nl + 1);
    if (!line.length) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      record("stdout/unparsed", { line });
      continue;
    }
    const t = parsed.type ?? "(no-type)";
    const subtype = parsed.subtype ?? null;
    const stopReason = parsed?.message?.stop_reason ?? null;
    const tag = `stdout/${t}${subtype ? `:${subtype}` : ""}${stopReason ? ` stop=${stopReason}` : ""}`;
    record(tag, parsed);
  }
});

child.stderr.setEncoding("utf8");
child.stderr.on("data", (c) => {
  stderrBuf += c;
  // Keep stderr noise out of the event log; just tag a stderr fact.
});

child.on("error", (err) => {
  record("error", { message: err.message });
});

child.on("close", (code) => {
  record("close", { exitCode: code });
  finish();
});

const probeTimer = setTimeout(() => {
  record("timeout", { afterMs: PROBE_TIMEOUT_MS });
  child.kill("SIGTERM");
}, PROBE_TIMEOUT_MS);

function finish() {
  clearTimeout(probeTimer);
  const out = {
    args,
    startedAt: new Date(startMs).toISOString(),
    durationMs: ts(),
    stderr: stderrBuf,
    events,
  };
  writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
  console.error(`\n[probe] wrote ${events.length} events to ${OUT_FILE}`);
  process.exit(0);
}

function writeUserEvent(text) {
  const evt = {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "text", text }],
    },
  };
  record("stdin/write", evt);
  child.stdin.write(JSON.stringify(evt) + "\n");
}

// Kick off after a small delay so the process has time to print any startup
// init events first (we want those captured).
setTimeout(() => writeUserEvent("Reply with the word HELLO and nothing else."), 1000);
setTimeout(() => writeUserEvent("Reply with the word WORLD and nothing else."), 30_000);
setTimeout(() => {
  // End the process. If it doesn't exit on stdin close within a few seconds,
  // close handler kills it.
  record("stdin/end", null);
  child.stdin.end();
  setTimeout(() => {
    if (!child.killed) {
      record("force-kill", null);
      child.kill("SIGTERM");
    }
  }, 5_000);
}, 90_000);
