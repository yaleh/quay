// @test-group product
// node-version-probe.test.mjs — gap-no-active-node-version-check-users-cant-tell-upgrade
// AC1/AC2/AC3 for the source-execution entry's ACTIVE Node-version probe.
//
//   AC1 — a version below the 22.6 floor fails closed with a clear error naming the
//         required floor + an upgrade hint (NOT the bare `bad option` node error).
//   AC2 — a version at/above the 22.6 floor is a no-op (the probe does not block normal use).
//   AC3 — the probe module is pure CommonJS runnable on old Node (no strip-types / ESM-only).
//
// The low-version branch is exercised two ways:
//   1. the pure check function (loaded via createRequire — plain Node, no strip-types), and
//   2. the REAL launcher spawned with the QUAY_TEST_NODE_VERSION seam, capturing its actual
//      stderr — the same code path a Node 18 runtime would take (a real Node 18 binary is
//      not available in this worktree; the seam substitutes exactly the string the probe
//      would parse from `process.versions.node` on such a runtime).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binDir = path.resolve(__dirname, "..", "bin");
const require = createRequire(import.meta.url);
const { checkNodeVersion, parseNodeVersion } = require("../bin/node-version-probe.cjs");

test("AC3: the probe module is pure CommonJS — loads without strip-types (plain node:test run)", () => {
  // createRequire loads a .cjs with plain Node — no --experimental-strip-types is involved
  // in loading the probe. A TS/ESM-only construct inside it would throw here, on the oldest
  // Node the test runner itself can use.
  assert.equal(typeof checkNodeVersion, "function");
  assert.equal(typeof parseNodeVersion, "function");
});

test("AC1: versions below the 22.6 floor fail closed with a clear message (naming floor + upgrade hint)", () => {
  for (const low of ["18.19.1", "20.0.0", "22.5.9", "v18.0.0"]) {
    const r = checkNodeVersion(low);
    assert.equal(r.ok, false, `${low} must be below the floor`);
    assert.match(r.message, /22\.6/, `${low}: message must name the required floor`);
    assert.match(r.message, /升级|upgrade/i, `${low}: message must carry an upgrade hint`);
    assert.ok(r.message.includes(low), `${low}: message must name the current version`);
  }
});

test("AC2: versions at/above the 22.6 floor are a no-op (ok, empty message)", () => {
  for (const okv of ["22.6.0", "22.6.1", "23.0.0", "25.2.0", "v25.2.0"]) {
    const r = checkNodeVersion(okv);
    assert.equal(r.ok, true, `${okv} must be at/above the floor`);
    assert.equal(r.message, "");
  }
});

test("AC1 e2e: the real launcher fails closed on a simulated low Node (QUAY_TEST_NODE_VERSION seam)", () => {
  const res = spawnSync(process.execPath, [path.join(binDir, "quay.cjs"), "--version"], {
    env: { ...process.env, QUAY_TEST_NODE_VERSION: "18.19.1" },
    encoding: "utf8",
  });
  assert.notEqual(res.status, 0, "the launcher must exit non-zero below the floor");
  const all = `${res.stdout}\n${res.stderr}`;
  assert.match(all, /22\.6/, "output must name the required floor");
  assert.match(all, /升级|upgrade/i, "output must carry an upgrade hint");
  assert.doesNotMatch(all, /bad option/, "must NOT be the bare node bad-option error");
});

test("AC2 e2e: the real launcher passes through on the current Node (>= floor, zero impact)", () => {
  const res = spawnSync(process.execPath, [path.join(binDir, "quay.cjs"), "--version"], {
    env: { ...process.env },
    encoding: "utf8",
  });
  assert.equal(res.status, 0, "the launcher must pass through at/above the floor");
  assert.match(
    `${res.stdout}\n${res.stderr}`,
    /\d+\.\d+\.\d+/,
    "the real CLI must run (prints the quay version)"
  );
});
