// @test-group engine
// Unit + CLI tests for chart2-s2-delivery-completeness.ts — the machine-verifiable cov calculator
// for chart-2 surface S2 (Delivery completeness), per DIR-064 / DIR-064-A. Mirrors the
// it0-split-or-commit-check test style: node:test + node:assert/strict, pure-function unit tests
// against temp fixtures + real CLI subprocess tests. RED-first: fixes belong in the MODULE.
// Run:
//   node --test experiments/quay-perpetual-stream/test/chart2-s2-delivery-completeness.test.mjs
//   node --test --experimental-test-coverage experiments/quay-perpetual-stream/test/chart2-s2-delivery-completeness.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { readVersionFields, versionsConsistent, computeS2Cov, loadS2Evidence, selftest, } = await import("../scripts/chart2-s2-delivery-completeness.ts");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, "..", "scripts", "chart2-s2-delivery-completeness.ts");
const REPO_ROOT = path.resolve(__dirname, "..", "..", ".."); // test → repo root

// Build a temp repo tree with the 5 version-source files. `versions` maps 1:1 onto the 5 sources;
// null → write the file but omit the version field.
function writeFixtureRepo(versions) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chart2-s2-fixt-"));
  const specs = [
    { rel: "packages/quay/package.json", nested: false },
    { rel: ".claude-plugin/marketplace.json", nested: true },
    { rel: "plugin/.claude-plugin/plugin.json", nested: false },
    { rel: "plugin/.claude-plugin/marketplace.json", nested: true },
    { rel: "plugin/vendor/quay/package.json", nested: false },
  ];
  specs.forEach((s, i) => {
    const abs = path.join(root, s.rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const v = versions[i];
    let obj;
    if (s.nested) {
      obj = v === null ? { plugins: [{ name: "x" }] } : { plugins: [{ name: "x", version: v }] };
    } else {
      obj = v === null ? { name: "x" } : { name: "x", version: v };
    }
    fs.writeFileSync(abs, JSON.stringify(obj));
  });
  return root;
}

// ── versionsConsistent ────────────────────────────────────────────────────────────────────────
test("versionsConsistent: all-equal → true", () => {
  const fields = [
    { source: "a", version: "0.4.0" },
    { source: "b", version: "0.4.0" },
    { source: "c", version: "0.4.0" },
  ];
  assert.equal(versionsConsistent(fields), true);
});

test("versionsConsistent: one different → false", () => {
  const fields = [
    { source: "a", version: "0.4.0" },
    { source: "b", version: "0.4.1" },
    { source: "c", version: "0.4.0" },
  ];
  assert.equal(versionsConsistent(fields), false);
});

test("versionsConsistent: a null → false", () => {
  const fields = [
    { source: "a", version: "0.4.0" },
    { source: "b", version: null },
    { source: "c", version: "0.4.0" },
  ];
  assert.equal(versionsConsistent(fields), false);
});

test("versionsConsistent: empty array → false", () => {
  assert.equal(versionsConsistent([]), false);
});

test("versionsConsistent: the real repo's 5-way drift → false", () => {
  const fields = [
    { source: "a", version: "0.3.8" },
    { source: "b", version: "0.3.5" },
    { source: "c", version: "0.3.22" },
    { source: "d", version: "0.3.16" },
    { source: "e", version: "0.3.5" },
  ];
  assert.equal(versionsConsistent(fields), false);
});

// ── computeS2Cov ─────────────────────────────────────────────────────────────────────────────
test("computeS2Cov: 0/3 → cov 0", () => {
  const r = computeS2Cov(false, false, false);
  assert.deepEqual(r, { cov: 0, satisfied: 0, total: 3 });
});

test("computeS2Cov: 3/3 → cov 1", () => {
  const r = computeS2Cov(true, true, true);
  assert.deepEqual(r, { cov: 1, satisfied: 3, total: 3 });
});

test("computeS2Cov: 1/3 → cov 0.333…", () => {
  const r = computeS2Cov(true, false, false);
  assert.equal(r.satisfied, 1);
  assert.equal(r.total, 3);
  assert.ok(Math.abs(r.cov - 1 / 3) < 1e-9);
});

test("computeS2Cov: 2/3 (manifest + install, versions drifted) → cov 0.666…", () => {
  const r = computeS2Cov(false, true, true);
  assert.equal(r.satisfied, 2);
  assert.ok(Math.abs(r.cov - 2 / 3) < 1e-9);
});

