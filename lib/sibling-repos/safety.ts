import path from "node:path";
import { repoRoot } from "./paths";

const BINARY_EXTENSIONS = new Set([
  ".pdf", ".xlsx", ".xls", ".docx", ".doc", ".pptx", ".ppt",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico",
  ".mp3", ".mp4", ".mov", ".webm", ".zip", ".tar", ".gz",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".node", ".so", ".dylib", ".exe", ".bin",
]);

/** Throw if `p` is not inside the configured FLIGHTDECK_REPO_ROOT. */
export function assertSafePath(p: string): string {
  const root = repoRoot();
  const resolved = path.resolve(p);
  const rel = path.relative(root, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(
      `path traversal blocked: ${resolved} is outside ${root}`
    );
  }
  return resolved;
}

export function isBinaryPath(p: string): boolean {
  return BINARY_EXTENSIONS.has(path.extname(p).toLowerCase());
}
