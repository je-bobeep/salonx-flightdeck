import { NextResponse } from "next/server";
import { getRecord, updateRecord } from "@flightdeck/lark/bitable";
import { TRACKER } from "@flightdeck/lark/wiki";
import { FD_FIELDS } from "@flightdeck/lark/schemas";
import { projectDev } from "@/lib/data-derive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Inline field edits for a Feature Development row. The body is a small set
 * of `{ field: <ui-key>, value: <new-value> }` patches — we map the ui-key to
 * Lark's actual field name and shape the value per the field's type. Limiting
 * the surface to a known whitelist keeps the route safe (no arbitrary writes)
 * and the UI is the only intended caller.
 *
 * Update semantics: passes `ignore_consistency_check: true` per
 * memory/reference_lark_base.md (Lark returns 9499 otherwise).
 */
type Patch = { field: string; value: unknown };

const FIELD_HANDLERS: Record<
  string,
  (value: unknown) => { name: string; lark: unknown }
> = {
  description: (v) => ({ name: FD_FIELDS.description, lark: String(v ?? "") }),
  storyDescription: (v) => ({
    name: FD_FIELDS.storyDescription,
    lark: String(v ?? ""),
  }),
  status: (v) => ({ name: FD_FIELDS.status, lark: String(v ?? "") }),
  priority: (v) => ({ name: FD_FIELDS.priority, lark: String(v ?? "") }),
  milestone: (v) => ({ name: FD_FIELDS.milestone, lark: String(v ?? "") }),
  requestType: (v) => ({ name: FD_FIELDS.requestType, lark: String(v ?? "") }),
  sprint: (v) => ({ name: FD_FIELDS.sprint, lark: String(v ?? "") }),
  module: (v) => ({
    name: FD_FIELDS.module,
    lark: Array.isArray(v) ? v.map(String) : [],
  }),
  product: (v) => ({
    name: FD_FIELDS.product,
    lark: Array.isArray(v) ? v.map(String) : [],
  }),
  /** ETA / Release Date — Lark stores as epoch ms (number). UI sends an ISO
   * date string ("YYYY-MM-DD") or a numeric ms; an empty string clears. */
  eta: (v) => ({ name: FD_FIELDS.eta, lark: parseDateMs(v) }),
  internalTargetDate: (v) => ({
    name: FD_FIELDS.internalEta,
    lark: parseDateMs(v),
  }),
  releaseDate: (v) => ({ name: FD_FIELDS.releaseDate, lark: parseDateMs(v) }),
  /** Assignee — single User; UI sends an open_id string or empty/null to
   * clear. Lark accepts `[{id: "ou_..."}]` or empty array. */
  assignees: (v) => {
    if (typeof v === "string" && v.length > 0) {
      return { name: FD_FIELDS.assignee, lark: [{ id: v }] };
    }
    if (Array.isArray(v)) {
      const ids = v
        .map((x) => (typeof x === "string" ? x : null))
        .filter((x): x is string => !!x);
      return { name: FD_FIELDS.assignee, lark: ids.map((id) => ({ id })) };
    }
    return { name: FD_FIELDS.assignee, lark: [] };
  },
  customerFeedback: (v) => ({
    name: FD_FIELDS.customerFeedback,
    lark: Boolean(v),
  }),
  needsTranslationReview: (v) => ({
    name: FD_FIELDS.needsTranslationReview,
    lark: Boolean(v),
  }),
};

function parseDateMs(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const num = Number(v);
    if (Number.isFinite(num) && num > 1_000_000_000_000) return num;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "recordId required" }, { status: 400 });
  }
  let patches: Patch[];
  try {
    const body = await req.json();
    patches = Array.isArray(body) ? body : [body];
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const fields: Record<string, unknown> = {};
  for (const p of patches) {
    const handler = FIELD_HANDLERS[p.field];
    if (!handler) {
      return NextResponse.json(
        { error: `unknown field: ${p.field}` },
        { status: 400 }
      );
    }
    const { name, lark } = handler(p.value);
    fields[name] = lark;
  }

  try {
    await updateRecord(
      TRACKER.appToken,
      TRACKER.tables.featureDevelopment,
      id,
      fields
    );
    // Re-read so the response carries the latest projection — saves the UI a
    // second round-trip and avoids an out-of-date optimistic state.
    const fresh = await getRecord(
      TRACKER.appToken,
      TRACKER.tables.featureDevelopment,
      id
    );
    if (!fresh) {
      return NextResponse.json({ error: "row vanished after update" }, { status: 500 });
    }
    return NextResponse.json({ row: projectDev(fresh) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
