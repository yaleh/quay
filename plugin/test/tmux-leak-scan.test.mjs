// @test-group engine
// @load-sensitive wall-clock
// @load-sensitive-entry 2026-08-13 wall-clock (reap-wait R2/R3 timing races under full-suite load; round 132 green / 133 red same tree, isolated rerun green — partition as in-family flake, not regression)
// tmux-leak-scan.test.mjs — gap-leak-scan-reap-race-false-red: RED/GREEN tests for the suite-tail
// leak scan's BOUNDED REAP-WAIT. The defect: at suite end `tmux-leak-scan.sh --check` raced with
// teardown reaping of test-spawned tmux servers — under load a still-exiting server (its process
// and /tmp/session-liveness-* socket dir are removed asynchronously after kill-session) was swept
// as "NEW residual" → a false red (round 95: tests=4150 all pass, only the leak gate red; round 96
// light-load control: reaping won 2-10s before the scan → green). Fix: --check HOLD JUDGMENT — when
// NEW matches appear it polls up to $TMUX_LEAK_REAP_WAIT_MS (default 10000) for them to clear; only
// matches STILL PRESENT at the bound are a REAL leak. A genuine leak never clears, so the gate is
// not weakened — it only stops flagging exit-in-progress.
//
// Covers:
//   - R1  clean delta (no NEW matches) → immediate clean, no reap-wait note (zero added latency)
//   - R2  TRANSIENT NEW residue (appears then clears within the bound — the round-95 shape) →
//        CLEAN + reap-wait note, NOT red
//   - R3  PERSISTENT NEW residue (a genuine leak) → FAIL after the bound, listing the match
//   - R4  pre-existing match recorded in --snapshot → excluded (DELTA form preserved)
//   - R5  fail-closed: --check with no before-run snapshot → FAIL "no before-run snapshot"
//
// Run:
//   scripts/test.sh plugin/test/tmux-leak-scan.test.mjs
//
// NOTE: this test creates /tmp/session-liveness-* dirs (the leak-scan's OWN watched class) and
// always removes them in finally — it must never leave residue behind for the suite-tail scan.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCAN_SH = path.join(REPO_ROOT, "plugin", "scripts", "tmux-leak-scan.sh");

// A unique /tmp/session-liveness-* dir under the leak-scan's watched prefix.
// Each test uses a TEST-LOCAL scope subroot (--scope) so the scan covers ONLY that test's
// simulated leakage — the shared /tmp/quay-run-<runId>/ root is scanned by every leak-simulation
// test in the suite, and they cross-flagged each other's fixtures as residue (round 131 R2/R3 ×
// DELTA). The subroot lives under the namespace root (or os.tmpdir() in legacy mode) so it is
// visible to the scan only via --scope. Mirrors probeRoot() for the base.
function makeScopeRoot() {
  const base = process.env.QUAY_RUN_ID
    ? path.join(os.tmpdir(), `quay-run-${process.env.QUAY_RUN_ID}`)
    : os.tmpdir();
  fs.mkdirSync(base, { recursive: true });
  const scope = path.join(base, `leaktest-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(scope, { recursive: true });
  return scope;
}

// The fake-leak dir under the test's own scope subroot.
function makeTmpDirPath(scope) {
  return path.join(
    scope,
    `session-liveness-reapwait-${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
  );
}

function runSnapshot(scratch, scope) {
  return spawnSync("bash", [SCAN_SH, "--scope", scope, "--snapshot", scratch], { encoding: "utf8", timeout: 30_000 });
}

function runCheck(scratch, scope, { reapWaitMs = "10000", pollMs = "250" } = {}) {
  return spawnSync("bash", [SCAN_SH, "--scope", scope, "--check", scratch], {
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, TMUX_LEAK_REAP_WAIT_MS: reapWaitMs, TMUX_LEAK_REAP_POLL_MS: pollMs },
  });
}

