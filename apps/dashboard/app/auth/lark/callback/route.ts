import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken, LarkAuthError } from "@flightdeck/lark/oauth";
import { readEnv } from "@flightdeck/lark/env";
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

  const res = NextResponse.redirect(new URL("/", env.NEXTAUTH_URL));
  res.cookies.delete(STATE_COOKIE);
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
