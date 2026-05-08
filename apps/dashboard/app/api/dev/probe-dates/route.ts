import { NextResponse } from "next/server";
import { listRecords } from "@flightdeck/lark/bitable";
import { TRACKER } from "@flightdeck/lark/wiki";
import { BD_FIELDS } from "@flightdeck/lark/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Diagnostic: show raw values of both date fields + record metadata. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const numberFilter = url.searchParams.get("n");

  const raws = await listRecords(TRACKER.appToken, TRACKER.tables.bdFeedback, {
    pageSize: 100,
    all: true,
  });

  const sample = numberFilter
    ? raws.filter((r) => String(r.fields[BD_FIELDS.number]) === numberFilter)
    : raws.slice(0, 10);

  return NextResponse.json({
    serverNowMs: Date.now(),
    serverNowIso: new Date().toISOString(),
    rows: sample.map((r) => {
      const dc = r.fields[BD_FIELDS.dateCreated];
      const dr = r.fields[BD_FIELDS.dateRecorded];
      const dod = r.fields[BD_FIELDS.dayOfDeploying];
      return {
        record_id: r.record_id,
        number: r.fields[BD_FIELDS.number],
        item: String(r.fields[BD_FIELDS.item]).slice(0, 80),
        created_time_meta: r.created_time, // record-level created_time
        last_modified_time_meta: r.last_modified_time,
        dateCreated_raw: dc,
        dateCreated_iso:
          typeof dc === "number" ? new Date(dc).toISOString() : null,
        dateRecorded_raw: dr,
        dateRecorded_iso:
          typeof dr === "number" ? new Date(dr).toISOString() : null,
        dayOfDeploying_raw: dod,
      };
    }),
  });
}
