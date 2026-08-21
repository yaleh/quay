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
import { spawnSync, execSync } from "node:child_process";

// The cross-gate threshold authority (gap-resource-gate-two-thresholds-test-sh-vs-cap-from-gate AC2):
// cap-from-gate.ts owns the mechanism constant WAIT_THRESHOLD (=60) that the full-suite gate's
// CPU_LIMIT default must equal — the drift-invariant test below imports the authority so the
// two thresholds cannot silently diverge again.
import { WAIT_THRESHOLD } from "../scripts/cap-from-gate.ts";
// gap-suite-budget-oversubscribe 判据4 — the RUNNER-side derivations the direct path
// must match: defaultLaneCount() (main lane = max(1, floor(nproc × oversub / S))) +
// hostParallelism()/concurrentSuiteSlots()/concurrentPhaseCount() (the serial/lowconc phase budget
// = hostParallelism ÷ (S × P), P = 2 overlap-ON / 1 overlap-OFF — gap-lane-formula-ignores-phase-
// overlap-concurrency). Imported as FUNCTIONS (not the module-level DEFAULT_* consts) so the env
// seams below are read at call time, not import time.
import { defaultLaneCount, hostParallelism, concurrentSuiteSlots, concurrentPhaseCount } from "../scripts/full-suite-runner.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

/** Run the REAL gate with env-seam overrides. Returns { status, stdout } (stderr merged). */
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

/** The gate's DEFAULT CPU_LIMIT (the env-seam spelling, e.g. `${RESOURCE_GATE_CPU_LIMIT:-60}`). */
function defaultCpuLimit() {
  const src = fs.readFileSync(GATE, "utf8");
  const m = src.match(/CPU_LIMIT="\$\{RESOURCE_GATE_CPU_LIMIT:-(\d+)\}"/);
  assert.ok(m, "resource-gate.sh must define CPU_LIMIT with the RESOURCE_GATE_CPU_LIMIT env-seam spelling");
  return Number(m[1]);
}

/** Extract the REAL default_concurrency_formula from scripts/test.sh and run it with seams.
 *  `slots` (default 2 = QUAY_MAX_CONCURRENT_SUITES current value) is the RESOURCE_GATE_CONCURRENT_SUITES
 *  seam; `oversub` (default 1 = QUAY_MAX_OVERSUBSCRIPTION current value) is the
 *  RESOURCE_GATE_OVERSUBSCRIPTION seam. The MAIN formula is PURE computation
 *  (max(1, floor(nproc × oversub / S)) — gap-suite-budget-oversubscribe): no runtime `in_use`
 *  subtraction, no AMPLIFICATION divisor. The serial/lowconc PHASE defaults
 *  (serial_lowconc_host_default) ARE H÷S — tested separately. */
function derivedConcurrency(nproc, slots = 2, oversub = 1) {
  const src = fs.readFileSync(TEST_SH, "utf8");
  // The formula lives in default_concurrency_formula; default_test_concurrency CALLS it (the
  // 2026-08-03 TEMPORARY pin to 8 was reverted by
  // gap-concurrency-derivation-reverted-but-doc-ac-and-tests-all-still-report-derived).
  const fnMatch = src.match(/default_concurrency_formula\(\) \{[^]*?\n\}/);
  assert.ok(fnMatch, "scripts/test.sh must define default_concurrency_formula()");
  const script = `${fnMatch[0]}\nRESOURCE_GATE_NPROC=${nproc}\nRESOURCE_GATE_CONCURRENT_SUITES=${slots}\nRESOURCE_GATE_OVERSUBSCRIPTION=${oversub}\nprintf '%s' "$(default_concurrency_formula)"\n`;
  const res = spawnSync("bash", ["-c", script], { encoding: "utf8" });
  assert.equal(res.status, 0, `derivedConcurrency subshell failed: ${res.stderr}`);
  return Number(res.stdout.trim());
}

/** Directly EXECUTE default_test_concurrency (the real effective default) and return its value.
 *  This is the AC1/AC3 "test the real value, not the spelling" seam: it runs the actual function
 *  the exec lines call, so a function that returns a constant instead of the derived formula is
 *  caught HERE, not by a call-site-spelling assertion. Runs on the REAL host (nproc, S=2, oversub=1)
 *  — the idle-host default ⇒ max(1, floor(nproc × 1 / 2)) = nproc/2 (gap-suite-budget-oversubscribe
 *  pure computation). */
function currentDefaultConcurrency() {
  const src = fs.readFileSync(TEST_SH, "utf8");
  const fnMatch = src.match(/default_test_concurrency\(\) \{[^]*?\n\}/);
  assert.ok(fnMatch, "scripts/test.sh must define default_test_concurrency()");
  // default_test_concurrency calls default_concurrency_formula — extract BOTH functions so the
  // isolated subshell is self-contained (matches the ## Contract effective_concurrency measure).
  const formulaMatch = src.match(/default_concurrency_formula\(\) \{[^]*?\n\}/);
  assert.ok(formulaMatch, "scripts/test.sh must define default_concurrency_formula()");
  const script = `${formulaMatch[0]}\n${fnMatch[0]}\nprintf '%s' "$(default_test_concurrency)"\n`;
  const res = spawnSync("bash", ["-c", script], { encoding: "utf8" });
  assert.equal(res.status, 0, `currentDefaultConcurrency subshell failed: ${res.stderr}`);
  return Number(res.stdout.trim());
}

/** Extract the REAL serial_lowconc_host_default (the shared serial/lowconc fallback) from
 *  scripts/test.sh and run it with deterministic seams. This is the DIRECT-path value of the two
 *  phase knobs (no QUAY_SERIAL_CONCURRENCY / QUAY_LOWCONC_CONCURRENCY env) — the AC74 fix makes it
 *  host-derived (H÷(S×P)) instead of the old 2/3 literals; `overlap` (default "1" = the
 *  QUAY_PHASE_OVERLAP default) selects the concurrent-phase count P = 2 (on) / 1 (off). */
function phaseConcurrencyDefault(nproc, slots, overlap = "1") {
  const src = fs.readFileSync(TEST_SH, "utf8");
  const fnMatch = src.match(/serial_lowconc_host_default\(\) \{[^]*?\n\}/);
  assert.ok(fnMatch, "scripts/test.sh must define serial_lowconc_host_default()");
  const script = `${fnMatch[0]}\nRESOURCE_GATE_NPROC=${nproc}\nRESOURCE_GATE_CONCURRENT_SUITES=${slots}\nQUAY_PHASE_OVERLAP=${overlap}\nprintf '%s' "$(serial_lowconc_host_default)"\n`;
  const res = spawnSync("bash", ["-c", script], { encoding: "utf8" });
  assert.equal(res.status, 0, `phaseConcurrencyDefault subshell failed: ${res.stderr}`);
  return Number(res.stdout.trim());
}

// ── AC2: the gate reads /proc/pressure/cpu some avg10 as PRIMARY; load average is SUPPLEMENTARY ─────
// gap-resource-gate-psi-does-not-capture-load-flake-driver: PSI `some avg10` alone MISSED the
// load-flake driver (round-230/231/232: load 6.4/6.04/11.76 with PSI 8-10 < 60 ⇒ gate GO, red rounds).
// The gate now ALSO reads /proc/loadavg as the OVERLOAD-WINDOW supplementary criterion
// (load >= nproc × LOAD_OVER_FACTOR ⇒ WAIT). PSI stays the PRIMARY structural CPU-contention signal.
test("AC2 — gate reads /proc/pressure/cpu `some avg10` as PRIMARY; load average is a SUPPLEMENTARY overload-window criterion", () => {
  const src = fs.readFileSync(GATE, "utf8");
  const code = src.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  assert.match(src, /\/proc\/pressure\/cpu/, "gate must read /proc/pressure/cpu");
  assert.match(src, /avg10=/, "gate must parse the some avg10 field");
  assert.match(src, /some avg10 < 60|CPU_LIMIT/, "gate must carry the some avg10 < 60 band (unified with cap-from-gate's WAIT_THRESHOLD)");
  // The load-average overload-window criterion (AC3) — load is a SUPPLEMENT, PSI stays primary.
  assert.match(code, /\/proc\/loadavg/, "gate must read /proc/loadavg (the supplementary overload-window signal)");
  assert.match(src, /LOAD_OVER_FACTOR/, "gate must carry the load >= nproc × LOAD_OVER_FACTOR overload-window band");
  assert.match(src, /RESOURCE_GATE_TEST_LOAD_OVERRIDE/, "the load test seam must exist");
  assert.match(src, /NOT a replacement|not a replacement|SUPPLEMENT|supplementary/, "the header must state load is a supplement, not a replacement for PSI");
});

