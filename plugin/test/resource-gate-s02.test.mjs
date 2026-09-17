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

// SPLIT from resource-gate.test.mjs by gap-suite-split-15-over-30s-test-files — shard 2/5 (13 tests). Shared fixtures: ./helpers/resource-gate-harness.mjs (single source).

import { test } from "node:test";
import { REPO_ROOT, TEST_SH, assert, concurrentSuiteSlots, currentDefaultConcurrency, defaultLaneCount, defaultPhaseConcurrencyDirect, defaultTestConcurrency, derivedConcurrency, fs, hostParallelism, os, path, runGate, spawnSync, withSeams } from "./helpers/resource-gate-harness.mjs";

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
  const realNproc = hostParallelism(); // the TS canonical nproc (read-host) — defaultTestConcurrency reads the SAME source
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
  // Oversub must ALSO be hermetic here (this real-host assertion does not go through withSeams): it
  // compares currentDefaultConcurrency() against the oversub=1 baseline (derivedConcurrency(...,1)) —
  // an ambient QUAY_MAX_OVERSUBSCRIPTION / RESOURCE_GATE_OVERSUBSCRIPTION (e.g. an oversub suite run)
  // would perturb the effective default and red it (2026-09-02 ov15 run).
  const prevOversub = process.env.QUAY_MAX_OVERSUBSCRIPTION;
  const prevRGOver = process.env.RESOURCE_GATE_OVERSUBSCRIPTION;
  delete process.env.QUAY_MAX_OVERSUBSCRIPTION;
  delete process.env.RESOURCE_GATE_OVERSUBSCRIPTION;
  // in_use must ALSO be hermetic here (this real-host assertion does not go through withSeams): the
  // budget-aware derivation would otherwise shell out to the live host and read a nondeterministic
  // in_use, so pin it to 0 (idle baseline) to compare against derivedConcurrency(...,inUse=0).
  const prevInUse = process.env.RESOURCE_GATE_TEST_NODE_PROCS;
  process.env.RESOURCE_GATE_TEST_NODE_PROCS = "0";
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
      `default_test_concurrency must return max(1, floor(${realNproc}×1/${realSlots})) = ${Math.max(1, Math.floor(realNproc / realSlots))} on the real host (idle in_use=0 baseline)`
    );
  } finally {
    if (prevLock === undefined) delete process.env.FULL_SUITE_LOCK_FILE;
    else process.env.FULL_SUITE_LOCK_FILE = prevLock;
    if (prevSeam === undefined) delete process.env.RESOURCE_GATE_CONCURRENT_SUITES;
    else process.env.RESOURCE_GATE_CONCURRENT_SUITES = prevSeam;
    if (prevKnob === undefined) delete process.env.QUAY_MAX_CONCURRENT_SUITES;
    else process.env.QUAY_MAX_CONCURRENT_SUITES = prevKnob;
    if (prevOversub === undefined) delete process.env.QUAY_MAX_OVERSUBSCRIPTION;
    else process.env.QUAY_MAX_OVERSUBSCRIPTION = prevOversub;
    if (prevRGOver === undefined) delete process.env.RESOURCE_GATE_OVERSUBSCRIPTION;
    else process.env.RESOURCE_GATE_OVERSUBSCRIPTION = prevRGOver;
    if (prevInUse === undefined) delete process.env.RESOURCE_GATE_TEST_NODE_PROCS;
    else process.env.RESOURCE_GATE_TEST_NODE_PROCS = prevInUse;
    fs.rmSync(pinTmp, { recursive: true, force: true });
  }
});


