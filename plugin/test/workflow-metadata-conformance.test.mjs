// @test-group engine
// workflow-metadata-conformance.test.mjs — DIR-124-A4: RED/GREEN + regression tests for
// workflow-metadata-conformance.mjs, the workflow metadata-vs-executable-driver conformance checker.
//
// Covers:
//   RED   — stale fixture (phantom DeadPhase + body-only ExtraPhase + stale 'building' + unclaimed
//           'needs-human') exits 1 with phase-set + return-outcome FAILs
//   GREEN — corrected fixture (meta matches body) exits 0
//   REAL  — both real workflow files are parseable and produce the documented RED baseline
//           findings (the "real-sourcefiles-were-parseable" regression)
//   C5    — both checker mirrors are byte-identical
//   C4    — fixture filenames never appear in .claude/workflows/
//   C3    — --json output carries failures[]/warnings[] and exit code is driven only by failures
//   C8    — node --no-warnings convention divergence WARN (and its documented-intent escape hatch)
//   AC15  — extraction functions are pure and independently exercised
//
// Run:
//   node --test plugin/test/workflow-metadata-conformance.test.mjs
//   scripts/test.sh plugin/test/workflow-metadata-conformance.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Repo root differs by test location: plugin/test/ (2 levels up), experiments/.../test/ (3 levels up).
// Use .git presence to detect the correct root for both locations.
const REPO_ROOT = (() => {
  const try2 = path.resolve(__dirname, "..", "..");
  if (fs.existsSync(path.join(try2, ".git"))) return try2;
  const try3 = path.resolve(__dirname, "..", "..", "..");
  if (fs.existsSync(path.join(try3, ".git"))) return try3;
  throw new Error("Cannot find repo root from " + __dirname);
})();
const SCRIPT = path.resolve(REPO_ROOT, "experiments", "quay-perpetual-stream", "scripts", "workflow-metadata-conformance.mjs");
const SCRIPT_MIRROR = path.resolve(REPO_ROOT, "plugin", "scripts", "workflow-metadata-conformance.mjs");
const FIX = path.resolve(REPO_ROOT, "experiments", "quay-perpetual-stream", "test", "fixtures");
const STALE_FIX = path.join(FIX, "workflow-metadata-conformance-stale.js");
const CLEAN_FIX = path.join(FIX, "workflow-metadata-conformance-clean.js");

// Surviving workflows after the prepare/execute pipeline retirement (ADR-022 /
// gap-retire-the-prepare-execute-pipeline-cluster): drain-directives + run-routines live in
// plugin/workflows/ (single source — the .claude/workflows/ dual copies were retired by
// gap-ac166-second-copy-retirement). prepare-milestone.js / execute-milestone.js are gone;
// select-preflight.js was retired with the classic OUTER-LOOP SELECT phase
// (gap-select-preflight-retirement-decision, 2026-08-16).
const REAL_DRAIN = path.resolve(REPO_ROOT, "plugin", "workflows", "drain-directives.js");
const REAL_ROUTINES = path.resolve(REPO_ROOT, "plugin", "workflows", "run-routines.js");

function runScript(args) {
  const result = spawnSync("node", [SCRIPT, ...args], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  return { status: result.status, stdout: (result.stdout || "").trim(), stderr: (result.stderr || "").trim() };
}

function parseJsonResult(result) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`script did not emit parseable JSON (status ${result.status}): stdout=${result.stdout.slice(0, 400)} stderr=${result.stderr.slice(0, 400)}`);
  }
}

// Import the pure module once (same code path the DoD clause shells out to).
let mod;
async function loadModule() {
  if (!mod) mod = await import(pathToFileURL(SCRIPT).href);
  return mod;
}

// ── C5: checker mirrors are byte-identical ────────────────────────────────────────────────────────
test("C5: both checker mirrors are byte-identical", () => {
  const a = fs.readFileSync(SCRIPT, "utf8");
  const b = fs.readFileSync(SCRIPT_MIRROR, "utf8");
  assert.equal(a, b, `experiments/scripts and plugin/scripts mirrors of workflow-metadata-conformance.mjs must be byte-identical`);
});

