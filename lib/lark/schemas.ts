import { z } from "zod";

// Branded record-id types so we can't mix BD record IDs and Dev record IDs.
export type BdRecordId = string & { readonly __brand: "BdRecordId" };
export type DevRecordId = string & { readonly __brand: "DevRecordId" };

export const BdRecordIdZ = z
  .string()
  .min(1)
  .transform((s) => s as BdRecordId);

export const DevRecordIdZ = z
  .string()
  .min(1)
  .transform((s) => s as DevRecordId);

// --- Field name maps -----------------------------------------------------
//
// These are the WIRE field names. Note `Sub-category\n` has a literal
// trailing newline — see memory/reference_lark_base.md.

export const BD_FIELDS = {
  number: "Number",
  category: "Category",
  subCategory: "Sub-category\n",
  item: "Item",
  translate: "Translate",
  priority: "Priority",
  developmentTask: "Development Task",
  dateCreated: "Date Created",
  dateRecorded: "Date recorded",
  dayOfDeploying: "Day of deploying",
  fromThePocMerchant: "From the POC merchant",
  parentItems: "Parent items",
  createdBy: "Created By",
  status: "Status",
  requestSource: "Request source (if applicable)",
} as const;

export const FD_FIELDS = {
  description: "Description",
  storyDescription: "Story description",
  status: "Status",
  module: "Module",
  product: "Product",
  requestType: "Request Type",
  priority: "Priority",
  milestone: "Milestone",
  sprint: "Sprint",
  customerFeedback: "Customer Feedback",
  bdFeedback: "BD Feedback",
  assignee: "Assignee",
  needsTranslationReview: "Needs Translation Review",
  // Discovered live (Phase B roundtrip 2026-05-05):
  eta: "ETA",
  internalEta: "Internal ETA",
  releaseDate: "Release Date",
  prd: "PRD",
  tShirtSizing: "T-shirt Sizing",
  mustHave: "Must-have",
  aiSummary: "AI Summary",
} as const;

// --- Record envelopes ----------------------------------------------------
//
// Lark Bitable response shapes vary depending on field-content state — empty
// fields are omitted, single-user vs multi-user fields differ on read, dates
// can be ISO strings or epoch ms, DuplexLink fields can be arrays or objects.
//
// We deliberately keep the schema lenient: just `record_id` + bag of fields.
// Use the accessor functions below to pull typed values out safely.

export const BdFeedbackRecord = z.object({
  record_id: BdRecordIdZ,
  fields: z.record(z.unknown()),
});
export type BdFeedbackRecord = z.infer<typeof BdFeedbackRecord>;

export const FeatureDevRecord = z.object({
  record_id: DevRecordIdZ,
  fields: z.record(z.unknown()),
});
export type FeatureDevRecord = z.infer<typeof FeatureDevRecord>;

// --- Lenient accessors ---------------------------------------------------

/** Pull a string field, accepting strings or {text}-shaped objects. */
export function readString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    // Rich-text array: [{type:"text", text:"..."}]
    return value
      .map((seg) => {
        if (seg && typeof seg === "object" && "text" in seg) {
          return String((seg as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join("");
  }
  if (typeof value === "object") {
    if ("text" in value) {
      return String((value as { text?: unknown }).text ?? "");
    }
  }
  return "";
}

/** Pull a number from a field that may be number or numeric string. */
export function readNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Pull a date as epoch ms from a field that may be ms, ISO string, or empty. */
export function readDateMs(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
    const d = Date.parse(value);
    return Number.isFinite(d) ? d : null;
  }
  return null;
}

/** Pull a boolean from a checkbox field (which may also be undefined / false). */
export function readBool(value: unknown): boolean {
  return value === true;
}

/** Pull an array of strings from a MultiSelect field. */
export function readMultiSelect(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  return [];
}

/**
 * Pull DuplexLink record IDs. The actual on-the-wire shapes we've seen:
 *   1. `[{record_ids: ["rec..."], table_id, text, ...}, ...]` — current Lark
 *      Bitable read shape. Each array element has its own `record_ids` (which
 *      can also be `null` for empty link objects).
 *   2. `{link_record_ids: ["rec..."]}` — older shape, returned by some
 *      endpoints.
 *   3. Plain `["rec...", "rec..."]` — write shape on update payloads.
 *
 * Always returns deduped, non-empty record IDs.
 */
export function readLinkIds(value: unknown): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  const collect = (s: unknown) => {
    if (typeof s === "string" && s.length > 0) seen.add(s);
  };
  const visit = (v: unknown): void => {
    if (!v) return;
    if (Array.isArray(v)) {
      for (const el of v) {
        if (typeof el === "string") {
          collect(el);
        } else if (el && typeof el === "object") {
          visit(el);
        }
      }
      return;
    }
    if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (Array.isArray(o.record_ids)) {
        for (const s of o.record_ids) collect(s);
      }
      if (Array.isArray(o.link_record_ids)) {
        for (const s of o.link_record_ids) collect(s);
      }
    }
  };
  visit(value);
  return [...seen];
}

export type LarkUserRef = {
  id: string;
  name?: string;
  enName?: string;
  email?: string;
  avatarUrl?: string;
};

/** Pull users from a User field. Accepts single object or array of objects. */
export function readUsers(value: unknown): LarkUserRef[] {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const o = item as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : null;
    if (!id) return [];
    return [
      {
        id,
        name: typeof o.name === "string" ? o.name : undefined,
        enName: typeof o.en_name === "string" ? o.en_name : undefined,
        email: typeof o.email === "string" ? o.email : undefined,
        avatarUrl:
          typeof o.avatar_url === "string" ? o.avatar_url : undefined,
      },
    ];
  });
}

/** Pull URL field — `{link, text}` shape. */
export function readUrl(
  value: unknown
): { link: string; text: string } | null {
  if (!value || typeof value !== "object") return null;
  const o = value as { link?: unknown; text?: unknown };
  if (typeof o.link !== "string") return null;
  return { link: o.link, text: typeof o.text === "string" ? o.text : o.link };
}
