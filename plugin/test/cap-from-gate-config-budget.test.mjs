// @test-group engine
// cap-from-gate-config-budget.test.mjs — gap-fixed-cap-5-dynamic-cap-retired. The DYNAMIC adaptive
// concurrency cap is RETIRED (human ruling 2026-08-09): effective_cap is the FIXED constant 5,
// regardless of cpu pressure / suite state / process budget. The band + hysteresis + budget logic
// still RUNS as PURE OBSERVATION (the signal/band/budget lines the CLI prints) and is pinned here
// as observation, but it participates in NO decision — effective_cap is always the configured worker cap.
//
// SPLIT NOTE (gap-suite-floor-two-longest-files-bound): this is one of FIVE files split from the
// original cap-from-gate.test.mjs (166s main-phase floor) by test concern — this file holds the
// CROSS-LAYER BUDGET-observation, the SEAM-hermeticity (round-5 red, cluster B), the AC4
// configurable-bands tests, and the two resource-gate report-surface tests (avg10/avg300 lines +
// cross-gate dead-zone alignment). The `@test-group engine` declaration is preserved so the
// main-phase membership stays byte-identical.
//
// History (retired mechanism, kept for the observation semantics): the B face (dispatch slot cap)
// USED to read the same total process budget as test.sh's worker derivation and resource-gate.sh
// (process-budget.sh — single authority) and bound the effective cap: budget exhausted → cap dropped
// to the floor (1). RETIRED as a decision input: the budget is now READ ONLY as observation (the
// printed `budget:` line). A saturated host no longer drops the cap — effective_cap is the fixed 5
// even when available=0.
//
// The DoD's live-system controls are recorded in the task body — the unit/integration tests here
// pin the fixed-cap semantics deterministically via the resource-gate env seams
// (RESOURCE_GATE_TEST_CPU_AVG10 / RESOURCE_GATE_TEST_NODE_PROCS / RESOURCE_GATE_TEST_NPROC).
//
// Run:
//   scripts/test.sh plugin/test/cap-from-gate-config-budget.test.mjs
//   node --test plugin/test/cap-from-gate-config-budget.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  computeDesiredBand,
  readBandsFromConfig,
  computeEffectiveCap,
} from "../scripts/cap-from-gate.ts";
import { driverCap } from "../scripts/driver-config.ts";

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
const GATE = path.join(REPO_ROOT, "plugin", "scripts", "resource-gate.sh");
// Expected effective_cap = the CONFIGURED worker cap (drivers.yml via driverCap), NOT a hardcoded 5 —
// gap-cap-from-gate-effective-cap-dual-source-blocks-yml-override (see cap-from-gate-bands.test.mjs).
const CONFIGURED_CAP = driverCap(REPO_ROOT, "worker");

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
  assert.equal(idle.effective_cap, CONFIGURED_CAP, `GO with room ⇒ configured cap (${CONFIGURED_CAP}), not min(GO_band, available)`);
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
  assert.equal(saturated.effective_cap, CONFIGURED_CAP, `budget exhausted ⇒ effective_cap STAYS ${CONFIGURED_CAP} (no cap drop — dynamic cap retired)`);
  assert.equal(saturated.budget_available, 0);
  // Budget constrained (available=1): the OLD behavior bounded the cap to 1; now it stays 5.
  const constrained = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: state,
    bands: TEST_BANDS,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "12", RESOURCE_GATE_TEST_NODE_PROCS: "3" },
  });
  assert.equal(constrained.effective_cap, CONFIGURED_CAP, `available=1 ⇒ effective_cap stays ${CONFIGURED_CAP}`);
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
  assert.equal(cap.effective_cap, CONFIGURED_CAP, `the seam proves the budget flows through (observation); effective_cap is still the configured cap (${CONFIGURED_CAP})`);
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
  assert.equal(r.effective_cap, CONFIGURED_CAP, `config 4/2/1 does NOT drop the cap — configured cap (${CONFIGURED_CAP})`);
  // GO band with archguard bands → observed band GO; cap still fixed 5 (config change does NOT move it).
  const s2 = tmpState("cfgcap-go");
  const r2 = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: s2,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "12", RESOURCE_GATE_TEST_NODE_PROCS: "0" },
    bands: { go: 4, wait: 2, extreme_wait: 1 },
  });
  assert.equal(r2.band, "GO");
  assert.equal(r2.effective_cap, CONFIGURED_CAP, `config GO=4 does NOT change the cap — configured cap (${CONFIGURED_CAP})`);
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
