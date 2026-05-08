import type { NextConfig } from "next";
import path from "node:path";

// Canonical .env.local lives at the repo root (per CLAUDE.md). It's symlinked
// to apps/dashboard/.env.local so Next.js's default loader picks it up.

const config: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, "../.."),
  transpilePackages: [
    "@flightdeck/auth",
    "@flightdeck/lark",
    "@flightdeck/sibling",
    "@flightdeck/claude",
    "@flightdeck/poller",
  ],
  serverExternalPackages: ["better-sqlite3"],
};

export default config;
