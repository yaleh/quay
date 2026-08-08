#!/usr/bin/env node
// quay.js — pure-JS entry shim for quay's SOURCE-execution path
// (task gap-no-active-node-version-check-users-cant-tell-upgrade).
//
// The real CLI is TypeScript (bin/quay.ts), executed via
// `node --experimental-strip-types`, which needs Node >= 22.6. On an older
// Node that flag is rejected by node itself with a bare `bad option` — the
// user cannot tell they need to upgrade. This shim runs on ANY Node (pure JS,
// no strip-types — AC3) so the version probe can produce a clear, actionable
// error instead (AC1).
//
// On Node >= 22.6 this shim is a zero-dependency pass-through: it spawns the
// real CLI under `node --experimental-strip-types bin/quay.ts` and forwards
// argv + stdio + exit code. The normal-path overhead is one process spawn
// (AC2: probe does not block Node >= 22.6).
//
// SCOPE NOTE (AC4): the shipped npm bin (dist/quay.js) does NOT go through
// this shim — it is an esbuild bundle that runs on the DIST floor (Node 20,
// proven by the dist-verify-node-floor CI job). This probe is for the
// source-execution path only; the dist floor is judged separately.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkNodeVersion } from "./node-version-check.cjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REAL_ENTRY = path.join(__dirname, "quay.ts");

const probe = checkNodeVersion();
if (!probe.ok) {
  console.error(probe.message);
  console.error(`Fix: upgrade Node to >= ${probe.floor} (e.g. via nvm) and retry.`);
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ["--experimental-strip-types", REAL_ENTRY, ...process.argv.slice(2)],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
