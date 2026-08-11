// @test-group governance
// cap-from-gate.test.mjs — gap-fixed-cap-5-dynamic-cap-retired. The DYNAMIC adaptive concurrency cap
// is RETIRED (human ruling 2026-08-09): effective_cap is the FIXED constant 5, regardless of cpu
// pressure / suite state / process budget. The band + hysteresis + budget logic still RUNS as PURE
// OBSERVATION (the signal/band/budget lines the CLI prints) and is pinned here as observation, but it
// participates in NO decision — effective_cap is always FIXED_EFFECTIVE_CAP (5).
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
//   scripts/test.sh plugin/test/cap-from-gate.test.mjs
//   node --test plugin/test/cap-from-gate.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  FIXED_EFFECTIVE_CAP,
  DEFAULT_BANDS,
  WAIT_THRESHOLD,
  EXTREME_THRESHOLD,
  HYSTERESIS_SAMPLES_DEFAULT,
  computeDesiredBand,
  applyHysteresis,
  capForBand,
  readBandsFromConfig,
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
const CAP_SCRIPT = path.join(REPO_ROOT, "plugin", "scripts", "cap-from-gate.sh");
const GATE = path.join(REPO_ROOT, "plugin", "scripts", "resource-gate.sh");

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

// ── AC3: hysteresis (negative control) ─────────────────────────────────────────────────────────────
test("AC3 — hysteresis: a single sample toward a new band does NOT switch; N consecutive do (unit)", () => {
  const go = { band: "GO", consecutive: 0, decided_at: "" };
  // One WAIT sample → stays GO, consecutive=1.
  const s1 = applyHysteresis(go, "WAIT", 2);
  assert.deepEqual(s1, { band: "GO", consecutive: 1, switched: false });
  // Second WAIT sample → switches.
  const s2 = applyHysteresis(s1, "WAIT", 2);
  assert.deepEqual(s2, { band: "WAIT", consecutive: 0, switched: true });
  // A GO blip resets the counter (opposite direction is not cumulative).
  const blip = applyHysteresis(s2, "GO", 2);
  assert.deepEqual(blip, { band: "WAIT", consecutive: 1, switched: false });
  const blip2 = applyHysteresis(blip, "GO", 2);
  assert.deepEqual(blip2, { band: "GO", consecutive: 0, switched: true });
  // Consistent with current band → consecutive stays 0.
  const stay = applyHysteresis(go, "GO", 2);
  assert.deepEqual(stay, { band: "GO", consecutive: 0, switched: false });
});

test("AC3 — cold start (no state) adopts the raw reading immediately; samples=1 switches every time", () => {
  const cold = applyHysteresis(null, "WAIT", 2);
  assert.deepEqual(cold, { band: "WAIT", consecutive: 0, switched: false }, "no history → adopt raw band");
  // samples=1 (a degenerate config, used only by tests) means no hysteresis at all.
  const s1 = applyHysteresis({ band: "GO", consecutive: 0, decided_at: "" }, "WAIT", 1);
  assert.deepEqual(s1, { band: "WAIT", consecutive: 0, switched: true });
});

test("AC3 — avg10 jitter below WAIT stays GO; a single above-threshold sample does not flip (hysteresis, integration)", (t) => {
  const state = tmpState("jitter");
  // Two samples jittering below WAIT=60 (39→41) with the churn-dominated avg300 held at 54 (the
  // old signal's locked floor) — the avg300 reading must NOT influence the band.
  const r1 = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: state,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "39", RESOURCE_GATE_TEST_CPU_AVG300: "54", RESOURCE_GATE_TEST_NODE_PROCS: "0" },
  });
  const r2 = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: state,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "41", RESOURCE_GATE_TEST_CPU_AVG300: "54", RESOURCE_GATE_TEST_NODE_PROCS: "0" },
  });
  assert.equal(r1.band, "GO");
  assert.equal(r2.band, "GO", "avg10 jitter (39→41) below WAIT=60 must NOT flip the band");
  assert.equal(r2.effective_cap, r1.effective_cap, "cap stays constant under avg10 jitter");
  // A single above-threshold sample (68, real overload) must NOT flip an established GO either —
  // the negative control holds for the responsive signal too.
  const r3 = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: state,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "68", RESOURCE_GATE_TEST_NODE_PROCS: "0" },
  });
  assert.equal(r3.band, "GO", "single above-threshold sample must NOT switch (hysteresis)");
  assert.equal(r3.consecutive, 1, "one WAIT-ward sample accumulates to consecutive=1");
});

