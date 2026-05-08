import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { buildAuthorizeUrl } from "@flightdeck/lark/oauth";
import { readEnv } from "@flightdeck/lark/env";
import { STATE_COOKIE } from "@/lib/oauth-state";

export const runtime = "nodejs";

export async function GET() {
  const env = readEnv();
  const state = crypto.randomBytes(32).toString("base64url");
  const url = buildAuthorizeUrl(state, env);

  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NEXTAUTH_URL.startsWith("https://"),
    path: "/",
    maxAge: 60 * 5,
  });
  return res;
}
