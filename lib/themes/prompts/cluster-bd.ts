// System prompt for the BD-feedback clustering call.
//
// Output is strict JSON: {themes: [{name, description, bdRecordIds[], dominantCategories[], dominantSubCategories[]}, ...]}.
// Every passed-in BD record_id must appear in exactly one theme.

export type ClusterPromptOpts = {
  /** Names of themes from the previous run. Claude is instructed to reuse these
   *  names when ≥70% of members overlap, for stable naming across runs. */
  previousThemeNames?: string[];
};

export function clusterBdSystemPrompt(opts: ClusterPromptOpts = {}): string {
  const reuseClause =
    opts.previousThemeNames && opts.previousThemeNames.length > 0
      ? `\nPREVIOUS THEME NAMES (reuse exactly when ≥70% of members overlap with a previous theme; otherwise pick a new name):\n${opts.previousThemeNames.map((n) => `- ${n}`).join("\n")}\n`
      : "";

  return `You cluster BD-feedback rows from a SalonX product feedback log into a small set of THEMES.

A theme is a coherent user-facing concern. Examples: "Timezone correctness", "WhatsApp delivery", "Split-bill UX", "Staff scheduling conflicts". A theme is NOT a category like "Bug" or "Enhancement" — those are too coarse.

INPUT
The user message contains a JSON array of BD-feedback rows. Each row has:
  { record_id, item, translate, category, subCategory, priority, ageDays }

OUTPUT
Return ONLY valid JSON in this exact shape (no prose, no markdown fences):
{
  "themes": [
    {
      "name": "<short label, ≤ 4 words, Title Case>",
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
${reuseClause}
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
};

export function assignBdSystemPrompt(opts: AssignPromptOpts): string {
  const catalog = opts.existingThemes
    .map(
      (t) =>
        `- theme_id: ${t.id}\n  name: "${t.name}"\n  description: "${t.description}"\n  dominant sub-categories: [${t.dominantSubCategories.map((s) => `"${s}"`).join(", ")}]\n  examples: [${t.examples.map((s) => `"${s.slice(0, 80)}"`).join(", ")}]`
    )
    .join("\n");

  return `You assign NEW BD-feedback rows to an EXISTING set of themes. Existing assignments are STICKY — never reshuffle them. Prefer assignment to an existing theme over creating a new one.

EXISTING THEMES (use these theme_ids verbatim when assigning):
${catalog}

INPUT: a JSON array of new rows: [{ record_id, item, translate, category, subCategory, priority, ageDays }]

OUTPUT: strict JSON of this exact shape (no markdown, no prose):
{
  "assignments": [
    { "record_id": "rec...", "theme_id": "<existing theme_id>" }
  ],
  "newThemes": [
    {
      "tempId": "new-1",
      "name": "<short Title Case label, ≤ 4 words>",
      "description": "<one sentence, ≤ 20 words>",
      "bdRecordIds": ["rec..."]
    }
  ]
}

CONSTRAINTS
- Every input record_id appears in EXACTLY ONE place: either an "assignments" entry pointing at an existing theme_id, or in a newTheme.bdRecordIds array.
- Cap newThemes at 2 per call. Force-fit a row into an existing theme unless truly no theme is a fit.
- New theme names: ≤ 4 words, Title Case, distinct from any existing theme name.
- Group by underlying CONCERN, not by category labels like "Bug" or "Enhancement".

Output JUST the JSON object.`;
}
