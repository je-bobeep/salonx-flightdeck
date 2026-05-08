import { NextResponse } from "next/server";
import { whoami } from "@flightdeck/lark/whoami";
import { LarkAuthError } from "@flightdeck/lark/oauth";
import { getToken } from "@flightdeck/auth/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lightweight auth-state check used by the persistent reauth banner.
 * Polls every ~60s. Returns 200 OK regardless of state — the body's `ok`
 * flag is the signal.
 */
export async function GET() {
  const token = getToken();
  if (!token) {
    return NextResponse.json({ ok: false, reason: "no-token" });
  }
  if (Date.now() > token.refreshExpiresAt) {
    return NextResponse.json({ ok: false, reason: "refresh-expired" });
  }
  try {
    const me = await whoami();
    if (!me) {
      return NextResponse.json({ ok: false, reason: "no-token" });
    }
    return NextResponse.json({ ok: true, name: me.name });
  } catch (e) {
    if (e instanceof LarkAuthError && e.forceReauth) {
      return NextResponse.json({ ok: false, reason: "refresh-revoked", message: e.message });
    }
    return NextResponse.json({
      ok: false,
      reason: "error",
      message: e instanceof Error ? e.message : String(e),
    });
  }
}
