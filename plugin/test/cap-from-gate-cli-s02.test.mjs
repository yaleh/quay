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

// SPLIT from cap-from-gate-cli.test.mjs by gap-suite-split-15-over-30s-test-files — shard 2/4 (1 test). Shared fixtures: ./helpers/cap-from-gate-cli-harness.mjs (single source).

import { test } from "node:test";
import { REPO_ROOT, assert, fs, path } from "./helpers/cap-from-gate-cli-harness.mjs";

test("AC8 — cross-references: resource-gate + concurrent-batch-scheduler + SPEC-isolation are named in the mechanism", () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, "plugin", "scripts", "cap-from-gate.ts"), "utf8");
  assert.match(src, /resource-gate/, "the signal source (resource-gate.sh) must be referenced");
  assert.match(src, /concurrent-batch-scheduler/, "the dispatch disjointness gate must be referenced");
  assert.match(src, /SPEC-isolation/, "the isolation/resource-governance spec must be referenced");
});

// ── CLI smoke: bash wrapper prints a last effective_cap=N line (the Contract measure) ──────────────
