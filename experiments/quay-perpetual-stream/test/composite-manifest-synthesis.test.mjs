// composite-manifest-synthesis.test.mjs — sibling test for composite-manifest-synthesis.ts
// (ADR-001 Decision clause 2: load-bearing method-infra MUST carry a `<name>.test.mjs` sibling —
// loadbearing-test-gate.sh enforces this by exact filename match).
//
// Run: node --experimental-strip-types --test experiments/quay-perpetual-stream/test/composite-manifest-synthesis.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  synthesizeManifest,
  extractCharterTaskIds,
  loadTaskFacts,
  DEFAULT_SYNTHESIS_CAPACITY,
  ProhibitingEdgeError,
} from "../scripts/composite-manifest-synthesis.ts";
import { buildCouplingGraph } from "../scripts/coupling-graph.ts";
import { runPreflight } from "../scripts/composite-preflight.ts";

const __filename = fileURLToPath(import.meta.url);
const CLI_PATH = path.join(path.dirname(__filename), "..", "scripts", "composite-manifest-synthesis.ts");

function mk(id, touches, deps = [], sem = [], acCount = 1) {
  return {
    version: 1,
    id,
    status: "todo",
    labels: [],
    valueType: "capabilityGrowth",
    eligible: true,
    estimatedValue: 5,
    deliverySurface: [],
    touches,
    semanticResources: sem,
    dependsOn: deps,
    verificationBoundary: "scripts/test.sh",
    acCount,
    lineEstimate: 50,
    sourceHash: "h",
  };
}

function candidate(id, taskIds) {
  return { candidateId: id, taskIds };
}

function mkTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ── real fixture builders for CLI-level tests ──────────────────────────────────────────────────
// Build a real disposable workspace: a `tasks/` dir with real markdown task files (real
// `## Touches`/`## Acceptance Criteria` sections the CLI's loadTaskFacts() genuinely parses), plus
// real files on disk at the declared Touches paths (so expandGlobs() genuinely matches them), plus
// a real charter file declaring the same task ids as its scope.
function buildRealWorkspace({ tasks, charterTaskLine }) {
  const root = mkTmpDir("composite-manifest-synth-ws-");
  const taskStoreDir = path.join(root, "tasks");
  fs.mkdirSync(taskStoreDir, { recursive: true });
  for (const t of tasks) {
    for (const rel of t.files) {
      const abs = path.join(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, `// fixture file for ${t.id}\n`);
    }
    const touchesSection = t.touches.map((g) => `- ${g}`).join("\n");
    const acSection = Array.from({ length: t.acCount }, (_, i) => `- [ ] AC item ${i + 1}`).join("\n");
    const body = `---\nid: ${t.id}\nstatus: todo\n---\n\n## Acceptance Criteria\n\n${acSection}\n\n## Touches\n\n${touchesSection}\n`;
    fs.writeFileSync(path.join(taskStoreDir, `${t.id}.md`), body);
  }
  const charterPath = path.join(root, "charter.md");
  fs.writeFileSync(charterPath, `# Fixture charter\n\n**Task:** ${charterTaskLine} · **Class:** development\n`);
  return { root, taskStoreDir, charterPath };
}