test("AC5b — the MAIN derivation is BUDGET-AWARE: in_use is subtracted (in_use=0 keeps the idle baseline; in_use>0 reduces lanes); process-budget.sh still reports the cross-layer budget", () => {
  // gap-process-budget-in-use-structurally-zero-never-throttles: the pre-fix in_use was structurally 0
  // ⇒ the "subtract in-use" term never subtracted, so a busy host derived the idle-host lane count
  // (oversubscription). The formula is now max(1, floor((nproc − in_use) × oversub / S)): the S
  // divisor stays the structural bound (gap-suite-budget-oversubscribe), and in_use is a
  // one-directional downward adjustment within it (a busy host takes fewer lanes; the idle baseline
  // is unchanged).
  assert.equal(derivedConcurrency(16, 2, 1), 8, "16 cores / 2 slots, in_use=0 → 8 (idle baseline)");
  assert.equal(derivedConcurrency(4, 2, 1), 2, "4 cores / 2 slots, in_use=0 → 2");
  // in_use>0 reduces lanes (bidirectional falsifiable — the budget-aware half).
  assert.equal(derivedConcurrency(16, 2, 1, 4), 6, "16 cores / 2 slots, in_use=4 → (16−4)/2 = 6");
  assert.equal(derivedConcurrency(16, 1, 1, 4), 12, "16 cores / 1 slot, in_use=4 → 16−4 = 12");
  // The shared authority (plugin/scripts/process-budget.sh) still reports total_budget / in_use /
  // available — the cross-layer PROCESS-budget observation the gate's report and cap-from-gate
  // consume, AND the in_use source the lane formula now reads (single source, not a separate count).
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
  // half of concurrency-literal-check (definition point exists but a derivation does not read it). The
  // DIRECT-path derivations moved from scripts/test.sh bash to runner-concurrency.ts
  // (defaultTestConcurrency / defaultPhaseConcurrencyDirect) under SPEC P4 — test.sh now thin-forwards.
  const testSh = fs.readFileSync(TEST_SH, "utf8");
  const rc = fs.readFileSync(path.join(REPO_ROOT, "plugin", "scripts", "runner-concurrency.ts"), "utf8");
  const runnerTs = fs.readFileSync(path.join(REPO_ROOT, "plugin", "scripts", "full-suite-runner.ts"), "utf8");
  // The DIRECT-path derivations read the slot knob through concurrentSuiteSlots() (the single definition
  // point) — test.sh only thin-forwards to them (no more in-bash S read).
  assert.match(rc, /defaultTestConcurrency\(\): number \{[^]*concurrentSuiteSlots\(\)/, "defaultTestConcurrency must read the slot knob (concurrentSuiteSlots())");
  assert.match(rc, /defaultPhaseConcurrencyDirect\(\): number \{[^]*concurrentSuiteSlots\(\)/, "defaultPhaseConcurrencyDirect must read the slot knob (concurrentSuiteSlots())");
  assert.match(testSh, /default_concurrency_formula\(\) \{\n  node --no-warnings --experimental-strip-types "\$\{repo_root\}\/plugin\/scripts\/runner-concurrency\.ts" --default-test-concurrency/, "default_concurrency_formula must thin-forward to runner-concurrency.ts (no in-bash computation)");
  assert.match(testSh, /serial_lowconc_host_default\(\) \{\n  node --no-warnings --experimental-strip-types "\$\{repo_root\}\/plugin\/scripts\/runner-concurrency\.ts" --phase-concurrency/, "serial_lowconc_host_default must thin-forward to runner-concurrency.ts");
  // defaultLaneCount (runner path) reads the knob through concurrentSuiteSlots() (the single definition point).
  assert.match(runnerTs, /defaultLaneCount\(\): number \{[^]*concurrentSuiteSlots\(\)/, "defaultLaneCount must read the slot knob (concurrentSuiteSlots())");
  // Each derivation also reads the oversub knob ③ (or its seam).
  assert.match(rc, /defaultTestConcurrency\(\): number \{[^]*QUAY_MAX_OVERSUBSCRIPTION/, "defaultTestConcurrency must read QUAY_MAX_OVERSUBSCRIPTION");
  assert.match(runnerTs, /defaultLaneCount\(\): number \{[^]*QUAY_MAX_OVERSUBSCRIPTION/, "defaultLaneCount must read QUAY_MAX_OVERSUBSCRIPTION");
});


test("AC1 — S single source: defaultTestConcurrency + defaultPhaseConcurrencyDirect delegate S to concurrentSuiteSlots() (the .concurrency-file-reading canonical)", () => {
  // gap-suite-concurrency-S-two-source-divergence: the lock's slot count (suite_slot_count / the TS
  // suiteLockSlotCount) reads seam → `<base>.concurrency` file → QUAY_MAX_CONCURRENT_SUITES, and the lane
  // formulas must read the SAME chain. The fix (one S reader, divergence structurally impossible) is now
  // structural in TS: BOTH direct-path derivations CALL concurrentSuiteSlots() — the TS single definition
  // point (which delegates to suiteLockSlotCount). By-position (the function body), so a derivation that
  // stopped delegating goes RED here.
  const rc = fs.readFileSync(path.join(REPO_ROOT, "plugin", "scripts", "runner-concurrency.ts"), "utf8");
  const mainBody = rc.match(/defaultTestConcurrency\(\): number \{[^]*?\n\}/)?.[0] ?? "";
  const phaseBody = rc.match(/defaultPhaseConcurrencyDirect\(\): number \{[^]*?\n\}/)?.[0] ?? "";
  assert.ok(mainBody, "defaultTestConcurrency must exist");
  assert.ok(phaseBody, "defaultPhaseConcurrencyDirect must exist");
  assert.match(mainBody, /concurrentSuiteSlots\(\)/, "defaultTestConcurrency must delegate S to concurrentSuiteSlots()");
  assert.match(phaseBody, /concurrentSuiteSlots\(\)/, "defaultPhaseConcurrencyDirect must delegate S to concurrentSuiteSlots()");
});
