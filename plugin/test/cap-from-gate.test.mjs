// @test-group governance
// cap-from-gate.test.mjs — gap-adaptive-concurrency-cap-tied-to-resource-gate →
// gap-cap-from-gate-avg300-driven-by-claude-session-churn-structural-cap-2. Pins the ADAPTIVE
// concurrency cap mechanism (plugin/scripts/cap-from-gate.ts) that replaces the fixed cap=3:
//
//   AC1 — cap read AT the dispatch decision point (the helper is the mechanism the tick calls in
//         step 4; no new polling — a single read per tick, reused by ready-pool floor + dispatch)
//   AC2 — reads cpu `some avg10` (the responsive signal), NOT `some avg300` (measured churn-dominated:
//         stable 50-55, barely moves under dispatch-class load, +1.5pt vs avg10's +26pt under a 4-core
//         injection). Test: the churn baseline (avg10 42-54) is GO, real overload (avg10 68) is WAIT —
//         regardless of what avg300 says. avg10's 10s window is safe because hysteresis + dispatch-point
//         sampling (25-min ticks) make the switch slow (2 same-direction readings = sustained load).
//   AC3 — hysteresis (negative control): ONE avg10 sample pointing at a new band does NOT switch;
//         `samples` consecutive same-direction readings do. avg10 near-threshold jitter must never
//         amplify into dispatch jitter.
//   AC4 — bands configurable: numbers come from .quay/config.yml loop:concurrency_bands
//         (quay default 5/2/1; override e.g. 4/2/1 takes effect). Mechanism shared, numbers per-project.
//   AC5 — resources empty (low avg10) ⇒ GO band ⇒ cap equals the configured GO value (quay default 5; per-project override respected).
//   AC6 — high avg10 (e.g. another project saturating the host) ⇒ WAIT/EXTREME band ⇒ cap drops
//         (does not add load).
//   AC7 — ownership: the mechanism lives in quay's plugin/scripts (downstream adopts via upgrade
//         channel, never re-invents). Asserted by the file being under plugin/scripts/ + the thin
//         bash wrapper for the Contract invocation form.
//   AC8 — cross-referenced with resource-gate (signal) + concurrent-batch-scheduler (the disjointness
//         gate at the same decision point) + SPEC-isolation (the containerized-resource-governance spec).
//
// The DoD's live-system controls (real empty-host dispatch >= 3; real 4-core-injection downgrade;
// real config override) are recorded in the task body — the unit/integration tests here pin the same
// mechanism deterministically via the resource-gate env seams (RESOURCE_GATE_TEST_CPU_AVG10).
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

// Hermetic bands injected into every GO/WAIT/EXTREME assertion (ad-arm1 gate #3: the original fix
// asserted `=== DEFAULT_BANDS.go` — but DEFAULT_BANDS.go is 5 only on THIS machine's config; a
// project (B / ad-arm1) whose .quay/config.yml overrides concurrency_bands go:2 fails. The test
// must assert against a KNOWN injected value, never the machine-local config). TEST_BANDS is a
// deliberately non-default value (go:3) so a test that accidentally reads machine config FAILS
// loudly instead of passing by coincidence.
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
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "53", RESOURCE_GATE_TEST_CPU_AVG300: "54.5" },
  });
  assert.equal(r1.band, "GO", "avg10 (not avg300) decides the band — session churn alone must not cap");
  assert.equal(r1.effective_cap, TEST_BANDS.go, `GO band must equal the injected hermetic value, got ${r1.effective_cap}`);
  // real overload: 4-core injection moved avg10 to 68 while avg300 stayed ~53.7 (only +1.5pt) → WAIT.
  // The responsive signal sees the overload the avg300 could not.
  const s2 = tmpState("avg10b");
  const r2 = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: s2,
    bands: TEST_BANDS,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "68", RESOURCE_GATE_TEST_CPU_AVG300: "53.7" },
  });
  assert.equal(r2.band, "WAIT", "high avg10 (real overload) must downgrade even though avg300 is unchanged");
  assert.equal(r2.effective_cap, TEST_BANDS.wait);
});

// ── AC5/AC6: the cap tracks resources ──────────────────────────────────────────────────────────────
test("AC5 — resources empty (low avg10) ⇒ GO band ⇒ cap equals the configured GO value (cold-start first decision adopts immediately)", (t) => {
  const state = tmpState("go");
  const r = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: state,
    bands: TEST_BANDS,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "12" },
  });
  assert.equal(r.band, "GO");
  assert.equal(r.effective_cap, TEST_BANDS.go, `GO cap must equal the injected hermetic value, got ${r.effective_cap}`);
  // The state file is written (a real decision was made and persisted).
  const persisted = loadState(state);
  assert.equal(persisted.band, "GO");
});