// ── AC3b: STALL CONVERGENCE (gap-test-concurrency-cap-does-not-scope-nested-spawns AC3) ─────────────
// The 223-min stall was exactly ONE alternating same-band sample hard-resetting the `consecutive`
// counter: under WAIT/GO alternation the counter bounced 0/1 forever, so a sustained EXTREME peak
// (avg10=88, load1=18 at 07:51Z) was never adopted and the cap stayed GO=5 through the peak. The fix
// makes the counter ACCUMULATE across alternation (a confirmation sample does NOT zero it) and only
// zeroes it when the last divergence is stale (HYSTERESIS_RECOVERY_MS — the load recovered). The
// single-sample negative control (AC3) is preserved: one away-sample still does not switch.
test("AC3b — WAIT/GO alternation CONVERGES to the load band after 2 same-direction samples (the 223-min stall fix)", (t) => {
  const state = tmpState("stall");
  // Establish GO with a cold-start decision, then drive samples at 25-min dispatch ticks with the
  // load alternating across the WAIT=60 threshold — the exact oscillation that used to stall.
  const base = Date.now();
  const stepMs = 25 * 60 * 1000;
  const first = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: state,
    bands: TEST_BANDS,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "45", RESOURCE_GATE_TEST_NODE_PROCS: "0" },
    now: base,
  });
  assert.equal(first.band, "GO", "cold start below WAIT establishes GO");
  // Alternation: WAIT (68) → GO (45, confirmation) → WAIT (68). Pre-fix, the GO confirmation
  // reset `consecutive` to 0, so this sequence never reached 2 and the cap stayed GO forever.
  const r1 = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: state,
    bands: TEST_BANDS,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "68", RESOURCE_GATE_TEST_NODE_PROCS: "0" },
    now: base + stepMs,
  });
  assert.equal(r1.band, "GO", "single WAIT sample must NOT switch (AC3 negative control)");
  assert.equal(r1.consecutive, 1, "one away-sample accumulates to consecutive=1");
  const r2 = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: state,
    bands: TEST_BANDS,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "45", RESOURCE_GATE_TEST_NODE_PROCS: "0" },
    now: base + 2 * stepMs,
  });
  assert.equal(r2.band, "GO", "a confirmation (GO) does NOT flip back to a fresh state mid-alternation");
  assert.equal(r2.consecutive, 1, "the confirmation must NOT hard-reset the counter (pre-fix it reset to 0 → stall)");
  const r3 = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: state,
    bands: TEST_BANDS,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "68", RESOURCE_GATE_TEST_NODE_PROCS: "0" },
    now: base + 3 * stepMs,
  });
  assert.equal(r3.band, "WAIT", "the 2nd same-direction sample across the alternation switches the OBSERVED band — converged, no stall");
  assert.equal(r3.effective_cap, FIXED_EFFECTIVE_CAP, "effective_cap stays fixed 5 even after the OBSERVED band converges to WAIT");
});

