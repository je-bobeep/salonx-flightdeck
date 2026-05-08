import { NextResponse } from "next/server";
import { clearToken } from "@flightdeck/auth/db";
import { readEnv } from "@flightdeck/lark/env";

export const runtime = "nodejs";

export async function POST() {
  clearToken();
  return NextResponse.redirect(new URL("/", readEnv().NEXTAUTH_URL), {
    status: 303,
  });
}
