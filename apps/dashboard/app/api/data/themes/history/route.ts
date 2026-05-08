import { NextResponse } from "next/server";
import { readDailyBucketHistory } from "@flightdeck/themes/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Daily theme cluster history. Returns up to the most recent 14 daily buckets
 * (one per day, newest first). Heavy member arrays (`bdRecordIds`,
 * `devRecordIds`) are stripped — the history view only needs names + counts.
 *
 * This is a debug surface so the user can recover from a known-good day's
 * clustering when the current day's drifted.
 */
export async function GET() {
  try {
    const history = readDailyBucketHistory().map((entry) => ({
      dateKey: entry.dateKey,
      computedAt: entry.payload.computedAt,
      mode: entry.payload.mode,
      themeCount: entry.payload.themes.length,
      themes: entry.payload.themes.map((t) => ({
        id: t.id,
        name: t.name,
        bdVolume: t.bdVolume,
        dominantCategories: t.dominantCategories,
        dominantSubCategories: t.dominantSubCategories,
      })),
      fetchedAt: entry.fetchedAt,
    }));
    return NextResponse.json({ ok: true, history });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
