// @test-group engine
// cap-from-gate-hysteresis.test.mjs — gap-fixed-cap-5-dynamic-cap-retired. The DYNAMIC adaptive
// concurrency cap is RETIRED (human ruling 2026-08-09): effective_cap is the FIXED constant 5,
// regardless of cpu pressure / suite state / process budget. The band + hysteresis + budget logic
// still RUNS as PURE OBSERVATION (the signal/band/budget lines the CLI prints) and is pinned here
// as observation, but it participates in NO decision — effective_cap is always FIXED_EFFECTIVE_CAP (5).
//
// SPLIT NOTE (gap-suite-floor-two-longest-files-bound): this is one of FIVE files split from the
// original cap-from-gate.test.mjs (166s main-phase floor) by test concern — this file holds the
// HYSTERESIS tests (AC3 negative control + AC3b stall convergence — the 223-min stall fix). The
// AC3b stale-divergence test lives in cap-from-gate-stale-budget.test.mjs (its 8-sample run is the
// file's dominant cost; splitting it out keeps every cap-from-gate file under the 50s band with
// margin). The `@test-group engine` declaration is preserved so the main-phase membership stays
// byte-identical.
//
// History (retired mechanism, kept for the observation semantics): the adaptive cap read cpu
// `some avg10` (the responsive signal), mapped it to GO/WAIT/EXTREME bands, kept hysteresis
// (2 same-direction samples before switching, AC3b stall convergence), and bounded the result by
// the cross-layer process budget. All of that is now observation only — effective_cap is fixed 5.
//
// The DoD's live-system controls are recorded in the task body — the unit/integration tests here
// pin the fixed-cap semantics deterministically via the resource-gate env seams
// (RESOURCE_GATE_TEST_CPU_AVG10 / RESOURCE_GATE_TEST_NODE_PROCS).
//
// Run:
//   scripts/test.sh plugin/test/cap-from-gate-hysteresis.test.mjs
//   node --test plugin/test/cap-from-gate-hysteresis.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  FIXED_EFFECTIVE_CAP,
  applyHysteresis,
  computeEffectiveCap,
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

// Hermetic bands injected into every GO/WAIT/EXTREME assertion (ad-arm1 gate #3 — see the sibling
// cap-from-gate-bands.test.mjs header for the rationale). TEST_BANDS is a deliberately non-default
// value (go:3) so a test that accidentally reads machine config FAILS loudly.
const TEST_BANDS = { go: 3, wait: 2, extreme_wait: 1 };

// Hermetic budget baseline (2026-08-09, red-window #10): every budget-dependent assertion assumes a
// 4-core total_budget. Pin the nproc seam to 4 so the budget logic is deterministic under BOTH the
// host (nproc=4) and the systemd scope (nproc=2).
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