test("AC3b — a STALE divergence (load genuinely recovered) DOES reset the counter, so an isolated blip fades", (t) => {
  const state = tmpState("stale");
  const base = Date.now();
  const stepMs = 25 * 60 * 1000;
  // Establish GO, then a single WAIT blip (away-sample → consecutive=1), then confirmations held
  // LONGER than HYSTERESIS_RECOVERY_MS — the blip must fade (counter reset to 0) so a second
  // isolated blip much later does NOT combine with the stale one to switch.
  computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: state,
    bands: TEST_BANDS,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "45", RESOURCE_GATE_TEST_NODE_PROCS: "0" },
    now: base,
  });
  computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: state,
    bands: TEST_BANDS,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "68", RESOURCE_GATE_TEST_NODE_PROCS: "0" },
    now: base + stepMs,
  });
  // 4 confirmations spaced beyond the recovery window → the divergence is stale → counter resets.
  for (let i = 2; i <= 5; i++) {
    computeEffectiveCap({
      repoRoot: REPO_ROOT,
      stateFile: state,
      bands: TEST_BANDS,
      env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "45", RESOURCE_GATE_TEST_NODE_PROCS: "0" },
      now: base + i * (stepMs * 2), // 50-min spacing → beyond the 90-min recovery by the 4th
    });
  }
  const late = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: state,
    bands: TEST_BANDS,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "68", RESOURCE_GATE_TEST_NODE_PROCS: "0" },
    now: base + 6 * (stepMs * 2),
  });
  assert.equal(late.band, "GO", "the stale blip faded — a lone later WAIT sample must NOT switch");
  assert.equal(late.consecutive, 1, "the later WAIT sample restarts the accumulation at 1");
});

// ── CROSS-LAYER TOTAL BUDGET (gap-fixed-cap-5-dynamic-cap-retired) ────────────────────────────────
// The B face (dispatch slot cap) USED to read the same total process budget as test.sh's worker
// derivation and resource-gate.sh (process-budget.sh — single authority) and bound the effective cap:
// budget exhausted → cap dropped to the floor (1). RETIRED as a decision input: the budget is now
// READ ONLY as observation (the printed `budget:` line). A saturated host no longer drops the cap —
// effective_cap is the fixed 5 even when available=0 (the "WAIT built on a wrong in_use count" class
// of error is gone with the dynamic cap).
test("BUDGET — the budget is OBSERVED (available/readable) but NO LONGER bounds effective_cap (fixed 5)", (t) => {
  const state = tmpState("budget");
  // GO band with an IDLE budget (in_use=0 → available=nproc=4): budget observed, cap fixed 5.
  const idle = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: state,
    bands: TEST_BANDS, // go=3, wait=2, extreme=1 — injected, but irrelevant to the fixed cap
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "12", RESOURCE_GATE_TEST_NODE_PROCS: "0" },
  });
  assert.equal(idle.band, "GO");
  assert.equal(idle.effective_cap, FIXED_EFFECTIVE_CAP, "GO with room ⇒ fixed 5, not min(GO_band, available)");
  assert.equal(idle.budget_available, 4, "available = nproc - in_use = 4 - 0 (observation)");
  // Budget EXHAUSTED (in_use=20 on a 4-core box → available=0): the OLD behavior dropped the cap to 1;
  // the retired dynamic cap means effective_cap stays 5 (a saturated host's WAIT verdict no longer
  // participates in the dispatch decision).
  const saturated = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: state,
    bands: TEST_BANDS,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "12", RESOURCE_GATE_TEST_NODE_PROCS: "20" },
  });
  assert.equal(saturated.band, "GO", "cpu pressure still says GO (observed)");
  assert.equal(saturated.effective_cap, FIXED_EFFECTIVE_CAP, "budget exhausted ⇒ effective_cap STAYS 5 (no cap drop — dynamic cap retired)");
  assert.equal(saturated.budget_available, 0);
  // Budget constrained (available=1): the OLD behavior bounded the cap to 1; now it stays 5.
  const constrained = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: state,
    bands: TEST_BANDS,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "12", RESOURCE_GATE_TEST_NODE_PROCS: "3" },
  });
  assert.equal(constrained.effective_cap, FIXED_EFFECTIVE_CAP, "available=1 ⇒ effective_cap stays 5");
  assert.equal(constrained.budget_available, 1, "budget observation still accurate");
});

