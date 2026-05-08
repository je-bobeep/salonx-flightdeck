import fs from "node:fs";
import path from "node:path";
import { workspaceRoot } from "./paths";

/** Resolve the absolute path to lib/mcp-tools/bin.js relative to the workspace root. */
function mcpBinPath(): string {
  return path.join(workspaceRoot(), "lib/mcp-tools/bin.js");
}

export const MCP_SERVER_NAME = "flightdeck";

/**
 * Build (or refresh) the JSON MCP config that points `claude -p` at our
 * stdio MCP server. Returns the absolute path to the file.
 *
 * We write it inside `.data/` so it co-locates with other ephemeral state
 * and is gitignored. It's safe to overwrite each call.
 */
export function ensureMcpConfig(): string {
  const root = workspaceRoot();
  const dataDir = path.join(root, ".data");
  fs.mkdirSync(dataDir, { recursive: true });

  const binPath = mcpBinPath();
  // Honor parent env when present (e.g. systemd-set FLIGHTDECK_DB_PATH on hubbibi)
  // so the spawned MCP child writes to the SAME DB as the dashboard process.
  // Without this, deployment splits state between dashboard and MCP child and the
  // propose-then-approve flow breaks silently.
  const dbPath = process.env.FLIGHTDECK_DB_PATH ?? path.join(dataDir, "tokens.db");

  const config = {
    mcpServers: {
      [MCP_SERVER_NAME]: {
        command: process.execPath, // current node binary
        args: [binPath],
        env: {
          FLIGHTDECK_DB_PATH: dbPath,
          FLIGHTDECK_REPO_ROOT: process.env.FLIGHTDECK_REPO_ROOT ?? path.dirname(root),
          // Pass through PATH so child can find git, gh, etc.
          PATH: process.env.PATH ?? "",
        },
      },
    },
  };

  const cfgPath = path.join(dataDir, "mcp-config.json");
  fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2));
  return cfgPath;
}

/** Tool-name prefix that Claude Code uses for MCP tools from our server. */
export const MCP_TOOL_PREFIX = `mcp__${MCP_SERVER_NAME}__`;

/** Allowedtools wildcard for `--allowedTools`. */
export const MCP_ALLOWED_TOOLS_WILDCARD = `${MCP_TOOL_PREFIX}*`;
