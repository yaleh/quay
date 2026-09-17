// Shared harness for the resource-gate shards (split of resource-gate.test.mjs by
// gap-suite-split-15-over-30s-test-files). ONE copy of every depth-0 helper — the shards import the
// names they use; ⛔ no shard re-declares a fixture.
//
// SRC_URL re-establishes the ORIGINAL directory so the moved code's own
// __dirname / import.meta.url-relative paths keep resolving from helpers/.
const SRC_URL = new URL("../resource-gate.test.mjs", import.meta.url).href;

// @test-group engine
// resource-gate.test.mjs — gap-no-resource-awareness-heavy-ops-run-blind. Pins the shared resource
// gate (plugin/scripts/resource-gate.sh) + the derived concurrency default (scripts/test.sh
// default_test_concurrency) as a MECHANICAL mechanism, not prose:
//
//   AC2 — the gate reads /proc/pressure/cpu `some avg10` (structural), never load average (proxy)
//   AC4 — it counts node procs via CMDLINE (host-independent — the `node-MainThread` comm literal
//         is host/Node-version-dependent, boheidc comm=`MainThread` ⇒ 恒 0), never `pgrep -f` /
//         `grep -x node`; the comm literal survives only as the dual-read self-check cross-count
//   AC3 — GO ↔ WAIT both directions, deterministically via the env test seams (no busy-loop flake)
//   AC6 — mem_avail < 2048MB → WAIT + prints RSS top-5
//   AC10 — orphaned node procs printed on their own line, excluded from the GO/WAIT verdict
//   AC7 — test.sh consults the gate on the full-suite default path; skips it for scoped runs
//   AC5 — default concurrency = max(1, floor(nproc × oversub / S)); explicit --test-concurrency=N wins
//         (gap-suite-budget-oversubscribe pure computation — nproc read-host, oversub 旋钮③, S 旋钮②)
//
// The gate's own AC3 (raise cpu pressure with real busy loops, watch WAIT, stop, watch GO) is a
// live-system control — recorded in the task body, not here (a unit test cannot hold /proc/pressure
// hostage). The env seams below pin the SAME verdict logic deterministically.
//
// Run:
//   scripts/test.sh plugin/test/resource-gate.test.mjs
//   node --test plugin/test/resource-gate.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync, execSync } from "node:child_process";

// The cross-gate threshold authority (gap-resource-gate-two-thresholds-test-sh-vs-cap-from-gate AC2):
// cap-from-gate.ts owns the mechanism constant WAIT_THRESHOLD (=60) that the full-suite gate's
// CPU_LIMIT default must equal — the drift-invariant test below imports the authority so the
// two thresholds cannot silently diverge again.
import { WAIT_THRESHOLD } from "../../scripts/cap-from-gate.ts";
// gap-suite-budget-oversubscribe 判据4 — the RUNNER-side derivations the direct path
// must match: defaultLaneCount() (main lane = max(1, floor(nproc × oversub / S))) +
// hostParallelism()/concurrentSuiteSlots()/concurrentPhaseCount() (the serial/lowconc phase budget
// = hostParallelism ÷ (S × P), P = 2 overlap-ON / 1 overlap-OFF — gap-lane-formula-ignores-phase-
// overlap-concurrency). Imported as FUNCTIONS (not the module-level DEFAULT_* consts) so the env
// seams below are read at call time, not import time.
import { defaultLaneCount, hostParallelism, concurrentSuiteSlots, concurrentPhaseCount } from "../../scripts/full-suite-runner.ts";
// gap-execution-loop-p4-suite-entry-ts-ization (SPEC P4 套件入口收进 TS): the DIRECT-path concurrency
// decision functions moved from scripts/test.sh bash to runner-concurrency.ts (test.sh thin-forwards to
// them). Imported as FUNCTIONS so the env seams below are read at call time, not import time — the
// DIRECT path now shares the TS canonical the RUNNER path (defaultLaneCount/hostParallelism/…) uses.
import { defaultTestConcurrency, defaultPhaseConcurrencyDirect, defaultLowconcConcurrency } from "../../scripts/runner-concurrency.ts";



/** Run the REAL gate with env-seam overrides. Returns { status, stdout } (stderr merged). */

/** The gate's DEFAULT CPU_LIMIT (the env-seam spelling, e.g. `${RESOURCE_GATE_CPU_LIMIT:-60}`). */

/** Run a function with a set of env seams set (save/restore; unset-on-absent). The DIRECT-path
 *  concurrency functions live in runner-concurrency.ts (SPEC P4) and read their seams from
 *  process.env — this replaces the old bash-extraction subshells (which sourced suite-slot-lib.sh and
 *  extracted default_concurrency_formula / serial_lowconc_host_default from test.sh). The seams are the
 *  SAME names the bash functions read, so every assertion below is unchanged in meaning. */

