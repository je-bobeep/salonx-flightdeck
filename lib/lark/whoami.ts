import { z } from "zod";
import { LARK_USER_INFO_URL } from "./endpoints";
import { LarkAuthError, refreshToken } from "./oauth";
import { getToken, updateProfile, type StoredToken } from "../auth/db";

const UserInfoResponse = z.object({
  code: z.number(),
  msg: z.string().optional(),
  data: z
    .object({
      name: z.string().optional(),
      en_name: z.string().optional(),
      avatar_url: z.string().optional(),
      open_id: z.string().optional(),
      union_id: z.string().optional(),
      email: z.string().optional(),
      enterprise_email: z.string().optional(),
      tenant_key: z.string().optional(),
    })
    .optional(),
});

export type WhoamiResult = {
  name: string;
  email: string | null;
  openId: string;
  avatarUrl: string | null;
};

async function callUserInfo(accessToken: string): Promise<{
  status: number;
  body: z.infer<typeof UserInfoResponse>;
}> {
  const res = await fetch(LARK_USER_INFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const json = (await res.json()) as unknown;
  return { status: res.status, body: UserInfoResponse.parse(json) };
}

export async function whoami(): Promise<WhoamiResult | null> {
  let token = getToken();
  if (!token) return null;

  const tryCall = async (t: StoredToken) => callUserInfo(t.accessToken);

  let { status, body } = await tryCall(token);

  // 401 OR Lark error code 20005 / 99991663 / 99991668 (invalid/expired access
  // token) → try refresh once. (20005 is what /authen/v1/user_info returns
  // when the UAT has expired.)
  const expired =
    status === 401 ||
    body.code === 20005 ||
    body.code === 99991663 ||
    body.code === 99991668;
  if (expired) {
    if (Date.now() > token.refreshExpiresAt) {
      throw new LarkAuthError("Refresh token expired — re-auth required", undefined, true);
    }
    token = await refreshToken(token.refreshToken);
    ({ status, body } = await tryCall(token));
  }

  if (body.code !== 0 || !body.data?.open_id || !body.data?.name) {
    throw new LarkAuthError(
      `Lark user_info returned code=${body.code} status=${status}${body.msg ? ` msg="${body.msg}"` : ""}`,
      body.code
    );
  }

  updateProfile(body.data.open_id, body.data.name);

  return {
    name: body.data.name,
    email: body.data.email ?? body.data.enterprise_email ?? null,
    openId: body.data.open_id,
    avatarUrl: body.data.avatar_url ?? null,
  };
}