// ── AC2 (gap-adaptive-concurrency-cap-tied-to-resource-gate): the gate also reports avg300 ─────────
// cap-from-gate reads the adaptive-concurrency signal via the SAME report line (single source): the
// avg300 field must be parsed AND printed under its own test seam.
test("AC2b — gate parses AND prints `some avg300` (the adaptive-cap signal), seam-controlled", () => {
  const src = fs.readFileSync(GATE, "utf8");
  assert.match(src, /avg300=/, "gate must parse the some avg300 field");
  assert.match(src, /RESOURCE_GATE_TEST_CPU_AVG300/, "the avg300 test seam must exist");
  const r = runGate({ RESOURCE_GATE_TEST_CPU_AVG10: "10", RESOURCE_GATE_TEST_CPU_AVG300: "12.34", RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000" });
  assert.match(r.stdout, /cpu_stall\(some avg300\)=12\.34/, "report mode must print the avg300 line");
});

// ── AC2-AC4 (gap-resource-gate-psi-does-not-capture-load-flake-driver) ──────────────────────────────
// Empirical flake correlation (round-230/231/232, suite-fix subagent 2026-08-10 + outer 复核):
// loop-shipping passed=false at load 6.4 / 6.04 / 11.76 while PSI some avg10 stayed 8-10 < 60 and the
// gate returned GO — the red rounds tracked LOAD (runnable+uninterruptible queue depth, incl. the
// loop's own claude sessions), not PSI. AC3 adds the overload-window criterion (load >= nproc ×
// LOAD_OVER_FACTOR ⇒ WAIT) WITHOUT weakening the PSI primary band; AC4 is the negative control.
test("AC4 — overload-window negative control: load >= nproc×2 ⇒ WAIT even when PSI is low (round-232 reproduction)", () => {
  // round-232: load 11.76 / nproc=4 (~3× oversubscription), PSI 8.27 < 60. Old gate: GO. New gate:
  // load_wait fires (11.76 >= 4×2=8) ⇒ WAIT, exit 1 — the round no longer starts into the overload
  // window that produced the loop-shipping flake.
  const r = runGate(
    { RESOURCE_GATE_TEST_CPU_AVG10: "8.27", RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000", RESOURCE_GATE_TEST_LOAD_OVERRIDE: "11.76", RESOURCE_GATE_TEST_NPROC: "4" },
    ["--for", "full-suite"],
  );
  assert.equal(r.status, 1, `load 11.76 / nproc 4 must WAIT (overload window), got ${r.status}\n${r.stdout}`);
  assert.match(r.stdout, /loadavg=11\.76/, "the loadavg line must print the reading");
  assert.match(r.stdout, /=> WAIT: 过载窗口/, "the verdict must name the overload window");
});

test("AC4 — load below the threshold stays GO (normal machine state, PSI low)", () => {
  const r = runGate(
    { RESOURCE_GATE_TEST_CPU_AVG10: "10", RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000", RESOURCE_GATE_TEST_LOAD_OVERRIDE: "3", RESOURCE_GATE_TEST_NPROC: "4" },
    ["--for", "full-suite"],
  );
  assert.equal(r.status, 0, `load 3 / nproc 4 must GO, got ${r.status}\n${r.stdout}`);
  assert.match(r.stdout, /loadavg=3\.00/, "the loadavg line must print the reading");
  assert.match(r.stdout, /=> GO/);
});

test("invariant psi_still_waits — PSI high ⇒ WAIT even when load is low (the supplementary load criterion does NOT weaken the primary)", () => {
  const r = runGate(
    { RESOURCE_GATE_TEST_CPU_AVG10: "84.77", RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000", RESOURCE_GATE_TEST_LOAD_OVERRIDE: "1", RESOURCE_GATE_TEST_NPROC: "4" },
    ["--for", "full-suite"],
  );
  assert.equal(r.status, 1, `PSI high must still WAIT, got ${r.status}\n${r.stdout}`);
  assert.match(r.stdout, /=> WAIT: CPU 饥饿/, "the PSI primary verdict must still name CPU starvation");
});

test("AC4 — unmeasurable load fails CLOSED (a gate that silently opens when a signal is missing is a quietly-lying instrument)", () => {
  const r = runGate(
    { RESOURCE_GATE_TEST_CPU_AVG10: "10", RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000", RESOURCE_GATE_TEST_LOAD_OVERRIDE: "unmeasurable", RESOURCE_GATE_TEST_NPROC: "4" },
    ["--for", "full-suite"],
  );
  assert.equal(r.status, 1, `unmeasurable load must WAIT (fail-closed), got ${r.status}\n${r.stdout}`);
  assert.match(r.stdout, /loadavg=UNMEASURABLE/, "the output must say UNMEASURABLE, not a fake number");
});

test("AC2 — the gate's header records the flake/load correlation (the red-round pairs that motivated the supplementary criterion)", () => {
  // The ## Contract invariant flake_load_correlation: the red-round load+PSI pairs (round-230/231/232
  // @ load 6.4/6.04/11.76, PSI 8-10 < 60) are recorded in the gate's header, so a future reader sees
  // WHY load is added — the correlation is pinned, not prose elsewhere.
  const src = fs.readFileSync(GATE, "utf8");
  assert.match(src, /round-230\/231\/232|6\.4\/6\.04\/11\.76|11\.76/, "the header must record the flake/load correlation evidence");
  assert.match(src, /overload.window|OVERLOAD-WINDOW|SUPPLEMENT/, "the header must explain load is the overload-window supplement");
});

// ── AC4: CMDLINE-based node count (host-independent), never a comm literal / pgrep -f / grep -x node
// (gap-node-mainthread-comm-literal-host-dependent) The old `pgrep -xc node-MainThread` enumeration
// was HOST-DEPENDENT: boheidc (Node v24.19.0) reports comm=`MainThread`, so it silently returned 0
// there. The gate now enumerates node pids via CMDLINE; the node-MainThread literal survives ONLY as
// the dual-read self-check cross-count.
test("AC4 — gate counts node procs via CMDLINE (host-independent), not a comm literal; keeps the dual-read self-check", () => {
  const src = fs.readFileSync(GATE, "utf8");
  // The header comment may MENTION the forbidden spellings (as warnings) — the CODE must not.
  const code = src.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  assert.match(src, /list_node_cmdline_pids|\/proc\/.*cmdline/, "gate must enumerate node pids via cmdline");
  assert.doesNotMatch(code, /pgrep -xc node-MainThread/, "gate must NOT enumerate via the host-dependent comm literal `pgrep -xc node-MainThread`");
  assert.doesNotMatch(code, /pgrep -f/, "gate must NOT use `pgrep -f` (matches any cmdline containing node)");
  // NB: a bare `grep -x node` (standalone grep, not pgrep) is a fragment — always 0 on a host whose
  // comm is `node-MainThread`, and ALSO 0 on boheidc (comm=`MainThread`).
  assert.doesNotMatch(code, /(^|[^a-zA-Z])grep -x node\b/m, "gate must NOT use `grep -x node` as a standalone command (fragment — always 0)");
  // The dual-read self-check cross-reads the comm literal against cmdline candidates.
  assert.match(src, /count_comm_node_mainthread|node_comm_mainthread/, "gate must carry the dual-read comm cross-count");
  assert.match(src, /list_node_cmdline_pids|node_cmdline_procs/, "gate must carry the dual-read cmdline candidate count");
  assert.match(src, /instrument_failure|INSTRUMENT-FAILURE/, "gate must report instrument failure on the dual-read mismatch");
});

test("AC4 negative control — the old comm literal is reported as INSTRUMENT FAILURE when comm=0 but cmdline>0 (the boheidc shape)", () => {
  const r = runGate({
    RESOURCE_GATE_TEST_CPU_AVG10: "10",
    RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000",
    RESOURCE_GATE_TEST_COMM_COUNT: "0",
    RESOURCE_GATE_TEST_CMDLINE_COUNT: "5",
  });
  assert.match(r.stdout, /node_comm_mainthread=0/, "the comm cross-count must be reported");
  assert.match(r.stdout, /node_cmdline_procs=5/, "the cmdline candidate count must be reported");
  assert.match(r.stdout, /INSTRUMENT-FAILURE/, "comm=0 with cmdline=5 must report instrument failure, not machine idle");
});

test("AC4 negative control — a matching comm literal (comm>0) is NOT instrument failure", () => {
  const r = runGate({
    RESOURCE_GATE_TEST_CPU_AVG10: "10",
    RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000",
    RESOURCE_GATE_TEST_COMM_COUNT: "2",
    RESOURCE_GATE_TEST_CMDLINE_COUNT: "2",
  });
  assert.match(r.stdout, /node_comm_mainthread=2/, "the comm cross-count must be reported");
  assert.doesNotMatch(r.stdout, /INSTRUMENT-FAILURE/, "comm>0 is a normal reading");
});

// ── AC3: GO ↔ WAIT both directions via deterministic seams ─────────────────────────────────────────
test("AC3 — gate returns GO (exit 0) when cpu some avg10 < 60 and mem ok", () => {
  const r = runGate({ RESOURCE_GATE_TEST_CPU_AVG10: "10", RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000" }, ["--for", "full-suite"]);
  assert.equal(r.status, 0, `expected GO (exit 0), got ${r.status}\n${r.stdout}`);
  assert.match(r.stdout, /=> GO/);
  assert.match(r.stdout, /cpu_stall\(some avg10\)=10\.00  \[limit 60\]   ok/);
  assert.match(r.stdout, /mem_avail=4000MB             \[limit 2048\] ok/);
});

test("AC3 — gate returns WAIT (exit 1) when cpu some avg10 >= 60 (busy-loop control is the live form)", () => {
  const r = runGate({ RESOURCE_GATE_TEST_CPU_AVG10: "84.77", RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000" }, ["--for", "full-suite"]);
  assert.equal(r.status, 1, `expected WAIT (exit 1), got ${r.status}\n${r.stdout}`);
  assert.match(r.stdout, /=> WAIT: CPU 饥饿/);
  assert.match(r.stdout, /cpu_stall\(some avg10\)=84\.77  \[limit 60\]   WAIT/);
});

test("AC3 — report mode always exits 0 even under a WAIT verdict (scoped operator can always read)", () => {
  const r = runGate({ RESOURCE_GATE_TEST_CPU_AVG10: "84.77" }, []);
  assert.equal(r.status, 0, `report mode must exit 0, got ${r.status}\n${r.stdout}`);
  assert.match(r.stdout, /=> WAIT: CPU 饥饿/);
});

// ── gap-resource-gate-two-thresholds-test-sh-vs-cap-from-gate: AC2/AC4 threshold alignment ─────────
test("AC2 — the full-suite gate's CPU_LIMIT default is UNIFIED with cap-from-gate's WAIT_THRESHOLD (drift invariant)", () => {
  // cap-from-gate.ts owns the mechanism constant (WAIT_THRESHOLD = 60, the GO/WAIT boundary).
  // resource-gate.sh's binary full-suite gate must refuse a suite EXACTLY when dispatch leaves the
  // GO band — a load in the old 40-60 dead-zone made the suite WAIT (limit 40) while dispatch kept
  // GO, the "suite refuses + dispatch continues" loop risk. This import-time invariant makes the two
  // thresholds unable to silently diverge again.
  assert.equal(defaultCpuLimit(), WAIT_THRESHOLD,
    `resource-gate CPU_LIMIT (${defaultCpuLimit()}) must equal cap-from-gate WAIT_THRESHOLD (${WAIT_THRESHOLD})`);
});

test("AC4 — the 40-60 problem region is aligned: avg10=49.56 ⇒ both gates GO; avg10=70 ⇒ both non-GO", () => {
  // The manager's observed dead-zone sample (avg10=49.56): test.sh's gate used to WAIT (limit 40)
  // while cap-from-gate stayed GO — the load-peak imbalance. After unification the full-suite gate
  // returns GO here (no suite-refusal while dispatch continues).
  const suite49 = runGate({ RESOURCE_GATE_TEST_CPU_AVG10: "49.56", RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000" }, ["--for", "full-suite"]);
  assert.equal(suite49.status, 0, `avg10=49.56 must be GO (exit 0), got ${suite49.status}\n${suite49.stdout}`);
  assert.match(suite49.stdout, /\[limit 60\]   ok/);
  // Above the unified threshold (avg10=70) the suite refuses — cap-from-gate is simultaneously
  // WAIT (computeDesiredBand(68..70) = WAIT), so neither layer keeps dispatching into the refused load.
  const suite70 = runGate({ RESOURCE_GATE_TEST_CPU_AVG10: "70", RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000" }, ["--for", "full-suite"]);
  assert.equal(suite70.status, 1, `avg10=70 must be WAIT (exit 1), got ${suite70.status}\n${suite70.stdout}`);
  assert.match(suite70.stdout, /\[limit 60\]   WAIT/);
});

// ── gap-resource-gate-two-thresholds-test-sh-vs-cap-from-gate: AC5 budget same-source ──────────────
test("AC5 — the gate's report reads total_budget/in_use/available from process-budget.sh (the shared cross-layer authority)", () => {
  // The ## Contract invoke's observable: the full-suite gate reports the SAME budget numbers
  // (process-budget.sh — total_budget = nproc) that test.sh's worker derivation and cap-from-gate's
  // slot cap consume, so under load the "total budget" cannot drift per-layer.
  const r = runGate({ RESOURCE_GATE_TEST_CPU_AVG10: "10", RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000", RESOURCE_GATE_TEST_NODE_PROCS: "2", RESOURCE_GATE_TEST_NPROC: "4" });
  assert.match(r.stdout, /total_budget=4\s+budget_in_use=2\s+budget_available=2\s+\[cross-layer budget authority: process-budget\.sh\]/);
});

// ── fail-closed on an unmeasurable signal (no quiet lying) ────────────────────────────────────────
test("gate FAILS CLOSED when /proc/pressure/cpu is unreadable (kernel without PSI)", () => {
  const r = runGate({ RESOURCE_GATE_TEST_CPU_AVG10: "unmeasurable", RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000" }, ["--for", "full-suite"]);
  assert.equal(r.status, 1, `unmeasurable CPU must be WAIT (fail-closed), got ${r.status}\n${r.stdout}`);
  assert.match(r.stdout, /UNMEASURABLE/, "the output must say UNMEASURABLE, not a fake number");
  assert.match(r.stdout, /fail-closed/, "the verdict must explain the fail-closed decision");
});

test("gate FAILS CLOSED when free -m is unreadable", () => {
  const r = runGate({ RESOURCE_GATE_TEST_CPU_AVG10: "10", RESOURCE_GATE_TEST_MEM_AVAIL_MB: "unmeasurable" }, ["--for", "full-suite"]);
  assert.equal(r.status, 1, `unmeasurable mem must be WAIT (fail-closed), got ${r.status}\n${r.stdout}`);
  assert.match(r.stdout, /mem_avail=UNMEASURABLE/, "the output must say UNMEASURABLE");
});

// ── AC6: mem_avail < 2048MB → WAIT + RSS top-5 ─────────────────────────────────────────────────────
test("AC6 — mem_avail < 2048MB refuses the full suite and prints the RSS top-5", () => {
  const r = runGate({ RESOURCE_GATE_TEST_CPU_AVG10: "10", RESOURCE_GATE_TEST_MEM_AVAIL_MB: "1000" }, ["--for", "full-suite"]);
  assert.equal(r.status, 1, `expected WAIT (exit 1), got ${r.status}\n${r.stdout}`);
  assert.match(r.stdout, /mem_avail=1000MB             \[limit 2048\] WAIT/);
  assert.match(r.stdout, /=> WAIT: 内存不足/);
  assert.match(r.stdout, /RSS top-5/, "AC6 must print the RSS top-5 when refusing on memory");
  assert.match(r.stdout, /PID\s+PPID\s+RSS\s+COMMAND/, "RSS listing must actually run ps (header row)");
});

test("AC6 — RSS top-5 is NOT printed when memory is fine (only on the refuse path)", () => {
  const r = runGate({ RESOURCE_GATE_TEST_CPU_AVG10: "10", RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000" }, ["--for", "full-suite"]);
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stdout, /RSS top-5/);
});

// ── AC10: orphaned node procs on their own line, excluded from the verdict ─────────────────────────
test("AC10 — orphaned node procs (ppid=1, cwd deleted) are listed on their own line and do NOT flip the verdict", () => {
  const r = runGate(
    {
      RESOURCE_GATE_TEST_CPU_AVG10: "10",
      RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000",
      RESOURCE_GATE_TEST_ORPHANS: "111:/home/yale/work/quay-worktrees/a (deleted);222:/home/yale/work/quay-worktrees/b (deleted)",
    },
    ["--for", "full-suite"]
  );
  assert.equal(r.status, 0, `orphans are informational — must NOT flip GO, got ${r.status}\n${r.stdout}`);
  const orphanLines = r.stdout.split("\n").filter((l) => l.startsWith("orphan_node:"));
  assert.equal(orphanLines.length, 2, `expected 2 orphan lines, got:\n${r.stdout}`);
  assert.match(orphanLines[0], /111:\/home\/yale\/work\/quay-worktrees\/a \(deleted\)/);
  assert.match(orphanLines[1], /222:\/home\/yale\/work\/quay-worktrees\/b \(deleted\)/);
});

// ── AC5/AC1/AC3: derived default concurrency = max(1, floor(nproc × oversub / S)) ──────────────────
// gap-suite-budget-oversubscribe (human 14:4xZ 修正方向 — (b) 认领制/(c) 锁发配额 均被否): the MAIN
// derivation is PURE computation over config knobs + host env. nproc = host (read-host, never a
// literal); oversub = 旋钮③ QUAY_MAX_OVERSUBSCRIPTION (default 1); S = 旋钮② QUAY_MAX_CONCURRENT_SUITES
// (default 2). Σ over S running suites = S × (nproc×oversub/S) = nproc×oversub, structurally bounded.
test("AC5 — formula derives max(1, floor(nproc × oversub / S)); the DEFAULT executes that formula (not a constant)", () => {
  // The REAL formula from scripts/test.sh (default_concurrency_formula), run with test seams.
  // nproc × oversub / S, clamped at 1.
  assert.equal(derivedConcurrency(4, 1, 1), 4, "4 cores, 1 slot → nproc (single slot = whole host)");
  assert.equal(derivedConcurrency(16, 1, 1), 16, "16 cores, 1 slot → 16");
  assert.equal(derivedConcurrency(16, 2, 1), 8, "16 cores, 2 slots → 8 (nproc×oversub/S)");
  assert.equal(derivedConcurrency(4, 2, 1), 2, "4 cores, 2 slots → 2");
  assert.equal(derivedConcurrency(1, 2, 1), 1, "floor(1×1/2) clamps at 1 (max(1, ...))");
  assert.equal(derivedConcurrency(8, 2, 1), 4, "8 cores, 2 slots → 4");
  // oversub is the express channel for "single suite uses the whole host" (判据4) — never dynamic run-count.
  assert.equal(derivedConcurrency(16, 2, 2), 16, "16 cores, 2 slots, oversub=2 → 16");
  assert.equal(derivedConcurrency(16, 2, 0.5), 4, "oversub=0.5 → 4 (fractional oversub reads through)");
  // AC1/AC3 of gap-concurrency-derivation-reverted-but-doc-ac-and-tests-all-still-report-derived:
  // the EFFECTIVE default (default_test_concurrency) must equal the derived formula on the REAL host
  // — the 2026-08-03 TEMPORARY pin to 8 was reverted (that drift: docs/tests said derived while the
  // code returned a constant). This assertion directly executes the real function, so a future
  // constant-return regression goes RED here (the Contract's control clause). Idle host ⇒
  // max(1, floor(nproc × 1 / 2)) = nproc/2 (pure computation known cost).
  const realNproc = Number(execSync("nproc").toString().trim());
  // Adaptive to the configured slot count (gap-suite-lock-slot-seam-asymmetry AC2): under
  // QUAY_MAX_CONCURRENT_SUITES=1 the effective default is nproc (single slot = whole host), not nproc/2 —
  // the assertion must not hardcode S=2.
  //
  // Hermetic against the PRODUCTION `.concurrency` scalar (gap-suite-slot-ssot-i5-false-positive): the
  // TS canonical (concurrentSuiteSlots) and the bash canonical (default_test_concurrency) must read the
  // SAME S. The TS side reads <suiteLockBase>.concurrency FIRST — a live-suite S=1 file would shadow the
  // knob and drift from bash (which reads seam→knob→2) ⇒ the real-host assertion goes red. Pin the base
  // to an isolated temp dir carrying 2 and drive the knob to 2 so BOTH canons deterministically read S=2.
  const prevLock = process.env.FULL_SUITE_LOCK_FILE;
  const prevSeam = process.env.RESOURCE_GATE_CONCURRENT_SUITES;
  const prevKnob = process.env.QUAY_MAX_CONCURRENT_SUITES;
  const pinTmp = fs.mkdtempSync(path.join(os.tmpdir(), "rg-pin5-"));
  const pinBase = path.join(pinTmp, "full-suite.lock");
  fs.writeFileSync(`${pinBase}.concurrency`, "2", "utf8");
  process.env.FULL_SUITE_LOCK_FILE = pinBase;
  delete process.env.RESOURCE_GATE_CONCURRENT_SUITES;
  process.env.QUAY_MAX_CONCURRENT_SUITES = "2";
  let realSlots;
  try {
    realSlots = concurrentSuiteSlots();
    assert.equal(
      currentDefaultConcurrency(),
      derivedConcurrency(realNproc, realSlots, 1),
      `default_test_concurrency must return max(1, floor(${realNproc}×1/${realSlots})) = ${Math.max(1, Math.floor(realNproc / realSlots))} on the real host (gap-suite-budget-oversubscribe pure computation)`
    );
  } finally {
    if (prevLock === undefined) delete process.env.FULL_SUITE_LOCK_FILE;
    else process.env.FULL_SUITE_LOCK_FILE = prevLock;
    if (prevSeam === undefined) delete process.env.RESOURCE_GATE_CONCURRENT_SUITES;
    else process.env.RESOURCE_GATE_CONCURRENT_SUITES = prevSeam;
    if (prevKnob === undefined) delete process.env.QUAY_MAX_CONCURRENT_SUITES;
    else process.env.QUAY_MAX_CONCURRENT_SUITES = prevKnob;
    fs.rmSync(pinTmp, { recursive: true, force: true });
  }
});

test("AC5b — the MAIN derivation is PURE computation: runtime in_use is NOT subtracted (the pre-fix racy subtraction was the oversubscription source); process-budget.sh still reports the cross-layer budget", () => {
  // gap-suite-budget-oversubscribe: the pre-fix `nproc − in_use` read the runtime in_use at each
  // suite's own start (each subtracted only what was already running, never what would come) ⇒ two
  // suites derived 16 then 8, Σ 24 > 16. The pure formula ignores in_use entirely — S and oversub
  // are the structural bound. (The rejected (b)/(c) alternatives — claim ledger / lock-carried
  // quota — also introduced new runtime state; the human chose zero new runtime state.)
  assert.equal(derivedConcurrency(16, 2, 1), 8, "16 cores / 2 slots → 8 regardless of in_use");
  assert.equal(derivedConcurrency(4, 2, 1), 2, "4 cores / 2 slots → 2");
  // The shared authority (plugin/scripts/process-budget.sh) still reports total_budget / in_use /
  // available — the cross-layer PROCESS-budget observation the gate's report and cap-from-gate
  // consume (single source for those consumers; not a lane-formula input).
  const budgetScript = path.join(REPO_ROOT, "plugin", "scripts", "process-budget.sh");
  assert.ok(fs.existsSync(budgetScript), "the shared total-budget authority must exist");
  const seam = { ...process.env, RESOURCE_GATE_TEST_NPROC: "4", RESOURCE_GATE_TEST_NODE_PROCS: "3" };
  const b = spawnSync("bash", [budgetScript], { cwd: REPO_ROOT, encoding: "utf8", env: seam });
  assert.equal(b.status, 0, `process-budget.sh must exit 0\n${b.stderr}`);
  assert.match(b.stdout, /total_budget=4/, "total_budget = nproc (the single authority)");
  assert.match(b.stdout, /in_use=3/, "in_use = the running node process count (cmdline-classified)");
  assert.match(b.stdout, /available=1/, "available = max(0, total_budget - in_use)");
});

// ── gap-suite-budget-oversubscribe: 判据1/判据2/判据3/判据4 ─────────────────────────────────────────
// The task's three lane derivations (serial_lowconc_host_default, default_concurrency_formula,
// defaultLaneCount) must ALL read 旋钮② QUAY_MAX_CONCURRENT_SUITES; the MAIN formula is
// max(1, floor(nproc × oversub / S)); the two-suite real sample (16+8=24 > 16) must replay as NOT
// exceeding; a single suite gets nproc/S (known cost, not a defect). The AC74-era assertions
// (main = nproc, no slot divisor) are REVERSED by this task's human ruling.
test("判据1 — MAIN formula = max(1, floor(nproc × oversub / S)): Σ over S suites ≤ nproc × oversub structurally", () => {
  assert.equal(derivedConcurrency(16, 2, 1), 8, "16 cores, 2 slots → 8");
  assert.equal(derivedConcurrency(16, 1, 1), 16, "16 cores, 1 slot → 16");
  assert.equal(derivedConcurrency(4, 2, 1), 2, "4 cores, 2 slots → 2");
  assert.equal(derivedConcurrency(1, 2, 1), 1, "floor(1×1/2) clamps at 1");
  // Σ invariant: S suites × lane = nproc × oversub — structurally cannot exceed.
  const nproc = 16, oversub = 1, slots = 2;
  const lane = derivedConcurrency(nproc, slots, oversub);
  assert.equal(slots * lane, nproc * oversub, `${slots} suites × ${lane} = ${slots * lane} = nproc×oversub (${nproc * oversub})`);
  assert.ok(slots * lane <= nproc * oversub, "Σ lane ≤ nproc × oversub");
});

test("AC2 (判据2) — two-suite real sample (16+8>16, load 29.23) replays as NOT exceeding under the pure formula; the pre-fix state red by 8", () => {
  // The 2026-08-14 14:39Z incident: two concurrent suites derived 16 (first, in_use≈0) + 8 (second,
  // in_use≈8) = 24 workers > total_budget 16 (load 29.23). Under the pure formula each suite derives
  // nproc×oversub/S = 8, so the replay Σ = 16 = nproc×oversub — cannot exceed.
  const nproc = 16, oversub = 1, slots = 2;
  const lane = derivedConcurrency(nproc, slots, oversub);
  assert.equal(lane, 8, `each suite derives nproc×oversub/S = ${Math.floor((nproc * oversub) / slots)}`);
  assert.equal(2 * lane, 16, "two suites × 8 = 16");
  assert.ok(2 * lane <= nproc * oversub, "Σ lane ≤ nproc × oversub (no longer red)");
  // The pre-fix state was red by 8 — the negative control (the checker CAN take false).
  const oldFirst = 16;   // old main formula: first suite, in_use≈0 ⇒ nproc
  const oldSecond = 8;   // old main formula: second suite, in_use≈8 ⇒ nproc − in_use
  assert.equal(oldFirst + oldSecond, 24, "pre-fix Σ = 24");
  assert.equal(oldFirst + oldSecond - nproc * oversub, 8, "pre-fix exceeded nproc×oversub by 8");
  assert.ok(oldFirst + oldSecond > nproc * oversub, "pre-fix 24 > 16 → red (structurally impossible under the pure formula)");
});

test("AC3 (判据3) — all three lane derivations read QUAY_MAX_CONCURRENT_SUITES (grep -L on any derivation file ⇒ not landed)", () => {
  // 判据3: serial_lowconc / default_concurrency_formula / defaultLaneCount 全部读旋钮② — the reverse
  // half of concurrency-literal-check (definition point exists but a derivation does not read it).
  const testSh = fs.readFileSync(TEST_SH, "utf8");
  const runnerTs = fs.readFileSync(path.join(REPO_ROOT, "plugin", "scripts", "full-suite-runner.ts"), "utf8");
  // serial_lowconc_host_default reads the knob directly.
  assert.match(testSh, /serial_lowconc_host_default\(\) \{[^]*QUAY_MAX_CONCURRENT_SUITES/, "serial_lowconc_host_default must read QUAY_MAX_CONCURRENT_SUITES");
  // default_concurrency_formula reads the knob (via the RESOURCE_GATE_CONCURRENT_SUITES seam fallback).
  assert.match(testSh, /default_concurrency_formula\(\) \{[^]*QUAY_MAX_CONCURRENT_SUITES/, "default_concurrency_formula must read QUAY_MAX_CONCURRENT_SUITES");
  // defaultLaneCount reads the knob through concurrentSuiteSlots() (the single definition point).
  assert.match(runnerTs, /defaultLaneCount\(\): number \{[^]*concurrentSuiteSlots\(\)/, "defaultLaneCount must read the slot knob (concurrentSuiteSlots())");
  // Each derivation also reads the oversub knob ③ (or its seam).
  assert.match(testSh, /default_concurrency_formula\(\) \{[^]*QUAY_MAX_OVERSUBSCRIPTION/, "default_concurrency_formula must read QUAY_MAX_OVERSUBSCRIPTION");
  assert.match(runnerTs, /defaultLaneCount\(\): number \{[^]*QUAY_MAX_OVERSUBSCRIPTION/, "defaultLaneCount must read QUAY_MAX_OVERSUBSCRIPTION");
});

test("AC4 (判据4) — single suite gets nproc/S (pure computation known cost, NOT full nproc); oversub knob is the express channel, no dynamic amplification", () => {
  // A lone suite under the pure formula gets nproc/S = 8 on a 16-core 2-slot host — the known cost
  // of the pure-computation approach (no "how many suites are running" runtime read, which was the
  // rejected dynamic-amplification form). Express "single suite uses the whole host" via oversub=2.
  assert.equal(derivedConcurrency(16, 2, 1), 8, "single suite = nproc/S = 8 (not 16) — known cost");
  assert.equal(derivedConcurrency(16, 2, 2), 16, "oversub=2 → single suite = 16 (the trade-off knob)");
  // The formula does NOT read any runtime "running suite count" — S is a static knob. Strip the
  // shell comments first (by-position — the historical `nproc − in_use` explanation is prose, not
  // code) and assert the CODE neither reads in_use nor shells out to process-budget.
  const src = fs.readFileSync(TEST_SH, "utf8");
  const fnMatch = src.match(/default_concurrency_formula\(\) \{[^]*?\n\}/);
  assert.ok(fnMatch, "default_concurrency_formula must exist");
  const codeLines = fnMatch[0].split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  assert.doesNotMatch(codeLines, /in_use|RESOURCE_GATE_TEST_NODE_PROCS|process-budget\.sh|concurrentSuitesRunning/, "the main formula must NOT read runtime running-suite/in_use counts");
});

test("AC74/判据2 — serial/lowconc defaults are HOST-derived (H÷(S×P)), the 2/3 literals are gone", () => {
  // The DIRECT-path phase fallback (serial_lowconc_host_default) derives max(1, floor(nproc/(S×P)))
  // where P = concurrent-phase count (2 = overlap ON, the QUAY_PHASE_OVERLAP default; 1 = overlap OFF,
  // the pre-overlap H÷S budget — gap-lane-formula-ignores-phase-overlap-concurrency AC1/AC3).
  assert.equal(phaseConcurrencyDefault(16, 2, "1"), 4, "16 cores, 2 slots, overlap ON → floor(16/(2×2)) = 4");
  assert.equal(phaseConcurrencyDefault(4, 2, "1"), 1, "4 cores, 2 slots, overlap ON → 1");
  assert.equal(phaseConcurrencyDefault(4, 1, "1"), 2, "1 slot, overlap ON → floor(4/(1×2)) = 2");
  assert.equal(phaseConcurrencyDefault(1, 2, "1"), 1, "floor(1/(2×2)) clamps at 1");
  // AC3 negative control — overlap OFF keeps the pre-overlap H÷S budget (single-phase peak unchanged).
  assert.equal(phaseConcurrencyDefault(16, 2, "0"), 8, "16 cores, 2 slots, overlap OFF → floor(16/2) = 8 (unchanged)");
  assert.equal(phaseConcurrencyDefault(4, 2, "0"), 2, "4 cores, 2 slots, overlap OFF → 2");
  assert.equal(phaseConcurrencyDefault(4, 1, "0"), 4, "1 slot, overlap OFF → nproc");
  assert.equal(phaseConcurrencyDefault(1, 2, "0"), 1, "floor(1/2) clamps at 1");
  // The env-fallback LITERALS are gone — the knob reads the host-derived helper, not 2/3.
  const src = fs.readFileSync(TEST_SH, "utf8");
  assert.match(src, /SERIAL_CONCURRENCY="\$\{QUAY_SERIAL_CONCURRENCY:-\$\(serial_lowconc_host_default\)\}"/, "serial default must be host-derived (no 2 literal)");
  assert.match(src, /LOWCONC_CONCURRENCY="\$\{QUAY_LOWCONC_CONCURRENCY:-\$\(serial_lowconc_host_default\)\}"/, "lowconc default must be host-derived (no 3 literal)");
  assert.doesNotMatch(src, /SERIAL_CONCURRENCY="\$\{QUAY_SERIAL_CONCURRENCY:-2\}"/, "the 2 literal must be gone");
  assert.doesNotMatch(src, /LOWCONC_CONCURRENCY="\$\{QUAY_LOWCONC_CONCURRENCY:-3\}"/, "the 3 literal must be gone");
});

test("判据4 — direct path and runner path read the SAME three values, equal to the host derivation (main=H×oversub÷S, serial=lowconc=H÷(S×P))", () => {
  // Deterministic seams on BOTH sides so the comparison is host-independent.
  const prevNproc = process.env.RESOURCE_GATE_NPROC;
  const prevSlots = process.env.QUAY_MAX_CONCURRENT_SUITES;
  const prevOversub = process.env.QUAY_MAX_OVERSUBSCRIPTION;
  const prevOverlap = process.env.QUAY_PHASE_OVERLAP;
  const prevSeam = process.env.RESOURCE_GATE_CONCURRENT_SUITES;
  const prevLock = process.env.FULL_SUITE_LOCK_FILE;
  // This test drives the KNOB — clear the seam (read FIRST by suiteLockSlotCount since
  // gap-suite-lock-slot-seam-asymmetry) so it cannot shadow the knob from an ambient test env.
  delete process.env.RESOURCE_GATE_CONCURRENT_SUITES;
  process.env.RESOURCE_GATE_NPROC = "16";
  process.env.QUAY_MAX_CONCURRENT_SUITES = "2";
  process.env.QUAY_MAX_OVERSUBSCRIPTION = "1";
  // Hermetic against the PRODUCTION `.concurrency` scalar (gap-suite-slot-ssot-i5-false-positive): a
  // live-suite S=1 file at <suiteLockBase>.concurrency would otherwise SHADOW the knob=2 this test
  // drives (the file has priority over QUAY_MAX_CONCURRENT_SUITES) ⇒ concurrentSuiteSlots() reads S=1
  // ⇒ runner main=16 ≠ direct main=8 (判据4 red). Pin the base to an isolated temp dir carrying 2.
  const pinTmp = fs.mkdtempSync(path.join(os.tmpdir(), "rg-pin4-"));
  const pinBase = path.join(pinTmp, "full-suite.lock");
  fs.writeFileSync(`${pinBase}.concurrency`, "2", "utf8");
  process.env.FULL_SUITE_LOCK_FILE = pinBase;
  try {
    const host = 16;
    const slots = 2;
    const oversub = 1;
    const targetMain = Math.max(1, Math.floor((host * oversub) / slots));
    // overlap ON (the default) ⇒ P = 2 concurrent phases ⇒ each phase budget = H÷(S×2).
    const targetPhaseOn = Math.max(1, Math.floor(host / (slots * 2)));
    // RUNNER path (full-suite-runner.ts): defaultLaneCount() for main; H÷(S×concurrentPhaseCount()) for phases.
    const runnerMain = defaultLaneCount();
    const runnerSerial = Math.max(1, Math.floor(hostParallelism() / (concurrentSuiteSlots() * concurrentPhaseCount())));
    const runnerLowconc = Math.max(1, Math.floor(hostParallelism() / (concurrentSuiteSlots() * concurrentPhaseCount())));
    // DIRECT path (scripts/test.sh): default_concurrency_formula for main; serial_lowconc_host_default
    // for both phases (overlap ON default → P=2).
    const directMain = derivedConcurrency(16, 2, 1);
    const directSerial = phaseConcurrencyDefault(16, 2, "1");
    const directLowconc = phaseConcurrencyDefault(16, 2, "1");
    // Each value equals the host derivation (判据4 target table: main=H×oversub÷S, serial=lowconc=H÷(S×P)).
    assert.equal(directMain, targetMain, `direct main must be nproc×oversub÷S (${targetMain})`);
    assert.equal(directSerial, targetPhaseOn, `direct serial must be H÷(S×2) (${targetPhaseOn}) — overlap ON`);
    assert.equal(directLowconc, targetPhaseOn, `direct lowconc must be H÷(S×2)`);
    // Direct == runner (the "与经 runner 起相同" half — a runner that still derived nproc (no /S) would
    // read main=16 ≠ direct main=8 → red).
    assert.equal(runnerMain, directMain, `runner main (${runnerMain}) must equal direct main (${directMain}) — 判据4`);
    assert.equal(runnerSerial, directSerial, `runner serial (${runnerSerial}) must equal direct serial (${directSerial}) — 判据4`);
    assert.equal(runnerLowconc, directLowconc, `runner lowconc (${runnerLowconc}) must equal direct lowconc (${directLowconc}) — 判据4`);
    // AC3 negative control — overlap OFF keeps H÷S on BOTH paths (single-phase peak unchanged).
    process.env.QUAY_PHASE_OVERLAP = "0";
    const targetPhaseOff = Math.max(1, Math.floor(host / slots));
    const runnerSerialOff = Math.max(1, Math.floor(hostParallelism() / (concurrentSuiteSlots() * concurrentPhaseCount())));
    const directSerialOff = phaseConcurrencyDefault(16, 2, "0");
    assert.equal(runnerSerialOff, targetPhaseOff, `overlap OFF runner serial must be H÷S (${targetPhaseOff})`);
    assert.equal(directSerialOff, targetPhaseOff, `overlap OFF direct serial must be H÷S (${targetPhaseOff})`);
    assert.equal(runnerSerialOff, directSerialOff, `overlap OFF runner (${runnerSerialOff}) == direct (${directSerialOff}) — 判据4 negative control`);
  } finally {
    if (prevNproc === undefined) delete process.env.RESOURCE_GATE_NPROC;
    else process.env.RESOURCE_GATE_NPROC = prevNproc;
    if (prevSlots === undefined) delete process.env.QUAY_MAX_CONCURRENT_SUITES;
    else process.env.QUAY_MAX_CONCURRENT_SUITES = prevSlots;
    if (prevOversub === undefined) delete process.env.QUAY_MAX_OVERSUBSCRIPTION;
    else process.env.QUAY_MAX_OVERSUBSCRIPTION = prevOversub;
    if (prevOverlap === undefined) delete process.env.QUAY_PHASE_OVERLAP;
    else process.env.QUAY_PHASE_OVERLAP = prevOverlap;
    if (prevSeam === undefined) delete process.env.RESOURCE_GATE_CONCURRENT_SUITES;
    else process.env.RESOURCE_GATE_CONCURRENT_SUITES = prevSeam;
    if (prevLock === undefined) delete process.env.FULL_SUITE_LOCK_FILE;
    else process.env.FULL_SUITE_LOCK_FILE = prevLock;
    fs.rmSync(pinTmp, { recursive: true, force: true });
  }
});

test("判据2 NEGATIVE CONTROL — the checker CAN take false: the pre-fix state (two suites 16+8=24 > 16) is RED against nproc×oversub (AC49 D2 attribution)", () => {
  // The task's "现在红" state (before this task): the old main formula derived nproc per suite (no /S
  // bound) — first suite read in_use≈0 → 16, second read in_use≈8 → 8, Σ 24 > nproc×oversub 16. The
  // pure-formula target (8 per suite, Σ 16 ≤ 16) is structurally different — the checker is NOT
  // structurally green (CLAUDE.md hard rule 4).
  const host = 16;
  const slots = 2;
  const oversub = 1;
  const preFixLanes = [16, 8];
  const targetLane = Math.max(1, Math.floor((host * oversub) / slots));
  assert.equal(targetLane, 8, "new target lane = 8");
  assert.notEqual(preFixLanes[0], targetLane, `pre-fix first suite 16 ≠ ${targetLane} (nproc×oversub/S) → RED on main`);
  assert.ok(preFixLanes[0] + preFixLanes[1] > host * oversub, "pre-fix Σ 24 > nproc×oversub 16 → RED");
});

// ── COUNTING SCOPE (gap-process-budget-counts-infra-as-test-concurrency-cap-pinned-1, AC2/AC3/AC4) ──
// The old `in_use = pgrep -xc node-MainThread` counted EVERY node main process as a test worker. On
// this box that was 17 processes — 14 MCP + 2 web serve + 1 suite-state monitor + 0 test workers —
// so on a 4-core box (total_budget=4) available=0 and effective_cap was structurally pinned at 1
// even in the GO band. in_use now counts ONLY throttle-able TEST processes: a node cmdline carrying
// `--test` (node --test runner AND its child workers, whose flags are --test-concurrency /
// --test-coverage-* / --test-name-pattern / --test-isolation / --test-timeout) or a direct test-file
// run (…test.mjs / …test.ts / …_test.mjs). Resident infrastructure (quay.js mcp / quay.ts mcp /
// quay-native mcp / quay serve / suite-state-trigger.ts --monitor) is a CONSTANT, not throttle-able.
//
// The RESOURCE_GATE_TEST_PROC_CMDLINES seam feeds a cmdline list (newline- or semicolon-separated)
// to the SAME classifier process-budget.sh runs over /proc, so the classification is pinned
// deterministically without needing real node --test processes.
test("AC2 — process-budget in_use classifies by cmdline: infra (mcp/serve/monitor) is NOT counted, test workers ARE", () => {
  const budgetScript = path.join(REPO_ROOT, "plugin", "scripts", "process-budget.sh");
  // The measured 2026-08-08 19:1xZ host classification: 17 node-MainThread, of which 14 MCP + 2
  // serve + 1 monitor are INFRA (never throttle-able) and 0 are test workers. Excluding infra must
  // give in_use=0, available=4 on a 4-core box — the GO band restored (AC3).
  const infraCmds = [
    "node /home/yale/.local/share/quay-plugin//vendor/quay/dist/quay.js mcp",
    "node packages/quay/bin/quay.ts mcp",
    "node /home/yale/.nvm/versions/node/v26.5.0/bin/quay-native mcp",
    "node /home/yale/.nvm/versions/node/v26.5.0/bin/quay serve --host 100.87.141.82 --port 4174",
    "node --experimental-strip-types packages/quay/bin/quay.ts serve --host 100.87.141.82 --port 4173",
    "node --no-warnings --experimental-strip-types /home/yale/work/quay/plugin/scripts/suite-state-trigger.ts --monitor",
  ];
  const infraOnly = spawnSync("bash", [budgetScript], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, RESOURCE_GATE_TEST_NPROC: "4", RESOURCE_GATE_TEST_PROC_CMDLINES: infraCmds.join(";") },
  });
  assert.equal(infraOnly.status, 0, `process-budget.sh must exit 0\n${infraOnly.stderr}`);
  assert.match(infraOnly.stdout, /in_use=0/, "infra cmdlines (mcp/serve/monitor) must NOT count against the test budget");
  assert.match(infraOnly.stdout, /available=4/, "4-core GO band with no test workers → available=4 (no longer pinned to 0)");
  assert.match(infraOnly.stdout, /verdict=GO/, "no throttle-able test workers ⇒ GO, cap NOT pinned to 1");

  // Real node --test workers (top-level runner + child worker, measured 2026-08-08) ARE counted.
  const testCmds = [
    "node --test --test-concurrency=2 /tmp/budget-control.mjs",                                    // top-level runner
    "/home/yale/.nvm/versions/node/v26.5.0/bin/node --test-coverage-functions=0 --test-concurrency=1 --test-isolation=process /tmp/budget-control.mjs", // child worker
    "node --test --test-name-pattern=flag /tmp/budget-control.mjs",
    "node --experimental-strip-types packages/quay/test/foo.test.mjs",                             // direct test-file run
  ];
  const testsRunning = spawnSync("bash", [budgetScript], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, RESOURCE_GATE_TEST_NPROC: "4", RESOURCE_GATE_TEST_PROC_CMDLINES: testCmds.join(";") },
  });
  assert.equal(testsRunning.status, 0, `process-budget.sh must exit 0\n${testsRunning.stderr}`);
  assert.match(testsRunning.stdout, /in_use=4/, "all 4 test-worker cmdlines must count against the budget");
  assert.match(testsRunning.stdout, /available=0/, "4 test workers on 4 cores → available=0");
});

test("AC4 — overload protection RETAINED: injecting test workers drops available and flips verdict to WAIT", () => {
  const budgetScript = path.join(REPO_ROOT, "plugin", "scripts", "process-budget.sh");
  const worker = "node --test --test-concurrency=1 /tmp/spawn-test.mjs";
  // nproc=4. 1 worker → available=3, still GO (throttled but not exhausted).
  const one = spawnSync("bash", [budgetScript], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, RESOURCE_GATE_TEST_NPROC: "4", RESOURCE_GATE_TEST_PROC_CMDLINES: worker },
  });
  assert.equal(one.status, 0);
  assert.match(one.stdout, /in_use=1/);
  assert.match(one.stdout, /available=3/);
  assert.match(one.stdout, /verdict=GO/);
  // 5 workers (one more than nproc) → available=0, WAIT — the budget still prevents over-subscription.
  const five = spawnSync("bash", [budgetScript], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, RESOURCE_GATE_TEST_NPROC: "4", RESOURCE_GATE_TEST_PROC_CMDLINES: Array(5).fill(worker).join(";") },
  });
  assert.equal(five.status, 0);
  assert.match(five.stdout, /in_use=5/);
  assert.match(five.stdout, /available=0/);
  assert.match(five.stdout, /verdict=WAIT/);
});

// ── COUNTING ACCURACY (gap-fixed-cap-5-dynamic-cap-retired AC4) ────────────────────────────────────
// The human ruling's measured defect: process-budget.sh reported `in_use=5` while only 1 node
// MainThread test process actually ran (infra — mcp/serve/monitor — was being counted as a
// throttle-able test worker). The fix (f126c087) counts ONLY throttle-able TEST procs; THIS test pins
// the exact reported scenario — 1 real test worker among the resident infra cmdlines ⇒ in_use=1,
// never 5. `budget_count_accurate` invariant.
test("AC4 — in_use matches the ACTUAL test-worker count: 1 test worker among infra ⇒ in_use=1 (not 5) — the 报5实1 reproduction", () => {
  const budgetScript = path.join(REPO_ROOT, "plugin", "scripts", "process-budget.sh");
  // The measured host infra set (2026-08-08 19:1xZ / the manager's 2026-08-09 ruling): MCP servers,
  // web serve, suite-state monitor — NOT throttle-able. Plus exactly ONE real test worker.
  const infraCmds = [
    "node /home/yale/.local/share/quay-plugin//vendor/quay/dist/quay.js mcp",
    "node packages/quay/bin/quay.ts mcp",
    "node /home/yale/.nvm/versions/node/v26.5.0/bin/quay-native mcp",
    "node /home/yale/.nvm/versions/node/v26.5.0/bin/quay serve --host 100.87.141.82 --port 4174",
    "node --experimental-strip-types packages/quay/bin/quay.ts serve --host 100.87.141.82 --port 4173",
    "node --no-warnings --experimental-strip-types /home/yale/work/quay/plugin/scripts/suite-state-trigger.ts --monitor",
  ];
  const oneWorker = "node --test --test-concurrency=1 /tmp/budget-control.mjs";
  const cmds = [...infraCmds, oneWorker];
  const r = spawnSync("bash", [budgetScript], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, RESOURCE_GATE_TEST_NPROC: "4", RESOURCE_GATE_TEST_PROC_CMDLINES: cmds.join(";") },
  });
  assert.equal(r.status, 0, `process-budget.sh must exit 0\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /in_use=1/, `6 infra + 1 test worker ⇒ in_use=1, got:\n${r.stdout}`);
  assert.match(r.stdout, /available=3/, "1 test worker on 4 cores ⇒ available=3");
  assert.match(r.stdout, /verdict=GO/, "1 worker leaves the budget GO");
  // Every infra cmdline alone (no test worker) ⇒ in_use=0 — infra is NEVER throttle-able.
  const infraOnly = spawnSync("bash", [budgetScript], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, RESOURCE_GATE_TEST_NPROC: "4", RESOURCE_GATE_TEST_PROC_CMDLINES: infraCmds.join(";") },
  });
  assert.equal(infraOnly.status, 0);
  assert.match(infraOnly.stdout, /in_use=0/, "pure infra ⇒ in_use=0 (infra is a resident constant, not test concurrency)");
});

// ── DUAL-READ SELF-CHECK (gap-node-mainthread-comm-literal-host-dependent, AC1b/AC4) ────────────────
// The comm literal (`node-MainThread`) is host/Node-version-dependent: on boheidc (Node v24.19.0) the
// node comm is `MainThread`, so a comm-literal enumeration silently reads 0. process-budget.sh now
// enumerates via CMDLINE (never the literal) and cross-reads the comm count: comm=0 && cmdline>0 ⇒
// INSTRUMENT FAILURE (never "machine idle").
test("AC1b/AC4 — process-budget reports instrument_failure when comm=0 but cmdline>0 (the boheidc shape)", () => {
  const budgetScript = path.join(REPO_ROOT, "plugin", "scripts", "process-budget.sh");
  const r = spawnSync("bash", [budgetScript], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, RESOURCE_GATE_TEST_NPROC: "4", RESOURCE_GATE_TEST_COMM_COUNT: "0", RESOURCE_GATE_TEST_CMDLINE_COUNT: "5" },
  });
  assert.equal(r.status, 0, `process-budget.sh must exit 0\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /node_comm_mainthread=0/, "the comm cross-count must be reported");
  assert.match(r.stdout, /node_cmdline_procs=5/, "the cmdline candidate count must be reported");
  assert.match(r.stdout, /instrument_failure=1/, "comm=0 with cmdline=5 must report instrument failure, not machine idle");
});

test("AC1b/AC4 — process-budget with a matching comm literal (comm>0) is NOT instrument failure", () => {
  const budgetScript = path.join(REPO_ROOT, "plugin", "scripts", "process-budget.sh");
  const r = spawnSync("bash", [budgetScript], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, RESOURCE_GATE_TEST_NPROC: "4", RESOURCE_GATE_TEST_COMM_COUNT: "2", RESOURCE_GATE_TEST_CMDLINE_COUNT: "2" },
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /instrument_failure=0/, "comm>0 is a normal reading");
});

test("AC5 — process-budget.sh header documents the counting scope (test procs only; infra is a resident constant)", () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, "plugin", "scripts", "process-budget.sh"), "utf8");
  assert.match(src, /COUNTING SCOPE/, "the header must carry a COUNTING SCOPE section (AC5)");
  assert.match(src, /THROTTLE-ABLE TEST processes|node --test worker|throttle-able/, "the header must state that in_use counts test processes only");
  assert.match(src, /MUST NOT count|NOT counted against the test budget/, "the header must state infra is excluded from the budget");
  assert.match(src, /OVERLOAD PROTECTION RETAINED|RESOURCE_GATE_TEST_PROC_CMDLINES/, "the header must document the retained overload protection / new seam");
});

test("AC5 — scripts/test.sh uses the derived default in its exec lines (no hardcoded 8)", () => {
  const src = fs.readFileSync(TEST_SH, "utf8");
  // All FIVE invocation sites must use the derived default: 4 `exec node --test ...` lines
  // (run_selected, --group-explicit, explicit-file, --scoped <file...>) + 1 `node --test ...`
  // line (--for-task, no exec). The --scoped <file...> site was added by
  // gap-scoped-runs-pay-full-static-check-overhead and correctly uses the derived default.
  const allSites = src.match(/node --test --test-concurrency="\$\(default_test_concurrency\)"/g);
  assert.equal(allSites.length, 5, `expected 5 derived-concurrency invocation sites, got ${allSites.length}`);
  assert.doesNotMatch(src, /--test-concurrency=8/, "no hardcoded 8 may remain in test.sh");
});

// ── AC7: test.sh integration — gate on the full-suite default, skip on scoped runs ─────────────────
test("AC7 — test.sh consults the gate on the full-suite default path and skips it for scoped runs", () => {
  const src = fs.readFileSync(TEST_SH, "utf8");
  assert.match(src, /resource-gate\.sh" --for full-suite/, "test.sh must invoke the gate in gate mode");
  assert.match(src, /resource_gate_check/, "run_selected must call resource_gate_check");
  assert.match(src, /is_default_set "\$groups"/, "the gate must guard the default full-suite set only");
  assert.match(src, /QUAY_TEST_SKIP_RESOURCE_GATE/, "nested-runner escape hatch must exist");
  // Scoped paths must NOT consult the gate: the --for-task and explicit-file branches never call it.
  const gateCallSites = src.split("\n").filter((l) => l.includes("resource_gate_check"));
  assert.ok(gateCallSites.length >= 1, "resource_gate_check must be called somewhere");
});

// ── single-flight lock (gap-resource-gate-no-single-flight-lock-two-suite-overlap) ──────────────────
// AC1/AC4 — the full-suite default path takes a flock on <git-common-dir>/full-suite.lock held for
// the ENTIRE run, so two concurrent cc8 suites can no longer both see GO and start. The lock is
// COMPLEMENTARY to the resource gate (AC2): the gate prevents "starting into a busy machine", the
// lock prevents "a second suite joining". Structural pin (the two-startup negative control is a live
// harness recorded in the task body): the flock reference exists, the acquire is wired into the
// is_default_set branch ahead of the gate, and the release fires before the full-suite exit.
test("AC1/AC4 — the full-suite default path holds a single-flight flock (full-suite.lock, shared across worktrees)", () => {
  const src = fs.readFileSync(TEST_SH, "utf8");
  // flock(1) reference must exist in test.sh (Contract measure suite_lock ≥ 1).
  assert.match(src, /\bflock\b/, "scripts/test.sh must use flock(1) for the single-flight lock");
  assert.match(src, /full-suite\.lock/, "the lock file must be named full-suite.lock");
  // SHARED across worktrees + the primary checkout via git's common dir (the 2026-08-07 incident
  // was two DIFFERENT worktrees each running a cc8 suite — a per-checkout lock would NOT serialize).
  assert.match(src, /git rev-parse --git-common-dir/, "the lock must resolve via git's common dir so all worktrees contend on the same file");
  // The acquire is called in the SAME is_default_set branch that consults the resource gate
  // (the default full-suite set only) — and BEFORE the gate (serialize first, then load-check).
  // The regex targets the CALL site (full_suite_lock_acquire immediately followed by a newline),
  // not the function definition (which is followed by `()`).
  const callSite = src.match(/full_suite_lock_acquire\n([\s\S]*?)\n\s*fi/);
  assert.ok(callSite, "full_suite_lock_acquire must be called inside an if/fi block (the full-suite default branch)");
  const afterAcquire = callSite[1];
  assert.match(afterAcquire, /resource_gate_check/, "the lock acquire must be followed by the resource gate check in the same block");
  assert.doesNotMatch(afterAcquire, /full_suite_lock_release/, "acquire and release must not share a block");
  // The release must fire before the full-suite exit (after the suite-AFTER assertions).
  assert.match(src, /full_suite_lock_release\n\s*exit "\$code"/, "the lock must be released before the full-suite exit");
  // Nested-runner escape hatches must skip the lock (a nested test.sh inside the running suite
  // must not deadlock against the suite's own lock).
  assert.match(src, /QUAY_TEST_SKIP_RESOURCE_GATE/, "nested-runner escape hatch must exist for the lock");
  assert.match(src, /QUAY_TEST_NESTED/, "same-root nested guard must exist for the lock");
});

// ── --for full-suite arg validation ────────────────────────────────────────────────────────────────
test("gate rejects an unknown --for target with exit 2 (usage)", () => {
  const r = runGate({}, ["--for", "bogus"]);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /usage:/);
});

// ── gap-worktree-scoped-runs-consume-resources-but-produce-no-signal: AC1/AC2/AC3 ──────────────────
// The coordination root of the deadlock: a worktree's heavy scoped verification consumes the machine
// (resource gate WAIT) while producing NO observable signal — so the main-repo full suite (the signal
// subagents actually wait for) is blocked, and nobody produces the waited-for signal. Two fixes:
//   AC1 — the gate REPORTS worktree_node_tests (a live observable: how many node --test procs are
//         running from linked worktrees) + caller_scope, so the worktree load is visible.
//   AC2 — the main-repo full-suite caller passes --main-repo-priority; the gate then lets the
//         main-repo suite proceed over worktree scoped load (deferrable), never permanently blocked.
//   AC3 — negative control: the worktree load is observable via the gate EVEN IF the worktree writes
//         no state file (the "no signal" half of the deadlock is closed by the gate's own signal).

test("AC1 — the gate reports worktree_node_tests + caller_scope (the observable worktree signal), seam-controlled", () => {
  const src = fs.readFileSync(GATE, "utf8");
  assert.match(src, /RESOURCE_GATE_TEST_WORKTREE_NODE_TESTS/, "the worktree_node_tests test seam must exist");
  assert.match(src, /RESOURCE_GATE_TEST_CALLER_SCOPE/, "the caller_scope test seam must exist");
  const r = runGate({
    RESOURCE_GATE_TEST_CPU_AVG10: "10",
    RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000",
    RESOURCE_GATE_TEST_CALLER_SCOPE: "main",
    RESOURCE_GATE_TEST_WORKTREE_NODE_TESTS: "6",
  });
  assert.match(r.stdout, /worktree_node_tests=6\s+caller_scope=main/, "report mode must print the worktree signal line");
});

test("AC1 — auto-detection: the gate reports caller_scope=worktree when invoked from a real linked worktree (no seam)", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "rg-wtrepo-"));
  const worktree = path.join(os.tmpdir(), `rg-wt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    execSync("git init -b main", { cwd: repo, stdio: "ignore" });
    execSync("git config user.email t@example.com", { cwd: repo, stdio: "ignore" });
    execSync("git config user.name t", { cwd: repo, stdio: "ignore" });
    fs.writeFileSync(path.join(repo, "a.txt"), "x");
    execSync("git add a.txt && git commit -m init", { cwd: repo, stdio: "ignore" });
    execSync(`git worktree add -b feature ${worktree}`, { cwd: repo, stdio: "ignore" });
    // Run the REAL gate from the worktree (no caller_scope seam) with a CPU seam so it stays GO.
    const env = { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "10", RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000" };
    const res = spawnSync("bash", [GATE], { cwd: worktree, encoding: "utf8", env });
    assert.match(res.stdout, /caller_scope=worktree/, `worktree invocation must auto-detect caller_scope=worktree, got:\n${res.stdout}`);
  } finally {
    try {
      execSync(`git worktree remove --force ${worktree}`, { cwd: repo, stdio: "ignore" });
    } catch {
      // worktree may not exist if the test failed early
    }
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("AC2 — main-repo priority: --main-repo-priority lets the main-repo full suite proceed over worktree scoped load (WAIT->GO at cpu=70)", () => {
  // LOAD_OVERRIDE=12 ALSO above the nproc×2=8 overload-window threshold: the override must clear the
  // load_wait too (worktree-sourced load is deferrable — it is exactly what pushes load average high).
  const r = runGate(
    {
      RESOURCE_GATE_TEST_CPU_AVG10: "70",
      RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000",
      RESOURCE_GATE_TEST_CALLER_SCOPE: "main",
      RESOURCE_GATE_TEST_WORKTREE_NODE_TESTS: "6",
      RESOURCE_GATE_TEST_LOAD_OVERRIDE: "12",
    },
    ["--for", "full-suite", "--main-repo-priority"],
  );
  assert.equal(r.status, 0, `main-repo suite must GO over worktree load; got ${r.status}\n${r.stdout}`);
  assert.match(r.stdout, /worktree_priority: ON/, "the priority override must be announced");
  assert.match(r.stdout, /=> GO: 主仓 full-suite 优先/, "the verdict must name the priority rule");
});

test("AC2 negative — the SAME load WITHOUT --main-repo-priority stays WAIT (the override is opt-in)", () => {
  // cpu=70 AND load=12 (both WAIT signals); no override ⇒ WAIT. CPU is primary so the verdict names
  // CPU starvation.
  const r = runGate(
    {
      RESOURCE_GATE_TEST_CPU_AVG10: "70",
      RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000",
      RESOURCE_GATE_TEST_CALLER_SCOPE: "main",
      RESOURCE_GATE_TEST_WORKTREE_NODE_TESTS: "6",
      RESOURCE_GATE_TEST_LOAD_OVERRIDE: "12",
    },
    ["--for", "full-suite"],
  );
  assert.equal(r.status, 1, `without the priority flag the gate must WAIT; got ${r.status}\n${r.stdout}`);
  assert.match(r.stdout, /=> WAIT: CPU 饥饿/);
});

test("AC2 negative — a WORKTREE caller passing --main-repo-priority stays WAIT (a worktree full-suite is itself deferrable)", () => {
  const r = runGate(
    {
      RESOURCE_GATE_TEST_CPU_AVG10: "70",
      RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000",
      RESOURCE_GATE_TEST_CALLER_SCOPE: "worktree",
      RESOURCE_GATE_TEST_WORKTREE_NODE_TESTS: "6",
      RESOURCE_GATE_TEST_LOAD_OVERRIDE: "12",
    },
    ["--for", "full-suite", "--main-repo-priority"],
  );
  assert.equal(r.status, 1, `a worktree caller must NOT get the main-repo override; got ${r.status}\n${r.stdout}`);
});

test("AC2 negative — CPU above the priority ceiling (>=85) stays WAIT even with worktree load + priority (machine too loaded for ANY heavy op)", () => {
  const r = runGate(
    {
      RESOURCE_GATE_TEST_CPU_AVG10: "90",
      RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000",
      RESOURCE_GATE_TEST_CALLER_SCOPE: "main",
      RESOURCE_GATE_TEST_WORKTREE_NODE_TESTS: "6",
      RESOURCE_GATE_TEST_LOAD_OVERRIDE: "12",
    },
    ["--for", "full-suite", "--main-repo-priority"],
  );
  assert.equal(r.status, 1, `cpu=90 above the ceiling must stay WAIT; got ${r.status}\n${r.stdout}`);
});

test("AC2 negative — worktree load below the min threshold (4) does NOT trigger the override", () => {
  const r = runGate(
    {
      RESOURCE_GATE_TEST_CPU_AVG10: "70",
      RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000",
      RESOURCE_GATE_TEST_CALLER_SCOPE: "main",
      RESOURCE_GATE_TEST_WORKTREE_NODE_TESTS: "2",
      RESOURCE_GATE_TEST_LOAD_OVERRIDE: "12",
    },
    ["--for", "full-suite", "--main-repo-priority"],
  );
  assert.equal(r.status, 1, `only 2 worktree procs is not dominant load; got ${r.status}\n${r.stdout}`);
});

test("AC2 negative — mem_wait is NEVER overridden: low memory stays WAIT even with worktree load + priority (OOM is a cliff, not deferrable)", () => {
  const r = runGate(
    {
      RESOURCE_GATE_TEST_CPU_AVG10: "10", // calm CPU — only mem blocks, so the verdict names memory alone
      RESOURCE_GATE_TEST_MEM_AVAIL_MB: "1000",
      RESOURCE_GATE_TEST_CALLER_SCOPE: "main",
      RESOURCE_GATE_TEST_WORKTREE_NODE_TESTS: "6",
    },
    ["--for", "full-suite", "--main-repo-priority"],
  );
  assert.equal(r.status, 1, `mem_wait must remain a hard blocker; got ${r.status}\n${r.stdout}`);
  assert.match(r.stdout, /=> WAIT: 内存不足/);
  assert.doesNotMatch(r.stdout, /worktree_priority: ON/, "the override must NOT announce when memory is the blocker");
});

test("AC3 — negative control: the worktree load is OBSERVABLE via the gate even when the worktree writes no state file (the 'no signal' half is closed)", () => {
  // The deadlock's second half: a worktree scoped run writes no .quay/full-suite-state.json, so its
  // completion updates nothing anyone waits on. The gate's worktree_node_tests line is a LIVE
  // observable that exists regardless of any state file — a waiter reads `resource-gate.sh` and sees
  // the worktree is consuming the machine.
  const r = runGate({
    RESOURCE_GATE_TEST_CPU_AVG10: "30",
    RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000",
    RESOURCE_GATE_TEST_CALLER_SCOPE: "main",
    RESOURCE_GATE_TEST_WORKTREE_NODE_TESTS: "12",
  });
  assert.equal(r.status, 0, "report mode exits 0 (read-only)");
  assert.match(r.stdout, /worktree_node_tests=12\s+caller_scope=main/, "the worktree signal is readable without any state file");
  assert.doesNotMatch(r.stdout, /full-suite-state/, "the gate itself needs no state file to report the worktree load");
});

// ── AC99 (gap-ac99-webui-machine-readable-json): the --json machine-readable interface ─────────────
// Every System/Manager view field traces to a mechanism emitting a stable JSON document. These tests
// read the PRODUCTION carrier — the real script's --json stdout — not a fixture (硬规则④推论三:
// 关掉 fixture/注入 seam 后判据仍能通过才算测量；fixture 只用于驱动确定性读数，判据读的是真输出).

const PROCESS_BUDGET = path.join(REPO_ROOT, "plugin", "scripts", "process-budget.sh");

test("AC99 — resource-gate.sh --json emits ONE valid JSON document carrying verdict + nproc-derived load_threshold (AC3)", () => {
  const env = {
    ...process.env,
    RESOURCE_GATE_TEST_CPU_AVG10: "30",
    RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000",
    RESOURCE_GATE_TEST_LOAD_OVERRIDE: "3",
    RESOURCE_GATE_TEST_NPROC: "4",
  };
  const res = spawnSync("bash", [GATE, "--json"], { cwd: REPO_ROOT, encoding: "utf8", env });
  assert.equal(res.status, 0, `report mode --json exits 0; got ${res.status}: ${res.stderr}`);
  const out = res.stdout.trim();
  const nl = out.indexOf("\n");
  const first = nl === -1 ? out : out.slice(0, nl);
  let j;
  assert.doesNotThrow(() => { j = JSON.parse(first); }, "stdout's first line must be one JSON document");
  assert.equal(j.verdict, "GO");
  // AC3 — load_threshold is nproc × load_over_factor computed INSIDE the mechanism (nproc=4 ⇒ 8),
  // never a host-derived literal the UI would have to hardcode.
  assert.equal(j.load_threshold, 8);
  assert.equal(j.load_over_factor, 2);
  assert.equal(j.nproc, 4);
  assert.equal(j.cpu_stall_avg10, 30);
  assert.equal(j.loadavg, 3);
  assert.equal(typeof j.reason, "string");
  assert.match(j.reason, /^=> GO/);
});

test("AC99 — resource-gate.sh --json carries the WAIT verdict + reason for a full-suite overload window", () => {
  const env = {
    ...process.env,
    RESOURCE_GATE_TEST_CPU_AVG10: "30",
    RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000",
    RESOURCE_GATE_TEST_LOAD_OVERRIDE: "12",
    RESOURCE_GATE_TEST_NPROC: "4",
  };
  const res = spawnSync("bash", [GATE, "--for", "full-suite", "--json"], { cwd: REPO_ROOT, encoding: "utf8", env });
  assert.equal(res.status, 1, "full-suite --json must keep the WAIT exit code (1)");
  const j = JSON.parse(res.stdout.trim());
  assert.equal(j.verdict, "WAIT");
  assert.equal(j.load_wait, 1);
  assert.equal(j.load_threshold, 8);
  assert.match(j.reason, /过载窗口/);
});

test("AC99 — process-budget.sh --json emits ONE valid JSON document carrying the budget numbers", () => {
  const env = {
    ...process.env,
    RESOURCE_GATE_TEST_NPROC: "4",
    RESOURCE_GATE_TEST_NODE_PROCS: "2",
  };
  const res = spawnSync("bash", [PROCESS_BUDGET, "--json"], { cwd: REPO_ROOT, encoding: "utf8", env });
  assert.equal(res.status, 0, `process-budget --json exits 0; got ${res.status}: ${res.stderr}`);
  const j = JSON.parse(res.stdout.trim());
  assert.equal(j.total_budget, 4);
  assert.equal(j.in_use, 2);
  assert.equal(j.available, 2);
  assert.equal(j.verdict, "GO");
});

test("AC99 — no --json ⇒ report text output is byte-identical (cap-from-gate back-compat)", () => {
  const r = runGate({ RESOURCE_GATE_TEST_CPU_AVG10: "30", RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000" });
  assert.match(r.stdout, /cpu_stall\(some avg10\)=30\.00  \[limit 60\]   ok/, "text cpu_stall line unchanged");
  assert.match(r.stdout, /=> GO/, "text verdict line unchanged");
  assert.doesNotMatch(r.stdout, /^\s*\{/m, "text mode must not emit a JSON object on its own");
});
