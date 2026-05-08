import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assertSafePath } from "./safety";

const exec = promisify(execFile);

const TIMEOUT_MS = 10_000;
const MAX_BUFFER = 4 * 1024 * 1024; // 4 MB

export type GitCommit = {
  hash: string;
  shortHash: string;
  isoDate: string;
  author: string;
  subject: string;
};

/**
 * `git -C <repoPath> log --grep=<keyword>` with safe output parsing.
 * Returns up to `limit` matching commits (newest first). Read-only.
 */
export async function gitLogGrep(
  repoPath: string,
  keyword: string,
  opts: { limit?: number } = {}
): Promise<GitCommit[]> {
  const safe = assertSafePath(repoPath);
  const limit = opts.limit ?? 50;
  // Tab-separated format that survives any commit-message punctuation.
  const fmt = "%H%x09%h%x09%cI%x09%an%x09%s";

  try {
    const { stdout } = await exec(
      "git",
      [
        "-C", safe,
        "log",
        "--no-merges",
        "--grep", keyword,
        "-i", // case-insensitive
        `-n`, String(limit),
        `--format=${fmt}`,
      ],
      { timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER }
    );
    return stdout
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => {
        const [hash, shortHash, isoDate, author, ...subjectParts] = l.split("\t");
        return {
          hash,
          shortHash,
          isoDate,
          author,
          subject: subjectParts.join("\t"),
        };
      });
  } catch (e) {
    // git not installed, repo missing, or non-zero exit (no matches)
    if (
      e &&
      typeof e === "object" &&
      "code" in e &&
      // git log exits 0 with no output when nothing matches; non-zero is real
      (e as { code: number }).code === 1
    ) {
      return [];
    }
    throw new Error(
      `git log failed for ${safe}: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

/** `git rev-parse --abbrev-ref HEAD` — current branch name. */
export async function gitCurrentBranch(repoPath: string): Promise<string | null> {
  const safe = assertSafePath(repoPath);
  try {
    const { stdout } = await exec(
      "git",
      ["-C", safe, "rev-parse", "--abbrev-ref", "HEAD"],
      { timeout: TIMEOUT_MS }
    );
    return stdout.trim();
  } catch {
    return null;
  }
}

/** Return GitHub repo as `owner/repo` parsed from origin remote, or null. */
export async function gitOriginGithub(
  repoPath: string
): Promise<{ owner: string; repo: string } | null> {
  const safe = assertSafePath(repoPath);
  try {
    const { stdout } = await exec(
      "git",
      ["-C", safe, "config", "--get", "remote.origin.url"],
      { timeout: TIMEOUT_MS }
    );
    const url = stdout.trim();
    // git@github.com:owner/repo.git  OR  https://github.com/owner/repo.git
    const m =
      url.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/) ??
      url.match(/github\.com[:/]([^/]+)\/([^/]+)\/?$/);
    if (!m) return null;
    return { owner: m[1], repo: m[2].replace(/\.git$/, "") };
  } catch {
    return null;
  }
}
