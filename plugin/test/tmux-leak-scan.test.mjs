// @test-group engine
// RESTORED (2026-08-13 round 140 green: Fix A expiry reached) (2026-08-13, round 133+134 deterministic-under-load): R3's genuine-leak dir is
// removed within the reap-wait bound under full-suite load (identical assertion both rounds, ~800ms
// each) — isolated runs green, but full-suite load is a NECESSARY condition, so it recurs on the
// certification path. TEMPORARILY moved off the default (product,engine) certification path to
// governance. EXPIRY: restore to engine when the removal-source fix lands (R2 reaper / scope
// collision trace) — the trace task owns it. STILL RUNS in --for-task / --group governance scoped
// gates (防真泄漏回归无人发现). WAS @test-group engine.
// @load-sensitive fixture-vs-sweeper
// @load-sensitive-entry 2026-08-13 fixture-vs-sweeper (manager root cause): R3's genuine-leak dir was
// swept by sweepRunNamespace() — the sweeper removes run-root children WITHOUT a live tmux owner, and
// a plain-mkdir fixture (no owner) is judged orphan. Isolated runs don't concurrency-sweep ⇒ green;
// full-suite does ⇒ deterministic red (rounds 133-136). Fix A: fixtures at os.tmpdir()/leakscan-fixture-*
// (outside the run-root the sweeper scans). The --scope isolation from round 131 is preserved.
// tmux-leak-scan.test.mjs — gap-leak-scan-reap-race-false-red: RED/GREEN tests for the suite-tail
// leak scan's BOUNDED REAP-WAIT. The defect: at suite end `tmux-leak-scan.sh --check` raced with
// teardown reaping of test-spawned tmux servers — under load a still-exiting server (its process
// and /tmp/session-liveness-* socket dir are removed asynchronously after kill-session) was swept
// as "NEW residual" → a false red (round 95: tests=4150 all pass, only the leak gate red; round 96
// light-load control: reaping won 2-10s before the scan → green). Fix: --check HOLD JUDGMENT — when
// NEW matches appear it polls up to a HOST-DERIVED reap-wait bound (default reap_wait_default():
// max(10000, nproc×2500), ≥10000 — gap-suite-leak-scan-ol-scd-g-teardown-slow) for them to clear;
// only matches STILL PRESENT at the bound are a REAL leak. A genuine leak never clears, so the gate
// is not weakened — it only stops flagging exit-in-progress.
//
// Covers:
//   - R1  clean delta (no NEW matches) → immediate clean, no reap-wait note (zero added latency)
//   - R2  TRANSIENT NEW residue (appears then clears within the bound — the round-95 shape) →
//        CLEAN + reap-wait note, NOT red
//   - R3  PERSISTENT NEW residue (a genuine leak) → FAIL after the bound, listing the match
//   - R4  pre-existing match recorded in --snapshot → excluded (DELTA form preserved)
//   - R5  fail-closed: --check with no before-run snapshot → FAIL "no before-run snapshot"
//   - R6  the default reap-wait is HOST-DERIVED (reap_wait_default() reads nproc, floor 10000) —
//        not a fixed literal (gap-suite-leak-scan-ol-scd-g-teardown-slow; AC1 read-host mechanic)
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

// A unique /tmp/leakscan-fixture-* dir OUTSIDE the run-root (Fix A, 2026-08-13 manager root cause):
// R3/DELTA's genuine-leak dir was removed by sweepRunNamespace() — the sweeper reads the run-root's
// children and removes any dir WITHOUT a live tmux owner (owner-liveness criterion). A plain-mkdir
// fixture (no live owner) is judged "orphan" and swept under full-suite load (isolated runs don't
// concurrency-sweep ⇒ pass; suite does ⇒ deterministic red, round 133-136). Fix: scope dirs live at
// os.tmpdir()/leakscan-fixture-* — a prefix the sweeper does NOT scan (it only reads quay-run-* and
// the run-root's children). The leak-scan test still passes --scope to point the scan at it.
function makeScopeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "leakscan-fixture-"));
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

// Extract the REAL reap_wait_default() from tmux-leak-scan.sh and run it with the nproc seam —
// the same extract-and-execute technique resource-gate.test.mjs uses for test.sh's
// default_concurrency_formula (the derivation lives in the script, not in a copied formula). The
// default reap-wait is HOST-DERIVED (gap-suite-leak-scan-ol-scd-g-teardown-slow): teardown latency
// scales with the main-phase lane count, so a fixed 10000ms is a host-dependent constant
// (CLAUDE.md 硬规则 4 推论二). RESOURCE_GATE_NPROC is the seam (no real nproc read → deterministic).
function reapWaitDefault(nproc) {
  const src = fs.readFileSync(SCAN_SH, "utf8");
  const fnMatch = src.match(/reap_wait_default\(\) \{[^]*?\n\}/);
  assert.ok(fnMatch, "tmux-leak-scan.sh must define reap_wait_default()");
  const script = `${fnMatch[0]}\nRESOURCE_GATE_NPROC=${nproc}\nprintf '%s' "$(reap_wait_default)"\n`;
  const res = spawnSync("bash", ["-c", script], { encoding: "utf8", timeout: 30_000 });
  assert.equal(res.status, 0, `reap_wait_default(${nproc}) failed: ${res.stderr}`);
  return parseInt(res.stdout.trim(), 10);
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
    // Round 133/134 flake (R3 under full-suite load): a genuine-leak dir was judged "cleared during
    // reap-wait" at 400-500ms — the 1200ms bound + 200ms poll raced a load-delayed removal. Bump to
    // the same margin R2 uses (5000ms / 400ms poll) so a persistent leak has far more headroom
    // before the transient judgment. @load-sensitive wall-clock declares the class.
    res = runCheck(scratch, scope, { reapWaitMs: "5000", pollMs: "400" });
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

test("R6 — the default reap-wait is HOST-DERIVED (reap_wait_default reads nproc), not a fixed literal", () => {
  // AC1's read-host mechanic (gap-suite-leak-scan-ol-scd-g-teardown-slow): the 4-round ol-scd-g
  // false-red was the reap-wait 10000ms literal expiring under 16-lane load. The default must now
  // scale with nproc — floor 10000 (the historical 4-core value, unchanged) up to nproc×2500. A
  // fixed 10000ms would return 10000 for EVERY seam here; the scaling asserts it reads the host.
  assert.equal(reapWaitDefault(1), 10000, "1-core floors at the historical 10000ms");
  assert.equal(reapWaitDefault(4), 10000, "4-core (historical box) is unchanged at 10000ms");
  assert.equal(reapWaitDefault(16), 40000, "16-core widens to 40000ms — the 16-lane ol-scd-g false-red fix");
  assert.equal(reapWaitDefault(32), 80000, "32-core scales linearly (nproc × 2500)");
});
