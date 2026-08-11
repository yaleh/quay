// @test-group governance
// cap-from-gate-bands.test.mjs — gap-fixed-cap-5-dynamic-cap-retired. The DYNAMIC adaptive concurrency
// cap is RETIRED (human ruling 2026-08-09): effective_cap is the FIXED constant 5, regardless of cpu
// pressure / suite state / process budget. The band + hysteresis + budget logic still RUNS as PURE
// OBSERVATION (the signal/band/budget lines the CLI prints) and is pinned here as observation, but it
// participates in NO decision — effective_cap is always FIXED_EFFECTIVE_CAP (5).
//
// SPLIT NOTE (gap-suite-floor-two-longest-files-bound): this is one of FIVE files split from the
// original cap-from-gate.test.mjs (166s main-phase floor) by test concern — this file holds the
// SIGNAL→BAND decision tests (AC2 avg10-vs-avg300 + AC5/AC6 GO/WAIT/EXTREME resource tracking).
// The `@test-group governance` declaration is preserved so the main-phase membership stays
// byte-identical.
//
// History (retired mechanism, kept for the observation semantics):
//   gap-adaptive-concurrency-cap-tied-to-resource-gate →
//   gap-cap-from-gate-avg300-driven-by-claude-session-churn-structural-cap-2. The adaptive cap read
//   cpu `some avg10` (the responsive signal), mapped it to GO/WAIT/EXTREME bands, kept hysteresis
//   (2 same-direction samples before switching, AC3b stall convergence), and bounded the result by
//   the cross-layer process budget. The measured cap history was 4/1/5/2/3 — a boolean disguised as
//   a number switching only with "is a suite running", and the WAIT verdict was built on a wrong
//   process-budget count (in_use=5 with 1 real test MainThread). All of that is now observation only.
//
//   AC1 — the helper is still invoked AT the dispatch decision point (the tick calls it in step 4;
//         no new polling) — it now returns the fixed 5.
//   AC2 — the signal read is still cpu `some avg10` (the OBSERVED band line); the cap does NOT follow it.
//   AC3 — hysteresis still OBSERVES the band (negative control preserved for the observation).
//   AC4 — bands configurable (observed band), but the cap is fixed regardless of config.
//   AC5/AC6 — GO ⇒ observed band GO, WAIT/EXTREME ⇒ observed band drops; effective_cap stays 5.
//   AC8 — cross-references preserved (resource-gate + concurrent-batch-scheduler + SPEC-isolation).
//
// The DoD's live-system controls (effective_cap=5 with a suite running AND not running) are recorded
// in the task body — the unit/integration tests here pin the fixed-cap semantics deterministically via
// the resource-gate env seams (RESOURCE_GATE_TEST_CPU_AVG10 / RESOURCE_GATE_TEST_NODE_PROCS).
//
// Run:
//   scripts/test.sh plugin/test/cap-from-gate-bands.test.mjs
//   node --test plugin/test/cap-from-gate-bands.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  FIXED_EFFECTIVE_CAP,
  WAIT_THRESHOLD,
  EXTREME_THRESHOLD,
  computeDesiredBand,
  computeEffectiveCap,
  loadState,
} from "../scripts/cap-from-gate.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, ".quay", "config.yml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Cannot find repo root upward from " + startDir);
}
const REPO_ROOT = findRepoRoot(__dirname);

// Hermetic bands injected into every GO/WAIT/EXTREME assertion (ad-arm1 gate #3: the original fix
// asserted `=== DEFAULT_BANDS.go` — but DEFAULT_BANDS.go is 5 only on THIS machine's config; a
// project (B / ad-arm1) whose .quay/config.yml overrides concurrency_bands go:2 fails. The test
// must assert against a KNOWN injected value, never the machine-local config). TEST_BANDS is a
// deliberately non-default value (go:3) so a test that accidentally reads machine config FAILS
// loudly instead of passing by coincidence.
const TEST_BANDS = { go: 3, wait: 2, extreme_wait: 1 };

// Hermetic budget baseline (2026-08-09, red-window #10): every budget-dependent assertion below
// assumes a 4-core total_budget (available = nproc − in_use; the BUDGET test asserts available=4,
// the saturated case nproc−20=0, the constrained case nproc−3=1). The suite runs inside a
// systemd-run --user --scope with CPUQuota=200% → `nproc` reads 2 inside the scope → total_budget=2
// → the budget bound collapses the effective cap below the injected GO value (got 2, expected 3)
// whenever the suite verifies on this host. Pin the nproc seam to 4 so the budget logic is
// deterministic under BOTH the host (nproc=4) and the systemd scope (nproc=2), matching the
// 4-core baseline the tests assert. Flows through every `{ ...process.env, ... }` env object.
process.env.RESOURCE_GATE_TEST_NPROC = "4";

// R6 carrier-array cleanup: every mkdtemp dir is tracked and removed after the run (no tmp leak).
const _createdDirs = [];
function tmpState(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `capfg-${prefix}-`));
  _createdDirs.push(dir);
  return path.join(dir, "state.json");
}
after(() => {
  for (const d of _createdDirs) fs.rmSync(d, { recursive: true, force: true });
});

