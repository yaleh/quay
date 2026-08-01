// composite-build.test.mjs — sibling test for composite-build.ts (ADR-001 Decision clause 2:
// load-bearing method-infra MUST carry a `<name>.test.mjs` sibling — loadbearing-test-gate.sh
// enforces this by exact filename match).
//
// Run: node --test experiments/quay-perpetual-stream/test/composite-build.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { planPhaseExecution, mapEvidenceToTasks, selftest } from "../scripts/composite-build.ts";

const __filename = fileURLToPath(import.meta.url);
const CLI_PATH = path.join(path.dirname(__filename), "..", "scripts", "composite-build.ts");

// Spawn composite-build.ts with the given argv; never throws — returns {code, stdout, stderr}.
function runCli(cliArgs) {
  try {
    const stdout = execFileSync(process.execPath, ["--experimental-strip-types", CLI_PATH, ...cliArgs], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? "", stderr: e.stderr?.toString() ?? "" };
  }
}

function writeTmpJson(obj) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "composite-build-cli-"));
  const file = path.join(dir, "input.json");
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  return file;
}

test("composite-build.ts embedded selftest() suite passes", () => {
  assert.equal(selftest(), true);
});

const mkPhases = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, taskIds: [`T-${i}`], requires: [], auditShardIds: [] }));

test("serialize mode: agentCount is always 1 regardless of width (1, 3, 5, 10)", () => {
  for (const n of [1, 3, 5, 10]) {
    const plan = planPhaseExecution(mkPhases(n), { mode: "serialize" });
    assert.equal(plan.agentCount, 1);
    assert.equal(plan.batches.flat().length, n);
  }
});

test("a shared phase covering many tasks gets exactly ONE owner, not one per task", () => {
  const sharedPhase = { id: "shared", taskIds: ["T-0", "T-1", "T-2", "T-3", "T-4"], requires: [], auditShardIds: [] };
  const plan = planPhaseExecution([sharedPhase], { mode: "parallel" });
  assert.equal(plan.agentCount, 1);
  assert.equal(new Set(Object.values(plan.owners)).size, 1);
});

test("parallel mode caps agent count independently of task/phase count", () => {
  const plan = planPhaseExecution(mkPhases(5), { mode: "parallel", maxParallelAgents: 2 });
  assert.ok(plan.agentCount <= 2, `agentCount=${plan.agentCount}`);
  assert.equal(plan.batches.flat().length, 5);
});

test("phase dependency ordering is respected: dependency's batch precedes dependent's batch", () => {
  const phases = [
    { id: "A", taskIds: ["T-0"], requires: [], auditShardIds: [] },
    { id: "B", taskIds: ["T-1"], requires: ["A"], auditShardIds: [] },
  ];
  const plan = planPhaseExecution(phases, { mode: "parallel" });
  const batchOf = (id) => plan.batches.findIndex((b) => b.includes(id));
  assert.ok(batchOf("A") < batchOf("B"));
});

test("evidence from a shared phase fans out to every task it covers", () => {
  const phases = [{ id: "shared", taskIds: ["T-0", "T-1", "T-2"], requires: [], auditShardIds: [] }];
  const evidence = [{ phaseId: "shared", files: ["a.ts"], commits: ["abc123"], tests: ["a.test.mjs"] }];
  const reports = mapEvidenceToTasks(phases, evidence);
  assert.equal(reports.length, 3);
  assert.ok(reports.every((r) => r.files.includes("a.ts") && r.commits.includes("abc123") && r.tests.includes("a.test.mjs")));
});

test("evidence across two phases touching the same task is deduped and phaseIds accumulate", () => {
  const phases = [
    { id: "p0", taskIds: ["T-0"], requires: [], auditShardIds: [] },
    { id: "p1", taskIds: ["T-0"], requires: ["p0"], auditShardIds: [] },
  ];
  const evidence = [
    { phaseId: "p0", files: ["a.ts"], commits: ["c1"], tests: [] },
    { phaseId: "p1", files: ["a.ts", "b.ts"], commits: ["c2"], tests: [] },
  ];
  const reports = mapEvidenceToTasks(phases, evidence);
  assert.equal(reports.length, 1);
  assert.deepEqual(reports[0].files.sort(), ["a.ts", "b.ts"]);
  assert.deepEqual(reports[0].phaseIds, ["p0", "p1"]);
});

test("a phase with no matching evidence entry is silently skipped, never throws", () => {
  const phases = [{ id: "p0", taskIds: ["T-0"], requires: [], auditShardIds: [] }];
  const reports = mapEvidenceToTasks(phases, []);
  assert.deepEqual(reports, []);
});

// ── Stage 1 (M210/DIR-119-D2): non-selftest CLI wraps --plan-json / --map-evidence-json ──────────
// These spawn composite-build.ts as a subprocess and assert the printed JSON is byte-for-behavior
// identical to calling the already-exported planner/evidence functions directly — i.e. the CLI is a
// PURE WRAP, not a rewrite. Two input shapes are covered: a bare CompositePhase[] array AND the
// {manifest, context} envelope composite-manifest-synthesis.ts writes (the shape the production
// callsites in execute-milestone.js pass via --phases; the wrap must unwrap .manifest.phases).

// A ≥2-phase DAG with a real `requires` edge (B requires A).
const dagPhases = [
  { id: "A", taskIds: ["T-0"], requires: [], auditShardIds: ["s-A"] },
  { id: "B", taskIds: ["T-1"], requires: ["A"], auditShardIds: ["s-B"] },
];

