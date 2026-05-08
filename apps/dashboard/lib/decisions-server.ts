// Server-side decisions log infrastructure.
//
// Reads markdown files from `salon-x-business/decisions/`, parses YAML
// frontmatter via gray-matter, validates the required fields, exposes a
// list/read API, and builds a MiniSearch index over the corpus.
//
// Decisions live in a sibling repo (the canonical PM docs hub) — flightdeck
// is purely a presentation layer. Re-parses on every call: the corpus is
// expected to stay under ~500 files so file-system reads are cheap, and we
// avoid stale-cache bugs at the cost of a few ms per request.

import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import MiniSearch from "minisearch";
import { SIBLINGS } from "@flightdeck/sibling/paths";
import { assertSafePath, isBinaryPath } from "@flightdeck/sibling/safety";
import {
  DECISION_KINDS,
  type Decision,
  type DecisionFrontmatter,
  type DecisionKind,
  type DecisionListItem,
  type DecisionSearchDoc,
  type DecisionStatus,
} from "./decisions-shapes";

/** Resolve the directory under salon-x-business that holds the decision
 *  markdown files. Centralised so the route handlers don't reach into the
 *  sibling-repo layout directly. */
function decisionsDir(): string {
  return path.join(SIBLINGS.salonXBusiness(), "decisions");
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_STATUSES: ReadonlySet<DecisionStatus> = new Set([
  "active",
  "superseded",
  "reverted",
]);
const VALID_KINDS: ReadonlySet<string> = new Set(DECISION_KINDS);

type FrontmatterValidation =
  | { ok: true; frontmatter: DecisionFrontmatter }
  | { ok: false; reason: string };

/**
 * Validate the parsed frontmatter object. We only enforce the four mandatory
 * fields (title, date, status, kind) — everything else is accepted as-is when
 * present and the right shape, dropped otherwise.
 *
 * Returns a tagged result so the caller can log + skip rather than throwing
 * out of the whole `listDecisions()` call when one file is malformed.
 */
function validateFrontmatter(raw: unknown): FrontmatterValidation {
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "frontmatter is not an object" };
  }
  const obj = raw as Record<string, unknown>;

  const title = obj.title;
  if (typeof title !== "string" || title.trim().length === 0) {
    return { ok: false, reason: "title missing or not a non-empty string" };
  }

  const date = obj.date;
  // gray-matter parses bare YAML dates into JS Date objects; coerce both
  // shapes back to a YYYY-MM-DD string before validating.
  let dateStr: string | null = null;
  if (typeof date === "string") {
    dateStr = date;
  } else if (date instanceof Date && !Number.isNaN(date.getTime())) {
    dateStr = date.toISOString().slice(0, 10);
  }
  if (!dateStr || !DATE_RE.test(dateStr)) {
    return { ok: false, reason: "date missing or not YYYY-MM-DD" };
  }

  const status = obj.status;
  if (typeof status !== "string" || !VALID_STATUSES.has(status as DecisionStatus)) {
    return {
      ok: false,
      reason: `status must be one of: ${Array.from(VALID_STATUSES).join(", ")}`,
    };
  }

  const kindRaw = obj.kind;
  if (!Array.isArray(kindRaw) || kindRaw.length === 0) {
    return { ok: false, reason: "kind must be a non-empty array" };
  }
  const kind: DecisionKind[] = [];
  for (const k of kindRaw) {
    if (typeof k !== "string" || !VALID_KINDS.has(k)) {
      return {
        ok: false,
        reason: `kind contains invalid value: ${JSON.stringify(k)}`,
      };
    }
    kind.push(k as DecisionKind);
  }

  // Optional fields — coerce to typed shape, drop if malformed (don't fail
  // the whole file).
  const frontmatter: DecisionFrontmatter = {
    title: title.trim(),
    date: dateStr,
    status: status as DecisionStatus,
    kind,
  };

  if (Array.isArray(obj.stakeholders)) {
    frontmatter.stakeholders = obj.stakeholders
      .filter((s): s is string => typeof s === "string")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  if (Array.isArray(obj.related_bd)) {
    frontmatter.related_bd = obj.related_bd
      .filter((s): s is string => typeof s === "string");
  }
  if (Array.isArray(obj.related_dev)) {
    frontmatter.related_dev = obj.related_dev
      .filter((s): s is string => typeof s === "string");
  }
  if (typeof obj.related_prd === "string") {
    frontmatter.related_prd = obj.related_prd;
  }
  if (typeof obj.related_meeting === "string") {
    frontmatter.related_meeting = obj.related_meeting;
  }
  if (typeof obj.supersedes === "string") {
    frontmatter.supersedes = obj.supersedes;
  } else if (obj.supersedes === null) {
    frontmatter.supersedes = null;
  }
  if (Array.isArray(obj.tags)) {
    frontmatter.tags = obj.tags
      .filter((s): s is string => typeof s === "string")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  return { ok: true, frontmatter };
}

/**
 * Strip enough markdown syntax to make the body suitable for two purposes:
 * (a) extracting a one-line "summary" preview, and (b) tokenising for search.
 *
 * Deliberately regex-based — we don't need round-trippable AST fidelity, just
 * something that strips the noise so MiniSearch tokenises real words. Order
 * matters: code fences first (so we don't re-process their contents), then
 * inline link/emphasis/heading markers.
 */
function stripMarkdown(md: string): string {
  let text = md;
  // Fenced code blocks (``` ... ``` and ~~~ ... ~~~).
  text = text.replace(/```[\s\S]*?```/g, " ");
  text = text.replace(/~~~[\s\S]*?~~~/g, " ");
  // Inline code.
  text = text.replace(/`[^`]*`/g, " ");
  // Images: ![alt](url) — keep alt text.
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  // Links: [text](url) — keep text.
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  // Reference-style links: [text][ref] — keep text.
  text = text.replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1");
  // Heading markers at start of line.
  text = text.replace(/^#{1,6}\s+/gm, "");
  // Blockquote markers.
  text = text.replace(/^>\s?/gm, "");
  // List markers (-, *, + and numeric).
  text = text.replace(/^\s*[-*+]\s+/gm, "");
  text = text.replace(/^\s*\d+\.\s+/gm, "");
  // Bold / italic emphasis. Run bold first (** or __), then italic (* or _).
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
  text = text.replace(/__([^_]+)__/g, "$1");
  text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2");
  text = text.replace(/(^|[^_])_([^_\n]+)_/g, "$1$2");
  // Horizontal rules.
  text = text.replace(/^\s*[-*_]{3,}\s*$/gm, "");
  // HTML tags (best-effort; we don't expect much of this).
  text = text.replace(/<[^>]+>/g, " ");
  return text;
}

/**
 * Pull the first non-empty paragraph out of the body, stripped of markdown.
 * Used as the index-list summary; falls back to an empty string if the body
 * is empty or only headings.
 */
function extractSummary(body: string): string {
  const stripped = stripMarkdown(body).trim();
  if (!stripped) return "";
  // Split on blank lines; the first non-empty block is the summary candidate.
  const blocks = stripped.split(/\n\s*\n/);
  for (const b of blocks) {
    const oneLine = b.replace(/\s+/g, " ").trim();
    if (oneLine.length > 0) return oneLine;
  }
  return "";
}

/**
 * Parse a single decision file. Returns null when the frontmatter is invalid
 * (with a console.warn detailing why) so callers can skip it without crashing
 * the whole list. The slug is the filename minus `.md`.
 */
async function parseDecisionFile(
  filePath: string
): Promise<{ item: DecisionListItem; body: string } | null> {
  const safe = assertSafePath(filePath);
  if (isBinaryPath(safe)) {
    console.warn(`[decisions] skipping binary file: ${safe}`);
    return null;
  }
  let raw: string;
  try {
    raw = await fs.readFile(safe, "utf8");
  } catch (e) {
    console.warn(
      `[decisions] failed to read ${safe}: ${e instanceof Error ? e.message : String(e)}`
    );
    return null;
  }
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(raw);
  } catch (e) {
    console.warn(
      `[decisions] gray-matter parse failed for ${safe}: ${e instanceof Error ? e.message : String(e)}`
    );
    return null;
  }
  const validation = validateFrontmatter(parsed.data);
  if (!validation.ok) {
    console.warn(`[decisions] invalid frontmatter in ${safe}: ${validation.reason}`);
    return null;
  }
  const body = parsed.content;
  const slug = path.basename(safe, ".md");
  const summary = extractSummary(body);
  return {
    item: {
      slug,
      frontmatter: validation.frontmatter,
      summary,
      filePath: safe,
    },
    body,
  };
}

/**
 * List every valid decision in the directory, sorted by date desc (newest
 * first), with frontmatter parsed and summary extracted. Files with invalid
 * or missing frontmatter are logged + skipped, not thrown.
 */
export async function listDecisions(): Promise<DecisionListItem[]> {
  const dir = decisionsDir();
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (e) {
    // Directory might not exist yet (e.g. first boot before any decisions
    // are logged). Treat as empty rather than 500.
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw e;
  }
  const mdFiles = entries.filter((f) => f.toLowerCase().endsWith(".md"));
  const parsed = await Promise.all(
    mdFiles.map((f) => parseDecisionFile(path.join(dir, f)))
  );
  const items = parsed
    .filter((p): p is { item: DecisionListItem; body: string } => p !== null)
    .map((p) => p.item);
  items.sort((a, b) => b.frontmatter.date.localeCompare(a.frontmatter.date));
  return items;
}

/**
 * Read a single decision by slug. Returns null if the file is missing or its
 * frontmatter is invalid. Slug is sanitised (no path separators, no leading
 * dots) before resolving so a malicious caller can't traverse out of the
 * decisions dir.
 */
export async function readDecision(slug: string): Promise<Decision | null> {
  // Defence in depth: reject anything that looks like a path component.
  if (!slug || slug.includes("/") || slug.includes("\\") || slug.startsWith(".")) {
    return null;
  }
  const filePath = path.join(decisionsDir(), `${slug}.md`);
  // assertSafePath inside parseDecisionFile catches traversal too, but doing
  // it here gives a clean null instead of a thrown error for the route.
  try {
    assertSafePath(filePath);
  } catch {
    return null;
  }
  try {
    await fs.access(filePath);
  } catch {
    return null;
  }
  const parsed = await parseDecisionFile(filePath);
  if (!parsed) return null;
  return { ...parsed.item, body: parsed.body };
}

/**
 * Build a MiniSearch index over title + body + kind + stakeholders + tags.
 * Body is stripped of markdown so search hits surface real prose, not syntax.
 *
 * The `readBody` callback isolates body-fetching from the index build so the
 * route handler can wire in `readDecision()` (the existing safe path) without
 * this module having to know about the route layer.
 */
export async function buildSearchIndex(
  items: DecisionListItem[],
  readBody: (slug: string) => Promise<string>
): Promise<{ serialized: string; docs: DecisionSearchDoc[] }> {
  const docs: DecisionSearchDoc[] = await Promise.all(
    items.map(async (item) => {
      const body = await readBody(item.slug);
      return {
        id: item.slug,
        title: item.frontmatter.title,
        body: stripMarkdown(body).replace(/\s+/g, " ").trim(),
        kind: item.frontmatter.kind.join(" "),
        stakeholders: (item.frontmatter.stakeholders ?? []).join(" "),
        tags: (item.frontmatter.tags ?? []).join(" "),
        date: item.frontmatter.date,
      };
    })
  );

  const index = new MiniSearch<DecisionSearchDoc>({
    fields: ["title", "body", "kind", "stakeholders", "tags"],
    storeFields: ["id"],
    idField: "id",
    searchOptions: {
      boost: { title: 3, kind: 2, tags: 2, stakeholders: 1.5 },
      fuzzy: 0.2,
      prefix: true,
    },
  });
  index.addAll(docs);

  return {
    serialized: JSON.stringify(index.toJSON()),
    docs,
  };
}
