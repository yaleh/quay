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

// SPLIT from cap-from-gate-cli.test.mjs by gap-suite-split-15-over-30s-test-files — shard 3/4 (1 test). Shared fixtures: ./helpers/cap-from-gate-cli-harness.mjs (single source).

import { test } from "node:test";
import { CAP_SCRIPT, CONFIGURED_CAP, REPO_ROOT, assert, spawnSync, tmpState } from "./helpers/cap-from-gate-cli-harness.mjs";

test("CLI smoke — `bash cap-from-gate.sh` prints a trailing effective_cap=<digit> line; env seam drives it", (t) => {
  const state = tmpState("cli");
  const env = { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "12", RESOURCE_GATE_TEST_NODE_PROCS: "0" };
  const res = spawnSync("bash", [CAP_SCRIPT, "--state", state], { cwd: REPO_ROOT, encoding: "utf8", env });
  assert.equal(res.status, 0, `cap-from-gate.sh must exit 0\n${res.stdout}${res.stderr}`);
  const capLine = res.stdout.split("\n").filter((l) => l.startsWith("effective_cap=")).pop();
  assert.match(capLine, /^effective_cap=\d+$/, `last line must be effective_cap=N, got: ${capLine}`);
  assert.equal(Number(capLine.split("=")[1]), CONFIGURED_CAP, `low avg10 ⇒ effective_cap is the configured worker cap (${CONFIGURED_CAP})`);
  // The Contract measure form: the stdout's digit segment contains the cap.
  const digits = (res.stdout.match(/[0-9]/g) || []);
  assert.ok(digits.length > 0, "stdout must carry a digit segment (Contract measure)");
});

// ── FIXED-CAP RETIREMENT (gap-fixed-cap-5-dynamic-cap-retired AC2) ──────────────────────────────────
// The human ruling: the dynamic cap was a "boolean disguised as a number" (cap history 4/1/5/2/3,
// switching only with suite-running). effective_cap must be 5 REGARDLESS of load state — a suite
// running or not, cpu pressure GO or EXTREME, budget idle or saturated. This is the Contract's
// `effective_cap_stability` band: the CLI output is 5 in every state.
