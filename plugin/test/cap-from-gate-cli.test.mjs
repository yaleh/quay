// @test-group governance
// cap-from-gate-cli.test.mjs — gap-fixed-cap-5-dynamic-cap-retired. The DYNAMIC adaptive concurrency
// cap is RETIRED (human ruling 2026-08-09): effective_cap is the FIXED constant 5, regardless of cpu
// pressure / suite state / process budget. The band + hysteresis + budget logic still RUNS as PURE
// OBSERVATION (the signal/band/budget lines the CLI prints) and is pinned here as observation, but it
// participates in NO decision — effective_cap is always FIXED_EFFECTIVE_CAP (5).
//
// SPLIT NOTE (gap-suite-floor-two-longest-files-bound): this is one of FIVE files split from the
// original cap-from-gate.test.mjs (166s main-phase floor) by test concern — this file holds the
// MECHANISM-SURFACE tests: the AC1/AC7 wrapper, AC8 cross-references, the CLI smoke, and the
// FIXED-CAP retirement matrix (the 8-sample FIXED-CAP run is the file's dominant cost; the
// resource-gate report-line + dead-zone tests moved to cap-from-gate-config-budget.test.mjs to
// keep every file under the 50s band with margin). The `@test-group governance` declaration is
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
const CAP_SCRIPT = path.join(REPO_ROOT, "plugin", "scripts", "cap-from-gate.sh");

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
