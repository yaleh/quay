// @test-group engine
// tmp-leak-pairing-check.test.mjs — RED/GREEN tests for the tmp-leak pairing gate
// (plugin/scripts/tmp-leak-pairing-check.ts, the mkdtemp-without-cleanup blocker).
//
// The 2026-08-12 /tmp audit measured 3389 leftover dirs / 1.1GB across five prefixes. The gate is
// the "修完不复发" mechanical guarantee: once a leaking file is fixed, an unpaired mkdtemp can never
// be re-introduced without the static phase going RED. Unlike test-isolation-check's R6 rule (which
// reports the same class but is baselined — 报出而不阻断), this gate BLOCKS on anything unpaired.
//
// Covered here:
//   - pairing heuristics (delegated to test-isolation-check's detectMkdtempNoCleanup):
//       RED  — an unpaired mkdtemp reports.
//       GREEN — rmSync in a finally; carrier-array + after(); helper-return captured-and-cleaned.
//   - CLI over the REAL corpus: 0 unpaired mkdtemps (PASS) — the leak-fix landing.
//   - negative control: a deliberately-leaky fixture makes the CLI exit 1 (the gate can fail).
//   - selftest: --selftest exits 0 (RED and GREEN both asserted).
//
// Run:
//   scripts/test.sh plugin/test/tmp-leak-pairing-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { detectMkdtempNoCleanup } from "../scripts/test-isolation-check.ts";
import { scanUnpairedMkdtemps } from "../scripts/tmp-leak-pairing-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECK_SH = path.join(REPO_ROOT, "plugin", "scripts", "tmp-leak-pairing-check.sh");

// ── pairing heuristic: RED ────────────────────────────────────────────────────────────────────────
test("RED: an unpaired mkdtemp result reports", () => {
  const leaky =
    'import { test } from "node:test";\n' +
    'const dir = fs.mkdtempSync(path.join(os.tmpdir(), "leaky-"));\n' +
    'fs.writeFileSync(path.join(dir, "a.md"), "x");\n';
  assert.ok(
    detectMkdtempNoCleanup(leaky, "leaky.test.mjs").some((v) => v.rule === "mkdtemp-no-cleanup"),
    "a mkdtemp that is never removed must report"
  );
});

// ── pairing heuristic: GREEN ───────────────────────────────────────────────────────────────────────
test("GREEN: rmSync in a finally block pairs the mkdtemp", () => {
  const src =
    'const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ok-finally-"));\n' +
    "try {\n" +
    '  fs.writeFileSync(path.join(dir, "a.md"), "x");\n' +
    "} finally {\n" +
    '  fs.rmSync(dir, { recursive: true, force: true });\n' +
    "}\n";
  assert.equal(detectMkdtempNoCleanup(src, "ok-finally.test.mjs").length, 0);
});

test("GREEN: the carrier-array + after() pattern pairs every mkdtemp", () => {
  const src =
    "const _created = [];\n" +
    "after(() => {\n" +
    "  for (const d of _created) fs.rmSync(d, { recursive: true, force: true });\n" +
    "});\n" +
    "function tmpDir() {\n" +
    '  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "carrier-"));\n' +
    "  _created.push(dir);\n" +
    "  return dir;\n" +
    "}\n";
  assert.equal(detectMkdtempNoCleanup(src, "carrier.test.mjs").length, 0,
    "a dir pushed into a carrier array that an after() hook rmSync's is not a leak");
});

test("GREEN: a helper return captured-and-cleaned at call sites is not a leak", () => {
  const src =
    "function makeTmp(tag) { return fs.mkdtempSync(path.join(os.tmpdir(), tag)); }\n" +
    'test("x", () => {\n' +
    '  const dir = makeTmp("caller-");\n' +
    "  try {\n" +
    '    fs.writeFileSync(path.join(dir, "a"), "x");\n' +
    "  } finally {\n" +
    '    fs.rmSync(dir, { recursive: true, force: true });\n' +
    "  }\n" +
    "});\n";
  assert.equal(detectMkdtempNoCleanup(src, "caller.test.mjs").length, 0,
    "a helper whose returned dir every call site cleans is not a leak");
});

// ── real corpus: the leak fix landed (PASS) ───────────────────────────────────────────────────────
test("CLI: the real test corpus has ZERO unpaired mkdtemps (the 2026-08-12 leak fix)", () => {
  const r = spawnSync("bash", [CHECK_SH, REPO_ROOT], { encoding: "utf8" });
  assert.equal(r.status, 0, `tmp-leak-pairing-check must PASS on the fixed corpus:\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /0 unpaired mkdtemp result/);
});

// ── negative control: the gate can fail ───────────────────────────────────────────────────────────
test("CLI: a deliberately-leaky fixture FAILS the gate (exit 1) — the gate is not always-green", () => {
  // The leaky fixture lives in a scratch dir under os.tmpdir(), NOT in REPO_ROOT/plugin/test/.
  // Writing it into the real repo races test-framework-policy-check.test.mjs's whole-repo scan
  // (same @test-group engine ⇒ concurrent): the zz-* fixture is listed by the canonical glob, then
  // deleted before readFileSafe reaches it ⇒ ENOENT ⇒ "" ⇒ spurious AC3/AC5 RED
  // (gap-test-isolation-race-tmp-leak-negative-fixture-writes-repo).
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "tlp-negative-"));
  try {
    // root probe only needs scripts/test.sh to exist (main() rejects a non-workspace root).
    fs.mkdirSync(path.join(scratch, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(scratch, "scripts", "test.sh"), "");
    const rel = "plugin/test/zz-tmp-leak-negative.test.mjs";
    fs.mkdirSync(path.join(scratch, "plugin", "test"), { recursive: true });
    fs.writeFileSync(
      path.join(scratch, rel),
      "// @test-group product\n" +
        'import { test } from "node:test";\n' +
        'import fs from "node:fs";\nimport os from "node:os";\nimport path from "node:path";\n' +
        'test("leaky", () => {\n' +
        '  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zz-gate-leaky-"));\n' +
        '  fs.writeFileSync(path.join(dir, "a.md"), "x");\n' +
        "});\n"
    );
    const r = spawnSync("bash", [CHECK_SH, scratch, "--files", rel], { encoding: "utf8" });
    assert.equal(r.status, 1, `a leaky fixture must FAIL the gate:\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /FAIL — every mkdtemp result must be paired with a cleanup/);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

// ── selftest ───────────────────────────────────────────────────────────────────────────────────────
test("CLI: --selftest exits 0 (RED and GREEN both asserted)", () => {
  const r = spawnSync("bash", [CHECK_SH, "--selftest"], { encoding: "utf8" });
  assert.equal(r.status, 0, `--selftest must exit 0:\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /0 failed/);
});

// ── scanUnpairedMkdtemps over the real corpus matches the CLI ────────────────────────────────────
test("scanUnpairedMkdtemps: real corpus returns no violations", async () => {
  const { canonicalTestFiles } = await import("../scripts/test-framework-policy-check.ts");
  const files = canonicalTestFiles(REPO_ROOT);
  assert.ok(files.length > 300, `corpus must be large enough to be meaningful, got ${files.length}`);
  const violations = scanUnpairedMkdtemps(REPO_ROOT, files);
  assert.deepEqual(violations, []);
});
