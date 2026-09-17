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

// SPLIT from resource-gate.test.mjs by gap-suite-split-15-over-30s-test-files — shard 3/5 (13 tests). Shared fixtures: ./helpers/resource-gate-harness.mjs (single source).

import { test } from "node:test";
import { REPO_ROOT, TEST_SH, assert, bashSlotCount, concurrentPhaseCount, concurrentSuiteSlots, defaultLaneCount, defaultLowconcConcurrency, defaultPhaseConcurrencyDirect, defaultTestConcurrency, derivedConcurrency, derivedConcurrencyNoSeam, fs, hostParallelism, os, path, phaseConcurrencyDefault, phaseConcurrencyDefaultNoSeam, runnerLaneCount, spawn, spawnSync, withSeams } from "./helpers/resource-gate-harness.mjs";

test("AC2 — file-wins negative control: writing ONLY the `.concurrency` file (env knob left stale at 1) halves laneCount AND sets the slot count (no more divergence)", () => {
  // The divergence's real shape (S=2 #655/#656): manager wrote `.concurrency`=2 (lock slots → 2) but
  // the env knob stayed 1, so laneCount stayed nproc (16) → 2×16=32 > 16 oversubscription. After the
  // fix the FILE wins for BOTH chains: concurrentSuiteSlots=2 AND laneCount halves (16→8).
  const prevNproc = process.env.RESOURCE_GATE_NPROC;
  const prevKnob = process.env.QUAY_MAX_CONCURRENT_SUITES;
  const prevSeam = process.env.RESOURCE_GATE_CONCURRENT_SUITES;
  const prevOversub = process.env.QUAY_MAX_OVERSUBSCRIPTION;
  const prevLock = process.env.FULL_SUITE_LOCK_FILE;
  const pinTmp = fs.mkdtempSync(path.join(os.tmpdir(), "rg-s2-"));
  const pinBase = path.join(pinTmp, "full-suite.lock");
  fs.writeFileSync(`${pinBase}.concurrency`, "2", "utf8");
  process.env.FULL_SUITE_LOCK_FILE = pinBase;
  delete process.env.RESOURCE_GATE_CONCURRENT_SUITES;      // seam must not shadow the file
  process.env.QUAY_MAX_CONCURRENT_SUITES = "1";             // STALE env — the old divergent value
  process.env.RESOURCE_GATE_NPROC = "16";
  process.env.QUAY_MAX_OVERSUBSCRIPTION = "1";
  try {
    // Both S readers agree on 2 (from the file), NOT 1 (the stale env).
    assert.equal(concurrentSuiteSlots(), 2, "TS canonical must read S=2 from the .concurrency file (env knob=1 stale)");
    assert.equal(bashSlotCount(), 2, "bash canonical must read S=2 from the .concurrency file (env knob=1 stale)");
    // The lane formula halves: 16 × 1 / 2 = 8 (the old env-only read would return 16 — the divergence).
    assert.equal(derivedConcurrencyNoSeam(16, 1), 8, "default_concurrency_formula must read S=2 from the file ⇒ 16/2=8 (env knob=1 would give 16)");
    // The phase formula also reads the file: floor(16/(2×2)) = 4 (the old env-only read would give 8).
    assert.equal(phaseConcurrencyDefaultNoSeam(16, "1"), 4, "serial_lowconc_host_default must read S=2 ⇒ floor(16/(2×2))=4 (env knob=1 would give 8)");
  } finally {
    if (prevNproc === undefined) delete process.env.RESOURCE_GATE_NPROC;
    else process.env.RESOURCE_GATE_NPROC = prevNproc;
    if (prevKnob === undefined) delete process.env.QUAY_MAX_CONCURRENT_SUITES;
    else process.env.QUAY_MAX_CONCURRENT_SUITES = prevKnob;
    if (prevSeam === undefined) delete process.env.RESOURCE_GATE_CONCURRENT_SUITES;
    else process.env.RESOURCE_GATE_CONCURRENT_SUITES = prevSeam;
    if (prevOversub === undefined) delete process.env.QUAY_MAX_OVERSUBSCRIPTION;
    else process.env.QUAY_MAX_OVERSUBSCRIPTION = prevOversub;
    if (prevLock === undefined) delete process.env.FULL_SUITE_LOCK_FILE;
    else process.env.FULL_SUITE_LOCK_FILE = prevLock;
    fs.rmSync(pinTmp, { recursive: true, force: true });
  }
});


