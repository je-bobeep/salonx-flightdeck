// Classify a Lark IM message into BD-Feedback fields.
//
// Two layers:
//   1. Deterministic priority detection from keywords (regex). Cheap, predictable.
//   2. Claude one-shot for category / sub-category / English summary / language detection.

import { runClaudeOneShot } from "@flightdeck/claude/runner";
import { classifyBdSystemPrompt } from "@flightdeck/claude/prompts/classify-bd";

export type DetectedPriority = "Critical Fix" | "Immediate" | "Next" | null;

/**
 * Priority detection rules per the user's spec:
 *   - "Super urgent" / "within 1 week" / "within 2 weeks" → Critical Fix
 *   - "Urgent" → Immediate
 *   - Literal "Immediate" → Immediate
 *   - Literal "Next" → Next
 *
 * "Critical Fix" wins over "Immediate" wins over "Next" when multiple match.
 * The "super urgent" check must run BEFORE the bare /\burgent\b/ match.
 */
export function detectPriority(text: string): DetectedPriority {
  if (!text) return null;
  const t = text;
  if (
    /super\s*urgent/i.test(t) ||
    /within\s+1\s+week\b/i.test(t) ||
    /within\s+2\s+weeks?\b/i.test(t)
  ) {
    return "Critical Fix";
  }
  if (/\burgent\b/i.test(t) || /\bimmediate\b/i.test(t)) {
    return "Immediate";
  }
  if (/\bnext\b/i.test(t)) {
    return "Next";
  }
  return null;
}

export type Classification = {
  category: string[];
  subCategory: string;
  isFeedback: boolean;
  reasoning: string;
};

export type ClassifyOptions = {
  text: string;
  knownCategories: string[];
  knownSubCategories?: string[];
  /** Override the model. Default 'sonnet' (sufficient for classification). */
  model?: string;
  abortSignal?: AbortSignal;
};

/**
 * Call Claude to extract structured BD fields from a free-form message.
 * Returns null if Claude couldn't produce valid JSON (caller logs + skips).
 */
export async function classifyMessage(
  opts: ClassifyOptions
): Promise<Classification | null> {
  const systemPrompt = classifyBdSystemPrompt({
    knownCategories: opts.knownCategories,
    knownSubCategories: opts.knownSubCategories,
  });

  const result = await runClaudeOneShot({
    systemPrompt,
    userMessage: opts.text,
    model: opts.model ?? "sonnet",
    abortSignal: opts.abortSignal,
    disableMcp: true,
  });

  if (!result.json || typeof result.json !== "object") {
    return null;
  }
  const j = result.json as Record<string, unknown>;
  const subCategory = typeof j.subCategory === "string" ? j.subCategory : "";
  const isFeedback = j.isFeedback === true;
  const reasoning = typeof j.reasoning === "string" ? j.reasoning : "";
  const categoryRaw = Array.isArray(j.category) ? j.category : [];
  const category = categoryRaw.filter(
    (c): c is string => typeof c === "string" && c.length > 0
  );

  // Validate category entries are in the known list — Claude sometimes
  // hallucinates label variants. Drop unknowns.
  const allowed = new Set(opts.knownCategories);
  const cleanCategory = category.filter((c) => allowed.has(c));

  return {
    category: cleanCategory,
    subCategory,
    isFeedback,
    reasoning,
  };
}