function runCli(args) {
  try {
    const stdout = execFileSync(process.execPath, ["--experimental-strip-types", CLI_PATH, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? "", stderr: e.stderr?.toString() ?? "" };
  }
}

// ── Stage 1: core pure function ────────────────────────────────────────────────────────────────

test("fuses overlapping Touches into one shared phase with an integrationInvariant", () => {
  const facts = [mk("A", ["shared/file.ts"]), mk("B", ["shared/file.ts"]), mk("C", ["other/file.ts"])];
  const graph = buildCouplingGraph({ tasks: facts });
  const { manifest } = synthesizeManifest(candidate("c1", ["A", "B", "C"]), facts, graph);

  const sharedPhase = manifest.phases.find((p) => p.taskIds.length > 1);
  assert.ok(sharedPhase, `expected a shared phase, got: ${JSON.stringify(manifest.phases)}`);
  assert.deepEqual(sharedPhase.taskIds.slice().sort(), ["A", "B"]);
  assert.ok(sharedPhase.integrationInvariant && sharedPhase.integrationInvariant.length > 0);
  const soloPhase = manifest.phases.find((p) => p.taskIds.length === 1);
  assert.ok(soloPhase && soloPhase.taskIds[0] === "C");
  // one task-ac shard per member task + one semantic-integration shard for the fused pair
  assert.equal(manifest.auditShards.filter((s) => s.kind === "task-ac").length, 3);
  assert.equal(manifest.auditShards.filter((s) => s.kind === "semantic-integration").length, 1);
});

test("fail-toward-fusion on unknown/missing/empty/overbroad Touches", () => {
  // A has no Touches at all (empty array) — must fuse with B rather than be optimistically split.
  const facts = [mk("A", []), mk("B", ["other/file.ts"])];
  const graph = buildCouplingGraph({ tasks: facts });
  const { manifest } = synthesizeManifest(candidate("c2", ["A", "B"]), facts, graph);
  assert.equal(manifest.phases.length, 1, `expected fusion into one phase, got: ${JSON.stringify(manifest.phases)}`);
  assert.deepEqual(manifest.phases[0].taskIds.slice().sort(), ["A", "B"]);
  assert.ok(manifest.phases[0].integrationInvariant.includes("missing/empty"));
});

test("disjoint, precise Touches produce genuinely separate phases (no false fusion)", () => {
  const facts = [mk("A", ["moduleA/a.ts"]), mk("B", ["moduleB/b.ts"])];
  const graph = buildCouplingGraph({ tasks: facts });
  const { manifest } = synthesizeManifest(candidate("c3", ["A", "B"]), facts, graph);
  assert.equal(manifest.phases.length, 2, JSON.stringify(manifest.phases));
  assert.ok(manifest.phases.every((p) => p.taskIds.length === 1));
});

test("byte-identical re-run from identical inputs (sorted collections, membership-derived IDs)", () => {
  const facts = [mk("Z", ["shared/x.ts"]), mk("A", ["shared/x.ts"]), mk("M", ["m/only.ts"])];
  const graph = buildCouplingGraph({ tasks: facts });
  const run1 = synthesizeManifest(candidate("c4", ["Z", "A", "M"]), facts, graph);
  const run2 = synthesizeManifest(candidate("c4", ["M", "Z", "A"]), facts, graph); // different input order
  assert.equal(JSON.stringify(run1.manifest), JSON.stringify(run2.manifest));
  assert.equal(JSON.stringify(run1.context), JSON.stringify(run2.context));
  // IDs are membership-derived, not incidental — the fused phase id names its sorted members.
  const shared = run1.manifest.phases.find((p) => p.taskIds.length > 1);
  assert.equal(shared.id, "phase-A+Z");
});

test("DEFAULT_SYNTHESIS_CAPACITY is a real named constant, not smuggled into CapacityLimits", () => {
  assert.equal(DEFAULT_SYNTHESIS_CAPACITY.maxPhases, 32);
  assert.equal(DEFAULT_SYNTHESIS_CAPACITY.maxAuditShards, 64);
  assert.equal(DEFAULT_SYNTHESIS_CAPACITY.maxParallelAgents, 4);
  assert.equal(DEFAULT_SYNTHESIS_CAPACITY.landPolicy, "atomic");
  const facts = [mk("A", ["a.ts"])];
  const graph = buildCouplingGraph({ tasks: facts });
  const { context } = synthesizeManifest(candidate("c5", ["A"]), facts, graph);
  assert.equal(context.capacity.maxPhases, 32);
  assert.equal(context.capacity.maxAuditShards, 64);
  assert.ok(!("maxParallelAgents" in context.capacity));
  assert.ok(!("landPolicy" in context.capacity));
});

// ── Stage 2 / AC17: prohibiting-edge exclusion, unit level (direct synthesizeManifest() call) ────

test("a hasProhibitingEdge pair fails BEFORE union-find, unit-level direct call (AC17)", () => {
  const facts = [mk("A", ["shared/x.ts"]), mk("B", ["shared/x.ts"])]; // would otherwise fuse
  const graph = buildCouplingGraph({
    tasks: facts,
    explicitEdges: [{ a: "A", b: "B", kind: "next-generation", evidence: "fixture-declared prohibiting edge" }],
  });
  assert.throws(
    () => synthesizeManifest(candidate("c6", ["A", "B"]), facts, graph),
    (err) => {
      assert.ok(err instanceof ProhibitingEdgeError, `expected ProhibitingEdgeError, got ${err}`);
      assert.equal(err.code, "prohibiting-edge-conflict");
      assert.deepEqual(err.pair.slice().sort(), ["A", "B"]);
      return true;
    },
  );
});

// ── extractCharterTaskIds ──────────────────────────────────────────────────────────────────────

test("extractCharterTaskIds reads the real **Task:** line shape", () => {
  const text = "# Charter\n\n**Task:** DIR-119-D1 · **Class:** development · **Value type:** capabilityGrowth\n";
  assert.deepEqual(extractCharterTaskIds(text), ["DIR-119-D1"]);
});

test("extractCharterTaskIds returns [] conservatively when neither shape is present", () => {
  assert.deepEqual(extractCharterTaskIds("# Charter\n\nNo task line here.\n"), []);
});

// ── loadTaskFacts (real filesystem I/O, CLI layer) ────────────────────────────────────────────

test("loadTaskFacts expands real Touches globs against a real workspace", () => {
  const { root, taskStoreDir } = buildRealWorkspace({
    tasks: [{ id: "T-LOAD", touches: ["moduleX/nested/a.ts", "moduleX/nested/b.ts"], files: ["moduleX/nested/a.ts", "moduleX/nested/b.ts"], acCount: 2 }],
    charterTaskLine: "T-LOAD",
  });
  const { facts, missing } = loadTaskFacts(["T-LOAD"], taskStoreDir, root);
  assert.deepEqual(missing, []);
  assert.equal(facts.length, 1);
  assert.deepEqual(facts[0].touches.slice().sort(), ["moduleX/nested/a.ts", "moduleX/nested/b.ts"]);
  assert.equal(facts[0].acCount, 2);
  fs.rmSync(root, { recursive: true, force: true });
});

test("loadTaskFacts reports missing task facts for an id with no file", () => {
  const root = mkTmpDir("composite-manifest-synth-missing-");
  const taskStoreDir = path.join(root, "tasks");
  fs.mkdirSync(taskStoreDir, { recursive: true });
  const { facts, missing } = loadTaskFacts(["NOPE"], taskStoreDir, root);
  assert.deepEqual(facts, []);
  assert.deepEqual(missing, ["NOPE"]);
  fs.rmSync(root, { recursive: true, force: true });
});

// ── Stage 2/3/AC13: CLI wrapper — self-validation before write, temp-file-plus-rename ────────────

test("CLI: successful run writes via temp-file-plus-rename, content matches in-memory synthesis", () => {
  const { root, taskStoreDir, charterPath } = buildRealWorkspace({
    tasks: [
      { id: "T-1", touches: ["moduleA/sub/**"], files: ["moduleA/sub/a.ts"], acCount: 1 },
      { id: "T-2", touches: ["moduleB/sub/**"], files: ["moduleB/sub/b.ts"], acCount: 1 },
    ],
    charterTaskLine: "T-1, T-2",
  });
  const outPath = path.join(root, "manifest.json");
  assert.equal(fs.existsSync(outPath), false);
  const candidateJson = JSON.stringify({ candidateId: "real-cli-run", taskIds: ["T-1", "T-2"] });
  const { code, stdout } = runCli([
    "--candidate-json",
    candidateJson,
    "--charter",
    charterPath,
    "--workspace-root",
    root,
    "--task-store-dir",
    taskStoreDir,
    "--out",
    outPath,
  ]);
  assert.equal(code, 0, stdout);
  const printed = JSON.parse(stdout.trim().split("\n").pop());
  assert.equal(printed.ok, true, stdout);
  assert.equal(printed.phaseCount, 2);
  assert.ok(fs.existsSync(outPath), "expected the CLI to write the output file on success");
  // no leftover temp file
  const leftover = fs.readdirSync(root).filter((f) => f.startsWith("manifest.json.tmp-"));
  assert.deepEqual(leftover, []);

  const written = JSON.parse(fs.readFileSync(outPath, "utf8"));
  const { facts } = loadTaskFacts(["T-1", "T-2"], taskStoreDir, root);
  const graph = buildCouplingGraph({ tasks: facts });
  const expected = synthesizeManifest({ candidateId: "real-cli-run", taskIds: ["T-1", "T-2"] }, facts, graph);
  expected.context.charterTaskIds = ["T-1", "T-2"];
  assert.equal(JSON.stringify(written.manifest), JSON.stringify(expected.manifest));
  assert.equal(JSON.stringify(written.context), JSON.stringify(expected.context));

  fs.rmSync(root, { recursive: true, force: true });
});

test("CLI: a contract-violating output (forced via --max-phases override) is rejected BEFORE any write", () => {
  const { root, taskStoreDir, charterPath } = buildRealWorkspace({
    tasks: [
      { id: "T-3", touches: ["moduleC/sub/**"], files: ["moduleC/sub/c.ts"], acCount: 1 },
      { id: "T-4", touches: ["moduleD/sub/**"], files: ["moduleD/sub/d.ts"], acCount: 1 },
    ],
    charterTaskLine: "T-3, T-4",
  });
  const outPath = path.join(root, "manifest.json");
  const candidateJson = JSON.stringify({ candidateId: "violating-run", taskIds: ["T-3", "T-4"] });
  const { code, stdout } = runCli([
    "--candidate-json",
    candidateJson,
    "--charter",
    charterPath,
    "--workspace-root",
    root,
    "--task-store-dir",
    taskStoreDir,
    "--out",
    outPath,
    "--max-phases",
    "1", // real phase count is 2 (disjoint Touches) — forces phase-count-over-capacity
  ]);
  assert.notEqual(code, 0);
  const printed = JSON.parse(stdout.trim().split("\n").pop());
  assert.equal(printed.ok, false);
  assert.equal(printed.code, "contract-violation");
  assert.ok(printed.violations.some((v) => v.startsWith("phase-count-over-capacity")), JSON.stringify(printed));
  assert.equal(fs.existsSync(outPath), false, "no file should be written on a contract violation");
  const leftover = fs.readdirSync(root).filter((f) => f.startsWith("manifest.json.tmp-"));
  assert.deepEqual(leftover, []);

  fs.rmSync(root, { recursive: true, force: true });
});

test("CLI: a hasProhibitingEdge pair (via --explicit-edges-json) fails before write, distinct reason code, no partial output", () => {
  const { root, taskStoreDir, charterPath } = buildRealWorkspace({
    tasks: [
      { id: "T-5", touches: ["moduleE/sub/**"], files: ["moduleE/sub/e.ts"], acCount: 1 },
      { id: "T-6", touches: ["moduleF/sub/**"], files: ["moduleF/sub/f.ts"], acCount: 1 },
    ],
    charterTaskLine: "T-5, T-6",
  });
  const outPath = path.join(root, "manifest.json");
  const candidateJson = JSON.stringify({ candidateId: "prohibited-run", taskIds: ["T-5", "T-6"] });
  const explicitEdgesJson = JSON.stringify([{ a: "T-5", b: "T-6", kind: "next-generation", evidence: "test-declared" }]);
  const { code, stdout } = runCli([
    "--candidate-json",
    candidateJson,
    "--charter",
    charterPath,
    "--workspace-root",
    root,
    "--task-store-dir",
    taskStoreDir,
    "--out",
    outPath,
    "--explicit-edges-json",
    explicitEdgesJson,
  ]);
  assert.notEqual(code, 0);
  const printed = JSON.parse(stdout.trim().split("\n").pop());
  assert.equal(printed.ok, false);
  assert.equal(printed.code, "prohibiting-edge-conflict");
  assert.deepEqual(printed.pair.slice().sort(), ["T-5", "T-6"]);
  assert.equal(fs.existsSync(outPath), false, "no file should be written on a prohibiting-edge conflict");

  fs.rmSync(root, { recursive: true, force: true });
});

// ── Stage 3 / AC4: documents the EXISTING composite-preflight.ts vacuous-pass path, honestly ────

test("AC4: a composite call missing compositeManifestFile hits the EXISTING vacuous-pass path (ok:true), not a fail-closed rejection", () => {
  // composite-preflight.ts is READ-ONLY here (not in this child's ## Touches) — this proves the
  // real current behavior rather than asserting a fail-closed rejection the checker does not have.
  const result = runPreflight(JSON.stringify({ milestoneCandidate: { taskIds: ["T-1", "T-2"] } }));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.isComposite, true);
  assert.deepEqual(result.contractViolations, []);
});

// ── Contract-violating manifest rejected — hand-corrupted in-memory (unit level, per task text) ──

test("a hand-corrupted synthesis output (missing integrationInvariant) is rejected by checkCompositeContract", async () => {
  const { checkCompositeContract } = await import("../scripts/composite-contracts.ts");
  const facts = [mk("A", ["shared/y.ts"]), mk("B", ["shared/y.ts"])];
  const graph = buildCouplingGraph({ tasks: facts });
  const { manifest, context } = synthesizeManifest(candidate("c7", ["A", "B"]), facts, graph);
  context.charterTaskIds = ["A", "B"];
  const valid = checkCompositeContract(manifest, context);
  assert.equal(valid.ok, true, JSON.stringify(valid.violations));

  const corrupted = { ...manifest, phases: manifest.phases.map((p) => (p.taskIds.length > 1 ? { ...p, integrationInvariant: undefined } : p)) };
  const broken = checkCompositeContract(corrupted, context);
  assert.equal(broken.ok, false);
  assert.ok(broken.violations.some((v) => v.startsWith("shared-phase-missing-integration-invariant")));
});
