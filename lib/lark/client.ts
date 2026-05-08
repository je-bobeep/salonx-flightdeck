import { z } from "zod";
import { getToken, type StoredToken } from "../auth/db";
import { LarkAuthError, refreshToken } from "./oauth";

export const LARK_API_BASE = "https://open.larksuite.com/open-apis";

/**
 * Module-level in-flight refresh promise. Lark refresh tokens are SINGLE-USE
 * — when the dashboard fires several routes in parallel and the access token
 * has expired, each call independently sees a 401 and tries to refresh with
 * the same refresh_token. The first call invalidates that token; all the
 * others get back code=20073. Holding a single in-flight promise so all
 * concurrent callers share the result of one refresh fixes the race.
 *
 * Tracked by the access-token string we tried to use, so a refresh that
 * failed for one (already-invalidated) token doesn't poison a second run
 * that's working off a fresh token.
 */
let inFlightRefresh: { forAccessToken: string; promise: Promise<StoredToken> } | null =
  null;

async function refreshOnce(triedAccessToken: string): Promise<StoredToken> {
  // Coalesce concurrent refreshes for the same access token.
  if (
    inFlightRefresh &&
    inFlightRefresh.forAccessToken === triedAccessToken
  ) {
    return inFlightRefresh.promise;
  }
  // Re-read from DB — another request may have just written a fresh token,
  // in which case our stored refresh_token is already the new one.
  const current = getToken();
  if (!current) {
    throw new LarkAuthError("Not signed in to Lark", undefined, true);
  }
  if (current.accessToken !== triedAccessToken) {
    // Someone else already refreshed under us. Use what's in the DB.
    return current;
  }
  const promise = refreshToken(current.refreshToken).finally(() => {
    if (inFlightRefresh && inFlightRefresh.forAccessToken === triedAccessToken) {
      inFlightRefresh = null;
    }
  });
  inFlightRefresh = { forAccessToken: triedAccessToken, promise };
  return promise;
}

const LarkBodyShape = z.object({
  code: z.number(),
  msg: z.string().optional(),
  data: z.unknown().optional(),
});

// Lark error codes that mean "the access token is no longer good — try refresh".
// 99991663 / 99991668 are the documented Bitable invalid-token codes.
// 20005 is what /authen/v1/user_info returns when the UAT has expired.
const TOKEN_INVALID_CODES = new Set([99991663, 99991668, 20005]);

export class LarkApiError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly httpStatus: number,
    public readonly body: unknown
  ) {
    super(message);
    this.name = "LarkApiError";
  }
}

type FetchSpec = {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string; // e.g. "/bitable/v1/apps/.../records" — joined to LARK_API_BASE
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
};

function buildUrl(path: string, query?: FetchSpec["query"]): string {
  const url = new URL(LARK_API_BASE + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function rawFetch(
  spec: FetchSpec,
  accessToken: string
): Promise<{ status: number; body: unknown }> {
  const init: RequestInit = {
    method: spec.method ?? "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(spec.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: spec.body !== undefined ? JSON.stringify(spec.body) : undefined,
    cache: "no-store",
  };
  const res = await fetch(buildUrl(spec.path, spec.query), init);
  // Some endpoints return non-JSON on auth failure; guard.
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { code: -1, msg: `non-json response: ${text.slice(0, 200)}` };
    }
  }
  return { status: res.status, body: json };
}

/**
 * Make a Lark API call as the signed-in user. Auto-refreshes the access token
 * once on 401 / token-invalid response codes. Throws LarkAuthError if no token,
 * or LarkApiError on a non-zero Lark `code`.
 *
 * Callers that need to inspect the raw envelope (e.g. for the `data` field)
 * should pass an `as` schema or just cast the return value.
 */
export async function larkFetch<T = unknown>(spec: FetchSpec): Promise<T> {
  let token: StoredToken | null = getToken();
  if (!token) {
    throw new LarkAuthError("Not signed in to Lark", undefined, true);
  }

  let { status, body } = await rawFetch(spec, token.accessToken);

  const parsed = LarkBodyShape.safeParse(body);
  const code = parsed.success ? parsed.data.code : null;
  const msg = parsed.success ? parsed.data.msg : undefined;

  const tokenInvalid =
    status === 401 || (code !== null && TOKEN_INVALID_CODES.has(code));

  if (tokenInvalid) {
    if (Date.now() > token.refreshExpiresAt) {
      throw new LarkAuthError(
        "Lark refresh token expired — re-auth required",
        code ?? undefined,
        true
      );
    }
    // Coalesced refresh — handles concurrent route handlers all hitting 401
    // at once with the same now-stale refresh_token.
    token = await refreshOnce(token.accessToken);
    ({ status, body } = await rawFetch(spec, token.accessToken));
  }

  const final = LarkBodyShape.safeParse(body);
  if (!final.success) {
    throw new LarkApiError(
      `Unexpected Lark response shape (status=${status})`,
      -1,
      status,
      body
    );
  }
  if (final.data.code !== 0) {
    throw new LarkApiError(
      `Lark API error code=${final.data.code}${msg ? ` msg="${msg}"` : ""}`,
      final.data.code,
      status,
      body
    );
  }

  return body as T;
}
