// @test-group engine
// Unit tests for chart2-s1-distribution-reliability.ts — the chart-2 Surface S1
// (Distribution reliability) value ruler (DIR-064 / DIR-064-A). Mirrors the
// it0-split-or-commit-check.test.mjs style: node:test + node:assert/strict, imports the
// pure functions, unit tests + a CLI subprocess test. RED-first discipline — the fix for
// any failing case belongs in the MODULE, never in the fixtures.
// Run:
//   node --test experiments/quay-perpetual-stream/test/chart2-s1-distribution-reliability.test.mjs
//   node --test --experimental-test-coverage experiments/quay-perpetual-stream/test/chart2-s1-distribution-reliability.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { computeS1Cov, loadArtifacts, selftest, DEFAULT_ARTIFACTS_JSON, } = await import("../scripts/chart2-s1-distribution-reliability.ts");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, "..", "scripts", "chart2-s1-distribution-reliability.ts");
const REAL_JSON = path.join(__dirname, "..", "chart2-s1-artifacts.json");

function tmpJson(obj) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chart2-s1-test-"));
  const p = path.join(dir, "artifacts.json");
  fs.writeFileSync(p, typeof obj === "string" ? obj : JSON.stringify(obj));
  return { dir, p };
}

// ── computeS1Cov ─────────────────────────────────────────────────────────────────────────────────
test("computeS1Cov: all-pass → cov 1.0", () => {
  const r = computeS1Cov([
    { name: "a", floorSmokePass: true },
    { name: "b", floorSmokePass: true },
  ]);
  assert.deepEqual(r, { cov: 1.0, passed: 2, total: 2 });
});

test("computeS1Cov: all-fail → cov 0.0", () => {
  const r = computeS1Cov([
    { name: "a", floorSmokePass: false },
    { name: "b", floorSmokePass: false },
  ]);
  assert.deepEqual(r, { cov: 0.0, passed: 0, total: 2 });
});

test("computeS1Cov: mixed 1/5 (seeded v0.3.8 shape) → cov 0.2", () => {
  const r = computeS1Cov([
    { name: "npm-pack", floorSmokePass: true },
    { name: "sea-linux-x64", floorSmokePass: false },
    { name: "sea-macos-arm64", floorSmokePass: false },
    { name: "sea-windows-x64", floorSmokePass: false },
    { name: "plugin-bundle", floorSmokePass: false },
  ]);
  assert.equal(r.cov, 0.2);
  assert.equal(r.passed, 1);
  assert.equal(r.total, 5);
});

test("computeS1Cov: Δv — flipping the 3 SEA rows to pass moves cov 0.2 → 0.8", () => {
  const after = computeS1Cov([
    { name: "npm-pack", floorSmokePass: true },
    { name: "sea-linux-x64", floorSmokePass: true },
    { name: "sea-macos-arm64", floorSmokePass: true },
    { name: "sea-windows-x64", floorSmokePass: true },
    { name: "plugin-bundle", floorSmokePass: false },
  ]);
  assert.equal(after.cov, 0.8);
});

test("computeS1Cov: empty list → throws (fail-closed, no silent 0/0)", () => {
  assert.throws(() => computeS1Cov([]), /empty artifact list/);
});

test("computeS1Cov: non-array input → throws", () => {
  assert.throws(() => computeS1Cov(null), /empty artifact list/);
});

test("computeS1Cov: only strict `true` counts as a pass (truthy-not-true is a fail)", () => {
  const r = computeS1Cov([
    { name: "a", floorSmokePass: 1 },
    { name: "b", floorSmokePass: "yes" },
    { name: "c", floorSmokePass: true },
  ]);
  assert.equal(r.passed, 1);
  assert.equal(r.total, 3);
});

// ── loadArtifacts ────────────────────────────────────────────────────────────────────────────────
test("loadArtifacts: ignores '//' and non-array keys, returns the artifacts array", () => {
  const { dir, p } = tmpJson({
    "//": "comment",
    release: "vX",
    artifacts: [
      { name: "one", floorSmokePass: true },
      { name: "two", floorSmokePass: false },
    ],
  });
  const arr = loadArtifacts(p);
  assert.equal(arr.length, 2);
  assert.deepEqual(arr[0], { name: "one", floorSmokePass: true });
  assert.deepEqual(arr[1], { name: "two", floorSmokePass: false });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("loadArtifacts: coerces non-true floorSmokePass to false", () => {
  const { dir, p } = tmpJson({ artifacts: [{ name: "x" }] });
  const arr = loadArtifacts(p);
  assert.equal(arr[0].floorSmokePass, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("loadArtifacts: missing file → throws", () => {
  assert.throws(() => loadArtifacts(path.join(os.tmpdir(), "nope-" + Date.now() + ".json")), /not found/);
});

test("loadArtifacts: invalid JSON → throws", () => {
  const { dir, p } = tmpJson("{ not valid json ");
  assert.throws(() => loadArtifacts(p), /invalid JSON/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("loadArtifacts: JSON array (not object) → throws", () => {
  const { dir, p } = tmpJson([{ name: "x", floorSmokePass: true }]);
  assert.throws(() => loadArtifacts(p), /expected a JSON object/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("loadArtifacts: object without an artifacts array → throws", () => {
  const { dir, p } = tmpJson({ release: "vX" });
  assert.throws(() => loadArtifacts(p), /no "artifacts" array/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── integration: the real seeded evidence file → cov 0.8 (M122: sea-macos/windows flipped) ─────
test("real chart2-s1-artifacts.json → cov 0.8 (npm-pack + all 3 SEA platforms green, plugin untested)", () => {
  const r = computeS1Cov(loadArtifacts(REAL_JSON));
  assert.equal(r.cov, 0.8);
  assert.equal(r.passed, 4);
  assert.equal(r.total, 5);
});

test("DEFAULT_ARTIFACTS_JSON resolves to the real seeded file", () => {
  assert.ok(fs.existsSync(DEFAULT_ARTIFACTS_JSON));
  assert.equal(path.basename(DEFAULT_ARTIFACTS_JSON), "chart2-s1-artifacts.json");
});

// ── selftest() — the module's own embedded RED+GREEN fixture suite ─────────────────────────────────
test("selftest(): all embedded RED+GREEN fixture cases pass", () => {
  assert.equal(selftest(), true);
});

// ── CLI (isDirect block) — real subprocess invocation ───────────────────────────────────────────
function spawnCli(args) {
  try {
    const stdout = execFileSync("node", [SCRIPT, ...args], { encoding: "utf8" });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? String(err) };
  }
}

test("CLI: --selftest → exit 0", () => {
  const r = spawnCli(["--selftest"]);
  assert.equal(r.status, 0, r.stderr);
});

test("CLI: default (no path) runs against the real seeded json → cov 0.8, exit 0", () => {
  const r = spawnCli([]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /S1 Distribution-reliability cov = 0\.8 \(4\/5 artifacts pass floor-smoke\)/);
});

test("CLI: explicit path to the real seeded json → cov 0.8, exit 0", () => {
  const r = spawnCli([REAL_JSON]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /cov = 0\.8 \(4\/5/);
});

test("CLI: missing evidence file → exit 2", () => {
  const r = spawnCli([path.join(os.tmpdir(), "nope-" + Date.now() + ".json")]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /ERROR/);
});

