import { NextRequest, NextResponse } from "next/server";
import { deleteSession, SESSION_COOKIE_NAME } from "@flightdeck/auth/db";
import { readEnv } from "@flightdeck/lark/env";

export const runtime = "nodejs";

// Sign out THIS browser only. The Lark UAT in the singleton tokens row is
// preserved so the background poller keeps working — that's intentional,
// not a bug. To revoke the Lark token entirely, use a different mechanism
// (admin script or `DELETE FROM tokens` directly).
export async function POST(req: NextRequest) {
  const sessionId = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (sessionId) deleteSession(sessionId);

  const res = NextResponse.redirect(new URL("/", readEnv().NEXTAUTH_URL), {
    status: 303,
  });
  res.cookies.delete(SESSION_COOKIE_NAME);
  return res;
}