// ── readVersionFields (against temp fixture repo trees) ─────────────────────────────────────────
test("readVersionFields: reads all 5 fields (flat .version + nested .plugins[0].version)", () => {
  const root = writeFixtureRepo(["0.4.0", "0.4.1", "0.4.2", "0.4.3", "0.4.4"]);
  const fields = readVersionFields(root);
  assert.equal(fields.length, 5);
  assert.deepEqual(fields.map((f) => f.version), ["0.4.0", "0.4.1", "0.4.2", "0.4.3", "0.4.4"]);
  assert.deepEqual(fields.map((f) => f.source), [
    "packages/quay/package.json",
    ".claude-plugin/marketplace.json",
    "plugin/.claude-plugin/plugin.json",
    "plugin/.claude-plugin/marketplace.json",
    "plugin/vendor/quay/package.json",
  ]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("readVersionFields: aligned fixture → versionsConsistent true", () => {
  const root = writeFixtureRepo(["1.0.0", "1.0.0", "1.0.0", "1.0.0", "1.0.0"]);
  assert.equal(versionsConsistent(readVersionFields(root)), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test("readVersionFields: a missing field (null) reads as version:null", () => {
  const root = writeFixtureRepo(["1.0.0", "1.0.0", null, "1.0.0", "1.0.0"]);
  const fields = readVersionFields(root);
  assert.equal(fields[2].version, null);
  assert.equal(versionsConsistent(fields), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("readVersionFields: a missing file reads as version:null", () => {
  const root = writeFixtureRepo(["1.0.0", "1.0.0", "1.0.0", "1.0.0", "1.0.0"]);
  fs.rmSync(path.join(root, "plugin/vendor/quay/package.json"));
  const fields = readVersionFields(root);
  assert.equal(fields[4].version, null);
  fs.rmSync(root, { recursive: true, force: true });
});

// ── loadS2Evidence ───────────────────────────────────────────────────────────────────────────
test("loadS2Evidence: reads both flags true", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chart2-s2-ev-"));
  const p = path.join(dir, "e.json");
  fs.writeFileSync(p, JSON.stringify({ fullManifestPublished: true, foreignInstallE2eGreen: true }));
  assert.deepEqual(loadS2Evidence(p), { fullManifestPublished: true, foreignInstallE2eGreen: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("loadS2Evidence: missing file → both false (fail-closed)", () => {
  const p = path.join(os.tmpdir(), "chart2-s2-nope-" + Date.now() + ".json");
  assert.deepEqual(loadS2Evidence(p), { fullManifestPublished: false, foreignInstallE2eGreen: false });
});

// AC3 cross-annotation: evidence flags were flipped true by DELIVERY-C (ea3a33a9, manifest-published)
// and DELIVERY-D (1b1c81ab, foreign-install-e2e-green) on 2026-07-24. When a delivery flips an
// evidence flag, this test's expected values MUST be synced in the same change.
test("loadS2Evidence: the checked-in real evidence file → both true (DELIVERY-C/D)", () => {
  const p = path.join(REPO_ROOT, "experiments", "quay-perpetual-stream", "chart2-s2-delivery.json");
  assert.deepEqual(loadS2Evidence(p), { fullManifestPublished: true, foreignInstallE2eGreen: true });
});

// ── selftest() — the module's own embedded RED+GREEN fixture suite ──────────────────────────────
test("selftest(): the module's RED + GREEN fixture cases all behave as designed", () => {
  assert.equal(selftest(), true);
});

// ── CLI (isDirect block) — real subprocess invocation ──────────────────────────────────────────
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

test("CLI: --help → usage, exit 2", () => {
  const r = spawnCli(["--help"]);
  assert.equal(r.status, 2);
});

test("CLI: against THIS repo (default root) → cov 3/3 (versions consistent, manifest + foreign all green), exit 0", () => {
  const r = spawnCli([]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /S2 Delivery-completeness cov = 1 \(3\/3/);
  assert.match(r.stdout, /version-consistent=true/);
  assert.match(r.stdout, /manifest-published=true/);
  assert.match(r.stdout, /foreign-install-green=true/);
});

test("CLI: explicit repoRoot arg → cov 3/3 against the real repo", () => {
  const r = spawnCli([REPO_ROOT]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /S2 Delivery-completeness cov = 1 \(3\/3/);
});

// AC2 negative control (fail-closed): a temp repo whose evidence file has BOTH flags false must
// still compute cov 0.0 — if a delivery ever removes/negates the evidence without the code noticing,
// this assertion catches the regression. Drifted versions + both-false evidence → 0/3.
test("CLI: negative control — temp repo with both-false evidence → cov 0.0 (fail-closed)", () => {
  const root = writeFixtureRepo(["0.3.8", "0.3.5", "0.3.22", "0.3.16", "0.3.5"]); // drifted → version-consistent=false
  const evDir = path.join(root, "experiments", "quay-perpetual-stream");
  fs.mkdirSync(evDir, { recursive: true });
  fs.writeFileSync(
    path.join(evDir, "chart2-s2-delivery.json"),
    JSON.stringify({ fullManifestPublished: false, foreignInstallE2eGreen: false })
  );
  try {
    const r = spawnCli([root]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /S2 Delivery-completeness cov = 0 \(0\/3/);
    assert.match(r.stdout, /version-consistent=false/);
    assert.match(r.stdout, /manifest-published=false/);
    assert.match(r.stdout, /foreign-install-green=false/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