// ── SEAM HERMETICITY (round-5 red, cluster B): the injected nproc seam wins over the ambient ────────
// The round-5 failure mode was "注入的 hermetic 信号在套件满载时被真实负载信号覆盖 (seam 忽略)": the
// suite runs inside a systemd-run --user --scope with CPUQuota=200% → `nproc` reads 2 inside the scope
// (vs 4 on the host), so a budget read that DIDN'T honor RESOURCE_GATE_TEST_NPROC collapsed the
// effective cap to min(GO_band, 2) = 2 instead of the injected 3. The red-window #10 pin at the file
// top (process.env.RESOURCE_GATE_TEST_NPROC = "4") feeds every `{ ...process.env, ... }` env object;
// THIS test seals the seam explicitly by injecting a value PROVABLY different from the ambient nproc
// and asserting the injected value flows through process-budget.sh AND the full cap decision. If the
// seam is ever ignored, the assertion fails loudly (total_budget would read ambient ≠ injected).
test("SEAM (round-5 red, cluster B) — RESOURCE_GATE_TEST_NPROC overrides the ambient nproc end-to-end (process-budget.sh + computeEffectiveCap)", () => {
  const ambient = Number(spawnSync("nproc", { encoding: "utf8" }).stdout.trim());
  assert.ok(Number.isFinite(ambient) && ambient > 0, `ambient nproc must be readable, got ${ambient}`);
  // Deliberately NON-ambient so a seam-ignoring read (which falls back to ambient nproc) fails loudly.
  const injected = ambient === 4 ? 3 : 4;
  assert.notEqual(injected, ambient, "the injected total_budget must differ from ambient nproc (the seal is only provable when injected ≠ ambient)");
  // (a) process-budget.sh (the single budget authority) honors the seam.
  const budgetEnv = { ...process.env, RESOURCE_GATE_TEST_NPROC: String(injected), RESOURCE_GATE_TEST_NODE_PROCS: "0" };
  const budget = spawnSync("bash", [path.join(REPO_ROOT, "plugin", "scripts", "process-budget.sh")], { cwd: REPO_ROOT, encoding: "utf8", env: budgetEnv });
  assert.equal(budget.status, 0, `process-budget.sh must exit 0\n${budget.stdout}${budget.stderr}`);
  assert.match(budget.stdout, new RegExp(`total_budget=${injected}`), `injected RESOURCE_GATE_TEST_NPROC=${injected} must win over ambient nproc=${ambient}, got:\n${budget.stdout}`);
  assert.match(budget.stdout, new RegExp(`available=${injected}`), `available = total_budget − in_use = ${injected} − 0`);
  // (b) the full cap decision (the mechanism the tick actually calls) honors the seam.
  const state = tmpState("seam");
  const cap = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: state,
    bands: TEST_BANDS,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "12", RESOURCE_GATE_TEST_NODE_PROCS: "0", RESOURCE_GATE_TEST_NPROC: String(injected) },
  });
  assert.equal(cap.band, "GO");
  assert.equal(cap.budget_total, injected, `budget_total must be the injected ${injected} (ambient is ${ambient})`);
  assert.equal(cap.budget_available, injected, "budget_available = injected total_budget − 0 in_use");
  assert.equal(cap.effective_cap, FIXED_EFFECTIVE_CAP, `the seam proves the budget flows through (observation); effective_cap is still the fixed 5`);
});