test("AC6 — high avg10 (host saturated by another project) ⇒ WAIT then EXTREME ⇒ cap drops", (t) => {
  const state = tmpState("high");
  // Cold start with LOW avg10 establishes GO (AC5 — resources empty ⇒ cap >= 3).
  const cold = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: state,
    bands: TEST_BANDS,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "12" },
  });
  assert.equal(cold.band, "GO");
  assert.equal(cold.effective_cap, TEST_BANDS.go);
  // First overloaded sample (avg10=68 — the measured 4-core-injection reading): desired WAIT but
  // hysteresis holds GO (consecutive=1). One sample must NOT switch — the negative control.
  const first = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: state,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "68" },
  });
  assert.equal(first.band, "GO", "single sample must NOT switch (hysteresis)");
  assert.equal(first.consecutive, 1);
  // Second consecutive overloaded sample → switches to WAIT (cap 2).
  const second = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: state,
    bands: TEST_BANDS,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "68" },
  });
  assert.equal(second.band, "WAIT", "two consecutive same-direction samples switch");
  assert.equal(second.effective_cap, TEST_BANDS.wait, "WAIT cap is the injected hermetic value");
  // A single EXTREME sample (avg10=90) from WAIT holds (hysteresis: consecutive=1), then a second
  // consecutive EXTREME sample escalates → EXTREME (cap 1).
  const third = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: state,
    bands: TEST_BANDS,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "90" },
  });
  assert.equal(third.band, "WAIT", "single EXTREME sample must not skip WAIT (hysteresis)");
  assert.equal(third.consecutive, 1);
  const fourth = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: state,
    bands: TEST_BANDS,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "90" },
  });
  assert.equal(fourth.band, "EXTREME", "sustained heavy overload escalates to EXTREME");
  assert.equal(fourth.effective_cap, TEST_BANDS.extreme_wait);
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
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "39", RESOURCE_GATE_TEST_CPU_AVG300: "54" },
  });
  const r2 = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: state,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "41", RESOURCE_GATE_TEST_CPU_AVG300: "54" },
  });
  assert.equal(r1.band, "GO");
  assert.equal(r2.band, "GO", "avg10 jitter (39→41) below WAIT=60 must NOT flip the band");
  assert.equal(r2.effective_cap, r1.effective_cap, "cap stays constant under avg10 jitter");
  // A single above-threshold sample (68, real overload) must NOT flip an established GO either —
  // the negative control holds for the responsive signal too.
  const r3 = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: state,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "68" },
  });
  assert.equal(r3.band, "GO", "single above-threshold sample must NOT switch (hysteresis)");
  assert.equal(r3.consecutive, 1, "one WAIT-ward sample accumulates to consecutive=1");
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
  // EXTREME (avg10=90 ≥ 85) with archguard bands 4/2/1 → cap 1 (extreme_wait is 1 in both configs).
  const s1 = tmpState("cfgcap-x");
  const r = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: s1,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "90" },
    bands: { go: 4, wait: 2, extreme_wait: 1 },
  });
  assert.equal(r.band, "EXTREME");
  assert.equal(r.effective_cap, 1);
  // GO band with archguard bands → cap 4 (config change ⇒ mechanism follows).
  const s2 = tmpState("cfgcap-go");
  const r2 = computeEffectiveCap({
    repoRoot: REPO_ROOT,
    stateFile: s2,
    env: { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "12" },
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
  const env = { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "12" };
  const res = spawnSync("bash", [CAP_SCRIPT, "--state", state], { cwd: REPO_ROOT, encoding: "utf8", env });
  assert.equal(res.status, 0, `cap-from-gate.sh must exit 0\n${res.stdout}${res.stderr}`);
  const capLine = res.stdout.split("\n").filter((l) => l.startsWith("effective_cap=")).pop();
  assert.match(capLine, /^effective_cap=\d+$/, `last line must be effective_cap=N, got: ${capLine}`);
  assert.ok(Number(capLine.split("=")[1]) >= 3, "low avg10 ⇒ cap >= 3");
  // The Contract measure form: the stdout's digit segment contains the cap.
  const digits = (res.stdout.match(/[0-9]/g) || []);
  assert.ok(digits.length > 0, "stdout must carry a digit segment (Contract measure)");
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