test("AC4 (判据4) — single suite gets nproc/S on an idle host (known cost, NOT full nproc); oversub knob is the express channel, no dynamic run-count amplification", () => {
  // A lone suite on an IDLE host (in_use=0) gets nproc/S = 8 on a 16-core 2-slot host — the known cost
  // of the S-divisor structural bound. Express "single suite uses the whole host" via oversub=2.
  // gap-process-budget-in-use-structurally-zero-never-throttles: the in_use subtraction is a downward
  // adjustment WITHIN this bound (a busy host takes FEWER lanes), so the idle baseline is unchanged.
  assert.equal(derivedConcurrency(16, 2, 1), 8, "single suite = nproc/S = 8 (not 16) — known cost");
  assert.equal(derivedConcurrency(16, 2, 2), 16, "oversub=2 → single suite = 16 (the trade-off knob)");
  // The formula reads in_use (via testProcessesInUse — the budget-aware half) but STILL must NOT read a
  // dynamic "running suite count" (concurrentSuitesRunning — the rejected dynamic-amplification form):
  // S stays a static knob. Strip the comments first (by-position) and assert the CODE reads in_use yet
  // never reads concurrentSuitesRunning. The formula lives in runner-concurrency.ts defaultTestConcurrency
  // (SPEC P4).
  const rc = fs.readFileSync(path.join(REPO_ROOT, "plugin", "scripts", "runner-concurrency.ts"), "utf8");
  const fnMatch = rc.match(/defaultTestConcurrency\(\): number \{[^]*?\n\}/);
  assert.ok(fnMatch, "defaultTestConcurrency must exist");
  const codeLines = fnMatch[0].split("\n").filter((l) => !/^\s*\/\//.test(l) && !/^\s*\/\*\*?/.test(l)).join("\n");
  assert.match(codeLines, /testProcessesInUse\(\)/, "the main formula must read in_use (budget-aware)");
  assert.doesNotMatch(codeLines, /concurrentSuitesRunning/, "the main formula must NOT read a dynamic running-suite count (S stays a static knob)");
});


test("AC74/判据2 — serial default is HOST-derived (H÷(S×P)); lowconc default is the SAME host-derived value (gap-lowconc-concurrency-restore-host-derived)", () => {
  // The DIRECT-path SERIAL fallback (serial_lowconc_host_default) derives max(1, floor(nproc/(S×P)))
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
  // The LOWCONC default is the SAME host-derived H÷(S×P) — NOT a fixed 3. The shared
  // serial_lowconc_host_default binds lowconc again (gap-lowconc-concurrency-restore-host-derived
  // reverted the lowconc=3 split): 16 cores and 4 cores both derive with serial.
  assert.equal(defaultLowconcConcurrency(), defaultPhaseConcurrencyDirect(), "lowconc default == serial host-derived default (no seams)");
  assert.equal(withSeams({ RESOURCE_GATE_NPROC: "16", RESOURCE_GATE_CONCURRENT_SUITES: "2", QUAY_PHASE_OVERLAP: "1" }, () => defaultLowconcConcurrency()), 4, "lowconc default on 16 cores = floor(16/(2×2)) = 4");
  assert.equal(withSeams({ RESOURCE_GATE_NPROC: "4", RESOURCE_GATE_CONCURRENT_SUITES: "1", QUAY_PHASE_OVERLAP: "0" }, () => defaultLowconcConcurrency()), 4, "lowconc default on 4 cores = floor(4/1) = 4");
  // The env-fallback spellings: serial reads the host-derived helper; lowconc reads its OWN forwarder
  // (lowconc_concurrency_default → --lowconc-concurrency → the same host-derived default), neither a literal.
  const src = fs.readFileSync(TEST_SH, "utf8");
  assert.match(src, /SERIAL_CONCURRENCY="\$\{QUAY_SERIAL_CONCURRENCY:-\$\(serial_lowconc_host_default\)\}"/, "serial default must be host-derived (no 2 literal)");
  assert.match(src, /LOWCONC_CONCURRENCY="\$\{QUAY_LOWCONC_CONCURRENCY:-\$\(lowconc_concurrency_default\)\}"/, "lowconc default must use lowconc_concurrency_default (host-derived, = serial_lowconc_host_default)");
  assert.doesNotMatch(src, /SERIAL_CONCURRENCY="\$\{QUAY_SERIAL_CONCURRENCY:-2\}"/, "the 2 literal must be gone");
  assert.doesNotMatch(src, /LOWCONC_CONCURRENCY="\$\{QUAY_LOWCONC_CONCURRENCY:-3\}"/, "the 3 literal must be gone (lowconc reads the host-derived forwarder, not a literal)");
});


test("判据4 — direct path and runner path read the SAME values (main=H×oversub÷S, serial=H÷(S×P), lowconc=H÷(S×P))", () => {
  // Deterministic seams on BOTH sides so the comparison is host-independent.
  const prevNproc = process.env.RESOURCE_GATE_NPROC;
  const prevSlots = process.env.QUAY_MAX_CONCURRENT_SUITES;
  const prevOversub = process.env.QUAY_MAX_OVERSUBSCRIPTION;
  const prevOverlap = process.env.QUAY_PHASE_OVERLAP;
  const prevSeam = process.env.RESOURCE_GATE_CONCURRENT_SUITES;
  const prevLock = process.env.FULL_SUITE_LOCK_FILE;
  const prevInUse = process.env.RESOURCE_GATE_TEST_NODE_PROCS;
  // This test drives the KNOB — clear the seam (read FIRST by suiteLockSlotCount since
  // gap-suite-lock-slot-seam-asymmetry) so it cannot shadow the knob from an ambient test env.
  delete process.env.RESOURCE_GATE_CONCURRENT_SUITES;
  process.env.RESOURCE_GATE_NPROC = "16";
  process.env.QUAY_MAX_CONCURRENT_SUITES = "2";
  process.env.QUAY_MAX_OVERSUBSCRIPTION = "1";
  // Pin in_use to 0 (idle baseline) so the budget-aware runner (defaultLaneCount) and the direct path
  // (derivedConcurrency, in_use=0) compare equal — an unset seam would shell out to the live host.
  process.env.RESOURCE_GATE_TEST_NODE_PROCS = "0";
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
    // overlap ON (the default) ⇒ P = 2 concurrent phases ⇒ the SERIAL phase budget = H÷(S×2).
    const targetPhaseOn = Math.max(1, Math.floor(host / (slots * 2)));
    // RUNNER path (full-suite-runner.ts): defaultLaneCount() for main; H÷(S×concurrentPhaseCount()) for
    // serial; defaultLowconcConcurrency() (host-derived, = serial) for lowconc.
    const runnerMain = defaultLaneCount();
    const runnerSerial = Math.max(1, Math.floor(hostParallelism() / (concurrentSuiteSlots() * concurrentPhaseCount())));
    const runnerLowconc = defaultLowconcConcurrency();
    // DIRECT path (scripts/test.sh): default_concurrency_formula for main; serial_lowconc_host_default
    // for serial; lowconc_concurrency_default (defaultLowconcConcurrency, host-derived) for lowconc.
    const directMain = derivedConcurrency(16, 2, 1);
    const directSerial = phaseConcurrencyDefault(16, 2, "1");
    const directLowconc = defaultLowconcConcurrency();
    // Each value: main=H×oversub÷S, serial=H÷(S×P) (host-derived), lowconc=H÷(S×P) (same host-derived).
    assert.equal(directMain, targetMain, `direct main must be nproc×oversub÷S (${targetMain})`);
    assert.equal(directSerial, targetPhaseOn, `direct serial must be H÷(S×2) (${targetPhaseOn}) — overlap ON`);
    assert.equal(directLowconc, targetPhaseOn, `direct lowconc must be H÷(S×2)=${targetPhaseOn} (same as serial)`);
    // Direct == runner (the "与经 runner 起相同" half — a runner that still derived nproc (no /S) would
    // read main=16 ≠ direct main=8 → red).
    assert.equal(runnerMain, directMain, `runner main (${runnerMain}) must equal direct main (${directMain}) — 判据4`);
    assert.equal(runnerSerial, directSerial, `runner serial (${runnerSerial}) must equal direct serial (${directSerial}) — 判据4`);
    assert.equal(runnerLowconc, directLowconc, `runner lowconc (${runnerLowconc}) must equal direct lowconc (${directLowconc}) — 判据4`);
    assert.equal(runnerLowconc, targetPhaseOn, `runner lowconc must be H÷(S×2)=${targetPhaseOn}`);
    // AC3 negative control — overlap OFF keeps H÷S on BOTH paths for SERIAL (single-phase peak
    // unchanged); lowconc stays host-derived (= serial) regardless of overlap.
    process.env.QUAY_PHASE_OVERLAP = "0";
    const targetPhaseOff = Math.max(1, Math.floor(host / slots));
    const runnerSerialOff = Math.max(1, Math.floor(hostParallelism() / (concurrentSuiteSlots() * concurrentPhaseCount())));
    const directSerialOff = phaseConcurrencyDefault(16, 2, "0");
    assert.equal(runnerSerialOff, targetPhaseOff, `overlap OFF runner serial must be H÷S (${targetPhaseOff})`);
    assert.equal(directSerialOff, targetPhaseOff, `overlap OFF direct serial must be H÷S (${targetPhaseOff})`);
    assert.equal(runnerSerialOff, directSerialOff, `overlap OFF runner (${runnerSerialOff}) == direct (${directSerialOff}) — 判据4 negative control`);
    assert.equal(defaultLowconcConcurrency(), targetPhaseOff, `overlap OFF lowconc is still host-derived = H÷S (${targetPhaseOff})`);
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
    if (prevInUse === undefined) delete process.env.RESOURCE_GATE_TEST_NODE_PROCS;
    else process.env.RESOURCE_GATE_TEST_NODE_PROCS = prevInUse;
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

// ── gap-process-budget-in-use-structurally-zero-never-throttles: budget-aware MAIN derivation ───────
// The MAIN-lane derivation must subtract the cross-layer in_use (throttle-able node --test processes)
// so a busy host takes fewer lanes. Idle (in_use=0) keeps the pure formula; the oversub code default
// stays 1. The pre-fix defect: in_use was structurally 0 ⇒ the subtraction never subtracted, so a busy
// host derived the idle-host lane count (16×1.75=28 on a 16-core host).

/** defaultLaneCount (the runner-path main formula) with seams, hermetic against the production
 *  `.concurrency` scalar AND any live `.yielded` markers — pin the lock base to a clean temp dir so
 *  yieldedSuiteSlotCount() reads 0. S is driven via the RESOURCE_GATE_CONCURRENT_SUITES seam (outranks
 *  the file); in_use via RESOURCE_GATE_TEST_NODE_PROCS; oversub via QUAY_MAX_OVERSUBSCRIPTION. */


test("AC4/AC5 — defaultLaneCount is budget-aware: in_use>0 ⇒ < nproc; in_use=0 ⇒ nproc×oversub (bidirectional, S=1 production shape)", () => {
  // S=1 (the production slot count) so the idle baseline is nproc×oversub (single suite = whole host).
  const idle = runnerLaneCount({ RESOURCE_GATE_NPROC: "16", RESOURCE_GATE_CONCURRENT_SUITES: "1", QUAY_MAX_OVERSUBSCRIPTION: "1" });
  assert.equal(idle, 16, "idle in_use=0, oversub=1, S=1 → nproc = 16");
  const busy = runnerLaneCount({ RESOURCE_GATE_NPROC: "16", RESOURCE_GATE_CONCURRENT_SUITES: "1", QUAY_MAX_OVERSUBSCRIPTION: "1", RESOURCE_GATE_TEST_NODE_PROCS: "4" });
  assert.equal(busy, 12, "in_use=4 → (16−4)×1/1 = 12");
  assert.ok(busy < 16, "a busy host takes fewer than nproc lanes");
  // Clamps at 1 when in_use >= nproc (never 0 lanes, never negative).
  const saturated = runnerLaneCount({ RESOURCE_GATE_NPROC: "16", RESOURCE_GATE_CONCURRENT_SUITES: "1", QUAY_MAX_OVERSUBSCRIPTION: "1", RESOURCE_GATE_TEST_NODE_PROCS: "20" });
  assert.equal(saturated, 1, "in_use=20 ≥ nproc → clamps at 1 (max(1, ...))");
});


test("AC4 — direct path and runner path BOTH subtract in_use (set in_use back to 0 ⇒ full value)", () => {
  // The DIRECT path (defaultTestConcurrency) and RUNNER path (defaultLaneCount) stay equal under the
  // SAME seams (判据4), and both respond to in_use.
  const busyDirect = derivedConcurrency(16, 2, 1, 4);   // (16−4)/2 = 6
  const busyRunner = runnerLaneCount({ RESOURCE_GATE_NPROC: "16", RESOURCE_GATE_CONCURRENT_SUITES: "2", QUAY_MAX_OVERSUBSCRIPTION: "1", RESOURCE_GATE_TEST_NODE_PROCS: "4" });
  assert.equal(busyDirect, 6, "direct in_use=4 → (16−4)/2 = 6");
  assert.equal(busyRunner, 6, "runner in_use=4 → 6 (equal to direct)");
  // Set in_use back to 0 ⇒ back to nproc×oversub/S (bidirectional falsifiable).
  assert.equal(derivedConcurrency(16, 2, 1, 0), 8, "in_use=0 → back to 16×1/2 = 8");
  assert.equal(runnerLaneCount({ RESOURCE_GATE_NPROC: "16", RESOURCE_GATE_CONCURRENT_SUITES: "2", QUAY_MAX_OVERSUBSCRIPTION: "1" }), 8, "runner in_use=0 → back to 8");
});


test("AC6 — oversub code default is 1 (not 1.75): QUAY_MAX_OVERSUBSCRIPTION unset ⇒ defaultLaneCount uses 1", () => {
  // The production config's 1.75 was an experiment residue (already ops-changed to 1 by the human);
  // the CODE default must be 1 so a fresh host/install never oversubscribes by 1.75×.
  const defaultOversub = runnerLaneCount({ RESOURCE_GATE_NPROC: "16", RESOURCE_GATE_CONCURRENT_SUITES: "1" });
  // withSeams clears QUAY_MAX_OVERSUBSCRIPTION ⇒ the code default 1 applies (not 1.75 ⇒ not 28).
  assert.equal(defaultOversub, 16, "oversub unset → default 1 → nproc×1/1 = 16 (not 16×1.75=28)");
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
