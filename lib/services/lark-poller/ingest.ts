// Convert a classified Lark IM message into a BD Feedback row write.
// Handles "next Number" lookup and the field-shape quirks (Sub-category\n).

import { createRecord, listRecords } from "@flightdeck/lark/bitable";
import { TRACKER } from "@flightdeck/lark/wiki";
import { BD_FIELDS, readString } from "@flightdeck/lark/schemas";
import type { LarkMessage } from "@flightdeck/lark/im";
import type { Classification, DetectedPriority } from "./classify";

export type IngestInput = {
  message: LarkMessage;
  text: string;
  classification: Classification;
  priority: DetectedPriority;
};

export type IngestResult = {
  bdRecordId: string;
  bdNumber: string;
};

/**
 * Build the BD Feedback fields object from a classification + priority.
 * Exposed for testing / preview.
 */
export function buildBdFields(input: {
  classification: Classification;
  priority: DetectedPriority;
  number: string;
  todayIso: string;
  /** Raw original message text. Written verbatim to the Item field in
   *  whatever language it arrived in (Japanese, Chinese, English, mixed).
   *  The Lark Translate column is auto-populated from Item, so we don't
   *  write Translate at all. */
  text: string;
  requestSourceUrl?: string;
}): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    [BD_FIELDS.number]: input.number,
    [BD_FIELDS.item]: input.text,
    [BD_FIELDS.dateRecorded]: input.todayIso,
    [BD_FIELDS.status]: "Logged",
  };
  if (input.classification.category.length > 0) {
    fields[BD_FIELDS.category] = input.classification.category;
  }
  if (input.classification.subCategory) {
    fields[BD_FIELDS.subCategory] = input.classification.subCategory;
  }
  if (input.priority) {
    fields[BD_FIELDS.priority] = input.priority;
  }
  if (input.requestSourceUrl) {
    fields[BD_FIELDS.requestSource] = {
      link: input.requestSourceUrl,
      text: input.requestSourceUrl,
    };
  }
  return fields;
}

/**
 * Find the next BD Number to use. Lark Number field is a Text type holding
 * stringified integers; we scan all rows for the highest, then add 1.
 *
 * In v1 we re-scan on every ingest. Cheap enough for the volumes involved
 * (a few hundred rows).
 */
export async function nextBdNumber(): Promise<string> {
  const rows = await listRecords(
    TRACKER.appToken,
    TRACKER.tables.bdFeedback,
    {
      pageSize: 100,
      fieldNames: [BD_FIELDS.number],
    }
  );
  let max = 0;
  for (const r of rows) {
    const n = readString(r.fields[BD_FIELDS.number]);
    const v = Number(n);
    if (Number.isFinite(v) && v > max) max = v;
  }
  return String(max + 1);
}

function todayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function ingestMessage(
  input: IngestInput
): Promise<IngestResult> {
  const number = await nextBdNumber();
  const fields = buildBdFields({
    classification: input.classification,
    priority: input.priority,
    number,
    todayIso: todayIso(),
    text: input.text,
  });
  const created = await createRecord(
    TRACKER.appToken,
    TRACKER.tables.bdFeedback,
    fields
  );
  return { bdRecordId: created.record_id, bdNumber: number };
}
