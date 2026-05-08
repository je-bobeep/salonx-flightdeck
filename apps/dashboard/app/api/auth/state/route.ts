import { NextRequest, NextResponse } from "next/server";
import { whoami } from "@flightdeck/lark/whoami";
import { LarkAuthError } from "@flightdeck/lark/oauth";
import {
  getSession,
  getToken,
  SESSION_COOKIE_NAME,
} from "@flightdeck/auth/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lightweight auth-state check used by the persistent reauth banner.
 * Polls every ~60s. Returns 200 OK regardless of state — the body's `ok`
 * flag is the signal.
 *
 * This route lives under /api/auth/* (excluded from the middleware gate) so
 * that the sign-in page can poll it. We session-gate inline instead.
 */
export async function GET(req: NextRequest) {
  const sessionId = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = sessionId ? getSession(sessionId) : null;
  if (!session) {
    return NextResponse.json({ ok: false, reason: "no-session" });
  }
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
