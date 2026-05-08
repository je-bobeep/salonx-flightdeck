#!/usr/bin/env node
// Thin launcher: delegate to tsx so we can run the TS server file directly.
// Resolved relative to this file so it works whether invoked via the
// workspace bin link or absolute path.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const tsxBin = require.resolve("tsx/cli");
const serverPath = path.join(__dirname, "server.ts");

const child = spawn(process.execPath, [tsxBin, serverPath], {
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 0));
