// gate-dispatch-coverage.test.mjs — gap-gate-registration-vs-dispatch-unmeasured: RED/GREEN tests
// for the gate-dispatch-coverage REPORT tool (gate-dispatch-coverage.ts, byte-identical mirror via
// experiments/quay-perpetual-stream/scripts/gate-dispatch-coverage.ts symlink). Covers AC2–AC6
// (fixture tests) plus AC1 (mirror), AC8 (constant exit 0), AC9 (zero writes) and the AC10/DoD
// real-repo baseline run.
//
// DoD grouping note: `// @test-group engine` is intentionally NOT added — the dependency task
// (gap-test-suite-has-no-layer-grouping) is not yet merged and no existing plugin/test file shows
// the annotation, so the default (un-grouped) convention is used.
//
// Run:
//   scripts/test.sh plugin/test/gate-dispatch-coverage.test.mjs
//   node --test plugin/test/gate-dispatch-coverage.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// REPO_ROOT must resolve to the same directory regardless of where this test lives.
function _findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, ".quay", "config.yml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Cannot find repo root: no .quay/config.yml found upward from " + startDir);
}
const REPO_ROOT = _findRepoRoot(__dirname);
const PLUGIN_SCRIPTS = path.join(REPO_ROOT, "plugin", "scripts");
const EXP_SCRIPTS = path.join(REPO_ROOT, "experiments", "quay-perpetual-stream", "scripts");
const CLI = path.join(PLUGIN_SCRIPTS, "gate-dispatch-coverage.ts");
const CLI_MIRROR = path.join(EXP_SCRIPTS, "gate-dispatch-coverage.ts");
const SRC = fs.readFileSync(CLI, "utf8");

// ── Fixture workspace ────────────────────────────────────────────────────────────────────────────────

const FIXTURE_CONFIG = `gates:
  it0:
    - name: line-budget
      script: "./experiments/quay-perpetual-stream/scripts/it0-ceiling-line-budget-check.sh"
      argsKey: lineBudgetArgs
    - name: alpha-check
      script: "./plugin/scripts/alpha-check.sh"
      argsKey: alphaArgs
  fixed:
    - name: never-run
      script: "./plugin/scripts/never-run.sh"
    - name: omega-gate
      script: "./plugin/scripts/omega-gate.sh"
  testPass:
    - name: split-or-commit
      command: "node plugin/scripts/it0-split-or-commit-check.ts ."
`;

const FIXTURE_WORKFLOW = `// Gate phase (fixture)
const gates = await parallel([
  () => agent(\`Run omega-gate.sh. \${_typedMilestoneGateReturn} Non-zero → HARD BLOCK.\`, { label: 'omega', schema: _milestoneGateSchema }),
  () => agent(\`Run it0-dashboard-line-budget-check.sh. \${_typedMilestoneGateReturn}\`, { label: 'dash-budget', schema: _milestoneGateSchema }),
])
// Post-land split-or-commit
bash plugin/scripts/it0-split-or-commit-check.sh .
`;

const FIXTURE_DOD = `// Clause 3: Line-budget gate — reuse it0-ceiling-line-budget-check.sh directly
const scriptPath = path.join(__dirname, "it0-ceiling-line-budget-check.sh");
// Clause 4: alpha gate
const scriptPath2 = path.join(__dirname, "alpha-check.sh");
`;

const FIXTURE_CI = `jobs:
  test:
    steps:
      - run: bash omega-gate.sh
`;

const FIXTURE_OUTER_LOOP = `→ ∀c∈batch: alpha_check(c) -- scripts/alpha-check.sh
`;

function makeTmpWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gate-dispatch-"));
}

function cleanup(tmpRoot) {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

function writeFixture(tmpRoot) {
  const dirs = [
    path.join(tmpRoot, ".quay"),
    path.join(tmpRoot, ".claude", "workflows"),
    path.join(tmpRoot, ".github", "workflows"),
    path.join(tmpRoot, "experiments", "quay-perpetual-stream", "scripts"),
    path.join(tmpRoot, "experiments", "quay-perpetual-stream"),
  ];
  for (const d of dirs) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, ".quay", "config.yml"), FIXTURE_CONFIG);
  fs.writeFileSync(path.join(tmpRoot, ".claude", "workflows", "execute-milestone.js"), FIXTURE_WORKFLOW);
  fs.writeFileSync(path.join(tmpRoot, "experiments", "quay-perpetual-stream", "scripts", "it0-dod-check.ts"), FIXTURE_DOD);
  fs.writeFileSync(path.join(tmpRoot, ".github", "workflows", "ci.yml"), FIXTURE_CI);
  fs.writeFileSync(path.join(tmpRoot, "experiments", "quay-perpetual-stream", "OUTER-LOOP.md"), FIXTURE_OUTER_LOOP);
}

