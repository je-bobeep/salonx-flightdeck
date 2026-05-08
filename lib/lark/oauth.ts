import { z } from "zod";
import { LARK_AUTHORIZE_URL, LARK_TOKEN_URL } from "./endpoints";
import { readEnv, redirectUri, SCOPES, type FlightdeckEnv } from "./env";
import { saveToken, type StoredToken } from "../auth/db";

export class LarkAuthError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
    public readonly forceReauth = false
  ) {
    super(message);
    this.name = "LarkAuthError";
  }
}

export function buildAuthorizeUrl(state: string, env = readEnv()): string {
  const url = new URL(LARK_AUTHORIZE_URL);
  url.searchParams.set("client_id", env.LARK_APP_ID);
  url.searchParams.set("redirect_uri", redirectUri(env));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

const TokenResponse = z.object({
  code: z.number(),
  msg: z.string().optional(),
  access_token: z.string().optional(),
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  refresh_token_expires_in: z.number().optional(),
  scope: z.string().optional(),
});

type TokenResponse = z.infer<typeof TokenResponse>;

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(LARK_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = (await res.json()) as unknown;
  return TokenResponse.parse(json);
}

function tokenFromResponse(
  res: TokenResponse,
  fallbackScope = ""
): Omit<StoredToken, "updatedAt" | "openId" | "name"> & { openId: null; name: null } {
  if (
    res.code !== 0 ||
    !res.access_token ||
    !res.refresh_token ||
    !res.expires_in ||
    !res.refresh_token_expires_in
  ) {
    // 20064 = refresh token already used (single-use violation).
    // 20073 = refresh token expired / invalidated.
    // Both mean the user must re-authorize — no point retrying.
    const forceReauth = res.code === 20064 || res.code === 20073;
    throw new LarkAuthError(
      `Lark token endpoint returned code=${res.code}${res.msg ? ` msg="${res.msg}"` : ""}`,
      res.code,
      forceReauth
    );
  }
  const now = Date.now();
  return {
    accessToken: res.access_token,
    refreshToken: res.refresh_token,
    expiresAt: now + res.expires_in * 1000,
    refreshExpiresAt: now + res.refresh_token_expires_in * 1000,
    scope: res.scope ?? fallbackScope,
    openId: null,
    name: null,
  };
}

export async function exchangeCodeForToken(
  code: string,
  env: FlightdeckEnv = readEnv()
): Promise<StoredToken> {
  const res = await postToken({
    grant_type: "authorization_code",
    client_id: env.LARK_APP_ID,
    client_secret: env.LARK_APP_SECRET,
    code,
    redirect_uri: redirectUri(env),
  });
  const token = tokenFromResponse(res, SCOPES.join(" "));
  saveToken(token);
  return { ...token, updatedAt: Date.now() };
}

export async function refreshToken(
  refreshTokenValue: string,
  env: FlightdeckEnv = readEnv()
): Promise<StoredToken> {
  const res = await postToken({
    grant_type: "refresh_token",
    client_id: env.LARK_APP_ID,
    client_secret: env.LARK_APP_SECRET,
    refresh_token: refreshTokenValue,
  });
  const token = tokenFromResponse(res, SCOPES.join(" "));
  // Persist BEFORE returning — Lark refresh tokens are single-use, losing the
  // new one means re-auth from scratch. See memory/reference_lark_base.md.
  saveToken(token);
  return { ...token, updatedAt: Date.now() };
}
