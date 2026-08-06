#!/usr/bin/env node
// quay.cjs — the source-execution ENTRY for the quay Core CLI.
//
// gap-no-active-node-version-check-users-cant-tell-upgrade: this launcher is the ACTIVE
// Node-version probe. It is pure CommonJS (no strip-types / ESM-only syntax) so it runs on
// the oldest Node that can possibly execute it, and it FAILS CLOSED before touching the
// real TS entry when the runtime is below the `--experimental-strip-types` floor (22.6),
// naming the required floor + an upgrade hint instead of the bare `bad option` error.
//
// On success it re-execs the real TS entry under `node --experimental-strip-types` (the
// same invocation the docs historically spelled directly). The dist path (dist/quay.js —
// the transpiled bundle installed via package.json `bin`) does NOT route through this file;
// it has its own floor declared by the dist-verify-node-floor CI (AC4 cross-label).
"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { checkNodeVersion } = require("./node-version-probe.cjs");

// Run the ACTIVE probe (honors the QUAY_TEST_NODE_VERSION test seam — see the probe module).
const probe = checkNodeVersion();

if (!probe.ok) {
  console.error(probe.message);
  process.exit(1);
}

// Floor satisfied — run the real TS entry under `--experimental-strip-types`, passing
// through argv/stdin/stdout/stderr and the child's exit code. spawnSync keeps the parent
// blocked for the child's lifetime (no orphan on signal-kill; terminal Ctrl-C reaches both
// because the child is in the same process group).
const script = path.join(__dirname, "quay.ts");
const r = spawnSync(
  process.execPath,
  ["--experimental-strip-types", script, ...process.argv.slice(2)],
  { stdio: "inherit", env: process.env }
);
process.exit(r.status === null ? 1 : r.status);
