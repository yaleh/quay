// @test-group governance
// cap-from-gate.test.mjs — gap-adaptive-concurrency-cap-tied-to-resource-gate. Pins the ADAPTIVE
// concurrency cap mechanism (plugin/scripts/cap-from-gate.ts) that replaces the fixed cap=3:
//
//   AC1 — cap read AT the dispatch decision point (the helper is the mechanism the tick calls in
//         step 4; no new polling — a single read per tick, reused by ready-pool floor + dispatch)
//   AC2 — reads cpu `some avg300` (5-min window), NOT avg10 (10s) — the signal/actuator time-scale
//         match. Test: a high avg10 with low avg300 still yields GO (avg300 is the signal, not avg10).
//   AC3 — hysteresis (negative control): ONE avg300 sample pointing at a new band does NOT switch;
//         `samples` consecutive same-direction readings do. avg10 near-threshold jitter (which the
//         avg300 smoothing already absorbs) must never amplify into dispatch jitter.
//   AC4 — bands configurable: numbers come from .quay/config.yml loop:concurrency_bands
//         (quay default 5/2/1; override e.g. 4/2/1 takes effect). Mechanism shared, numbers per-project.
//   AC5 — resources empty (low avg300) ⇒ GO band ⇒ cap >= 3 (throughput above the old fixed 3).
//   AC6 — high avg300 (e.g. another project saturating the host) ⇒ WAIT/EXTREME band ⇒ cap drops
//         (does not add load).
//   AC7 — ownership: the mechanism lives in quay's plugin/scripts (downstream adopts via upgrade
//         channel, never re-invents). Asserted by the file being under plugin/scripts/ + the thin
//         bash wrapper for the Contract invocation form.
//   AC8 — cross-referenced with resource-gate (signal) + concurrent-batch-scheduler (the disjointness
//         gate at the same decision point) + SPEC-isolation (the containerized-resource-governance spec).
//
// The DoD's live-system controls (real empty-host dispatch >= 3; real archguard-high-load fallback;
// real config override) are recorded in the task body — the unit/integration tests here pin the same
// mechanism deterministically via the resource-gate env seams (RESOURCE_GATE_TEST_CPU_AVG300).
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

// ── AC2: the signal is avg300, not avg10 ───────────────────────────────────────────────────────────
test("AC2 — computeDesiredBand maps avg300 (5-min) to GO/WAIT/EXTREME bands; avg10 is NOT consulted", () => {
  assert.equal(computeDesiredBand(0), "GO");
  assert.equal(computeDesiredBand(39.99), "GO");
  assert.equal(computeDesiredBand(WAIT_THRESHOLD), "WAIT");
  assert.equal(computeDesiredBand(55), "WAIT");
  assert.equal(computeDesiredBand(EXTREME_THRESHOLD), "EXTREME");
  assert.equal(computeDesiredBand(99), "EXTREME");
  // Unmeasurable signal fails closed to the lowest band (never a quietly-high cap).
  assert.equal(computeDesiredBand(null), "EXTREME");
});

test("AC2 — the full decision reads avg300, NOT avg10: high avg10 + low avg300 ⇒ GO; low avg10 + high avg300 ⇒ EXTREME", (t) => {
  // Fresh state per case (each is a cold-start first decision — no prior band to be consistent against).
  // avg10 screams WAIT (84.77) but avg300 is low (12) → the 5-minute trend says resources are empty.
  const s1 = tmpState("avg300a");
  const r1 = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: s1,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "84.77", RESOURCE_GATE_TEST_CPU_AVG300: "12" },
  });
  assert.equal(r1.band, "GO", "avg300 (not avg10) decides the band");
  assert.ok(r1.effective_cap >= 3, `GO band must be >= 3, got ${r1.effective_cap}`);
  // avg10 is calm (10) but avg300 is 84 → the 5-minute trend says the host is saturated.
  const s2 = tmpState("avg300b");
  const r2 = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: s2,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "10", RESOURCE_GATE_TEST_CPU_AVG300: "84" },
  });
  assert.equal(r2.band, "EXTREME", "high avg300 must fall to EXTREME regardless of a calm avg10");
  assert.equal(r2.effective_cap, DEFAULT_BANDS.extreme_wait);
});

// ── AC5/AC6: the cap tracks resources ──────────────────────────────────────────────────────────────
test("AC5 — resources empty (low avg300) ⇒ GO band ⇒ cap >= 3 (cold-start first decision adopts immediately)", (t) => {
  const state = tmpState("go");
  const r = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: state,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG300: "12" },
  });
  assert.equal(r.band, "GO");
  assert.ok(r.effective_cap >= 3, `GO cap must be >= 3 (throughput above fixed 3), got ${r.effective_cap}`);
  // The state file is written (a real decision was made and persisted).
  const persisted = loadState(state);
  assert.equal(persisted.band, "GO");
});