// ── AC4: configurable bands ────────────────────────────────────────────────────────────────────────
test("AC4 — readBandsFromConfig: defaults 5/2/1; a config override takes effect", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "capfg-cfg-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cfg = path.join(dir, "config.yml");
  // No config → defaults.
  assert.deepEqual(readBandsFromConfig(cfg), { go: 5, wait: 2, extreme_wait: 1 });
  // Missing concurrency_bands block → defaults.
  fs.writeFileSync(cfg, "loop:\n  board: native\n");
  assert.deepEqual(readBandsFromConfig(cfg), { go: 5, wait: 2, extreme_wait: 1 });
  // archguard-style override 4/2/1.
  fs.writeFileSync(cfg, "loop:\n  concurrency_bands:\n    go: 4\n    wait: 2\n    extreme_wait: 1\n");
  assert.deepEqual(readBandsFromConfig(cfg), { go: 4, wait: 2, extreme_wait: 1 });
  // Malformed YAML → defaults (a cap detector degrades to defaults; readLoopParams is the fail-closed gate).
  fs.writeFileSync(cfg, "loop: [unclosed\n");
  assert.deepEqual(readBandsFromConfig(cfg), { go: 5, wait: 2, extreme_wait: 1 });
  // Invalid numbers fail back to defaults for that band.
  fs.writeFileSync(cfg, "loop:\n  concurrency_bands:\n    go: 0\n    wait: \"two\"\n    extreme_wait: 1\n");
  const r = readBandsFromConfig(cfg);
  assert.equal(r.go, 5, "non-positive go falls back to default");
  assert.equal(r.wait, 2, "non-numeric wait falls back to default");
  assert.equal(r.extreme_wait, 1);
});

test("AC4 — the OBSERVED band follows an injected band config, but effective_cap stays fixed 5 (config no longer decides the cap)", (t) => {
  // Fresh state per case — each is a cold-start first decision with the injected bands.
  // EXTREME (avg10=90 ≥ 85) with archguard bands 4/2/1 → observed band EXTREME; cap fixed 5.
  const s1 = tmpState("cfgcap-x");
  const r = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: s1,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "90", RESOURCE_GATE_TEST_NODE_PROCS: "0" },
    bands: { go: 4, wait: 2, extreme_wait: 1 },
  });
  assert.equal(r.band, "EXTREME");
  assert.equal(r.effective_cap, FIXED_EFFECTIVE_CAP, "config 4/2/1 does NOT drop the cap — fixed 5");
  // GO band with archguard bands → observed band GO; cap still fixed 5 (config change does NOT move it).
  const s2 = tmpState("cfgcap-go");
  const r2 = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: s2,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "12", RESOURCE_GATE_TEST_NODE_PROCS: "0" },
    bands: { go: 4, wait: 2, extreme_wait: 1 },
  });
  assert.equal(r2.band, "GO");
  assert.equal(r2.effective_cap, FIXED_EFFECTIVE_CAP, "config GO=4 does NOT change the cap — fixed 5");
});

// ── AC1/AC7: the mechanism is invoked at dispatch; owned by quay ───────────────────────────────────
test("AC1/AC7 — the helper is a plugin/scripts mechanism with a bash wrapper (Contract invocation form)", () => {
  assert.ok(fs.existsSync(CAP_SCRIPT), "cap-from-gate.sh wrapper must exist");
  assert.ok(fs.existsSync(path.join(REPO_ROOT, "plugin", "scripts", "cap-from-gate.ts")), "module must exist under plugin/scripts (quay ownership)");
  // The bash wrapper must exec the module (so `bash <cap-from-gate-helper>` works literally).
  const wrapper = fs.readFileSync(CAP_SCRIPT, "utf8");
  assert.match(wrapper, /exec node --experimental-strip-types/, "wrapper must exec the module");
  // The tick doc (the dispatch decision point) must invoke it.
  const tick = fs.readFileSync(path.join(REPO_ROOT, "plugin", "loop", "fast-mode-loop-tick.md"), "utf8");
  assert.match(tick, /cap-from-gate\.sh/, "step 3.6/4 must invoke the helper");
  assert.doesNotMatch(tick, /并发上限 3 个在飞/, "the fixed 'cap 3' dispatch rule must be gone from the tick");
});

