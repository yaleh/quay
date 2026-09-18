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
import { spawn } from "node:child_process";
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

// ⚠️ `spawn`, NOT `spawnSync` (2026-09-17 — the serve-host leak, gap-orphan-serve-hosts).
//
// WHY THIS IS NOT A STYLE CHOICE: `spawnSync` BLOCKS the event loop for the child's whole
// lifetime, so a signal delivered to this shim can never be relayed — there is no turn in which a
// handler could run. The shim therefore died while the real `quay.ts` process it had spawned kept
// running, reparented to init. Measured on this box: three `quay serve` hosts leaked this way, at
// 0.65–1.7 GB each, and the accumulated RSS drove a 16 GB machine into a global OOM (the kernel
// killed dbus-daemon, systemd and an unrelated chrome batch). The leak was invisible because the
// process that was killed was not the process that held the memory.
//
// The contract below is unchanged from the spawnSync version — argv, stdio and exit code are still
// forwarded — with ONE addition: termination now propagates to the child, so killing this shim
// kills what it started.
const child = spawn(
  process.execPath,
  ["--experimental-strip-types", REAL_ENTRY, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

child.on("error", (err) => {
  console.error(err.message);
  process.exit(1);
});

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    try {
      child.kill(sig);
    } catch {
      /* already gone — the exit handler below still runs */
    }
  });
}

/** Signal names this shim forwards → their numbers, so a signal-killed child is reported the same
 *  way a shell would report it (128 + N). ⛔ Not `process.kill(process.pid, signal)`: the handlers
 *  above would catch the re-raised signal and loop instead of exiting. */
const SIGNAL_NUM = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 };

child.on("exit", (code, signal) => {
  if (code !== null) process.exit(code);
  process.exit(128 + (SIGNAL_NUM[signal] ?? 0));
});