// The SAME phases wrapped in the real on-disk envelope composite-manifest-synthesis.ts L524 writes
// ({manifest, context}); composite-preflight.ts L19 documents / L78–86 consumes exactly this shape.
const dagEnvelope = {
  manifest: {
    version: 1,
    candidateId: "c1",
    taskIds: ["T-0", "T-1"],
    phases: dagPhases,
    auditShards: [{ id: "s-A", kind: "task-ac", taskIds: ["T-0"] }, { id: "s-B", kind: "task-ac", taskIds: ["T-1"] }],
    touches: ["a.ts", "b.ts"],
    semanticResources: [],
    landPolicy: "atomic",
  },
  context: { candidateTaskIds: ["T-0", "T-1"], charterTaskIds: ["T-0", "T-1"], taskAcCounts: { "T-0": 1, "T-1": 1 }, taskTouches: {}, taskSemanticResources: {} },
};

test("AC1: --plan-json (BARE-ARRAY shape) is a pure wrap of the exported planPhaseExecution", () => {
  const phasesFile = writeTmpJson(dagPhases);
  const r = runCli(["--plan-json", "--phases", phasesFile, "--mode", "parallel", "--max-parallel-agents", "2"]);
  assert.equal(r.code, 0, `stderr=${r.stderr}`);
  const cliPlan = JSON.parse(r.stdout);
  assert.deepEqual(cliPlan, planPhaseExecution(dagPhases, { mode: "parallel", maxParallelAgents: 2 }));
});

test("AC1: --map-evidence-json (BARE-ARRAY shape) is a pure wrap of the exported mapEvidenceToTasks", () => {
  const phasesFile = writeTmpJson(dagPhases);
  const evidence = [
    { phaseId: "A", files: ["a.ts"], commits: ["c1"], tests: [] },
    { phaseId: "NOPE", files: ["ghost.ts"], commits: [], tests: [] }, // nonexistent phase -> skipped
  ];
  const evidenceFile = writeTmpJson(evidence);
  const r = runCli(["--map-evidence-json", "--phases", phasesFile, "--evidence", evidenceFile]);
  assert.equal(r.code, 0, `stderr=${r.stderr}`);
  const cliReports = JSON.parse(r.stdout);
  assert.deepEqual(cliReports, mapEvidenceToTasks(dagPhases, evidence));
});

test("AC1: --plan-json (ENVELOPE shape) unwraps .manifest.phases and wraps the real export", () => {
  const envFile = writeTmpJson(dagEnvelope);
  const r = runCli(["--plan-json", "--phases", envFile, "--mode", "parallel", "--max-parallel-agents", "2"]);
  assert.equal(r.code, 0, `stderr=${r.stderr}`);
  const cliPlan = JSON.parse(r.stdout);
  assert.deepEqual(cliPlan, planPhaseExecution(dagPhases, { mode: "parallel", maxParallelAgents: 2 }));
});

test("AC1: --map-evidence-json (ENVELOPE shape) unwraps .manifest.phases and wraps the real export", () => {
  const envFile = writeTmpJson(dagEnvelope);
  const evidence = [{ phaseId: "B", files: ["b.ts"], commits: ["c2"], tests: ["b.test.mjs"] }];
  const evidenceFile = writeTmpJson(evidence);
  const r = runCli(["--map-evidence-json", "--phases", envFile, "--evidence", evidenceFile]);
  assert.equal(r.code, 0, `stderr=${r.stderr}`);
  const cliReports = JSON.parse(r.stdout);
  assert.deepEqual(cliReports, mapEvidenceToTasks(dagPhases, evidence));
});

test("AC1: malformed CLI input fails closed (exit 1, error on stderr)", () => {
  // Missing --phases entirely.
  const missing = runCli(["--plan-json", "--mode", "parallel"]);
  assert.notEqual(missing.code, 0);
  assert.ok(missing.stderr.length > 0, "expected an error message on stderr");

  // Unparseable phases JSON.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "composite-build-bad-"));
  const badFile = path.join(dir, "bad.json");
  fs.writeFileSync(badFile, "{not valid json");
  const bad = runCli(["--plan-json", "--phases", badFile]);
  assert.notEqual(bad.code, 0);
  assert.ok(bad.stderr.length > 0, "expected an error message on stderr");

  // Object that is NEITHER a bare array NOR an envelope with a .manifest.phases array.
  const notEnvelopeFile = writeTmpJson({ manifest: {} });
  const notEnvelope = runCli(["--plan-json", "--phases", notEnvelopeFile]);
  assert.notEqual(notEnvelope.code, 0);
  assert.ok(notEnvelope.stderr.length > 0, "expected an error message on stderr");
});

test("AC7: maxParallelAgents bounds concurrency, NEVER phase ownership (label count == phase count regardless of cap)", () => {
  const phases = mkPhases(5);
  for (const cap of [1, 2, 5]) {
    const plan = planPhaseExecution(phases, { mode: "parallel", maxParallelAgents: cap });
    // Each phase id appears in exactly one batch slot -> the workflow's one-build-phase-<id>-label-
    // per-batched-phase contract yields dispatch-label count == phase count == 5 regardless of cap.
    const flat = plan.batches.flat();
    assert.equal(flat.length, 5, `cap=${cap}: batched slots ${flat.length}`);
    assert.equal(new Set(flat).size, 5, `cap=${cap}: distinct batched phase ids`);
    for (const p of phases) assert.ok(flat.includes(p.id), `cap=${cap}: missing phase ${p.id}`);
    // The planner-owner cap the cap actually bounds.
    assert.ok(plan.agentCount <= cap, `cap=${cap}: agentCount=${plan.agentCount}`);
  }
});
