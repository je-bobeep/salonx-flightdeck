import { NextResponse } from "next/server";
import { listRecords } from "@flightdeck/lark/bitable";
import { TRACKER } from "@flightdeck/lark/wiki";
import { BD_FIELDS, FD_FIELDS } from "@flightdeck/lark/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Diagnostic: peek at the actual shape of link fields on real rows. */
export async function GET() {
  const [bd, dev] = await Promise.all([
    listRecords(TRACKER.appToken, TRACKER.tables.bdFeedback, {
      pageSize: 50,
      all: false,
    }),
    listRecords(TRACKER.appToken, TRACKER.tables.featureDevelopment, {
      pageSize: 50,
      all: false,
    }),
  ]);
  const bdLinkSamples = bd
    .filter((r) => r.fields[BD_FIELDS.developmentTask])
    .slice(0, 3)
    .map((r) => ({
      record_id: r.record_id,
      developmentTask: r.fields[BD_FIELDS.developmentTask],
    }));
  const devLinkSamples = dev
    .filter((r) => r.fields[FD_FIELDS.bdFeedback])
    .slice(0, 3)
    .map((r) => ({
      record_id: r.record_id,
      bdFeedback: r.fields[FD_FIELDS.bdFeedback],
    }));
  return NextResponse.json({
    bdWithDevLink: bdLinkSamples.length,
    bdSamples: bdLinkSamples,
    devWithBdLink: devLinkSamples.length,
    devSamples: devLinkSamples,
  });
}
