// System prompt for one-shot classification of a Lark IM message into a
// BD Feedback row. Used by the poller (lib/services/lark-poller).
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
    `  "itemEnglish": string,         // Concise English summary, action-oriented. 1 sentence. No fluff.`,
    `  "translateOriginal": string,   // The original message in its original language, or "" if input was already English.`,
    `  "category": string[],          // 1-3 best-fit values from the allowed list. Empty array if none fit.`,
    `  "subCategory": string,         // Specific area (e.g. "Calendar / Appointments", "Phone Integration"). 2-5 words. Empty string if too vague.`,
    `  "isFeedback": boolean,         // true if this is a feature request / bug / merchant ask. false if chitchat / acknowledgement / off-topic.`,
    `  "reasoning": string            // 1-line rationale. Cap at 200 chars.`,
    `}`,
    ``,
    `Allowed categories (return any subset; pick the best 1-3):`,
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
    `- itemEnglish must be the *requested behaviour or fix*, not a description of who said it.`,
    `- translateOriginal preserves the source verbatim (Japanese, Chinese, mixed) — DO NOT translate it back. If the message is already English, return "".`,
    `- isFeedback=false if the message is a thank-you, "ok received", a single emoji, a sticker, image-only context with no ask, or a status reply.`,
    `- If the request is unclear, choose the closest category but mark isFeedback=true; the human will correct.`,
    `- Output JSON only. No \`\`\`json fence. No leading or trailing prose.`,
  ]
    .filter(Boolean)
    .join("\n");
}
