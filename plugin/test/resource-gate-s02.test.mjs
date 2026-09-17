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

// SPLIT from resource-gate.test.mjs by gap-suite-split-15-over-30s-test-files — shard 2/8 (8 tests). Shared fixtures: ./helpers/resource-gate-harness.mjs (single source).

import { test } from "node:test";
import { WAIT_THRESHOLD, assert, defaultCpuLimit, runGate } from "./helpers/resource-gate-harness.mjs";

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