// ── AC2: RED/GREEN negative control ──────────────────────────────────────────────────────────────
test("AC2/RED: stale fixture (DeadPhase phantom + ExtraPhase body-only + stale 'building' + unclaimed 'needs-human') exits 1", () => {
  const r = runScript(["--files", STALE_FIX]);
  assert.equal(r.status, 1, `expected exit 1 for stale fixture, got ${r.status}: ${r.stdout}`);
  const json = parseJsonResult(runScript(["--json", "--files", STALE_FIX]));
  assert.equal(json.ok, false);
  const failures = json.failures;
  assert.ok(failures.some((f) => f.check === "phase-set" && /DeadPhase/.test(f.detail) && /never called/.test(f.detail)),
    `expected a DeadPhase phantom-phase FAIL, got: ${JSON.stringify(failures)}`);
  assert.ok(failures.some((f) => f.check === "phase-set" && /ExtraPhase/.test(f.detail) && /absent from meta/.test(f.detail)),
    `expected an ExtraPhase stale-metadata FAIL, got: ${JSON.stringify(failures)}`);
  assert.ok(failures.some((f) => f.check === "return-outcomes" && /'building'/.test(f.detail) && /stale claim/.test(f.detail)),
    `expected a 'building' stale-claim FAIL, got: ${JSON.stringify(failures)}`);
  assert.ok(failures.some((f) => f.check === "return-outcomes" && /'needs-human'/.test(f.detail) && /incomplete metadata/.test(f.detail)),
    `expected a 'needs-human' incomplete-claim FAIL, got: ${JSON.stringify(failures)}`);
});

test("AC2/GREEN: corrected fixture (meta matches body) exits 0 with no failures", () => {
  const r = runScript(["--json", "--files", CLEAN_FIX]);
  assert.equal(r.status, 0, `expected exit 0 for clean fixture, got ${r.status}: ${r.stdout}`);
  const json = parseJsonResult(r);
  assert.equal(json.ok, true);
  assert.equal(json.failures.length, 0, `clean fixture must have zero FAILs: ${JSON.stringify(json.failures)}`);
});

// ── AC3/C3: --json output shape + exit-code discipline ───────────────────────────────────────────
test("C3: --json output carries failures[]/warnings[] and only failures drive exit 1", () => {
  const r = runScript(["--json", "--files", STALE_FIX]);
  assert.equal(r.status, 1);
  const json = parseJsonResult(r);
  for (const key of ["ok", "files", "failures", "warnings"]) {
    assert.ok(key in json, `missing required key: ${key}`);
  }
  assert.ok(Array.isArray(json.failures));
  assert.ok(Array.isArray(json.warnings));
  assert.ok(json.failures.length > 0);
  assert.equal(json.ok, json.failures.length === 0);

  // WARN-only findings must NOT drive exit 1: a source with warnings but zero failures exits 0.
  // drain-directives.js is the surviving WARN-only workflow (amber return-outcomes, zero FAILs).
  const warnOnly = runScript(["--json", "--files", REAL_DRAIN]);
  const warnJson = parseJsonResult(warnOnly);
  assert.ok(warnJson.warnings.length >= 1, `expected drain-directives.js to carry warnings: ${JSON.stringify(warnJson.warnings)}`);
  assert.equal(warnJson.failures.length, 0, `drain-directives.js must have zero FAILs (WARN-only): ${JSON.stringify(warnJson.failures)}`);
  assert.equal(warnOnly.status, 0, `WARN-only run must exit 0, got ${warnOnly.status}`);
});

