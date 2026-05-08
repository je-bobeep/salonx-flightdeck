import { NextResponse } from "next/server";
import { listBdFeedback, listFeatureDev, listFields } from "@flightdeck/lark/bitable";
import { TRACKER, resolveWikiToken } from "@flightdeck/lark/wiki";
import { LarkApiError } from "@flightdeck/lark/client";
import { LarkAuthError } from "@flightdeck/lark/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Phase B smoke test. Visit /api/dev/lark-roundtrip when signed in.
 * Confirms: wiki resolution, list BD Feedback, list Feature Dev, list fields.
 * No writes — purely read-side verification.
 */
export async function GET() {
  try {
    const resolvedAppToken = await resolveWikiToken(TRACKER.wikiToken);
    const [bdSample, devSample, bdFields, devFields] = await Promise.all([
      listBdFeedback({ pageSize: 5, all: false }),
      listFeatureDev({ pageSize: 5, all: false }),
      listFields(TRACKER.appToken, TRACKER.tables.bdFeedback),
      listFields(TRACKER.appToken, TRACKER.tables.featureDevelopment),
    ]);

    return NextResponse.json({
      ok: true,
      wiki: {
        wikiToken: TRACKER.wikiToken,
        resolvedAppToken,
        matchesHardcoded: resolvedAppToken === TRACKER.appToken,
      },
      bd: {
        sampleCount: bdSample.length,
        first: bdSample[0]
          ? {
              record_id: bdSample[0].record_id,
              fieldKeys: Object.keys(bdSample[0].fields),
            }
          : null,
        fieldCount: bdFields.length,
        // Verify the trailing-newline field name is in the schema
        subCategoryFieldExists: bdFields.some(
          (f) => f.fieldName === "Sub-category\n"
        ),
        // Confirm Status field exists
        statusFieldExists: bdFields.some((f) => f.fieldName === "Status"),
      },
      dev: {
        sampleCount: devSample.length,
        first: devSample[0]
          ? {
              record_id: devSample[0].record_id,
              fieldKeys: Object.keys(devSample[0].fields),
            }
          : null,
        fieldCount: devFields.length,
        // Show what kind the Description / Story description fields are
        descriptionField: devFields.find((f) => f.fieldName === "Description"),
        storyDescriptionField: devFields.find(
          (f) => f.fieldName === "Story description"
        ),
        bdFeedbackField: devFields.find((f) => f.fieldName === "BD Feedback"),
      },
    });
  } catch (e) {
    if (e instanceof LarkAuthError) {
      return NextResponse.json(
        { ok: false, kind: "auth", message: e.message, forceReauth: e.forceReauth },
        { status: 401 }
      );
    }
    if (e instanceof LarkApiError) {
      return NextResponse.json(
        {
          ok: false,
          kind: "api",
          code: e.code,
          httpStatus: e.httpStatus,
          message: e.message,
          body: e.body,
        },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { ok: false, kind: "unknown", message: String(e) },
      { status: 500 }
    );
  }
}
