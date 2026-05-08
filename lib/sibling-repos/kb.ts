import fs from "node:fs/promises";
import path from "node:path";
import { SIBLINGS } from "./paths";
import { assertSafePath, isBinaryPath } from "./safety";

export type KbHit = {
  absolutePath: string;
  relativePath: string; // relative to salonx-kb root
  title: string | null;
  excerpt: string;
  score: number;
};

const KB_GLOB_DIRS = ["docs", "i18n/en/docusaurus-plugin-content-docs/current"];
const MAX_FILES = 1000;
const MAX_FILE_BYTES = 200_000;

async function* walk(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile() && full.endsWith(".md")) {
      yield full;
    }
  }
}

function extractTitle(md: string): string | null {
  const fmMatch = md.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const titleLine = fmMatch[1].split("\n").find((l) => /^title:/i.test(l));
    if (titleLine) {
      return titleLine.replace(/^title:\s*/i, "").replace(/^["']|["']$/g, "").trim();
    }
  }
  const h1 = md.match(/^#\s+(.+)$/m);
  return h1 ? h1[1].trim() : null;
}

function scoreContent(content: string, lowKws: string[]): number {
  if (lowKws.length === 0) return 0;
  const haystack = content.toLowerCase();
  return lowKws.reduce((s, k) => (haystack.includes(k) ? s + 1 : s), 0);
}

function makeExcerpt(content: string, lowKws: string[], len = 240): string {
  if (lowKws.length === 0) return content.slice(0, len);
  const haystack = content.toLowerCase();
  for (const kw of lowKws) {
    const idx = haystack.indexOf(kw);
    if (idx >= 0) {
      const start = Math.max(0, idx - Math.floor(len / 4));
      return content.slice(start, start + len).replace(/\s+/g, " ").trim();
    }
  }
  return content.slice(0, len).replace(/\s+/g, " ").trim();
}

/**
 * Keyword search across salonx-kb markdown content (Japanese + English).
 * Returns top-N hits ranked by keyword count. Skips binaries.
 */
export async function searchKb(
  keywords: string[],
  opts: { limit?: number } = {}
): Promise<KbHit[]> {
  const limit = opts.limit ?? 10;
  const kbRoot = SIBLINGS.salonXKb();
  const lowKws = keywords.map((k) => k.toLowerCase()).filter((k) => k.length > 0);
  const hits: KbHit[] = [];
  let scanned = 0;

  for (const sub of KB_GLOB_DIRS) {
    const subRoot = path.join(kbRoot, sub);
    for await (const file of walk(subRoot)) {
      if (scanned++ >= MAX_FILES) break;
      try {
        const safe = assertSafePath(file);
        if (isBinaryPath(safe)) continue;
        const stat = await fs.stat(safe);
        if (stat.size === 0 || stat.size > MAX_FILE_BYTES) continue;
        const content = await fs.readFile(safe, "utf8");
        const score = scoreContent(content, lowKws);
        if (score === 0) continue;
        hits.push({
          absolutePath: safe,
          relativePath: path.relative(kbRoot, safe),
          title: extractTitle(content),
          excerpt: makeExcerpt(content, lowKws),
          score,
        });
      } catch {
        // Skip unreadable files silently.
      }
    }
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
