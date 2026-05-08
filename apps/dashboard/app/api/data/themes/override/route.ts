import { NextResponse } from "next/server";
import { getToken } from "@flightdeck/auth/db";
import {
  clearDevOverride,
  clearRowOverride,
  setDevOverride,
  setRowOverride,
} from "@/lib/theme-overrides-db";
import { readThemesCachedOnly } from "@/lib/themes-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Kind = "bd" | "dev";

function readKind(raw: unknown): Kind {
  // Default to "bd" for backward compat with existing callers.
  return raw === "dev" ? "dev" : "bd";
}

/**
 * Look up the theme's display name from the most recent cached cluster.
 * Snapshotted into the override row so name-based recovery in
 * applyRowOverrides can survive id drift across re-clusters. Falls back to
 * the themeId itself when the theme isn't in the current cache (e.g.
 * override placed before clustering ran) — the recovery path tolerates
 * either-shaped value.
 */
function resolveThemeName(themeId: string): string {
  const cache = readThemesCachedOnly();
  const themes = cache?.blob.themes ?? [];
  const found = themes.find((t) => t.id === themeId);
  return found?.name ?? themeId;
}

export async function POST(req: Request) {
  if (!getToken()) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }
  try {
    const body = (await req.json()) as {
      kind?: unknown;
      bdRecordId?: unknown;
      devRecordId?: unknown;
      themeId?: unknown;
    };
    const kind = readKind(body.kind);
    const theme = typeof body.themeId === "string" ? body.themeId : null;
    if (!theme) {
      return NextResponse.json(
        { error: "themeId required" },
        { status: 400 }
      );
    }
    const themeName = resolveThemeName(theme);
    if (kind === "dev") {
      const dev =
        typeof body.devRecordId === "string" ? body.devRecordId : null;
      if (!dev) {
        return NextResponse.json(
          { error: "devRecordId required" },
          { status: 400 }
        );
      }
      setDevOverride(dev, theme, themeName);
      return NextResponse.json({ ok: true });
    }
    const bd = typeof body.bdRecordId === "string" ? body.bdRecordId : null;
    if (!bd) {
      return NextResponse.json(
        { error: "bdRecordId required" },
        { status: 400 }
      );
    }
    setRowOverride(bd, theme, themeName);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  if (!getToken()) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }
  try {
    const body = (await req.json()) as {
      kind?: unknown;
      bdRecordId?: unknown;
      devRecordId?: unknown;
    };
    const kind = readKind(body.kind);
    if (kind === "dev") {
      const dev =
        typeof body.devRecordId === "string" ? body.devRecordId : null;
      if (!dev) {
        return NextResponse.json(
          { error: "devRecordId required" },
          { status: 400 }
        );
      }
      clearDevOverride(dev);
      return NextResponse.json({ ok: true });
    }
    const bd = typeof body.bdRecordId === "string" ? body.bdRecordId : null;
    if (!bd) {
      return NextResponse.json(
        { error: "bdRecordId required" },
        { status: 400 }
      );
    }
    clearRowOverride(bd);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
