import { NextResponse } from "next/server";
import {
  getPollerState,
  recentIngestLog,
} from "@flightdeck/poller/state";
import { POLLER_CONFIG } from "@flightdeck/poller/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const state = getPollerState(POLLER_CONFIG.chatId);
  const log = recentIngestLog(POLLER_CONFIG.chatId, 30);
  return NextResponse.json({
    chatId: POLLER_CONFIG.chatId,
    intervalMs: POLLER_CONFIG.intervalMs,
    state,
    log,
  });
}