/** defaultTestConcurrency (the TS direct-path main formula) with seams. `slots` is the
 *  RESOURCE_GATE_CONCURRENT_SUITES seam; `oversub` is the RESOURCE_GATE_OVERSUBSCRIPTION seam; `inUse`
 *  is the RESOURCE_GATE_TEST_NODE_PROCS seam (the budget-aware subtraction — default 0 = idle host).
 *  The MAIN formula is max(1, floor((nproc − in_use) × oversub / S)) — the S divisor is the
 *  structural bound (gap-suite-budget-oversubscribe), the in_use subtraction is the budget-aware
 *  downward adjustment (gap-process-budget-in-use-structurally-zero-never-throttles). */

/** defaultTestConcurrency on the REAL host (no seams) — the effective default the exec lines call
 *  through test.sh's thin forwarder. A function that returned a constant instead of the derived formula
 *  is caught by the real-host assertion (AC5), which compares against an inline-derived expected value. */

/** defaultPhaseConcurrencyDirect (the TS direct-path serial/lowconc fallback) with seams. `overlap`
 *  (default "1" = the QUAY_PHASE_OVERLAP default) selects the concurrent-phase count P = 2 (on) / 1
 *  (off) — host-derived H÷(S×P) instead of the old 2/3 literals (gap-ac74-serial-lowconc-literal-direct-path). */

/** The bash canonical slot count S in a subshell with the AMBIENT env (FULL_SUITE_LOCK_FILE /
 *  `.concurrency` file honored, NO seam) — the direct reader for the AC2 file-wins negative control
 *  (gap-suite-concurrency-S-two-source-divergence). The bash canonical (suite-slot-lib.sh) is UNTOUCHED
 *  by P4: it still owns the single-flight lock slot paths + the SSoT cross-check. */

/** defaultTestConcurrency with NO slots seam — S comes from the AMBIENT `.concurrency` file / knob
 *  (the AC2 file-wins negative control: env knob left stale, the file must be authoritative). */

/** defaultPhaseConcurrencyDirect with NO slots seam (same file-wins negative control as
 *  derivedConcurrencyNoSeam). */

// ── AC2: the gate reads /proc/pressure/cpu some avg10 as PRIMARY; load average is SUPPLEMENTARY ─────
// gap-resource-gate-psi-does-not-capture-load-flake-driver: PSI `some avg10` alone MISSED the
// load-flake driver (round-230/231/232: load 6.4/6.04/11.76 with PSI 8-10 < 60 ⇒ gate GO, red rounds).
// The gate now ALSO reads /proc/loadavg as the OVERLOAD-WINDOW supplementary criterion
// (load >= nproc × LOAD_OVER_FACTOR ⇒ WAIT). PSI stays the PRIMARY structural CPU-contention signal.

const __dirname = path.dirname(fileURLToPath(SRC_URL));

function _findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, ".quay", "config.yml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Cannot find repo root: no .quay/config.yml found upward from " + startDir);
}

const REPO_ROOT = _findRepoRoot(__dirname);

const GATE = path.join(REPO_ROOT, "plugin", "scripts", "resource-gate.sh");

const TEST_SH = path.join(REPO_ROOT, "scripts", "test.sh");

// The bash canonical for S (suite_slot_count) — default_concurrency_formula / serial_lowconc_host_default
// now delegate their S read to it (gap-suite-concurrency-S-two-source-divergence), so the isolated
// subshells below must source it too.
const SUITE_SLOT_LIB = path.join(REPO_ROOT, "plugin", "scripts", "suite-slot-lib.sh");

function runGate(envOverrides = {}, args = []) {
  const env = { ...process.env, ...envOverrides };
  // Determinism for the OVERLOAD-WINDOW load seam (gap-resource-gate-psi-does-not-capture-load-
  // flake-driver): the real /proc/loadavg on a busy host (this box: 6.9-7.1 right now, close to the
  // nproc×2=8 threshold) would nondeterministically flip the new load_wait verdict and break the
  // verdict-asserting tests. Default the load seam LOW unless a test explicitly drives it — the
  // load-specific tests (AC4 negative control, psi_still_waits) set RESOURCE_GATE_TEST_LOAD_OVERRIDE
  // themselves. Same convention the CPU/MEM seams already use (explicit in every verdict test).
  if (!("RESOURCE_GATE_TEST_LOAD_OVERRIDE" in envOverrides)) {
    env.RESOURCE_GATE_TEST_LOAD_OVERRIDE = "1";
  }
  const res = spawnSync("bash", [GATE, ...args], { cwd: REPO_ROOT, encoding: "utf8", env });
  return { status: res.status, stdout: `${res.stdout}\n${res.stderr}` };
}

function defaultCpuLimit() {
  const src = fs.readFileSync(GATE, "utf8");
  const m = src.match(/CPU_LIMIT="\$\{RESOURCE_GATE_CPU_LIMIT:-(\d+)\}"/);
  assert.ok(m, "resource-gate.sh must define CPU_LIMIT with the RESOURCE_GATE_CPU_LIMIT env-seam spelling");
  return Number(m[1]);
}