test("R1 — a clean delta (no NEW matches) is immediate clean with no reap-wait note", () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "tmux-leak-reapwait-"));
  const scope = makeScopeRoot();
  try {
    let res = runSnapshot(scratch, scope);
    assert.equal(res.status, 0, `snapshot failed:\n${res.stdout}\n${res.stderr}`);
    res = runCheck(scratch, scope, { reapWaitMs: "5000" });
    assert.equal(res.status, 0, `clean --check must exit 0:\n${res.stdout}\n${res.stderr}`);
    assert.match(res.stdout, /no NEW residual test tmux servers\/dirs/);
    assert.doesNotMatch(res.stderr, /cleared during reap-wait/, "a clean run must not emit the reap-wait note");
  } finally {
    fs.rmSync(scope, { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test("R2 — TRANSIENT NEW residue (the round-95 shape) clears within the bound → CLEAN + note", () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "tmux-leak-reapwait-"));
  const scope = makeScopeRoot();
  const transientDir = makeTmpDirPath(scope);
  let reaper = null;
  try {
    let res = runSnapshot(scratch, scope);
    assert.equal(res.status, 0, `snapshot failed:\n${res.stdout}\n${res.stderr}`);
    // Create the NEW residue AFTER the snapshot so it is not recorded as pre-existing, then have a
    // detached reaper remove it shortly after --check begins scanning — simulating a test-spawned
    // tmux server that is STILL EXITING at scan time (teardown reaping, not a leak).
    fs.mkdirSync(transientDir, { recursive: true });
    reaper = spawn("bash", ["-c", `sleep 0.6 && rm -rf -- '${transientDir}'`], {
      detached: true,
      stdio: "ignore",
    });
    reaper.unref();
    res = runCheck(scratch, scope, { reapWaitMs: "5000", pollMs: "250" });
    assert.equal(res.status, 0, `transient residue must NOT red (reap-wait holds judgment):\n${res.stdout}\n${res.stderr}`);
    assert.match(res.stdout, /no NEW residual test tmux servers\/dirs/);
    assert.match(res.stderr, /cleared during reap-wait/, "the reap-wait note must be emitted when a match clears");
  } finally {
    if (reaper) {
      try { reaper.kill("SIGKILL"); } catch { /* already gone */ }
    }
    fs.rmSync(transientDir, { recursive: true, force: true });
    fs.rmSync(scope, { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test("R3 — PERSISTENT NEW residue (a genuine leak) still FAILs after the bound, listing the match", () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "tmux-leak-reapwait-"));
  const scope = makeScopeRoot();
  const leakDir = makeTmpDirPath(scope);
  try {
    let res = runSnapshot(scratch, scope);
    assert.equal(res.status, 0, `snapshot failed:\n${res.stdout}\n${res.stderr}`);
    fs.mkdirSync(leakDir, { recursive: true }); // NEW residue AFTER the snapshot — a genuine leak
    res = runCheck(scratch, scope, { reapWaitMs: "1200", pollMs: "200" });
    assert.equal(res.status, 1, `a genuine NEW leak must FAIL after the bound:\n${res.stdout}\n${res.stderr}`);
    assert.match(res.stderr, /tmux-leak-scan: FAIL/);
    assert.match(res.stderr, /NEW residual test tmux servers\/dirs/);
    assert.match(res.stderr, /STILL PRESENT after/);
    assert.match(res.stderr, new RegExp(path.basename(leakDir)));
    assert.doesNotMatch(res.stderr, /cleared during reap-wait/, "a genuine leak must not emit the transient note");
  } finally {
    fs.rmSync(leakDir, { recursive: true, force: true });
    fs.rmSync(scope, { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test("R4 — a pre-existing match recorded in the before-run snapshot is excluded (DELTA preserved)", () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "tmux-leak-reapwait-"));
  const scope = makeScopeRoot();
  const preDir = makeTmpDirPath(scope);
  try {
    fs.mkdirSync(preDir, { recursive: true }); // BEFORE the snapshot → recorded as pre-existing
    let res = runSnapshot(scratch, scope);
    assert.equal(res.status, 0, `snapshot failed:\n${res.stdout}\n${res.stderr}`);
    res = runCheck(scratch, scope);
    assert.equal(res.status, 0, `a pre-existing match must not trip the DELTA check:\n${res.stdout}\n${res.stderr}`);
    assert.match(res.stdout, /no NEW residual test tmux servers\/dirs/);
  } finally {
    fs.rmSync(preDir, { recursive: true, force: true });
    fs.rmSync(scope, { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test("R5 — fail closed: --check with no before-run snapshot exits 1", () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "tmux-leak-reapwait-"));
  const scope = makeScopeRoot();
  try {
    const res = runCheck(scratch, scope);
    assert.equal(res.status, 1, "--check without a snapshot must fail closed");
    assert.match(res.stderr, /no before-run snapshot/);
  } finally {
    fs.rmSync(scope, { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
