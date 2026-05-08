import { NextResponse, type NextRequest } from "next/server";

// Edge-safe gate: requires the `fd_session` cookie to be present on protected
// paths. Cookie *value* is validated against the SQLite sessions table inside
// route handlers (see `requireSession()` in lib/auth-guard.ts) — Edge can't
// load native modules, so DB lookup happens at the route layer.

export function middleware(req: NextRequest) {
  const hasCookie = req.cookies.has("fd_session");
  if (hasCookie) return NextResponse.next();

  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Pages without a cookie land back at "/" (sign-in page). Use NEXTAUTH_URL
  // as the redirect base — when Next.js binds to 127.0.0.1 and traffic arrives
  // via Tailscale's userspace forwarder, req.nextUrl reports `localhost` as the
  // host, which would 404 in the user's browser.
  const base = process.env.NEXTAUTH_URL ?? req.nextUrl.origin;
  return NextResponse.redirect(new URL("/", base));
}

export const config = {
  // Apply to everything EXCEPT:
  //   - the sign-in entry route (`/`)
  //   - the OAuth flow (`/auth/lark/start`, `/auth/lark/callback`)
  //   - the auth API surface used by the sign-in flow itself
  //   - Next internals + static assets
  matcher: [
    // Match every path EXCEPT: root "/", /auth/*, /api/auth/*, /_next/*, favicon
    "/((?!api/auth|auth/|_next/|favicon).+)",
  ],
};
