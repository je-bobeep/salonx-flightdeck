import { NextResponse } from "next/server";
import { getToken } from "@flightdeck/auth/db";
import { getThreadForBd } from "@/lib/thread-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  if (!getToken()) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "recordId required" }, { status: 400 });
  }
  const url = new URL(req.url);
  const refresh = url.searchParams.get("refresh") === "1";

  try {
    const result = await getThreadForBd(id, { refresh });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        reason: "fetch-failed",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 500 }
    );
  }
}
