import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assertSafePath } from "./safety";

const exec = promisify(execFile);

const TIMEOUT_MS = 15_000;
const MAX_BUFFER = 4 * 1024 * 1024; // 4 MB

export type CodeGrepHit = {
  /** Path relative to the repo root. */
  path: string;
  /** 1-based line number. */
  line: number;
  /** Matched line, trimmed to MAX_LINE_CHARS. */
  text: string;
};

const MAX_LINE_CHARS = 240;

/**
 * `git -C <repo> grep` with safe parsing. Honours the repo's .gitignore
 * automatically, so node_modules / dist / build / .next never appear in
 * results. Read-only.
 *
 * Use case: investigation phase of bd-to-dev / pair-sanity flows — Claude
 * needs to surface current behaviour of a feature area before drafting a
 * ticket. `gitLogGrep` finds *commits* about a topic; this finds *the actual
 * code* implementing it.
 */
export async function codeGrep(
  repoPath: string,
  pattern: string,
  opts: {
    /** Max hits returned. Default 30 — keeps responses bounded. */
    limit?: number;
    /** Restrict to filenames matching these glob suffixes (e.g. [".ts", ".tsx"]).
     * Empty/omitted = all files git knows about. */
    extensions?: readonly string[];
    /** Case-sensitive match. Default false. */
    caseSensitive?: boolean;
  } = {}
): Promise<CodeGrepHit[]> {
  const safe = assertSafePath(repoPath);
  const limit = opts.limit ?? 30;

  const args = [
    "-C", safe,
    "grep",
    "--no-color",
    "-n", // line numbers
    "-I", // skip binary files
  ];
  if (!opts.caseSensitive) args.push("-i");
  // Cap per-file hits so a single noisy file doesn't crowd out everything.
  args.push("--max-count", "5");
  args.push("-E"); // extended regex
  args.push(pattern);
  if (opts.extensions && opts.extensions.length > 0) {
    args.push("--");
    for (const ext of opts.extensions) {
      const clean = ext.startsWith(".") ? ext.slice(1) : ext;
      args.push(`*.${clean}`);
    }
  }

  try {
    const { stdout } = await exec("git", args, {
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
    });
    const lines = stdout.split("\n").filter((l) => l.length > 0);
    const out: CodeGrepHit[] = [];
    for (const line of lines) {
      // Format: "path/to/file.ts:123:matched line content..."
      // Filename / line / text are colon-separated; rest may contain colons.
      const m = line.match(/^([^:]+):(\d+):(.*)$/);
      if (!m) continue;
      out.push({
        path: m[1],
        line: Number(m[2]),
        text:
          m[3].length > MAX_LINE_CHARS
            ? m[3].slice(0, MAX_LINE_CHARS) + "…"
            : m[3],
      });
      if (out.length >= limit) break;
    }
    return out;
  } catch (e) {
    if (
      e &&
      typeof e === "object" &&
      "code" in e &&
      // git grep exits 1 when no match — that's fine, return empty.
      (e as { code: number }).code === 1
    ) {
      return [];
    }
    throw new Error(
      `git grep failed for ${safe}: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}