// Concurrency-knob env the derivation/resource-gate read. withSeams is hermetic over these: any NOT
// explicitly provided is cleared for the call (restored after) so ambient leakage — e.g. a caller
// exporting QUAY_MAX_OVERSUBSCRIPTION — can never perturb a fixture asserting the oversub=1 baseline
// (2026-09-02 ov15 run: exported oversub red 2 self-tests expecting 16×1/2=8).
const CONCURRENCY_ENV = [
  "RESOURCE_GATE_NPROC",
  "RESOURCE_GATE_CONCURRENT_SUITES",
  "RESOURCE_GATE_OVERSUBSCRIPTION",
  "QUAY_MAX_OVERSUBSCRIPTION",
  "QUAY_MAX_CONCURRENT_SUITES",
  "QUAY_PHASE_OVERLAP",
  // gap-process-budget-in-use-structurally-zero-never-throttles: the MAIN derivation is now
  // BUDGET-AWARE (subtracts in_use = testProcessesInUse()). in_use is hermetic-pinned to 0 unless a
  // test drives RESOURCE_GATE_TEST_NODE_PROCS explicitly — otherwise defaultTestConcurrency /
  // defaultLaneCount would shell out to the live host and read a nondeterministic in_use.
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

function derivedConcurrency(nproc, slots = 2, oversub = 1, inUse = 0) {
  return withSeams(
    {
      RESOURCE_GATE_NPROC: String(nproc),
      RESOURCE_GATE_CONCURRENT_SUITES: String(slots),
      RESOURCE_GATE_OVERSUBSCRIPTION: String(oversub),
      RESOURCE_GATE_TEST_NODE_PROCS: String(inUse),
    },
    () => defaultTestConcurrency(),
  );
}

function currentDefaultConcurrency() {
  return defaultTestConcurrency();
}

function phaseConcurrencyDefault(nproc, slots, overlap = "1") {
  return withSeams(
    { RESOURCE_GATE_NPROC: String(nproc), RESOURCE_GATE_CONCURRENT_SUITES: String(slots), QUAY_PHASE_OVERLAP: overlap },
    () => defaultPhaseConcurrencyDirect(),
  );
}

function bashSlotCount() {
  const script = `. "${SUITE_SLOT_LIB}"\nsuite_slot_count\n`;
  const res = spawnSync("bash", ["-c", script], { encoding: "utf8" });
  assert.equal(res.status, 0, `bashSlotCount subshell failed: ${res.stderr}`);
  return Number(res.stdout.trim());
}

function derivedConcurrencyNoSeam(nproc, oversub = 1) {
  return withSeams(
    { RESOURCE_GATE_NPROC: String(nproc), RESOURCE_GATE_OVERSUBSCRIPTION: String(oversub) },
    () => defaultTestConcurrency(),
  );
}

function phaseConcurrencyDefaultNoSeam(nproc, overlap = "1") {
  return withSeams(
    { RESOURCE_GATE_NPROC: String(nproc), QUAY_PHASE_OVERLAP: overlap },
    () => defaultPhaseConcurrencyDirect(),
  );
}

function runnerLaneCount(seams) {
  const prevLock = process.env.FULL_SUITE_LOCK_FILE;
  const pinTmp = fs.mkdtempSync(path.join(os.tmpdir(), "rg-rl-"));
  const pinBase = path.join(pinTmp, "full-suite.lock");
  process.env.FULL_SUITE_LOCK_FILE = pinBase;
  try {
    return withSeams(seams, () => defaultLaneCount());
  } finally {
    if (prevLock === undefined) delete process.env.FULL_SUITE_LOCK_FILE;
    else process.env.FULL_SUITE_LOCK_FILE = prevLock;
    fs.rmSync(pinTmp, { recursive: true, force: true });
  }
}

const PROCESS_BUDGET = path.join(REPO_ROOT, "plugin", "scripts", "process-budget.sh");

export { CONCURRENCY_ENV, GATE, PROCESS_BUDGET, REPO_ROOT, SUITE_SLOT_LIB, TEST_SH, WAIT_THRESHOLD, __dirname, _findRepoRoot, assert, bashSlotCount, concurrentPhaseCount, concurrentSuiteSlots, currentDefaultConcurrency, defaultCpuLimit, defaultLaneCount, defaultLowconcConcurrency, defaultPhaseConcurrencyDirect, defaultTestConcurrency, derivedConcurrency, derivedConcurrencyNoSeam, execSync, fileURLToPath, fs, hostParallelism, os, path, phaseConcurrencyDefault, phaseConcurrencyDefaultNoSeam, runGate, runnerLaneCount, spawn, spawnSync, test, withSeams };
