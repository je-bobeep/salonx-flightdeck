import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

const TIMEOUT_MS = 15_000;
const MAX_BUFFER = 4 * 1024 * 1024;

export class GhUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GhUnavailable";
  }
}

export type GhPr = {
  number: number;
  title: string;
  state: string;
  url: string;
  author: string | null;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  isDraft: boolean;
};

/**
 * `gh pr list --search <keyword> --repo <owner/repo>` with graceful failure.
 * Returns [] if `gh` isn't installed or isn't authed; throws GhUnavailable so
 * callers can decide whether to surface the warning or quietly degrade.
 */
export async function ghPrSearch(
  ownerRepo: string,
  keyword: string,
  opts: { limit?: number; state?: "open" | "closed" | "merged" | "all" } = {}
): Promise<GhPr[]> {
  const limit = opts.limit ?? 20;
  const state = opts.state ?? "all";
  try {
    const { stdout } = await exec(
      "gh",
      [
        "pr", "list",
        "--repo", ownerRepo,
        "--search", keyword,
        "--state", state,
        "--limit", String(limit),
        "--json", "number,title,state,url,author,createdAt,updatedAt,mergedAt,isDraft",
      ],
      { timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER }
    );
    const parsed = JSON.parse(stdout) as Array<{
      number: number;
      title: string;
      state: string;
      url: string;
      author: { login?: string } | null;
      createdAt: string;
      updatedAt: string;
      mergedAt: string | null;
      isDraft: boolean;
    }>;
    return parsed.map((p) => ({
      number: p.number,
      title: p.title,
      state: p.state,
      url: p.url,
      author: p.author?.login ?? null,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      mergedAt: p.mergedAt,
      isDraft: p.isDraft,
    }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("ENOENT") || msg.includes("command not found")) {
      throw new GhUnavailable("gh CLI is not installed");
    }
    if (msg.includes("authentication") || msg.includes("not logged in")) {
      throw new GhUnavailable("gh CLI is not authenticated");
    }
    throw new Error(`gh pr search failed: ${msg}`);
  }
}

/** Quick health check; returns true if `gh` is on PATH and authed. */
export async function ghAvailable(): Promise<boolean> {
  try {
    await exec("gh", ["auth", "status"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
