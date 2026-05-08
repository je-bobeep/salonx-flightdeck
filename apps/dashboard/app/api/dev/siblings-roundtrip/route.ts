import { NextResponse } from "next/server";
import { SIBLINGS, repoRoot } from "@flightdeck/sibling/paths";
import { gitLogGrep, gitOriginGithub } from "@flightdeck/sibling/git";
import { ghAvailable, ghPrSearch, GhUnavailable } from "@flightdeck/sibling/gh";
import { readPrdIndex, searchPrdIndex } from "@flightdeck/sibling/prds";
import { searchKb } from "@flightdeck/sibling/kb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Phase C smoke test. /api/dev/siblings-roundtrip?q=split+bill
 * Confirms paths resolve, git/gh/prds/kb tools all return non-empty results.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "split bill";

  const root = repoRoot();
  const ghOk = await ghAvailable();
  const origin = await gitOriginGithub(SIBLINGS.salonX());

  const [gitHits, prdHits, kbHits, prdIndex] = await Promise.all([
    gitLogGrep(SIBLINGS.salonX(), q, { limit: 5 }),
    searchPrdIndex(q.split(/\s+/), { limit: 5 }),
    searchKb(q.split(/\s+/), { limit: 5 }),
    readPrdIndex(),
  ]);

  let prHits: unknown = null;
  if (ghOk && origin) {
    try {
      prHits = await ghPrSearch(`${origin.owner}/${origin.repo}`, q, {
        limit: 5,
      });
    } catch (e) {
      prHits = e instanceof GhUnavailable ? `unavailable: ${e.message}` : `error: ${String(e)}`;
    }
  } else {
    prHits = "skipped: gh not available or no github origin";
  }

  return NextResponse.json({
    ok: true,
    q,
    repoRoot: root,
    ghAvailable: ghOk,
    salonXOrigin: origin,
    gitHits: gitHits.length,
    gitFirst: gitHits[0] ?? null,
    prHits,
    prdIndex: {
      featureAreaCount: prdIndex.length,
      sampleAreas: prdIndex.slice(0, 3).map((e) => e.featureArea),
    },
    prdMatches: prdHits.map((h) => ({
      featureArea: h.featureArea,
      prdCount: h.prdPaths.length,
      firstPrd: h.prdPaths[0],
    })),
    kbHits: kbHits.map((h) => ({
      relativePath: h.relativePath,
      title: h.title,
      score: h.score,
      excerpt: h.excerpt.slice(0, 100),
    })),
  });
}
