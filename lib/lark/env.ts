import { z } from "zod";

const Env = z.object({
  LARK_APP_ID: z.string().min(1, "LARK_APP_ID is missing — set it in .env.local"),
  LARK_APP_SECRET: z
    .string()
    .min(1, "LARK_APP_SECRET is missing — set it in .env.local"),
  NEXTAUTH_SECRET: z
    .string()
    .min(32, "NEXTAUTH_SECRET must be at least 32 chars (used for cookie signing)"),
  NEXTAUTH_URL: z.string().url(),
});

export type FlightdeckEnv = z.infer<typeof Env>;

export function readEnv(): FlightdeckEnv {
  return Env.parse({
    LARK_APP_ID: process.env.LARK_APP_ID,
    LARK_APP_SECRET: process.env.LARK_APP_SECRET,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
  });
}

export const REDIRECT_PATH = "/auth/lark/callback";

export function redirectUri(env: FlightdeckEnv): string {
  return new URL(REDIRECT_PATH, env.NEXTAUTH_URL).toString();
}

export const SCOPES = [
  "offline_access",
  "bitable:app",
  "base:record:retrieve",
  "base:record:create",
  "base:record:update",
  "base:table:read",
  "base:field:read",
  "wiki:wiki:readonly",
  "drive:drive:readonly",
  "contact:user.base:readonly",
  "im:message",
  "im:message.send_as_user",
  "im:message:readonly",
  "docx:document:readonly",
] as const;
