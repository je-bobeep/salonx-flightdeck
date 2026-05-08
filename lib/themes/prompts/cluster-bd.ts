// System prompt for the BD-feedback clustering call.
//
// Output is strict JSON: {themes: [{name, description, bdRecordIds[], dominantCategories[], dominantSubCategories[]}, ...]}.
// Every passed-in BD record_id must appear in exactly one theme.
//
// Phase 3 of theme-clustering-v2 (2026-05-08): the LLM picks names from the
// curated CANDIDATE_THEMES list rather than free-floating. Brand-new names are
// capped at MAX_NEW_THEMES_PER_RUN per call and recorded as proposals for
// explicit review. Anchored vocabulary supersedes the previous-run reuse
// clause that was vulnerable to fallback-name leakage.

import {
  CANDIDATE_THEMES,
  MAX_NEW_THEMES_PER_RUN,
} from "../taxonomy";

export type ClusterPromptOpts = {
  /** @deprecated Phase 3: previous-run name reuse is superseded by anchored
   *  vocabulary. Parameter retained so existing callers don't break; value is
   *  ignored when rendering the prompt. */
  previousThemeNames?: string[];
  /** When true, append a stronger constraint to the prompt — used on the
   *  retry pass after a first call exceeded MAX_NEW_THEMES_PER_RUN. */
  strictRetry?: boolean;
};

function renderCandidateList(): string {
  return CANDIDATE_THEMES.map((c) => {
    const mods = c.dominantModules?.length
      ? `[${c.dominantModules.map((m) => `"${m}"`).join(", ")}]`
      : "[]";
    const cats = c.dominantCategories?.length
      ? `[${c.dominantCategories.map((m) => `"${m}"`).join(", ")}]`
      : "[]";
    return `- name: "${c.name}"
  hint: "${c.hint.replace(/"/g, '\\"')}"
  when_dominant_modules: ${mods}
  when_dominant_categories: ${cats}`;
  }).join("\n");
}

export function clusterBdSystemPrompt(opts: ClusterPromptOpts = {}): string {
  void opts.previousThemeNames; // intentionally ignored — see deprecation note above

  const strictFooter = opts.strictRetry
    ? `\n\nSTRICT RETRY
Your previous response had >${MAX_NEW_THEMES_PER_RUN} brand-new theme names. This retry MUST stay within the cap. If no candidate fits a row's concern, force-fit it into the closest candidate or the "Other (cross-cutting)" bucket rather than minting a new name.`
    : "";

  return `You cluster BD-feedback rows from a SalonX product feedback log into a small set of THEMES.

A theme is a coherent user-facing concern. Examples: "Timezone correctness", "WhatsApp delivery", "Split-bill UX", "Staff scheduling conflicts". A theme is NOT a category like "Bug" or "Enhancement" — those are too coarse.

CANDIDATE_THEMES
You MUST prefer choosing names from the list below. Emit a brand-new name ONLY when no candidate fits. Total themes 5–15. The number of brand-new (non-candidate) names is capped at ${MAX_NEW_THEMES_PER_RUN} per run. Going over the cap will cause your response to be rejected.

${renderCandidateList()}

INPUT
The user message contains a JSON array of BD-feedback rows. Each row has:
  { record_id, item, translate, category, subCategory, priority, ageDays }

OUTPUT
Return ONLY valid JSON in this exact shape (no prose, no markdown fences):
{
  "themes": [
    {
      "name": "<short label, ≤ 4 words, Title Case — prefer a CANDIDATE_THEMES name>",
      "description": "<one sentence explaining what unifies these rows>",
      "bdRecordIds": ["rec...", "rec..."],
      "dominantCategories": ["<top 1–2 from member rows>"],
      "dominantSubCategories": ["<top 1–2 from member rows>"]
    }
  ]
}

CONSTRAINTS
- 5 to 15 themes total. If the input is small (<10 rows), fewer is fine but at least 2 distinct themes.
- Every input record_id must appear in exactly ONE theme. No duplicates, no omissions.
- Theme names: ≤ 4 words, Title Case, no trailing punctuation.
- Description: 1 short sentence (≤ 20 words).
- Group by underlying CONCERN, not surface phrasing — translate into the same theme even if rows are in different languages.
- Brand-new (non-candidate) names: at most ${MAX_NEW_THEMES_PER_RUN} per response.${strictFooter}

DO NOT include any commentary, reasoning, or markdown. Output JUST the JSON object.`;
}

export type AssignPromptOpts = {
  existingThemes: Array<{
    id: string;
    name: string;
    description: string;
    dominantSubCategories: string[];
    /** Up to 3 example items already in this theme. */
    examples: string[];
  }>;
  /** When true, append the stricter constraint footer for retry pass. */
  strictRetry?: boolean;
};

export function assignBdSystemPrompt(opts: AssignPromptOpts): string {
  const catalog = opts.existingThemes
    .map(
      (t) =>
        `- theme_id: ${t.id}\n  name: "${t.name}"\n  description: "${t.description}"\n  dominant sub-categories: [${t.dominantSubCategories.map((s) => `"${s}"`).join(", ")}]\n  examples: [${t.examples.map((s) => `"${s.slice(0, 80)}"`).join(", ")}]`
    )
    .join("\n");

  const strictFooter = opts.strictRetry
    ? `\n\nSTRICT RETRY
Your previous response minted >${MAX_NEW_THEMES_PER_RUN} new themes. This retry MUST stay within the cap. If no existing theme fits a row, force-fit it into the closest candidate or "Other (cross-cutting)" rather than minting a new name.`
    : "";

  return `You assign NEW BD-feedback rows to an EXISTING set of themes. Existing assignments are STICKY — never reshuffle them. Prefer assignment to an existing theme over creating a new one.

EXISTING THEMES (use these theme_ids verbatim when assigning):
${catalog}

CANDIDATE_THEMES (reference vocabulary)
When you must mint a new theme (cap: ${MAX_NEW_THEMES_PER_RUN}/call), prefer names from the curated list below. Existing themes that match a candidate take precedence.

${renderCandidateList()}

INPUT: a JSON array of new rows: [{ record_id, item, translate, category, subCategory, priority, ageDays }]

OUTPUT: strict JSON of this exact shape (no markdown, no prose):
{
  "assignments": [
    { "record_id": "rec...", "theme_id": "<existing theme_id>" }
  ],
  "newThemes": [
    {
      "tempId": "new-1",
      "name": "<short Title Case label, ≤ 4 words — prefer a CANDIDATE_THEMES name>",
      "description": "<one sentence, ≤ 20 words>",
      "bdRecordIds": ["rec..."]
    }
  ]
}

CONSTRAINTS
- Every input record_id appears in EXACTLY ONE place: either an "assignments" entry pointing at an existing theme_id, or in a newTheme.bdRecordIds array.
- Cap newThemes at ${MAX_NEW_THEMES_PER_RUN} per call. Force-fit a row into an existing theme unless truly no theme is a fit.
- New theme names: ≤ 4 words, Title Case, distinct from any existing theme name.
- Group by underlying CONCERN, not by category labels like "Bug" or "Enhancement".${strictFooter}

Output JUST the JSON object.`;
}
