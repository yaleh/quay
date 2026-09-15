// @test-group product
// node-version-check.test.mjs — task gap-no-active-node-version-check-users-
// cant-tell-upgrade.
//
// quay's SOURCE-execution path (`node --experimental-strip-types bin/quay.ts`)
// needs Node >= 22.6; on an older Node the flag is rejected by node itself
// with a bare `bad option` and the user gets no upgrade hint. The fix is a
// pure-JS probe (bin/node-version-check.cjs) plus a pure-JS entry shim
// (bin/quay.js) that produces a clear, actionable error on old Node and is a
// zero-dependency pass-through on Node >= 22.6.
//
// These tests pin:
//   (a) the pure version comparison (parseNodeVersion / belowFloor);
//   (b) checkNodeVersion's message shape (names the required floor + an
//       upgrade hint), via the version override — the same deterministic hook
//       (QUAY_NODE_VERSION_OVERRIDE) the wrapper/probe read;
//   (c) the real wrapper behavior as a subprocess: old-node override -> clear
//       error + exit 1 (NOT a bare bad-option), current node (>= 22.6) ->
//       pass-through success (AC2: probe does not block normal use);
//   (d) the probe standalone (`node node-version-check.cjs`): fail-closed on
//       old-node override, exit 0 on the real current version.
//
// The REAL old-Node run (Node 18.20.4 binary, no override) is captured in the
// task file's Evidence section — these tests use the env override because a
// `node --test` suite must pass on the repo's own Node (>= 22.6).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import probe from "../bin/node-version-check.cjs";
import { QUAY_PKG_DIR } from "./helpers/cli-entry.mjs";

const { checkNodeVersion, parseNodeVersion, belowFloor, STRIP_TYPES_FLOOR } = probe;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(QUAY_PKG_DIR, "bin");
const PROBE = path.join(BIN, "node-version-check.cjs");
const WRAPPER = path.join(BIN, "quay.js");

test("parseNodeVersion parses v-prefixed and bare major.minor", () => {
  assert.deepEqual(parseNodeVersion("v22.6.0"), [22, 6]);
  assert.deepEqual(parseNodeVersion("22.6.0"), [22, 6]);
  assert.deepEqual(parseNodeVersion("v18.19.1"), [18, 19]);
  assert.deepEqual(parseNodeVersion("v23.0.0"), [23, 0]);
  assert.equal(parseNodeVersion("garbage"), null);
  assert.equal(parseNodeVersion(""), null);
});

test("belowFloor compares [major, minor] tuples correctly", () => {
  assert.equal(belowFloor([18, 19], [22, 6]), true);
  assert.equal(belowFloor([22, 5], [22, 6]), true);
  assert.equal(belowFloor([22, 6], [22, 6]), false);
  assert.equal(belowFloor([22, 7], [22, 6]), false);
  assert.equal(belowFloor([26, 5], [22, 6]), false);
});

test("checkNodeVersion fails closed with a floor-naming + upgrade-hint message on an old version (AC1 shape)", () => {
  const res = checkNodeVersion({ version: "18.19.1" });
  assert.equal(res.ok, false);
  assert.equal(res.version, "18.19.1");
  assert.equal(res.floor, "22.6");
  // Names the required floor ("22.6" or ">= 22.6")...
  assert.match(res.message, /22\.6/);
  // ...and carries an upgrade hint (matches the Contract measure regex).
  assert.match(res.message, /Node.*22\.|>=22/);
  assert.match(res.message, /Upgrade Node/);
});

test("checkNodeVersion passes for every version >= the 22.6 floor and reads process.versions.node by default", () => {
  for (const v of ["22.6.0", "22.6.1", "23.0.0", "24.0.0", "26.5.0"]) {
    assert.equal(checkNodeVersion({ version: v }).ok, true, `should pass ${v}`);
  }
  // Default reads the real running Node (which, in this repo's test env, is >= 22.6).
  const real = checkNodeVersion();
  assert.equal(real.ok, true, `running Node ${real.version} must meet the 22.6 floor`);
  assert.equal(real.version, process.versions.node);
  assert.equal(real.message, "");
});

test("checkNodeVersion honors the QUAY_NODE_VERSION_OVERRIDE env hook", () => {
  const old = process.env.QUAY_NODE_VERSION_OVERRIDE;
  try {
    process.env.QUAY_NODE_VERSION_OVERRIDE = "18.20.4";
    assert.equal(checkNodeVersion().ok, false);
    process.env.QUAY_NODE_VERSION_OVERRIDE = "22.6.0";
    assert.equal(checkNodeVersion().ok, true);
  } finally {
    if (old === undefined) delete process.env.QUAY_NODE_VERSION_OVERRIDE;
    else process.env.QUAY_NODE_VERSION_OVERRIDE = old;
  }
});

test("wrapper subprocess: old-node override exits 1 with a clear error (not a bare bad-option) — AC1", () => {
  const r = spawnSync(process.execPath, [WRAPPER, "--version"], {
    encoding: "utf8",
    env: { ...process.env, QUAY_NODE_VERSION_OVERRIDE: "18.19.1" },
  });
  assert.equal(r.status, 1, `exit 1 on old node, got ${r.status}`);
  assert.match(r.stderr, /requires Node >= 22\.6/);
  assert.match(r.stderr, /18\.19\.1/);
  assert.match(r.stderr, /Upgrade Node/);
  // The bare bad-option text must NOT be the output.
  assert.ok(!r.stderr.includes("bad option"), "no bare node bad-option on old node");
});

test("wrapper subprocess: current node (>= 22.6) is an unblocked pass-through — AC2", () => {
  const r = spawnSync(process.execPath, [WRAPPER, "--version"], {
    encoding: "utf8",
    // Explicitly clear any override so the real (>= 22.6) version is judged.
    env: { ...process.env, QUAY_NODE_VERSION_OVERRIDE: "" },
  });
  assert.equal(r.status, 0, `wrapper --version passes through, got status ${r.status}`);
  assert.equal(r.stderr, "");
  // SPEC §4.3 option ii (ruling 2, 2026-09-15): develop carries the prerelease suffix
  // (X.Y.Z-dev), release branches drop it. Both are valid semver, so the pass-through
  // assertion accepts the prerelease form — a bare-X.Y.Z expectation goes red on every
  // develop build the moment the version bumps (AC-272 / gap-develop-version-union-missing-dev-suffix).
  assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/); // e.g. 0.4.0 or 0.7.0-dev
});

test("probe standalone: exit 1 on old-node override, exit 0 on real current version", () => {
  const old = spawnSync(process.execPath, [PROBE], {
    encoding: "utf8",
    env: { ...process.env, QUAY_NODE_VERSION_OVERRIDE: "18.20.4" },
  });
  assert.equal(old.status, 1);
  assert.match(old.stderr, /requires Node >= 22\.6/);

  const ok = spawnSync(process.execPath, [PROBE], {
    encoding: "utf8",
    env: { ...process.env, QUAY_NODE_VERSION_OVERRIDE: "" },
  });
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /meets quay's source-execution floor/);
});
