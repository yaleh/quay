// @test-group governance
// cap-from-gate-stale.test.mjs — gap-fixed-cap-5-dynamic-cap-retired. The DYNAMIC adaptive
// concurrency cap is RETIRED (human ruling 2026-08-09): effective_cap is the FIXED constant 5,
// regardless of cpu pressure / suite state / process budget. The band + hysteresis + budget logic
// still RUNS as PURE OBSERVATION (the signal/band/budget lines the CLI prints) and is pinned here
// as observation, but it participates in NO decision — effective_cap is always FIXED_EFFECTIVE_CAP (5).
//
// SPLIT NOTE (gap-suite-floor-two-longest-files-bound): this is one of FIVE files split from the
// original cap-from-gate.test.mjs (166s main-phase floor) by test concern — this file holds the
// AC3b STALE-divergence test (8 computeEffectiveCap samples, the single largest cost in the
// original file — kept alone so this file stays under the 50s band with margin). The
// `@test-group governance` declaration is preserved so the main-phase membership stays byte-identical.
//
// History (retired mechanism, kept for the observation semantics): the adaptive cap read cpu
// `some avg10`, mapped it to GO/WAIT/EXTREME bands, kept hysteresis, and bounded the result by
// the cross-layer process budget. The B face (dispatch slot cap) USED to bound the effective cap:
// budget exhausted → cap dropped to the floor (1). RETIRED as a decision input — a saturated host
// no longer drops the cap (the "WAIT built on a wrong in_use count" class of error is gone).
//
// The DoD's live-system controls are recorded in the task body — the unit/integration tests here
// pin the fixed-cap semantics deterministically via the resource-gate env seams
// (RESOURCE_GATE_TEST_CPU_AVG10 / RESOURCE_GATE_TEST_NODE_PROCS).
//
// Run:
//   scripts/test.sh plugin/test/cap-from-gate-stale-budget.test.mjs
//   node --test plugin/test/cap-from-gate-stale-budget.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  FIXED_EFFECTIVE_CAP,
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

// ── AC3b: STALL CONVERGENCE — the STALE-divergence branch (gap-test-concurrency-cap-does-not-scope-
// nested-spawns AC3). The 223-min stall was exactly ONE alternating same-band sample hard-resetting
// the `consecutive` counter. The fix makes the counter ACCUMULATE across alternation (a confirmation
// sample does NOT zero it) and only zeroes it when the last divergence is stale
// (HYSTERESIS_RECOVERY_MS — the load recovered). The single-sample negative control (AC3) is
// preserved in the hysteresis file; THIS test pins the stale-fade branch.
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

