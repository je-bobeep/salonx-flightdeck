// Wire types for the decisions log. Mirrored on both server (parses files
// from salon-x-business/decisions/) and client (renders the index + detail).
//
// `kind` is multi-select — a single decision can be e.g. both `decline` and
// `defer` (we won't do X now, but we'll consider it later when Y happens).

export const DECISION_KINDS = [
  "commit",
  "decline",
  "defer",
  "tradeoff",
  "design",
  "process",
] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];

export type DecisionStatus = "active" | "superseded" | "reverted";

/** Frontmatter parsed from the markdown file. Only `title`, `date`, `status`,
 *  `kind` are required by the scaffold; the rest are optional. */
export type DecisionFrontmatter = {
  title: string;
  date: string; // ISO YYYY-MM-DD
  status: DecisionStatus;
  kind: DecisionKind[];
  stakeholders?: string[];
  related_bd?: string[];
  related_dev?: string[];
  related_prd?: string;
  related_meeting?: string;
  supersedes?: string | null;
  tags?: string[];
};

/** Minimal shape for the /decisions index list. No body — keeps the wire
 *  payload small and the search index lean. */
export type DecisionListItem = {
  /** URL-safe slug, derived from filename without `.md`. */
  slug: string;
  frontmatter: DecisionFrontmatter;
  /** First non-frontmatter paragraph, trimmed. Used as the 1-line summary
   *  in the index list and the search index. */
  summary: string;
  /** Source file path (absolute). Useful for the "Edit at..." footer. */
  filePath: string;
};

/** Full decision returned by the detail route. Includes the raw markdown
 *  body so the client can render via react-markdown + remark-gfm. */
export type Decision = DecisionListItem & {
  body: string;
};

/** Minimal record fed into MiniSearch. Stripped of markdown syntax for cleaner
 *  tokenisation, with stakeholders / kinds / tags flattened to space-separated
 *  strings so MiniSearch's default tokenizer can split them. */
export type DecisionSearchDoc = {
  id: string; // = slug
  title: string;
  body: string; // stripped plaintext
  kind: string; // space-separated
  stakeholders: string;
  tags: string;
  date: string;
};

export type DecisionsListResponse = {
  ok: true;
  decisions: DecisionListItem[];
} | { ok: false; error: string };

export type DecisionDetailResponse = {
  ok: true;
  decision: Decision;
} | { ok: false; error: string };

export type DecisionsSearchIndexResponse = {
  ok: true;
  /** Pre-built JSON dump for client-side MiniSearch.loadJSON(). */
  serialized: string;
  /** The raw documents — rendered alongside hits since MiniSearch only
   *  returns ids by default. */
  docs: DecisionSearchDoc[];
} | { ok: false; error: string };
