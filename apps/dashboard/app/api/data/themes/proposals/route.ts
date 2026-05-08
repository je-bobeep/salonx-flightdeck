import { NextResponse } from "next/server";
import { getToken } from "@flightdeck/auth/db";
import {
  acceptProposal,
  listPendingProposals,
  rejectProposal,
} from "@/lib/taxonomy-proposals-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  if (!getToken()) {
    return NextResponse.json({ ok: false, error: "not signed in" }, { status: 401 });
  }
  try {
    const proposals = listPendingProposals();
    return NextResponse.json({ ok: true, proposals });
  } catch (e) {
    return NextResponse.json(
      { ok: false, proposals: [], error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  if (!getToken()) {
    return NextResponse.json({ ok: false, error: "not signed in" }, { status: 401 });
  }
  try {
    const body = (await req.json()) as { name?: unknown; action?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const action = body.action === "accept" || body.action === "reject" ? body.action : null;
    if (!name || !action) {
      return NextResponse.json(
        { ok: false, error: "name (string) and action ('accept'|'reject') required" },
        { status: 400 }
      );
    }
    if (action === "accept") acceptProposal(name);
    else rejectProposal(name);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