// ── AC4/AC5: surviving real workflows GREEN baseline + parseability regression ─────────────────────
// prepare-milestone.js / execute-milestone.js were retired (ADR-022); select-preflight.js was
// retired with the classic OUTER-LOOP SELECT phase (gap-select-preflight-retirement-decision,
// 2026-08-16). The surviving checked-in workflows are drain-directives.js + run-routines.js (single
// source in plugin/workflows/). These assertions pin the GREEN baseline for what the DoD clause now
// actually checks.
test("AC4/AC5: the surviving real workflows are parseable and produce ZERO FAILs (GREEN baseline)", async () => {
  const m = await loadModule();
  for (const file of [REAL_DRAIN, REAL_ROUTINES]) {
    const src = fs.readFileSync(file, "utf8");
    const meta = m.extractMeta(src);
    assert.equal(meta.ok, true, `extractMeta failed on ${file}: ${meta.error}`);
    assert.equal(m.extractPhases(src).uniqueLabels.length >= 1, true, `extractPhases empty on ${file}`);
    assert.equal(typeof m.extractGateDispatch(src).count, "number", `extractGateDispatch failed on ${file}`);

    const res = m.checkFile(file, src);
    assert.equal(res.failures.length, 0, `${file} must have zero FAILs (GREEN baseline): ${JSON.stringify(res.failures)}`);
  }
});

// ── AC15: extraction-function API (pure functions, independently exercised) ──────────────────────
test("AC15: extractPhases skips commented phase() references and template-literal phase(s) prose", async () => {
  const m = await loadModule();
  const src = `// phase('Commented') — not a real call\n/* phase('BlockCommented') */\nphase('Real')\nlog(\`built \${x} phase(s)\`)\n`;
  const phases = m.extractPhases(src);
  assert.deepEqual(phases.uniqueLabels, ["Real"], `must find only the real call site, got ${JSON.stringify(phases.uniqueLabels)}`);
  assert.equal(phases.callCounts.get("Real"), 1);
});

test("AC15: extractReturnOutcomes captures multi-line return objects and skips agent-prompt outcome prose", async () => {
  const m = await loadModule();
  const src = `return { outcome: 'done', reason: 'ok' }\n` +
    `return _wtRet({\n  outcome: 'building',\n  taskId: 'T1',\n})\n` +
    `const x = \`Return {outcome: "done"|"needs-human"} — instructional text\`\n`;
  const outcomes = m.extractReturnOutcomes(src);
  assert.ok(outcomes.outcomeValues.includes("done"), "must capture single-line return outcome");
  assert.ok(outcomes.outcomeValues.includes("building"), "must capture multi-line return outcome");
  assert.ok(!outcomes.outcomeValues.includes("needs-human"), "must NOT capture agent-prompt instructional outcomes");
  assert.equal(outcomes.outcomeValues.length, 2, `got ${JSON.stringify(outcomes.outcomeValues)}`);
});

test("AC15: extractNodeInvocations distinguishes --no-warnings presence in both orders", async () => {
  const m = await loadModule();
  const src = `node --experimental-strip-types a.mjs\nnode --no-warnings --experimental-strip-types b.mjs\nnode --experimental-strip-types --no-warnings c.mjs\n`;
  const nodes = m.extractNodeInvocations(src);
  assert.equal(nodes.totalCount, 3);
  assert.equal(nodes.withNoWarnings, 2, `expected 2 with --no-warnings, got ${JSON.stringify(nodes)}`);
  assert.equal(nodes.withoutNoWarnings, 1);
});

test("AC15: extractOutcomeClaims parses the description union", async () => {
  const m = await loadModule();
  const claims = m.extractOutcomeClaims(`Returns {outcome: "done"|"needs-human"|"building"}.`);
  assert.equal(claims.found, true);
  assert.deepEqual(claims.values, ["done", "needs-human", "building"]);
});

test("AC15: extractMeta handles escaped quotes in a single-quoted description", async () => {
  const m = await loadModule();
  const src = `export const meta = { name: 'x', description: 'it is DIR-117-B\\'s scope, ok', phases: [{ title: 'A', detail: 'd' }] }`;
  const meta = m.extractMeta(src);
  assert.equal(meta.ok, true);
  assert.ok(meta.description.includes("DIR-117-B's"), `escaped quote must be unescaped, got: ${JSON.stringify(meta.description)}`);
  assert.deepEqual(meta.phases.map((p) => p.title), ["A"]);
});