// ── AC2: the signal is cpu some avg10 (responsive), NOT the churn-dominated avg300 ────────────────
test("AC2 — computeDesiredBand maps cpu some avg10 to GO/WAIT/EXTREME; the churn baseline is GO, real overload is WAIT", () => {
  assert.equal(computeDesiredBand(0), "GO");
  assert.equal(computeDesiredBand(39.99), "GO");
  // Measured claude-session churn baseline (avg10 42-54, 2026-08-08) sits BELOW WAIT=60 → GO.
  assert.equal(computeDesiredBand(42), "GO");
  assert.equal(computeDesiredBand(53.8), "GO");
  assert.equal(computeDesiredBand(59.99), "GO");
  assert.equal(computeDesiredBand(WAIT_THRESHOLD), "WAIT");
  // Measured real overload (4-core full-load injection pushed avg10 to 68) → WAIT.
  assert.equal(computeDesiredBand(68), "WAIT");
  assert.equal(computeDesiredBand(EXTREME_THRESHOLD), "EXTREME");
  assert.equal(computeDesiredBand(99), "EXTREME");
  // Unmeasurable signal fails closed to the lowest band (never a quietly-high cap).
  assert.equal(computeDesiredBand(null), "EXTREME");
});

test("AC2 — the full decision reads cpu some avg10, NOT avg300: churn-only high avg300 ⇒ GO; overloaded avg10 ⇒ WAIT even with unchanged avg300", (t) => {
  // Fresh state per case (each is a cold-start first decision — no prior band to be consistent against).
  // churn-only baseline: avg10=53 (below WAIT=60) with avg300=54.5 (the old signal's locked floor) → GO.
  // This is the DEFECT case: the old avg300-driven cap read 54.5 and pinned WAIT forever.
  const s1 = tmpState("avg10a");
  const r1 = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: s1,
    bands: TEST_BANDS,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "53", RESOURCE_GATE_TEST_CPU_AVG300: "54.5", RESOURCE_GATE_TEST_NODE_PROCS: "0" },
  });
  assert.equal(r1.band, "GO", "avg10 (not avg300) decides the OBSERVED band — session churn alone must not cap");
  assert.equal(r1.effective_cap, FIXED_EFFECTIVE_CAP, `effective_cap is the fixed 5 regardless of the observed GO band, got ${r1.effective_cap}`);
  // real overload: 4-core injection moved avg10 to 68 while avg300 stayed ~53.7 (only +1.5pt) → WAIT.
  // The responsive signal sees the overload the avg300 could not — but the OBSERVED band downgrade
  // does NOT change the fixed effective_cap.
  const s2 = tmpState("avg10b");
  const r2 = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: s2,
    bands: TEST_BANDS,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "68", RESOURCE_GATE_TEST_CPU_AVG300: "53.7", RESOURCE_GATE_TEST_NODE_PROCS: "0" },
  });
  assert.equal(r2.band, "WAIT", "high avg10 (real overload) must downgrade the OBSERVED band even though avg300 is unchanged");
  assert.equal(r2.effective_cap, FIXED_EFFECTIVE_CAP, "effective_cap stays fixed 5 under a WAIT band (retired dynamic cap)");
});

// ── AC5/AC6: the cap tracks resources ──────────────────────────────────────────────────────────────
test("AC5 — resources empty (low avg10) ⇒ OBSERVED GO band; effective_cap is the fixed 5 (cold-start first decision adopts immediately)", (t) => {
  const state = tmpState("go");
  const r = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: state,
    bands: TEST_BANDS,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "12", RESOURCE_GATE_TEST_NODE_PROCS: "0" },
  });
  assert.equal(r.band, "GO");
  assert.equal(r.effective_cap, FIXED_EFFECTIVE_CAP, `effective_cap is the fixed 5, got ${r.effective_cap}`);
  // The state file is written (the band observation is persisted).
  const persisted = loadState(state);
  assert.equal(persisted.band, "GO");
});

test("AC6 — high avg10 (host saturated) ⇒ OBSERVED band WAIT then EXTREME; effective_cap stays fixed 5", (t) => {
  const state = tmpState("high");
  // Cold start with LOW avg10 establishes GO (AC5 — resources empty ⇒ GO band).
  const cold = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: state,
    bands: TEST_BANDS,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "12", RESOURCE_GATE_TEST_NODE_PROCS: "0" },
  });
  assert.equal(cold.band, "GO");
  assert.equal(cold.effective_cap, FIXED_EFFECTIVE_CAP);
  // First overloaded sample (avg10=68 — the measured 4-core-injection reading): desired WAIT but
  // hysteresis holds GO (consecutive=1). One sample must NOT switch — the negative control.
  const first = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: state,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "68", RESOURCE_GATE_TEST_NODE_PROCS: "0" },
  });
  assert.equal(first.band, "GO", "single sample must NOT switch the OBSERVED band (hysteresis)");
  assert.equal(first.consecutive, 1);
  // Second consecutive overloaded sample → the OBSERVED band switches to WAIT; cap stays 5.
  const second = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: state,
    bands: TEST_BANDS,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "68", RESOURCE_GATE_TEST_NODE_PROCS: "0" },
  });
  assert.equal(second.band, "WAIT", "two consecutive same-direction samples switch the OBSERVED band");
  assert.equal(second.effective_cap, FIXED_EFFECTIVE_CAP, "effective_cap stays fixed 5 under WAIT (retired dynamic cap)");
  // A single EXTREME sample (avg10=90) from WAIT holds (hysteresis: consecutive=1), then a second
  // consecutive EXTREME sample escalates the OBSERVED band → EXTREME; cap still 5.
  const third = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: state,
    bands: TEST_BANDS,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "90", RESOURCE_GATE_TEST_NODE_PROCS: "0" },
  });
  assert.equal(third.band, "WAIT", "single EXTREME sample must not skip WAIT (hysteresis)");
  assert.equal(third.consecutive, 1);
  const fourth = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: state,
    bands: TEST_BANDS,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "90", RESOURCE_GATE_TEST_NODE_PROCS: "0" },
  });
  assert.equal(fourth.band, "EXTREME", "sustained heavy overload escalates the OBSERVED band to EXTREME");
  assert.equal(fourth.effective_cap, FIXED_EFFECTIVE_CAP, "effective_cap stays fixed 5 even under EXTREME (retired dynamic cap)");
});
