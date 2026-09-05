// @test-group engine
// quay-init-closure-ratchet.test.mjs — gap-quay-init-closure-assertion-first (SPEC AC168 判据先行).
//
// Pins the shrink-only ratchet's judgment + the SPEC AC4 counter-example criterion (读生产载体, not a
// fixture), via the PURE judgment function (baseline ±1 both directions) + the runLaydown NOT-EVALUATED
// path (real laydown cannot run ⇒ evaluated:false, never conflated with "≤ baseline").
//
//   基线降 1 必须红  — checkClosureRatchet({files:N, …}, {files:N-1, …}).ok === false  (it really counts
//                      production artifacts: the SAME count vs a lowered allowance is a violation).
//   基线升 1 必须绿  — checkClosureRatchet({files:N, …}, {files:N+1, …}).ok === true   (shrink-only: growing
//                      the allowance is legal, only growth of the laydown itself is blocked).
//   NOT-EVALUATED     — runLaydown(root-without-quay-init.sh).evaluated === false, and the CLI exits 3.
//
// Run:
//   scripts/test.sh plugin/test/quay-init-closure-ratchet.test.mjs
//   node --test plugin/test/quay-init-closure-ratchet.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

import { checkClosureRatchet, countTree, runLaydown } from "../scripts/quay-init-closure-ratchet.ts";

function makeTmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), `qicr-${prefix}-`)); }
function cleanup(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } }

// ── the ±1 both-directions judgment (DoD 负控制, AC2 "只许降不许升") ──────────────────────────────

test("ratchet ok when the laydown is exactly at baseline (files and bytes)", () => {
  const actual = { files: 136, bytes: 6886001 };
  const baseline = { files: 136, bytes: 6886001 };
  const v = checkClosureRatchet(actual, baseline);
  assert.equal(v.ok, true, `actual == baseline must be ok, got ${JSON.stringify(v)}`);
  assert.equal(v.overFiles, false);
  assert.equal(v.overBytes, false);
});

test("基线降 1 必须红 — a lowered FILE baseline reddens the SAME count (it really counts production artifacts)", () => {
  const actual = { files: 136, bytes: 6886001 };
  const baseline = { files: 135, bytes: 6886001 }; // baseline -1
  const v = checkClosureRatchet(actual, baseline);
  assert.equal(v.ok, false, "lowering the file baseline by 1 must go RED (136 > 135)");
  assert.equal(v.overFiles, true);
});

test("落地量涨 1 必须红 — one more laid-down FILE goes RED (the shrink-only direction)", () => {
  const actual = { files: 137, bytes: 6886001 };
  const baseline = { files: 136, bytes: 6886001 };
  const v = checkClosureRatchet(actual, baseline);
  assert.equal(v.ok, false, "a grown laydown (137 vs 136) must go RED");
  assert.equal(v.overFiles, true);
});

test("byte growth alone goes RED (bytes are ratcheted too, not just the file count)", () => {
  const actual = { files: 136, bytes: 6887000 };
  const baseline = { files: 136, bytes: 6886001 };
  const v = checkClosureRatchet(actual, baseline);
  assert.equal(v.ok, false, "growing bytes past baseline must go RED");
  assert.equal(v.overBytes, true);
  assert.equal(v.overFiles, false);
});

test("基线升 1 必须绿 — raising the allowance by one is legal (shrink-only: only growth of the laydown is blocked)", () => {
  const actual = { files: 136, bytes: 6886001 };
  const baseline = { files: 137, bytes: 6886001 }; // baseline +1
  const v = checkClosureRatchet(actual, baseline);
  assert.equal(v.ok, true, "raising the baseline by 1 must stay GREEN (136 ≤ 137)");
});

test("shrink is always ok — a laydown BELOW baseline on both axes is green", () => {
  const actual = { files: 100, bytes: 1000 };
  const baseline = { files: 136, bytes: 6886001 };
  const v = checkClosureRatchet(actual, baseline);
  assert.equal(v.ok, true, "a shrunken laydown must be ok (只许降)");
});

// ── NOT-EVALUATED (hard rule 3b): 读不懂输入 ≠ 合格 ───────────────────────────────────────────────

test("hard rule 3b — runLaydown with NO quay-init.sh ⇒ evaluated:false (NOT-EVALUATED, never a green count)", () => {
  const root = makeTmp("no-init");
  try {
    const r = runLaydown(root);
    assert.equal(r.evaluated, false, "a root without plugin/scripts/quay-init.sh must be NOT-EVALUATED");
    assert.equal(r.files, 0);
    assert.equal(r.bytes, 0);
  } finally { cleanup(root); }
});

test("hard rule 3b — the CLI exits 3 (NOT-EVALUATED third state) when the laydown cannot run", () => {
  const root = makeTmp("no-init-cli");
  try {
    const checker = path.join(REPO_ROOT, "plugin", "scripts", "quay-init-closure-ratchet.ts");
    const res = spawnSync("node", ["--no-warnings", "--experimental-strip-types", checker, "--gate", "--root", root], { encoding: "utf8" });
    assert.equal(res.status, 3, `NOT-EVALUATED must exit 3, got ${res.status}: ${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /NOT-EVALUATED/, "the NOT-EVALUATED third state must be distinguishable in the output");
  } finally { cleanup(root); }
});

// ── countTree ──────────────────────────────────────────────────────────────────────────────────────

test("countTree counts regular files and byte sizes recursively", () => {
  const root = makeTmp("count");
  try {
    fs.mkdirSync(path.join(root, "a", "b"), { recursive: true });
    fs.writeFileSync(path.join(root, "a", "b", "f1"), "0123456789"); // 10 bytes
    fs.writeFileSync(path.join(root, "a", "f2"), "01234"); // 5 bytes
    const c = countTree(root);
    assert.equal(c.files, 2);
    assert.equal(c.bytes, 15);
  } finally { cleanup(root); }
});