test("AC15: extractMeta ignores a commented-out `export const meta =` copy", async () => {
  const m = await loadModule();
  const src = `// export const meta = { name: 'fake', description: 'x', phases: [] }\nexport const meta = { name: 'real', description: 'y', phases: [{ title: 'A', detail: 'd' }] }\n`;
  const meta = m.extractMeta(src);
  assert.equal(meta.ok, true);
  assert.equal(meta.name, "real", `must extract the real (uncommented) meta declaration, got: ${JSON.stringify(meta)}`);
});

test("AC15: extractPhases does NOT count phase('X') inside a regex literal", async () => {
  const m = await loadModule();
  const src = `const re = /phase('Ghost')/\nphase('Real')\n`;
  const phases = m.extractPhases(src);
  assert.deepEqual(phases.uniqueLabels, ["Real"], `regex-literal phase('Ghost') must not be counted: ${JSON.stringify(phases.uniqueLabels)}`);
});

test("AC15: extractOutcomeClaims parses single-quoted outcome unions too", async () => {
  const m = await loadModule();
  const claims = m.extractOutcomeClaims(`Returns {outcome: 'done'|'needs-human'}.`);
  assert.equal(claims.found, true);
  assert.deepEqual(claims.values, ["done", "needs-human"]);
});

// ── AC7/AC8/AC6/Check-7: FAIL/WARN paths for mechanism-mention and gate-count checks ──────────────
test("AC7: meta claiming worktree support with zero body references is a FAIL (false claim)", async () => {
  const m = await loadModule();
  const src = `export const meta = { name: 'x', description: 'Uses per-milestone worktree isolation (DIR-123).', phases: [{ title: 'Build', detail: 'd' }] }\nphase('Build')\nreturn { outcome: 'done' }\n`;
  const res = m.checkFile("/tmp/wt-false.js", src);
  assert.ok(res.failures.some((f) => f.check === "worktree" && /false claim/.test(f.detail)),
    `expected a worktree false-claim FAIL, got: ${JSON.stringify(res.failures)}`);
});

test("AC8: meta claiming cache/resume with zero body mechanism patterns is a FAIL (stale claim)", async () => {
  const m = await loadModule();
  const src = `export const meta = { name: 'x', description: 'A real, resumable lifecycle stage with cache fingerprints.', phases: [{ title: 'Build', detail: 'd' }] }\nphase('Build')\nreturn { outcome: 'done' }\n`;
  const res = m.checkFile("/tmp/wt-stale-cache.js", src);
  assert.ok(res.failures.some((f) => f.check === "cache-resume" && /stale claim/.test(f.detail)),
    `expected a cache-resume stale-claim FAIL, got: ${JSON.stringify(res.failures)}`);
});

test("AC6: meta mentioning 'node --no-warnings --experimental-strip-types' with zero such invocations is a FAIL", async () => {
  const m = await loadModule();
  const src = `export const meta = { name: 'x', description: 'Runs node --no-warnings --experimental-strip-types for every check.', phases: [{ title: 'Verify', detail: 'runs node --no-warnings --experimental-strip-types' }] }\nphase('Verify')\nreturn { outcome: 'done' }\n`;
  const res = m.checkFile("/tmp/wt-node.js", src);
  assert.ok(res.failures.some((f) => f.check === "node-convention"),
    `expected a node-convention meta-divergence FAIL, got: ${JSON.stringify(res.failures)}`);
});

test("Check-7: meta claiming a specific gate count that mismatches the dispatch array is a WARN", async () => {
  const m = await loadModule();
  const src = `export const meta = { name: 'x', description: 'Runs the 5 gates.', phases: [{ title: 'Gate', detail: 'runs 5 gates' }] }\nphase('Gate')\nconst gates = await parallel([() => agent('a', { label: 'g1' }), () => agent('b', { label: 'g2' })])\nreturn { outcome: 'done' }\n`;
  const res = m.checkFile("/tmp/wt-gates.js", src);
  const warn = res.warnings.find((w) => w.check === "gate-count");
  assert.ok(warn, `expected a gate-count WARN, got: ${JSON.stringify(res.warnings)}`);
  assert.match(warn.detail, /5 gate\(s\)/);
});

