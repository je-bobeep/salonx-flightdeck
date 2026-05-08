import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken, LarkAuthError } from "@flightdeck/lark/oauth";
import { readEnv } from "@flightdeck/lark/env";
import { whoami } from "@flightdeck/lark/whoami";
import {
  clearToken,
  createSession,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
} from "@flightdeck/auth/db";
import { STATE_COOKIE } from "@/lib/oauth-state";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const env = readEnv();
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return errorPage(`Lark returned error: ${error}`, 400);
  }

  const expectedState = req.cookies.get(STATE_COOKIE)?.value;
  if (!state || !expectedState || state !== expectedState) {
    return errorPage(
      "OAuth state mismatch — restart sign-in. (Possible CSRF or expired state.)",
      400
    );
  }

  if (!code) {
    return errorPage("Missing authorization code in callback.", 400);
  }

  try {
    await exchangeCodeForToken(code, env);
  } catch (e) {
    const msg =
      e instanceof LarkAuthError
        ? `Lark token exchange failed: ${e.message}`
        : `Token exchange failed: ${String(e)}`;
    return errorPage(msg, 502);
  }

  // Identity gate: only the configured Lark user is allowed to sign in.
  // Without this check, anyone with any Lark account could OAuth, overwrite
  // the singleton tokens row, and impersonate the dashboard owner.
  const allowedOpenId = process.env.ALLOWED_LARK_OPEN_ID;
  if (!allowedOpenId) {
    clearToken();
    return errorPage(
      "ALLOWED_LARK_OPEN_ID is not configured on the server. Sign-in disabled.",
      503
    );
  }

  let me;
  try {
    me = await whoami();
  } catch (e) {
    clearToken();
    return errorPage(
      `Could not resolve Lark user info after sign-in: ${e instanceof Error ? e.message : String(e)}`,
      502
    );
  }
  if (!me) {
    clearToken();
    return errorPage("Sign-in succeeded but Lark returned no user info.", 502);
  }
  if (me.openId !== allowedOpenId) {
    clearToken();
    return errorPage(
      `This dashboard is restricted to a specific Lark user. Signed-in identity (${me.name}) is not authorised.`,
      403
    );
  }

  // Per-browser session — separate from the singleton Lark UAT.
  const userAgent = req.headers.get("user-agent");
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    null;
  const sessionId = createSession(me.openId, userAgent, ip);

  const res = NextResponse.redirect(new URL("/", env.NEXTAUTH_URL));
  res.cookies.delete(STATE_COOKIE);
  res.cookies.set(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NEXTAUTH_URL.startsWith("https://"),
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return res;
}

function errorPage(message: string, status: number) {
  return new NextResponse(
    `<!doctype html><html><body style="font-family:ui-sans-serif,system-ui;padding:2rem;max-width:40rem;margin:0 auto">
      <h1 style="color:#b91c1c">Sign-in failed</h1>
      <p>${escapeHtml(message)}</p>
      <p><a href="/auth/lark/start">Try again</a></p>
    </body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
