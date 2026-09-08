// @test-group engine
// runner-concurrency.test.mjs — the DIRECT-path concurrency decision logic extracted from
// scripts/test.sh to plugin/scripts/runner-concurrency.ts (gap-execution-loop-p4-suite-entry-ts-ization,
// SPEC-execution-loop-productization P4 套件入口收进 TS). These are the pure functions the bash
// default_concurrency_formula / default_test_concurrency / serial_lowconc_host_default /
// has_explicit_concurrency / bucket_test_concurrency / all_flags now thin-forward to, plus the
// main_root derivation (deriveMainRoot). Every function is driven with the SAME deterministic seams the
// bash functions read (RESOURCE_GATE_NPROC / RESOURCE_GATE_CONCURRENT_SUITES /
// RESOURCE_GATE_OVERSUBSCRIPTION / QUAY_PHASE_OVERLAP), so a seam regression here is a direct-path
// regression (the full suite's resource-gate.test.mjs 判据4 cross-checks these against the runner twins).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import {
  concurrentSuiteSlots,
  hostParallelism,
  defaultTestConcurrency,
  defaultPhaseConcurrencyDirect,
  defaultLowconcConcurrency,
  hasExplicitConcurrency,
  allFlags,
  bucketTestConcurrency,
  deriveMainRoot,
} from "../scripts/runner-concurrency.ts";

/** Run a function with env seams set (save/restore; unset-on-absent) — the same convention
 *  resource-gate.test.mjs uses. */
