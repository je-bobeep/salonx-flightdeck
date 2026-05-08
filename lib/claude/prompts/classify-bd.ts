// System prompt for one-shot classification of a Lark IM message into a
// BD Feedback row. Used by the poller (lib/services/lark-poller).
//
// The poller writes the *raw original message* into the Item field as-is
// (Lark's Translate column auto-generates the English version). So this
// prompt no longer asks Claude for a summary or translation — only for
// category / sub-category / isFeedback / reasoning.
//
// Output is strict JSON — no preamble, no fence — so the caller can JSON.parse
// the result body directly.

export type ClassifyContext = {
  knownCategories: string[];
  // Optional: a few existing sub-categories for context. Helps Claude pick
  // labels consistent with prior entries.
  knownSubCategories?: string[];
};

export function classifyBdSystemPrompt(ctx: ClassifyContext): string {
  return [
    `You classify SalonX merchant feedback messages into BD Feedback row fields.`,
    ``,
    `Output a single JSON object with these fields and NOTHING ELSE (no prose, no fence):`,
    `{`,
    `  "category": string[],          // 1-3 best-fit values from the allowed list. MUST contain at least one entry when isFeedback=true.`,
    `  "subCategory": string,         // Specific area (e.g. "Calendar / Appointments", "Phone Integration"). 2-5 words. MUST be non-empty when isFeedback=true.`,
    `  "isFeedback": boolean,         // true if this is a feature request / bug / merchant ask. false if chitchat / acknowledgement / off-topic.`,
    `  "reasoning": string            // 1-line rationale. Cap at 200 chars.`,
    `}`,
    ``,
    `Allowed categories (return any subset of size 1-3; pick the best fits):`,
    ctx.knownCategories.map((c) => `- ${c}`).join("\n"),
    ``,
    ctx.knownSubCategories && ctx.knownSubCategories.length > 0
      ? `Sub-category examples used previously (prefer matching these when reasonable):\n${ctx.knownSubCategories
          .slice(0, 30)
          .map((s) => `- ${s}`)
          .join("\n")}`
      : "",
    ``,
    `Rules:`,
    `- The original message may be Japanese, Chinese, English, or mixed. Read it in its original language; do NOT translate it.`,
    `- isFeedback=false if the message is a thank-you, "ok received", a single emoji, a sticker, image-only context with no ask, or a status reply.`,
    `- When isFeedback=true: category and subCategory are MANDATORY. Never return an empty array or empty string for these. If the request is unclear, pick the closest category and the most specific sub-category you can defend in one line of reasoning.`,
    `- When isFeedback=false: category and subCategory are not used downstream, but still produce best-effort values rather than empty.`,
    `- Output JSON only. No \`\`\`json fence. No leading or trailing prose.`,
  ]
    .filter(Boolean)
    .join("\n");
}