test("AC8 — cross-references: resource-gate + concurrent-batch-scheduler + SPEC-isolation are named in the mechanism", () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, "plugin", "scripts", "cap-from-gate.ts"), "utf8");
  assert.match(src, /resource-gate/, "the signal source (resource-gate.sh) must be referenced");
  assert.match(src, /concurrent-batch-scheduler/, "the dispatch disjointness gate must be referenced");
  assert.match(src, /SPEC-isolation/, "the isolation/resource-governance spec must be referenced");
});

// ── CLI smoke: bash wrapper prints a last effective_cap=N line (the Contract measure) ──────────────
test("CLI smoke — `bash cap-from-gate.sh` prints a trailing effective_cap=<digit> line; env seam drives it", (t) => {
  const state = tmpState("cli");
  const env = { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "12", RESOURCE_GATE_TEST_NODE_PROCS: "0" };
  const res = spawnSync("bash", [CAP_SCRIPT, "--state", state], { cwd: REPO_ROOT, encoding: "utf8", env });
  assert.equal(res.status, 0, `cap-from-gate.sh must exit 0\n${res.stdout}${res.stderr}`);
  const capLine = res.stdout.split("\n").filter((l) => l.startsWith("effective_cap=")).pop();
  assert.match(capLine, /^effective_cap=\d+$/, `last line must be effective_cap=N, got: ${capLine}`);
  assert.equal(Number(capLine.split("=")[1]), FIXED_EFFECTIVE_CAP, "low avg10 ⇒ effective_cap is the fixed 5");
  // The Contract measure form: the stdout's digit segment contains the cap.
  const digits = (res.stdout.match(/[0-9]/g) || []);
  assert.ok(digits.length > 0, "stdout must carry a digit segment (Contract measure)");
});

// ── FIXED-CAP RETIREMENT (gap-fixed-cap-5-dynamic-cap-retired AC2) ──────────────────────────────────
// The human ruling: the dynamic cap was a "boolean disguised as a number" (cap history 4/1/5/2/3,
// switching only with suite-running). effective_cap must be 5 REGARDLESS of load state — a suite
// running or not, cpu pressure GO or EXTREME, budget idle or saturated. This is the Contract's
// `effective_cap_stability` band: the CLI output is 5 in every state.
test("FIXED-CAP — effective_cap is 5 under EVERY observed state (GO/WAIT/EXTREME × budget idle/saturated) — the Contract measure", (t) => {
  const states = [
    // [label, avg10, nodeProcs, expectedObservedBand]
    ["GO idle", "12", "0", "GO"],
    ["GO saturated", "12", "20", "GO"],
    ["WAIT idle", "68", "0", "WAIT"],
    ["WAIT saturated", "68", "20", "WAIT"],
    ["EXTREME idle", "90", "0", "EXTREME"],
    ["EXTREME saturated", "90", "20", "EXTREME"],
    ["UNMEASURABLE (fail-closed EXTREME)", "unmeasurable", "0", "EXTREME"],
  ];
  for (const [label, avg10, procs, expectedBand] of states) {
    const state = tmpState(`fixed-${label.replace(/\W+/g, "-")}`);
    // UNMEASURABLE is driven by the resource-gate seam string `unmeasurable` (a kernel-without-PSI
    // signal — the retired mechanism fail-closed the OBSERVED band to EXTREME).
    const env = {
      ...process.env,
      RESOURCE_GATE_TEST_CPU_AVG10: avg10,
      RESOURCE_GATE_TEST_NODE_PROCS: procs,
    };
    const r = computeEffectiveCap({ repoRoot: REPO_ROOT, stateFile: state, env });
    assert.equal(r.effective_cap, FIXED_EFFECTIVE_CAP, `${label}: effective_cap must be the fixed 5, got ${r.effective_cap}`);
    assert.ok(["GO", "WAIT", "EXTREME"].includes(r.band), `${label}: observed band is a real band`);
    if (label.startsWith("UNMEASURABLE")) assert.equal(r.band, "EXTREME", "unmeasurable signal fail-closes the OBSERVED band to EXTREME");
  }
  // Contract invocation form: `bash cap-from-gate.sh` with a suite-running simulation (EXTREME +
  // budget saturated) still emits effective_cap=5.
  const res = spawnSync("bash", [CAP_SCRIPT, "--state", tmpState("contract")], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "90", RESOURCE_GATE_TEST_NODE_PROCS: "20" },
  });
  assert.equal(res.status, 0, `cap-from-gate.sh must exit 0\n${res.stdout}${res.stderr}`);
  const capLine = res.stdout.split("\n").filter((l) => l.startsWith("effective_cap=")).pop();
  assert.equal(Number(capLine.split("=")[1]), FIXED_EFFECTIVE_CAP, "suite-running (EXTREME, saturated) ⇒ effective_cap is still 5");
});