const CONCURRENCY_ENV = [
  "RESOURCE_GATE_NPROC",
  "RESOURCE_GATE_CONCURRENT_SUITES",
  "RESOURCE_GATE_OVERSUBSCRIPTION",
  "QUAY_MAX_OVERSUBSCRIPTION",
  "QUAY_MAX_CONCURRENT_SUITES",
  "QUAY_PHASE_OVERLAP",
  // gap-process-budget-in-use-structurally-zero-never-throttles: the MAIN derivation is now
  // BUDGET-AWARE (subtracts in_use = testProcessesInUse()). in_use is hermetic-pinned to 0 unless a
  // test drives RESOURCE_GATE_TEST_NODE_PROCS explicitly — otherwise defaultTestConcurrency would
  // shell out to the live host and read a nondeterministic in_use (incl. this test's own node --test
  // workers).
  "RESOURCE_GATE_TEST_NODE_PROCS",
];
function withSeams(seams, fn) {
  const saved = {};
  const touched = [];
  const effective = { RESOURCE_GATE_TEST_NODE_PROCS: "0", ...seams };
  for (const k of Object.keys(effective)) {
    saved[k] = process.env[k];
    process.env[k] = effective[k];
    touched.push(k);
  }
  // Hermetic: any concurrency-knob env NOT explicitly provided is cleared for the call (restored
  // after), so an ambient value — e.g. a caller exporting QUAY_MAX_OVERSUBSCRIPTION — can never
  // perturb a fixture asserting the oversub=1 baseline (2026-09-02: an ov15 run red
  // runner-concurrency + resource-gate self-tests because the exported oversub leaked into fixtures
  // expecting 16×1/2=8). Same hermetic-input discipline as the outer-cron-registry host guard.
  for (const k of CONCURRENCY_ENV) {
    if (!(k in effective)) {
      saved[k] = process.env[k];
      delete process.env[k];
      touched.push(k);
    }
  }
  try {
    return fn();
  } finally {
    for (const k of touched) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

// ── hasExplicitConcurrency / allFlags (the arg-classification predicates) ───────────────────────────

test("hasExplicitConcurrency — detects the `=` spelling and the bare space-form marker, not unrelated args", () => {
  assert.equal(hasExplicitConcurrency(["--test-concurrency=4"]), true, "`=` spelling");
  assert.equal(hasExplicitConcurrency(["--test-concurrency"]), true, "bare space-form marker");
  assert.equal(hasExplicitConcurrency(["--test-concurrency", "4"]), true, "space form with value");
  assert.equal(hasExplicitConcurrency(["--experimental-test-coverage"]), false, "unrelated flag");
  assert.equal(hasExplicitConcurrency([]), false, "empty");
  assert.equal(hasExplicitConcurrency(["a.test.mjs", "--test-concurrency=2"]), true, "flag after a file");
});

test("allFlags — true iff every arg starts with '-' (empty is vacuously true, matching the bash predicate)", () => {
  assert.equal(allFlags(["--a", "--b"]), true);
  assert.equal(allFlags(["--test-concurrency=4"]), true);
  assert.equal(allFlags([]), true);
  assert.equal(allFlags(["--a", "file.mjs"]), false);
  assert.equal(allFlags(["file.mjs"]), false);
});

// ── defaultTestConcurrency (the MAIN direct-path formula: max(1, floor(nproc × oversub / S))) ────────

test("defaultTestConcurrency — pure computation max(1, floor(nproc × oversub / S)) under seams", () => {
  const c = (nproc, slots, oversub) =>
    withSeams(
      { RESOURCE_GATE_NPROC: String(nproc), RESOURCE_GATE_CONCURRENT_SUITES: String(slots), RESOURCE_GATE_OVERSUBSCRIPTION: String(oversub) },
      () => defaultTestConcurrency(),
    );
  assert.equal(c(4, 1, 1), 4, "4 cores / 1 slot → nproc");
  assert.equal(c(16, 2, 1), 8, "16 cores / 2 slots → 8");
  assert.equal(c(1, 2, 1), 1, "floor(1×1/2) clamps at 1");
  assert.equal(c(16, 2, 2), 16, "oversub=2 → 16");
  assert.equal(c(16, 2, 0.5), 4, "fractional oversub reads through");
});

test("defaultTestConcurrency — oversub empty-string-as-unset falls to the knob, invalid oversub falls to 1 (bash `:-` + awk validation parity)", () => {
  // RESOURCE_GATE_OVERSUBSCRIPTION="" (empty) → QUAY_MAX_OVERSUBSCRIPTION=2 wins (bash `:-` semantics).
  assert.equal(
    withSeams(
      { RESOURCE_GATE_NPROC: "16", RESOURCE_GATE_CONCURRENT_SUITES: "2", RESOURCE_GATE_OVERSUBSCRIPTION: "", QUAY_MAX_OVERSUBSCRIPTION: "2" },
      () => defaultTestConcurrency(),
    ),
    16,
    "empty oversub seam → knob 2 → 16×2/2=16",
  );
  // A non-numeric / non-positive oversub (bash awk rejects it) falls to 1.
  assert.equal(
    withSeams(
      { RESOURCE_GATE_NPROC: "16", RESOURCE_GATE_CONCURRENT_SUITES: "2", RESOURCE_GATE_OVERSUBSCRIPTION: "1e3" },
      () => defaultTestConcurrency(),
    ),
    8,
    "invalid oversub '1e3' → 1 → 16×1/2=8",
  );
});

// ── defaultPhaseConcurrencyDirect (the SERIAL direct-path formula: max(1, floor(nproc/(S×P)))) ─

test("defaultPhaseConcurrencyDirect — max(1, floor(nproc/(S×P))), P=2 overlap ON / 1 overlap OFF", () => {
  const c = (nproc, slots, overlap) =>
    withSeams(
      { RESOURCE_GATE_NPROC: String(nproc), RESOURCE_GATE_CONCURRENT_SUITES: String(slots), QUAY_PHASE_OVERLAP: overlap },
      () => defaultPhaseConcurrencyDirect(),
    );
  assert.equal(c(16, 2, "1"), 4, "16 cores / 2 slots / overlap ON → floor(16/(2×2))=4");
  assert.equal(c(4, 2, "1"), 1, "4 cores / 2 slots / overlap ON → 1");
  assert.equal(c(4, 1, "1"), 2, "1 slot / overlap ON → floor(4/(1×2))=2");
  assert.equal(c(16, 2, "0"), 8, "overlap OFF → floor(16/2)=8 (pre-overlap H÷S budget)");
  assert.equal(c(4, 1, "0"), 4, "1 slot / overlap OFF → nproc");
});

// ── defaultLowconcConcurrency (the LOWCONC direct-path default: HOST-DERIVED, = serial) ─

test("defaultLowconcConcurrency — HOST-DERIVED max(1, floor(nproc/(S×P))), IDENTICAL to serial (gap-lowconc-concurrency-restore-host-derived)", () => {
  // NOT a fixed 3: lowconc returns serial's host-derived default (the lowconc=3 fixed-value split was
  // wrong — 用户 2026-09-02 反转「并发取 3 不取 8」).
  assert.equal(defaultLowconcConcurrency(), defaultPhaseConcurrencyDirect(), "lowconc default == serial host-derived default (no seams)");
  assert.equal(
    withSeams({ RESOURCE_GATE_NPROC: "16", RESOURCE_GATE_CONCURRENT_SUITES: "2", QUAY_PHASE_OVERLAP: "1" }, () => defaultLowconcConcurrency()),
    4,
    "16 cores / 2 slots / overlap ON → floor(16/(2×2))=4",
  );
  assert.equal(
    withSeams({ RESOURCE_GATE_NPROC: "4", RESOURCE_GATE_CONCURRENT_SUITES: "1", QUAY_PHASE_OVERLAP: "0" }, () => defaultLowconcConcurrency()),
    4,
    "4 cores / 1 slot / overlap OFF → floor(4/1)=4",
  );
});

// ── bucketTestConcurrency (the --buckets effective concurrency: explicit wins, else derived default) ─

test("bucketTestConcurrency — explicit --test-concurrency=N (both spellings) wins; otherwise the derived default", () => {
  const c = (args) => withSeams({ RESOURCE_GATE_NPROC: "16", RESOURCE_GATE_CONCURRENT_SUITES: "2" }, () => bucketTestConcurrency(args));
  assert.equal(c(["--test-concurrency=4"]), 4, "`=` spelling wins");
  assert.equal(c(["--test-concurrency", "3"]), 3, "space spelling wins");
  assert.equal(c(["--test-concurrency=abc"]), 8, "invalid `=` value → derived default (16/2)");
  assert.equal(c(["--test-concurrency", "0"]), 8, "non-positive space value → derived default");
  assert.equal(c([]), 8, "no flag → derived default (16/2)");
});

// ── deriveMainRoot (the main_root derivation: QUAY_MAIN_CHECKOUT → git first worktree → repoRoot) ────

test("deriveMainRoot — env override wins and non-git cwd fails open to repoRoot (never aborts the suite)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rc-root-"));
  // The full suite sets QUAY_MAIN_CHECKOUT in the ambient env (full-suite-runner.ts suiteEnv), which
  // would leak into the "no env" assertion below and turn it into "env is the main checkout" — a false
  // red. Unset it explicitly so "no env" truly means QUAY_MAIN_CHECKOUT absent (withSeams can't express
  // "unset": it would write the string "undefined"). Save/restore so an ambient value (if any) survives.
  const savedMain = process.env.QUAY_MAIN_CHECKOUT;
  delete process.env.QUAY_MAIN_CHECKOUT;
  try {
    assert.equal(
      withSeams({ QUAY_MAIN_CHECKOUT: "/override/root" }, () => deriveMainRoot(tmp)),
      "/override/root",
      "QUAY_MAIN_CHECKOUT wins when git is unavailable",
    );
    assert.equal(deriveMainRoot(tmp), tmp, "no env + non-git cwd → repoRoot passthrough");
  } finally {
    if (savedMain === undefined) delete process.env.QUAY_MAIN_CHECKOUT;
    else process.env.QUAY_MAIN_CHECKOUT = savedMain;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("deriveMainRoot — the git-derived FIRST worktree is ALWAYS preferred over repoRoot AND over QUAY_MAIN_CHECKOUT", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "rc-git-"));
  const wt = path.join(os.tmpdir(), `rc-wt-${process.pid}-${Date.now()}`);
  execSync("git init -b main", { cwd: repo, stdio: "ignore" });
  execSync("git config user.email t@example.com", { cwd: repo, stdio: "ignore" });
  execSync("git config user.name t", { cwd: repo, stdio: "ignore" });
  fs.writeFileSync(path.join(repo, "a.txt"), "hi\n");
  execSync("git add a.txt && git commit -m init", { cwd: repo, stdio: "ignore" });
  execSync(`git worktree add ${wt}`, { cwd: repo, stdio: "ignore" });
  try {
    // QUAY_MAIN_CHECKOUT pointing at the WORKTREE (the full-suite-runner --root shape) must still be
    // overridden by the git primary checkout (whose slug has the session transcripts).
    assert.equal(
      withSeams({ QUAY_MAIN_CHECKOUT: wt }, () => deriveMainRoot(wt)),
      repo,
      "git primary checkout overrides a worktree QUAY_MAIN_CHECKOUT",
    );
  } finally {
    execSync(`git worktree remove --force ${wt}`, { cwd: repo, stdio: "ignore" });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// ── S single source (gap-suite-concurrency-S-two-source-divergence) — direct path reads the file too ─

test("S single source — defaultTestConcurrency / defaultPhaseConcurrencyDirect read the `.concurrency` FILE (env knob stale ⇒ file wins)", () => {
  const pinTmp = fs.mkdtempSync(path.join(os.tmpdir(), "rc-s2-"));
  const pinBase = path.join(pinTmp, "full-suite.lock");
  fs.writeFileSync(`${pinBase}.concurrency`, "2", "utf8");
  const savedLock = process.env.FULL_SUITE_LOCK_FILE;
  const savedSeam = process.env.RESOURCE_GATE_CONCURRENT_SUITES;
  const savedKnob = process.env.QUAY_MAX_CONCURRENT_SUITES;
  process.env.FULL_SUITE_LOCK_FILE = pinBase;
  delete process.env.RESOURCE_GATE_CONCURRENT_SUITES;
  process.env.QUAY_MAX_CONCURRENT_SUITES = "1"; // STALE env — the file (2) must win
  try {
    assert.equal(concurrentSuiteSlots(), 2, "TS canonical reads S=2 from the file");
    assert.equal(
      withSeams({ RESOURCE_GATE_NPROC: "16" }, () => defaultTestConcurrency()),
      8,
      "main formula halves: 16×1/2=8 (env knob=1 stale would give 16)",
    );
    assert.equal(
      withSeams({ RESOURCE_GATE_NPROC: "16" }, () => defaultPhaseConcurrencyDirect()),
      4,
      "phase formula: floor(16/(2×2))=4 (env knob=1 stale would give 8)",
    );
  } finally {
    if (savedLock === undefined) delete process.env.FULL_SUITE_LOCK_FILE;
    else process.env.FULL_SUITE_LOCK_FILE = savedLock;
    if (savedSeam === undefined) delete process.env.RESOURCE_GATE_CONCURRENT_SUITES;
    else process.env.RESOURCE_GATE_CONCURRENT_SUITES = savedSeam;
    if (savedKnob === undefined) delete process.env.QUAY_MAX_CONCURRENT_SUITES;
    else process.env.QUAY_MAX_CONCURRENT_SUITES = savedKnob;
    fs.rmSync(pinTmp, { recursive: true, force: true });
  }
});