test("AC6 — high avg300 (host saturated by another project) ⇒ WAIT then EXTREME ⇒ cap drops", (t) => {
  const state = tmpState("high");
  // Cold start with LOW avg300 establishes GO (AC5 — resources empty ⇒ cap >= 3).
  const cold = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: state,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG300: "12" },
  });
  assert.equal(cold.band, "GO");
  assert.ok(cold.effective_cap >= 3);
  // First high sample (avg300=55): desired WAIT but hysteresis holds GO (consecutive=1). One sample
  // must NOT switch — the negative control.
  const first = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: state,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG300: "55" },
  });
  assert.equal(first.band, "GO", "single sample must NOT switch (hysteresis)");
  assert.equal(first.consecutive, 1);
  // Second consecutive high sample → switches to WAIT (cap 2).
  const second = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: state,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG300: "55" },
  });
  assert.equal(second.band, "WAIT", "two consecutive same-direction samples switch");
  assert.equal(second.effective_cap, DEFAULT_BANDS.wait, "WAIT cap is the configured value");
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

test("AC3 — avg10 near-threshold jitter cannot flip the band because the decision is avg300-only (integration)", (t) => {
  const state = tmpState("jitter");
  // Two samples alternating near the gate's avg10 threshold (40) but with STABLE low avg300.
  const r1 = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: state,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "39", RESOURCE_GATE_TEST_CPU_AVG300: "12" },
  });
  const r2 = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: state,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "41", RESOURCE_GATE_TEST_CPU_AVG300: "12" },
  });
  assert.equal(r1.band, "GO");
  assert.equal(r2.band, "GO", "avg10 jitter (39→41) with stable avg300 must NOT flip the band");
  assert.equal(r2.effective_cap, r1.effective_cap, "cap stays constant under avg10 jitter");
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

test("AC4 — the effective cap follows an injected band config (mechanism shared, numbers per-project)", (t) => {
  // Fresh state per case — each is a cold-start first decision with the injected bands.
  // EXTREME (high avg300) with archguard bands 4/2/1 → cap 1 (extreme_wait is 1 in both configs).
  const s1 = tmpState("cfgcap-x");
  const r = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: s1,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG300: "90" },
    bands: { go: 4, wait: 2, extreme_wait: 1 },
  });
  assert.equal(r.band, "EXTREME");
  assert.equal(r.effective_cap, 1);
  // GO band with archguard bands → cap 4 (config change ⇒ mechanism follows).
  const s2 = tmpState("cfgcap-go");
  const r2 = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: s2,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG300: "12" },
    bands: { go: 4, wait: 2, extreme_wait: 1 },
  });
  assert.equal(r2.band, "GO");
  assert.equal(r2.effective_cap, 4, "config GO=4 takes effect");
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
  const env = { ...process.env, RESOURCE_GATE_TEST_CPU_AVG300: "12" };
  const res = spawnSync("bash", [CAP_SCRIPT, "--state", state], { cwd: REPO_ROOT, encoding: "utf8", env });
  assert.equal(res.status, 0, `cap-from-gate.sh must exit 0\n${res.stdout}${res.stderr}`);
  const capLine = res.stdout.split("\n").filter((l) => l.startsWith("effective_cap=")).pop();
  assert.match(capLine, /^effective_cap=\d+$/, `last line must be effective_cap=N, got: ${capLine}`);
  assert.ok(Number(capLine.split("=")[1]) >= 3, "low avg300 ⇒ cap >= 3");
  // The Contract measure form: the stdout's digit segment contains the cap.
  const digits = (res.stdout.match(/[0-9]/g) || []);
  assert.ok(digits.length > 0, "stdout must carry a digit segment (Contract measure)");
});

test("resource-gate.sh itself reports the avg300 line (single source for the signal)", () => {
  const src = fs.readFileSync(GATE, "utf8");
  assert.match(src, /avg300=/, "resource-gate must parse the some avg300 field");
  const env = { ...process.env, RESOURCE_GATE_TEST_CPU_AVG300: "12.34" };
  const r = spawnSync("bash", [GATE], { cwd: REPO_ROOT, encoding: "utf8", env });
  assert.match(r.stdout, /cpu_stall\(some avg300\)=12\.34/, "report mode must print the avg300 line");
});