test("resource-gate.sh reports BOTH avg10 and avg300 lines (single source for the signal)", () => {
  const src = fs.readFileSync(GATE, "utf8");
  assert.match(src, /avg10=/, "resource-gate must parse the some avg10 field");
  assert.match(src, /avg300=/, "resource-gate must parse the some avg300 field");
  const env = { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "12.34", RESOURCE_GATE_TEST_CPU_AVG300: "54.5" };
  const r = spawnSync("bash", [GATE], { cwd: REPO_ROOT, encoding: "utf8", env });
  assert.match(r.stdout, /cpu_stall\(some avg10\)=12\.34/, "report mode must print the avg10 line (cap-from-gate reads this)");
  assert.match(r.stdout, /cpu_stall\(some avg300\)=54\.50/, "report mode must print the avg300 line (kept for the record)");
});

// ── gap-resource-gate-two-thresholds-test-sh-vs-cap-from-gate: AC4 cross-gate alignment ────────────
test("AC4 — the suite gate and the dispatch cap AGREE in the old 40-60 dead-zone (avg10=49.56 ⇒ both GO)", () => {
  // The manager's observed load-peak imbalance (2026-08-08 21:1xZ): at avg10=49.56 the full-suite
  // gate WAITed (limit 40 — suite refused) while the dispatch cap stayed GO (< 60 — dispatch
  // continued). After the threshold unification the suite gate's limit IS the cap's GO/WAIT
  // boundary, so this exact sample must be GO on BOTH layers — no "suite refuses + dispatch
  // continues" imbalance.
  // LOAD_OVERRIDE=1: the overload-window load seam (gap-resource-gate-psi-does-not-capture-load-
  // flake-driver) must be LOW so the real /proc/loadavg (8.86 right now on this box, above the
  // nproc×2=8 threshold) cannot nondeterministically flip this cross-gate GO alignment to WAIT.
  const env = { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "49.56", RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000", RESOURCE_GATE_TEST_NODE_PROCS: "2", RESOURCE_GATE_TEST_LOAD_OVERRIDE: "1" };
  // Dispatch side: cap-from-gate's desired band is GO (below WAIT_THRESHOLD=60).
  assert.equal(computeDesiredBand(49.56), "GO", "avg10=49.56 must be in the dispatch GO band");
  // Suite side: the full-suite gate must report GO too (exit 0) at the same sample.
  const suite = spawnSync("bash", [GATE, "--for", "full-suite"], { cwd: REPO_ROOT, encoding: "utf8", env });
  assert.equal(suite.status, 0, `avg10=49.56 must be GO (exit 0), got ${suite.status}\n${suite.stdout}\n${suite.stderr}`);
  assert.match(suite.stdout, /\[limit 60\]   ok/, "the full-suite gate reports GO under the unified limit");
});
