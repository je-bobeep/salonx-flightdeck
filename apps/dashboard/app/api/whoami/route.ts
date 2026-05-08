import { NextResponse } from "next/server";
import { whoami } from "@flightdeck/lark/whoami";
import { LarkAuthError } from "@flightdeck/lark/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const me = await whoami();
    if (!me) {
      return NextResponse.json({ signedIn: false }, { status: 200 });
    }
    return NextResponse.json({ signedIn: true, ...me });
  } catch (e) {
    if (e instanceof LarkAuthError && e.forceReauth) {
      return NextResponse.json(
        { signedIn: false, reason: "refresh_revoked", message: e.message },
        { status: 401 }
      );
    }
    return NextResponse.json(
      { signedIn: false, error: String(e) },
      { status: 500 }
    );
  }
}
