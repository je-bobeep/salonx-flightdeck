import os from "node:os";
import path from "node:path";

/**
 * Root under which all sibling repos must live. Defaults to ~/all-salonx-repo
 * but can be overridden with FLIGHTDECK_REPO_ROOT (useful for tests / CI).
 *
 * The safety check in `safety.ts` ensures no read/grep ever escapes this root.
 */
export function repoRoot(): string {
  const fromEnv = process.env.FLIGHTDECK_REPO_ROOT;
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(os.homedir(), "all-salonx-repo");
}

export function siblingPath(name: string): string {
  return path.join(repoRoot(), name);
}

export const SIBLINGS = {
  salonX: () => siblingPath("salon-x"),
  salonXBusiness: () => siblingPath("salon-x-business"),
  salonXKb: () => siblingPath("salonx-kb"),
  salonXFlightdeck: () => siblingPath("salonx-flightdeck"),
} as const;

export type SiblingName = keyof typeof SIBLINGS;
