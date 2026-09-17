// Shared harness for the cap-from-gate-cli shards (split of cap-from-gate-cli.test.mjs by
// gap-suite-split-15-over-30s-test-files). ONE copy of every depth-0 helper — the shards import the
// names they use; ⛔ no shard re-declares a fixture.
//
// SRC_URL re-establishes the ORIGINAL directory so the moved code's own
// __dirname / import.meta.url-relative paths keep resolving from helpers/.
const SRC_URL = new URL("../cap-from-gate-cli.test.mjs", import.meta.url).href;

// @test-group engine
// cap-from-gate-cli.test.mjs — gap-fixed-cap-5-dynamic-cap-retired. The DYNAMIC adaptive concurrency
// cap is RETIRED (human ruling 2026-08-09): effective_cap is the FIXED constant 5, regardless of cpu
// pressure / suite state / process budget. The band + hysteresis + budget logic still RUNS as PURE
// OBSERVATION (the signal/band/budget lines the CLI prints) and is pinned here as observation, but it
// participates in NO decision — effective_cap is always the configured worker cap.
//
// SPLIT NOTE (gap-suite-floor-two-longest-files-bound): this is one of FIVE files split from the
// original cap-from-gate.test.mjs (166s main-phase floor) by test concern — this file holds the
// MECHANISM-SURFACE tests: the AC1/AC7 wrapper, AC8 cross-references, the CLI smoke, and the
// FIXED-CAP retirement matrix (the 8-sample FIXED-CAP run is the file's dominant cost; the
// resource-gate report-line + dead-zone tests moved to cap-from-gate-config-budget.test.mjs to
// keep every file under the 50s band with margin). The `@test-group engine` declaration is
// preserved so the main-phase membership stays byte-identical.
//
// History (retired mechanism, kept for the observation semantics): the adaptive cap read cpu
// `some avg10`, mapped it to GO/WAIT/EXTREME bands, kept hysteresis, and bounded the result by the
// cross-layer process budget. The human ruling: the dynamic cap was a "boolean disguised as a
// number" (cap history 4/1/5/2/3, switching only with suite-running). effective_cap must be 5
// REGARDLESS of load state — a suite running or not, cpu pressure GO or EXTREME, budget idle or
// saturated. This is the Contract's `effective_cap_stability` band: the CLI output is 5 in every state.
//
// The DoD's live-system controls are recorded in the task body — the unit/integration tests here
// pin the fixed-cap semantics deterministically via the resource-gate env seams
// (RESOURCE_GATE_TEST_CPU_AVG10 / RESOURCE_GATE_TEST_NODE_PROCS / RESOURCE_GATE_TEST_MEM_AVAIL_MB /
// RESOURCE_GATE_TEST_LOAD_OVERRIDE).
//
// Run:
//   scripts/test.sh plugin/test/cap-from-gate-cli.test.mjs
//   node --test plugin/test/cap-from-gate-cli.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  computeEffectiveCap,
} from "../../scripts/cap-from-gate.ts";
import { driverCap } from "../../scripts/driver-config.ts";




// Hermetic budget baseline (2026-08-09, red-window #10): every budget-dependent assertion assumes a
// 4-core total_budget. Pin the nproc seam to 4 so the budget logic is deterministic under BOTH the
// host (nproc=4) and the systemd scope (nproc=2).
process.env.RESOURCE_GATE_TEST_NPROC = "4";


// ── AC1/AC7: the mechanism is invoked at dispatch; owned by quay ───────────────────────────────────

const __dirname = path.dirname(fileURLToPath(SRC_URL));

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

// Expected effective_cap = the CONFIGURED worker cap (drivers.yml via driverCap), NOT a hardcoded 5 —
// gap-cap-from-gate-effective-cap-dual-source-blocks-yml-override (see cap-from-gate-bands.test.mjs).
const CONFIGURED_CAP = driverCap(REPO_ROOT, "worker");

// Hermetic bands injected into every GO/WAIT/EXTREME assertion (ad-arm1 gate #3 — see the sibling
// cap-from-gate-bands.test.mjs header for the rationale). TEST_BANDS is a deliberately non-default
// value (go:3) so a test that accidentally reads machine config FAILS loudly.
const TEST_BANDS = { go: 3, wait: 2, extreme_wait: 1 };

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

export { CAP_SCRIPT, CONFIGURED_CAP, REPO_ROOT, TEST_BANDS, __dirname, _createdDirs, after, assert, computeEffectiveCap, driverCap, fileURLToPath, findRepoRoot, fs, os, path, spawnSync, test, tmpState };
