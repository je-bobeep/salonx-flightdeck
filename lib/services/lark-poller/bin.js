#!/usr/bin/env node
// Thin launcher: delegate to tsx so we can run run.ts directly without a
// build step. Resolves tsx via the package's own node_modules.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const tsxBin = require.resolve("tsx/cli");
const runPath = path.join(__dirname, "run.ts");

const child = spawn(process.execPath, [tsxBin, runPath, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 0));
