import fs from "node:fs/promises";
import path from "node:path";
import { SIBLINGS } from "./paths";
import { assertSafePath, isBinaryPath } from "./safety";

export type PrdIndexEntry = {
  featureArea: string;
  prdPaths: string[]; // absolute paths
  specPaths: string[];
  techPaths: string[];
  codePaths: string[]; // strings as written in INDEX.md (relative to ../salon-x)
  supersededPaths: string[];
};

/**
 * Parse `salon-x-business/INDEX.md` and return one entry per feature-area
 * heading. The INDEX.md format is a series of "## <Feature Area>" sections,
 * each followed by a markdown table whose first column is "PRDs" / "Specs" /
 * "Tech" / "Code" / "Superseded" and second column is a comma-separated list
 * of backtick-wrapped paths.
 *
 * We don't try to be exhaustive — just good-enough to seed cross-repo lookup.
 */
export async function readPrdIndex(): Promise<PrdIndexEntry[]> {
  const indexPath = path.join(SIBLINGS.salonXBusiness(), "INDEX.md");
  const safe = assertSafePath(indexPath);
  const raw = await fs.readFile(safe, "utf8");

  const out: PrdIndexEntry[] = [];
  const lines = raw.split("\n");
  let current: PrdIndexEntry | null = null;
  const businessRoot = SIBLINGS.salonXBusiness();

  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      if (current) out.push(current);
      current = {
        featureArea: heading[1].trim(),
        prdPaths: [],
        specPaths: [],
        techPaths: [],
        codePaths: [],
        supersededPaths: [],
      };
      continue;
    }
    if (!current) continue;

    // Table rows look like: | PRDs | `path1`, `path2`, ... |
    const row = line.match(/^\|\s*([^|]+?)\s*\|\s*(.+?)\s*\|\s*$/);
    if (!row) continue;
    const kind = row[1].toLowerCase().trim();
    const cells = Array.from(row[2].matchAll(/`([^`]+)`/g)).map((m) => m[1]);
    if (cells.length === 0) continue;

    const resolveLocal = (p: string) =>
      path.isAbsolute(p) ? p : path.resolve(businessRoot, p);

    switch (kind) {
      case "prds":
        current.prdPaths.push(...cells.map(resolveLocal));
        break;
      case "specs":
        current.specPaths.push(...cells.map(resolveLocal));
        break;
      case "tech":
        current.techPaths.push(...cells.map(resolveLocal));
        break;
      case "code":
        // Code paths are written as `../salon-x/...` relative to salon-x-business
        current.codePaths.push(...cells);
        break;
      case "superseded":
        current.supersededPaths.push(...cells.map(resolveLocal));
        break;
    }
  }
  if (current) out.push(current);
  return out;
}

/**
 * Naive keyword match against feature-area names + PRD filenames. Returns
 * top-N entries scored by keyword overlap. Cheaper than greping every PRD.
 */
export async function searchPrdIndex(
  keywords: string[],
  opts: { limit?: number } = {}
): Promise<PrdIndexEntry[]> {
  const lim = opts.limit ?? 5;
  const entries = await readPrdIndex();
  const lowKw = keywords.map((k) => k.toLowerCase()).filter((k) => k.length > 0);
  if (lowKw.length === 0) return entries.slice(0, lim);

  const scored = entries.map((e) => {
    const haystack = [
      e.featureArea,
      ...e.prdPaths.map((p) => path.basename(p)),
      ...e.specPaths.map((p) => path.basename(p)),
    ]
      .join(" ")
      .toLowerCase();
    const score = lowKw.reduce((s, k) => (haystack.includes(k) ? s + 1 : s), 0);
    return { e, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, lim)
    .map((s) => s.e);
}

/** Read a PRD/spec file (text only, never binary). */
export async function readSiblingFile(
  absolutePath: string,
  opts: { maxBytes?: number } = {}
): Promise<{ path: string; content: string; truncated: boolean }> {
  const safe = assertSafePath(absolutePath);
  if (isBinaryPath(safe)) {
    throw new Error(`refusing to read binary file: ${path.basename(safe)}`);
  }
  const max = opts.maxBytes ?? 200_000;
  const stat = await fs.stat(safe);
  if (stat.size === 0) {
    return { path: safe, content: "", truncated: false };
  }
  const fh = await fs.open(safe, "r");
  try {
    const buf = Buffer.alloc(Math.min(stat.size, max));
    await fh.read(buf, 0, buf.length, 0);
    return {
      path: safe,
      content: buf.toString("utf8"),
      truncated: stat.size > max,
    };
  } finally {
    await fh.close();
  }
}