function runCli(tmpRoot, ...args) {
  const res = spawnSync("node", ["--experimental-strip-types", CLI, "--root", tmpRoot, ...args], {
    encoding: "utf8",
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function runCliJson(tmpRoot) {
  const r = runCli(tmpRoot, "--json");
  assert.equal(r.status, 0, `CLI must exit 0 (AC8); stderr: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

function lineOf(text, needle) {
  const idx = text.indexOf(needle);
  assert.ok(idx >= 0, `fixture must contain ${needle}`);
  return text.slice(0, idx).split("\n").length;
}

function refsContain(dispatchedBy, file, needleLineText, fullText) {
  const line = lineOf(fullText, needleLineText);
  return dispatchedBy.some((r) => r.file === file && r.line === line);
}

// ── AC1: mirror — plugin/scripts real file + experiments symlink, byte-identical ─────────────────────

test("AC1: plugin/scripts is a real file and experiments is a byte-identical symlink", () => {
  assert.ok(fs.existsSync(CLI), "plugin/scripts/gate-dispatch-coverage.ts must exist");
  assert.ok(fs.existsSync(CLI_MIRROR), "experiments/.../gate-dispatch-coverage.ts must exist");
  const stPlugin = fs.statSync(CLI);
  assert.ok(stPlugin.isFile(), "plugin/scripts copy must be a REAL file");
  assert.ok(fs.lstatSync(CLI_MIRROR).isSymbolicLink(), "experiments copy must be a SYMLINK");
  const realTarget = fs.realpathSync(CLI_MIRROR);
  assert.equal(realTarget, CLI, "symlink must resolve to the plugin/scripts real file");
  assert.ok(
    fs.readFileSync(CLI, "utf8") === fs.readFileSync(CLI_MIRROR, "utf8"),
    "symlink must read byte-identical to the real file (cmp -s equivalent)"
  );
});

// ── AC2: parse config → all registered gates, count assertable ───────────────────────────────────────

test("AC2: parses .quay/config.yml gates: → all registered gates (count assertable)", () => {
  const tmp = makeTmpWorkspace();
  try {
    writeFixture(tmp);
    const report = runCliJson(tmp);
    const names = report.registered.map((g) => g.name);
    assert.equal(report.registered.length, 5, "fixture registers exactly 5 gates");
    for (const n of ["line-budget", "alpha-check", "never-run", "omega-gate", "split-or-commit"]) {
      assert.ok(names.includes(n), `registered gates must include ${n}; got ${names}`);
    }
    // testPass gate keeps its command as `script` (AC7: name+script shape)
    const soc = report.registered.find((g) => g.name === "split-or-commit");
    assert.equal(soc.script, "node plugin/scripts/it0-split-or-commit-check.ts .");
  } finally {
    cleanup(tmp);
  }
});

// ── AC3: per-gate dispatched-by reference points (file:line) across the 4 surfaces ───────────────────

test("AC3: dispatchers are reported as file:line reference points per registered gate", () => {
  const tmp = makeTmpWorkspace();
  try {
    writeFixture(tmp);
    const report = runCliJson(tmp);

    // omega-gate: dispatched in the workflow Gate phase AND the CI job
    const omega = report.registered.find((g) => g.name === "omega-gate");
    assert.ok(refsContain(omega.dispatchedBy, ".claude/workflows/execute-milestone.js", "Run omega-gate.sh", FIXTURE_WORKFLOW), "omega-gate must be referenced by the workflow Gate phase");
    assert.ok(refsContain(omega.dispatchedBy, ".github/workflows/ci.yml", "bash omega-gate.sh", FIXTURE_CI), "omega-gate must be referenced by the CI job");

    // alpha-check: dispatched from it0-dod-check.ts clause AND OUTER-LOOP.md
    const alpha = report.registered.find((g) => g.name === "alpha-check");
    assert.ok(refsContain(alpha.dispatchedBy, "experiments/quay-perpetual-stream/scripts/it0-dod-check.ts", "alpha-check.sh", FIXTURE_DOD), "alpha-check must be referenced by it0-dod-check.ts");
    assert.ok(refsContain(alpha.dispatchedBy, "experiments/quay-perpetual-stream/OUTER-LOOP.md", "scripts/alpha-check.sh", FIXTURE_OUTER_LOOP), "alpha-check must be referenced by OUTER-LOOP.md");

    // split-or-commit (testPass command gate): dispatched via `quay gate`-style name reference
    const soc = report.registered.find((g) => g.name === "split-or-commit");
    assert.ok(refsContain(soc.dispatchedBy, ".claude/workflows/execute-milestone.js", "it0-split-or-commit-check.sh", FIXTURE_WORKFLOW), "split-or-commit must be dispatched via the workflow");
  } finally {
    cleanup(tmp);
  }
});

// ── AC4: no-known-dispatcher for a never-referenced gate; never the word "dead" ──────────────────────

test("AC4: undispatched gates report no-known-dispatcher and output never says 'dead'", () => {
  const tmp = makeTmpWorkspace();
  try {
    writeFixture(tmp);
    const report = runCliJson(tmp);
    const never = report.registered.find((g) => g.name === "never-run");
    assert.equal(never.dispatchedBy.length, 0, "never-run must have zero dispatchers");
    const undispatchedNames = report.undispatched.map((g) => g.name);
    assert.ok(undispatchedNames.includes("never-run"), "never-run must be in the undispatched list");
    // plain-text output also marks it as no-known-dispatcher
    const plain = runCli(tmp);
    assert.equal(plain.status, 0);
    assert.match(plain.stdout, /never-run[\s\S]*?no-known-dispatcher/, "plain output must mark never-run as no-known-dispatcher");
    assert.ok(!/dead/i.test(JSON.stringify(report)), "the word 'dead' must NEVER appear (AC4)");
    assert.ok(!/dead/i.test(plain.stdout), "the word 'dead' must never appear in plain output (AC4)");
  } finally {
    cleanup(tmp);
  }
});

// ── AC5: reverse — dispatched-but-unregistered scripts are listed ────────────────────────────────────

test("AC5: reverse detection lists scripts dispatched but NOT registered (it0-dashboard-line-budget-check.sh)", () => {
  const tmp = makeTmpWorkspace();
  try {
    writeFixture(tmp);
    const report = runCliJson(tmp);
    const dash = report.unregistered.find((u) => u.script === "it0-dashboard-line-budget-check.sh");
    assert.ok(dash, "unregistered list must include it0-dashboard-line-budget-check.sh (known fixture instance)");
    assert.ok(refsContain(dash.dispatchedBy, ".claude/workflows/execute-milestone.js", "it0-dashboard-line-budget-check.sh", FIXTURE_WORKFLOW), "the unregistered script must carry its dispatch reference");
    // a registered script must NOT appear in unregistered
    assert.ok(!report.unregistered.some((u) => u.script === "omega-gate.sh"), "registered script must not be listed as unregistered");
  } finally {
    cleanup(tmp);
  }
});

// ── AC6: registration-name vs run-script mismatch is identified ──────────────────────────────────────

test("AC6: line-budget registers it0-ceiling-… but the live script is it0-dashboard-…", () => {
  const tmp = makeTmpWorkspace();
  try {
    writeFixture(tmp);
    const report = runCliJson(tmp);
    const mm = report.mismatches.find((m) => m.gate === "line-budget");
    assert.ok(mm, "mismatches must include the line-budget gate");
    assert.equal(mm.registeredScript, "it0-ceiling-line-budget-check.sh");
    assert.equal(mm.liveScript, "it0-dashboard-line-budget-check.sh");
    assert.equal(mm.kind, "different-script", "ceiling vs dashboard is a real (non-wrapper) mismatch");
  } finally {
    cleanup(tmp);
  }
});

// ── AC8 / AC9: constant exit 0 and zero writes ───────────────────────────────────────────────────────

test("AC8: constant exit 0 — even with a missing config / missing surfaces", () => {
  const tmp = makeTmpWorkspace();
  try {
    // Empty workspace: no config, no surfaces → must still exit 0 and emit an empty-shaped report.
    const r = runCli(tmp, "--json");
    assert.equal(r.status, 0, "CLI must exit 0 on an empty workspace");
    const report = JSON.parse(r.stdout);
    assert.ok(Array.isArray(report.registered));
    assert.ok(Array.isArray(report.undispatched));
    assert.ok(Array.isArray(report.unregistered));
    assert.ok(Array.isArray(report.mismatches));
    assert.ok(!/process\.exit\(\s*[1-9]/.test(SRC), "no non-zero process.exit path in source");
  } finally {
    cleanup(tmp);
  }
});

test("AC9: zero writes — no writeFile/appendFile/createWriteStream in the tool source", () => {
  for (const needle of ["writeFile", "writeFileSync", "appendFile", "appendFileSync", "createWriteStream", "mkdtempSync", "mkdirSync"]) {
    assert.ok(!SRC.includes(needle), `tool source must not call ${needle} (AC9)`);
  }
});

// ── AC10 / DoD: real-repo baseline run ───────────────────────────────────────────────────────────────

test("AC10/DoD: real-repo run produces a gate-dispatch baseline (exit 0)", () => {
  const r = runCli(REPO_ROOT, "--json");
  assert.equal(r.status, 0, "real-repo CLI must exit 0");
  const report = JSON.parse(r.stdout);
  assert.ok(report.registered.length >= 15, `registered gates must be >= the 15 the task claims; got ${report.registered.length}`);
  assert.ok(Array.isArray(report.undispatched), "undispatched array present");
  assert.ok(Array.isArray(report.unregistered), "unregistered array present");
  assert.ok(Array.isArray(report.mismatches), "mismatches array present");
  // Every registered gate must carry a name, script and dispatchedBy array (AC7 shape).
  for (const g of report.registered) {
    assert.ok(typeof g.name === "string" && g.name.length > 0, "registered.name present");
    assert.ok(typeof g.script === "string" && g.script.length > 0, "registered.script present");
    assert.ok(Array.isArray(g.dispatchedBy), "registered.dispatchedBy present");
  }
});