// ── AC10: metadata-unparseable is a FAIL (exit 1), never a silent skip ───────────────────────────
test("AC10: a workflow file with no `export const meta` is a FAIL, not a silent skip", async () => {
  const m = await loadModule();
  const res = m.checkFile("/tmp/no-meta.js", `phase('Verify')\nreturn { outcome: 'done' }\n`);
  assert.ok(res.failures.some((f) => f.check === "metadata" && /metadata-unparseable/.test(f.detail)),
    `expected metadata-unparseable FAIL, got: ${JSON.stringify(res.failures)}`);
});

// ── C8: node-convention divergence WARN + documented-intent escape hatch ────────────────────────
test("C8: nodeConventionWarn fires on all-with vs all-without divergence", async () => {
  const m = await loadModule();
  const execAllWith = { totalCount: 5, withNoWarnings: 5, withoutNoWarnings: 0, callSites: [] };
  const prepAllWithout = { totalCount: 3, withNoWarnings: 0, withoutNoWarnings: 3, callSites: [] };
  const warn = m.nodeConventionWarn({
    execNodes: execAllWith, prepNodes: prepAllWithout,
    execSrc: "node --no-warnings --experimental-strip-types a.mjs",
    prepSrc: "node --experimental-strip-types b.mjs",
    execPath: "execute-milestone.js", prepPath: "prepare-milestone.js",
  });
  assert.ok(warn !== null, "divergent conventions with no doc comment must WARN");
  assert.equal(warn.check, "node-convention");
  assert.equal(warn.severity, "AMBER");
});

test("C8: nodeConventionWarn is suppressed by a documented-intent comment", async () => {
  const m = await loadModule();
  const execAllWith = { totalCount: 5, withNoWarnings: 5, withoutNoWarnings: 0, callSites: [] };
  const prepAllWithout = { totalCount: 3, withNoWarnings: 0, withoutNoWarnings: 3, callSites: [] };
  const warn = m.nodeConventionWarn({
    execNodes: execAllWith, prepNodes: prepAllWithout,
    execSrc: "// intentional --no-warnings convention divergence (C8)\nnode --no-warnings --experimental-strip-types a.mjs",
    prepSrc: "node --experimental-strip-types b.mjs",
    execPath: "execute-milestone.js", prepPath: "prepare-milestone.js",
  });
  assert.equal(warn, null, "documented divergence must NOT WARN");
});

// ── C4: fixture isolation from production workflow files ─────────────────────────────────────────
test("C4: stale/clean fixture filenames never appear in plugin/workflows/", () => {
  const workflowsDir = path.resolve(REPO_ROOT, "plugin", "workflows");
  const files = fs.readdirSync(workflowsDir).map((f) => path.join(workflowsDir, f));
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    assert.ok(!src.includes("workflow-metadata-conformance-stale"), `stale fixture basename leaked into ${f}`);
    assert.ok(!src.includes("workflow-metadata-conformance-clean"), `clean fixture basename leaked into ${f}`);
  }
});

// ── AC3/C6: DoD-gate shell-out contract (the clause runs the script with --json from repo root) ──
test("C6: the script's default invocation (no --files) resolves the 2 surviving workflow files from the workspace root", () => {
  // The DoD clause shells out with no --files and cwd = repo root; the checker must find the 2
  // surviving workflow files (drain-directives + run-routines in plugin/workflows/; select-preflight.js
  // was retired with the classic OUTER-LOOP SELECT phase) and report the GREEN baseline (exit 0) —
  // proving the clause's child process is not vacuously green (it actually reads and checks the files).
  const r = spawnSync("node", [SCRIPT, "--json"], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, `default invocation must exit 0 on the GREEN baseline, got ${r.status}`);
  const json = JSON.parse(r.stdout);
  assert.equal(json.files.length, 2, `default invocation must check exactly 2 files, got ${json.files.length}`);
  assert.equal(json.failures.length, 0, `default invocation must surface ZERO FAILs (GREEN baseline), got ${json.failures.length}`);
});
