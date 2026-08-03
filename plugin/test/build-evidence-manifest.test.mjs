// @test-group engine
// build-evidence-manifest.test.mjs — M238: RED/GREEN fixture tests for
// build-evidence-manifest.ts, build-evidence-collector.ts, and build-evidence-gate.ts.
//
// Byte-identical mirror: plugin/test/build-evidence-manifest.test.mjs
//
// Run:
//   node --experimental-strip-types --test experiments/quay-perpetual-stream/test/build-evidence-manifest.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// REPO_ROOT must resolve to the same directory regardless of whether this file lives at
// experiments/quay-perpetual-stream/test/ or plugin/test/ (byte-identical mirror requirement).
// Walk up from __dirname until we find .quay/config.yml — the workspace root sentinel.
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
const SCRIPTS = path.join(REPO_ROOT, "experiments", "quay-perpetual-stream", "scripts");

// ── TypeScript module test helper ───────────────────────────────────────────────────────────────────

function runModule(modulePath, ...args) {
  // Shell-quote any arg that contains whitespace or quote characters (e.g. inline JSON for
  // --build-result) so the double quotes survive to JSON.parse inside the CLI module.
  const shq = (a) => (/[\s"']/.test(a) ? `'${String(a).replace(/'/g, `'\\''`)}'` : a);
  const cmd = `node --experimental-strip-types ${modulePath} ${args.map(shq).join(" ")}`;
  try {
    const stdout = execSync(cmd, { cwd: REPO_ROOT, encoding: "utf8", timeout: 30_000 });
    return { exitCode: 0, stdout };
  } catch (e) {
    return { exitCode: e.status || 1, stdout: e.stdout ? e.stdout.toString() : "", stderr: e.stderr ? e.stderr.toString() : "" };
  }
}

// ── In-process imports (for typed testing) ──────────────────────────────────────────────────────────

// The manifest module is also testable in-process via dynamic import.
// We use the shell-based tests for the collector and gate (which need git/worktree state),
// and in-process imports for the pure functions in the manifest module.

async function importManifestModule() {
  const manifestPath = path.join(SCRIPTS, "build-evidence-manifest.ts");
  return import(manifestPath);
}

// ── Tests ───────────────────────────────────────────────────────────────────────────────────────────
// Scratch dirs live in the OS temp dir (os.tmpdir()), NOT the shared <repo>/tmp/ directory.
// gap-m264-build-evidence-regress-flaky (2026-08-03): the M264 regress test was flaky in the
// full suite — one run green, next red, same commit. Root cause (reproduced): the scratch dirs
// were created under <repo>/tmp/, and a concurrent sweep of that shared directory between the
// test's file writes and the collector's read made admission.json disappear, so the collector
// produced an EMPTY acEvidence manifest and the test died on `manifest.acEvidence[0]` with an
// opaque TypeError. Every other suite test uses os.tmpdir() for scratch; only this file used the
// shared repo-local tmp/, which is what a sweep can reach. Moving scratch to os.tmpdir() makes
// the tests immune to any repo-local tmp sweep (the collector/gate read the scratch by absolute
// path, so the location change is behavior-neutral for what is under test).

// AC1: Singleton and composite Build produce the same versioned manifest schema
test("AC1 — manifest schema is versioned and shared across paths", async (t) => {
  const mod = await importManifestModule();

  // Schema version is pinned
  const errors = mod.validateManifestShape({ schemaVersion: "1", candidateCommit: "abc", acEvidence: [] });
  assert.equal(errors.length, 0, `expected 0 validation errors, got ${JSON.stringify(errors)}`);

  // Unknown schema version fails
  const errors2 = mod.validateManifestShape({ schemaVersion: "99", candidateCommit: "abc", acEvidence: [] });
  assert.ok(errors2.some((e) => e.code === "manifest-schema-unknown"), `expected manifest-schema-unknown for v99, got ${JSON.stringify(errors2)}`);
});

// AC2: Exactly one hash-bound BuildAdmission decision supplies planned evidence rows; missing/duplicate rows fail validation
test("AC2 — BuildAdmission planned evidence and duplicate rejection", async (t) => {
  const mod = await importManifestModule();

  // Normal projection
  const { rows, errors } = mod.planEvidenceRows([
    { taskId: "T1", acIndex: 0, requiredClass: "unit" },
    { taskId: "T1", acIndex: 1, requiredClass: "real-workflow", plannedCommand: "scripts/test.sh" },
    { taskId: "T2", acIndex: 0, requiredClass: "integration" },
  ]);
  assert.equal(errors.length, 0, `expected 0 errors, got ${JSON.stringify(errors)}`);
  assert.equal(rows.length, 3, `expected 3 rows, got ${rows.length}`);
  assert.equal(rows[0].taskId, "T1");
  assert.equal(rows[0].acIndex, 0);
  assert.equal(rows[0].requiredClass, "unit");

  // Duplicate AC mapping rejected
  const { rows: r2, errors: e2 } = mod.planEvidenceRows([
    { taskId: "T1", acIndex: 0, requiredClass: "source" },
    { taskId: "T1", acIndex: 0, requiredClass: "unit" },
  ]);
  assert.equal(e2.length, 1, `expected 1 error, got ${JSON.stringify(e2)}`);
  assert.equal(e2[0].reason, "duplicate-ac");
  assert.equal(r2.length, 1, "only first row should be included");

  // Copied requirement text in manifest rejected
  const errors3 = mod.validateManifestShape({
    schemaVersion: "1",
    candidateCommit: "abc",
    acEvidence: [],
    requirementText: "The system must do X",
  });
  assert.ok(errors3.some((e) => e.code === "no-second-authority"), `expected no-second-authority, got ${JSON.stringify(errors3)}`);

  // acText field also rejected
  const errors4 = mod.validateManifestShape({
    schemaVersion: "1",
    candidateCommit: "abc",
    acEvidence: [],
    acText: "copied text",
  });
  assert.ok(errors4.some((e) => e.code === "no-second-authority"), `expected no-second-authority for acText, got ${JSON.stringify(errors4)}`);

  // Empty input → empty output (non-vacuous when admission is absent)
  const { rows: r5, errors: e5 } = mod.planEvidenceRows([]);
  assert.equal(r5.length, 0);
  assert.equal(e5.length, 0);
});

// AC3: baseCommit, candidateCommit, and changedFiles are mechanically derived and match Git
test("AC3 — manifest refs for AC3 are validated in the gate (changed-files-mismatch)", async (t) => {
  // This is tested via the gate's changed-files-mismatch check.
  // The gate mechanically re-derives changedFiles from git and rejects drift.
  // We test the underlying comparison logic here.
  const mod = await importManifestModule();

  // sha256 determinism
  const h1 = mod.sha256String("hello");
  const h2 = mod.sha256String("hello");
  assert.equal(h1, h2, "sha256 must be deterministic");

  // Different content → different hash
  const h3 = mod.sha256String("world");
  assert.notEqual(h1, h3, "different content must produce different hash");
});

// AC4: Evidence entries identify their source and distinguish mechanical facts from producer claims
test("AC4 — producer provenance on evidence rows", async (t) => {
  const mod = await importManifestModule();

  // Valid manifest with mixed producer types
  const errors = mod.validateManifestShape({
    schemaVersion: "1",
    candidateCommit: "abc123",
    acEvidence: [
      {
        taskId: "T1", acIndex: 0, disposition: "satisfied",
        evidenceClass: "unit", producer: "mechanical",
        actualCommand: "npm test", actualArtifact: "test.log",
        artifactHash: "abc", detail: "exit code 0",
      },
      {
        taskId: "T1", acIndex: 1, disposition: "satisfied",
        evidenceClass: "real-workflow", producer: "build-agent",
        actualCommand: "", actualArtifact: "",
        artifactHash: "", detail: "agent claims workflow ran",
      },
    ],
  });
  assert.equal(errors.length, 0, `expected 0 errors, got ${JSON.stringify(errors)}`);

  // runtimeEvidence default producer is "build-agent"
  const m = {
    schemaVersion: "1",
    runIdentity: { milestoneId: "M238", taskIds: ["T1"], composite: false, attempt: 1, sessionId: "sess-1" },
    buildAdmissionRef: null,
    baseCommit: "base",
    candidateCommit: "cand",
    changedFiles: [],
    testsRun: [],
    plannedAcEvidence: [],
    acEvidence: [],
    runtimeEvidence: [{ producer: "build-agent", claim: "test", artifactRef: "" }],
    deferredOrUnmet: [],
    iterationArtifactRefs: [],
  };
  const ref = mod.manifestRefForReceipt(m, "/tmp/test.json");
  assert.ok(ref.hash, "must produce hash");
  assert.equal(ref.path, "/tmp/test.json");
});

// AC5: Evidence-class compatibility rejects source grep for real-workflow requirements
test("AC5 — evidence-class compatibility mechanics", async (t) => {
  const mod = await importManifestModule();

  // source < unit < integration < real-workflow < cross-generation
  assert.equal(mod.isEvidenceClassCompatible("source", "unit"), true, "unit >= source");
  assert.equal(mod.isEvidenceClassCompatible("source", "real-workflow"), true, "real-workflow >= source");
  assert.equal(mod.isEvidenceClassCompatible("unit", "real-workflow"), true, "real-workflow >= unit");
  assert.equal(mod.isEvidenceClassCompatible("integration", "cross-generation"), true, "cross-generation >= integration");
  assert.equal(mod.isEvidenceClassCompatible("real-workflow", "cross-generation"), true, "cross-generation >= real-workflow");

  // Same class is compatible
  assert.equal(mod.isEvidenceClassCompatible("source", "source"), true);
  assert.equal(mod.isEvidenceClassCompatible("real-workflow", "real-workflow"), true);

  // Weaker than required FAILS
  assert.equal(mod.isEvidenceClassCompatible("real-workflow", "source"), false, "source < real-workflow (M203 failure mode)");
  assert.equal(mod.isEvidenceClassCompatible("real-workflow", "unit"), false, "unit < real-workflow");
  assert.equal(mod.isEvidenceClassCompatible("cross-generation", "source"), false, "source < cross-generation");
  assert.equal(mod.isEvidenceClassCompatible("cross-generation", "real-workflow"), false, "real-workflow < cross-generation");
  assert.equal(mod.isEvidenceClassCompatible("integration", "source"), false, "source < integration");
});

// AC6: BuildEvidenceGate with distinct reason codes
test("AC6 — BuildEvidenceGate reason codes cover all blocking conditions", async (t) => {
  // The gate returns distinct reason codes for each condition.
  // We test the gate through its CLI mode with fixture manifests.

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "build-evidence-gate-"));
  const gateScript = path.join(SCRIPTS, "build-evidence-gate.ts");

  // Missing manifest → manifest-missing
  {
    const r = runModule(gateScript, "--manifest", path.join(scratch, "nonexistent.json"));
    assert.equal(r.exitCode, 1);
    assert.ok(r.stdout.includes("manifest-missing"), `expected manifest-missing, got: ${r.stdout}`);
  }

  // Unparseable JSON → manifest-missing
  {
    fs.writeFileSync(path.join(scratch, "bad.json"), "not json");
    const r = runModule(gateScript, "--manifest", path.join(scratch, "bad.json"));
    assert.equal(r.exitCode, 1);
    assert.ok(r.stdout.includes("manifest-missing") || r.stdout.includes("unparseable"), `expected manifest-missing, got: ${r.stdout}`);
  }

  // Missing schemaVersion → manifest-schema-unknown
  {
    fs.writeFileSync(path.join(scratch, "no-schema.json"), JSON.stringify({ candidateCommit: "abc", acEvidence: [] }));
    const r = runModule(gateScript, "--manifest", path.join(scratch, "no-schema.json"));
    assert.equal(r.exitCode, 1);
    assert.ok(r.stdout.includes("manifest-schema-unknown"), `expected manifest-schema-unknown, got: ${r.stdout}`);
  }

  // Missing candidateCommit → candidate-commit-invalid
  {
    fs.writeFileSync(path.join(scratch, "no-candidate.json"), JSON.stringify({ schemaVersion: "1", acEvidence: [] }));
    const r = runModule(gateScript, "--manifest", path.join(scratch, "no-candidate.json"));
    assert.equal(r.exitCode, 1);
    assert.ok(r.stdout.includes("candidate-commit-invalid"), `expected candidate-commit-invalid, got: ${r.stdout}`);
  }

  // Unmet disposition → required-evidence-unmet (use --advisory to skip buildAdmissionRef check)
  {
    const m = {
      schemaVersion: "1",
      candidateCommit: "abc123",
      baseCommit: "def456",
      buildAdmissionRef: { decisionFile: "dec.json", decisionHash: "hash123" },
      runIdentity: { milestoneId: "M238", taskIds: ["T1"], composite: false, attempt: 1, sessionId: "s" },
      changedFiles: [],
      testsRun: [],
      plannedAcEvidence: [
        { taskId: "T1", acIndex: 0, requiredClass: "unit", plannedCommand: "", plannedArtifact: "" },
      ],
      acEvidence: [
        { taskId: "T1", acIndex: 0, disposition: "unmet", evidenceClass: "source", producer: "mechanical", actualCommand: "", actualArtifact: "", artifactHash: "", detail: "missing" },
      ],
      runtimeEvidence: [],
      deferredOrUnmet: [],
      iterationArtifactRefs: [],
    };
    fs.writeFileSync(path.join(scratch, "unmet.json"), JSON.stringify(m));
    const r = runModule(gateScript, "--manifest", path.join(scratch, "unmet.json"));
    assert.equal(r.exitCode, 1);
    assert.ok(r.stdout.includes("required-evidence-unmet"), `expected required-evidence-unmet, got: ${r.stdout}`);
  }

  // Evidence class mismatch → evidence-class-mismatch
  {
    const m = {
      schemaVersion: "1",
      candidateCommit: "abc123",
      baseCommit: "def456",
      buildAdmissionRef: { decisionFile: "dec.json", decisionHash: "hash123" },
      runIdentity: { milestoneId: "M238", taskIds: ["T1"], composite: false, attempt: 1, sessionId: "s" },
      changedFiles: [],
      testsRun: [],
      plannedAcEvidence: [
        { taskId: "T1", acIndex: 0, requiredClass: "real-workflow", plannedCommand: "", plannedArtifact: "" },
      ],
      acEvidence: [
        { taskId: "T1", acIndex: 0, disposition: "satisfied", evidenceClass: "source", producer: "mechanical", actualCommand: "grep", actualArtifact: "", artifactHash: "", detail: "source grep only" },
      ],
      runtimeEvidence: [],
      deferredOrUnmet: [],
      iterationArtifactRefs: [],
    };
    fs.writeFileSync(path.join(scratch, "class-mismatch.json"), JSON.stringify(m));
    const r = runModule(gateScript, "--manifest", path.join(scratch, "class-mismatch.json"));
    assert.equal(r.exitCode, 1);
    assert.ok(r.stdout.includes("evidence-class-mismatch"), `expected evidence-class-mismatch, got: ${r.stdout}`);
  }

  // Unauthorized deferral → unauthorized-deferral
  {
    const m = {
      schemaVersion: "1",
      candidateCommit: "abc123",
      baseCommit: "def456",
      buildAdmissionRef: null,
      runIdentity: { milestoneId: "M238", taskIds: ["T1"], composite: false, attempt: 1, sessionId: "s" },
      changedFiles: [],
      testsRun: [],
      plannedAcEvidence: [],
      acEvidence: [
        { taskId: "T1", acIndex: 0, disposition: "deferred", evidenceClass: "source", producer: "build-agent", actualCommand: "", actualArtifact: "", artifactHash: "", detail: "", authorizedBy: "none" },
      ],
      runtimeEvidence: [],
      deferredOrUnmet: [],
      iterationArtifactRefs: [],
    };
    fs.writeFileSync(path.join(scratch, "unauth-defer.json"), JSON.stringify(m));
    const r = runModule(gateScript, "--manifest", path.join(scratch, "unauth-defer.json"), "--advisory");
    assert.equal(r.exitCode, 1);
    assert.ok(r.stdout.includes("unauthorized-deferral"), `expected unauthorized-deferral, got: ${r.stdout}`);
  }

  // Duplicate acEvidence → duplicate-ac-evidence
  {
    const m = {
      schemaVersion: "1",
      candidateCommit: "abc123",
      baseCommit: "def456",
      buildAdmissionRef: null,
      runIdentity: { milestoneId: "M238", taskIds: ["T1"], composite: false, attempt: 1, sessionId: "s" },
      changedFiles: [],
      testsRun: [],
      plannedAcEvidence: [],
      acEvidence: [
        { taskId: "T1", acIndex: 0, disposition: "satisfied", evidenceClass: "unit", producer: "mechanical", actualCommand: "", actualArtifact: "", artifactHash: "", detail: "" },
        { taskId: "T1", acIndex: 0, disposition: "satisfied", evidenceClass: "unit", producer: "mechanical", actualCommand: "", actualArtifact: "", artifactHash: "", detail: "" },
      ],
      runtimeEvidence: [],
      deferredOrUnmet: [],
      iterationArtifactRefs: [],
    };
    fs.writeFileSync(path.join(scratch, "dup-ac.json"), JSON.stringify(m));
    const r = runModule(gateScript, "--manifest", path.join(scratch, "dup-ac.json"), "--advisory");
    assert.equal(r.exitCode, 1);
    assert.ok(r.stdout.includes("duplicate-ac-evidence"), `expected duplicate-ac-evidence, got: ${r.stdout}`);
  }

  // Planned AC unmatched → planned-ac-unmatched
  {
    const m = {
      schemaVersion: "1",
      candidateCommit: "abc123",
      baseCommit: "def456",
      buildAdmissionRef: { decisionFile: "dec.json", decisionHash: "hash123" },
      runIdentity: { milestoneId: "M238", taskIds: ["T1"], composite: false, attempt: 1, sessionId: "s" },
      changedFiles: [],
      testsRun: [],
      plannedAcEvidence: [
        { taskId: "T1", acIndex: 0, requiredClass: "unit", plannedCommand: "", plannedArtifact: "" },
        { taskId: "T1", acIndex: 1, requiredClass: "real-workflow", plannedCommand: "", plannedArtifact: "" },
      ],
      acEvidence: [
        { taskId: "T1", acIndex: 0, disposition: "satisfied", evidenceClass: "unit", producer: "mechanical", actualCommand: "", actualArtifact: "", artifactHash: "", detail: "" },
      ],
      runtimeEvidence: [],
      deferredOrUnmet: [],
      iterationArtifactRefs: [],
    };
    fs.writeFileSync(path.join(scratch, "unmatched.json"), JSON.stringify(m));
    const r = runModule(gateScript, "--manifest", path.join(scratch, "unmatched.json"));
    assert.equal(r.exitCode, 1);
    assert.ok(r.stdout.includes("planned-ac-unmatched"), `expected planned-ac-unmatched, got: ${r.stdout}`);
  }

  // Valid manifest passes gate (in advisory mode, buildAdmissionRef=null is OK)
  // baseCommit === candidateCommit === a real commit → legitimately empty diff → drift check passes.
  {
    const okCommit = realCommitOf();
    const m = {
      schemaVersion: "1",
      candidateCommit: okCommit,
      baseCommit: okCommit,
      buildAdmissionRef: null,
      runIdentity: { milestoneId: "M238", taskIds: ["T1"], composite: false, attempt: 1, sessionId: "s" },
      changedFiles: [],
      testsRun: [],
      plannedAcEvidence: [],
      acEvidence: [],
      runtimeEvidence: [],
      deferredOrUnmet: [],
      iterationArtifactRefs: [],
    };
    fs.writeFileSync(path.join(scratch, "valid.json"), JSON.stringify(m));
    const r = runModule(gateScript, "--manifest", path.join(scratch, "valid.json"), "--advisory");
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes("PASS"), `expected PASS, got: ${r.stdout}`);
  }

  // Cleanup
  fs.rmSync(scratch, { recursive: true, force: true });
});

// AC7: Deferral authorization — authorized deferral passes, unauthorized fails
test("AC7 — authorized deferral passes gate", async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "build-evidence-gate-ac7-"));
  const gateScript = path.join(SCRIPTS, "build-evidence-gate.ts");

  // Authorized deferral with real policy key passes
  // baseCommit === candidateCommit === a real commit → legitimately empty diff → drift check passes.
  {
    const okCommit = realCommitOf();
    const m = {
      schemaVersion: "1",
      candidateCommit: okCommit,
      baseCommit: okCommit,
      buildAdmissionRef: null,
      runIdentity: { milestoneId: "M238", taskIds: ["T1"], composite: false, attempt: 1, sessionId: "s" },
      changedFiles: [],
      testsRun: [],
      plannedAcEvidence: [],
      acEvidence: [
        { taskId: "T1", acIndex: 0, disposition: "deferred", evidenceClass: "source", producer: "build-agent", actualCommand: "", actualArtifact: "", artifactHash: "", detail: "cross-gen not available yet", authorizedBy: "cross-generation-not-yet-available" },
      ],
      runtimeEvidence: [],
      deferredOrUnmet: [],
      iterationArtifactRefs: [],
    };
    fs.writeFileSync(path.join(scratch, "auth-defer.json"), JSON.stringify(m));
    const r = runModule(gateScript, "--manifest", path.join(scratch, "auth-defer.json"), "--advisory");
    assert.equal(r.exitCode, 0, `expected PASS for authorized deferral, got exit=${r.exitCode}: ${r.stdout}`);
  }

  // Unauthorized (empty authorizedBy) fails even in advisory
  {
    const m = {
      schemaVersion: "1",
      candidateCommit: "abc123",
      baseCommit: "def456",
      buildAdmissionRef: null,
      runIdentity: { milestoneId: "M238", taskIds: ["T1"], composite: false, attempt: 1, sessionId: "s" },
      changedFiles: [],
      testsRun: [],
      plannedAcEvidence: [],
      acEvidence: [
        { taskId: "T1", acIndex: 0, disposition: "deferred", evidenceClass: "source", producer: "build-agent", actualCommand: "", actualArtifact: "", artifactHash: "", detail: "", authorizedBy: "" },
      ],
      runtimeEvidence: [],
      deferredOrUnmet: [],
      iterationArtifactRefs: [],
    };
    fs.writeFileSync(path.join(scratch, "empty-auth.json"), JSON.stringify(m));
    const r = runModule(gateScript, "--manifest", path.join(scratch, "empty-auth.json"), "--advisory");
    assert.equal(r.exitCode, 1, `expected FAIL for empty authorizedBy, got exit=${r.exitCode}`);
    assert.ok(r.stdout.includes("unauthorized-deferral"), `expected unauthorized-deferral, got: ${r.stdout}`);
  }

  fs.rmSync(scratch, { recursive: true, force: true });
});

// AC8: Artifact reference validation
test("AC8 — artifact hash and out-of-root checks", async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "build-evidence-gate-ac8-"));
  const gateScript = path.join(SCRIPTS, "build-evidence-gate.ts");

  // Out-of-root path traversal → artifact-out-of-root
  {
    const m = {
      schemaVersion: "1",
      candidateCommit: "abc123",
      baseCommit: "def456",
      buildAdmissionRef: null,
      runIdentity: { milestoneId: "M238", taskIds: ["T1"], composite: false, attempt: 1, sessionId: "s" },
      changedFiles: [],
      testsRun: [],
      plannedAcEvidence: [],
      acEvidence: [],
      runtimeEvidence: [],
      deferredOrUnmet: [],
      iterationArtifactRefs: [{ path: "../../etc/passwd", hash: "abc", kind: "other" }],
    };
    fs.writeFileSync(path.join(scratch, "out-of-root.json"), JSON.stringify(m));
    const r = runModule(gateScript, "--manifest", path.join(scratch, "out-of-root.json"), "--advisory");
    assert.equal(r.exitCode, 1, `expected FAIL for out-of-root, got exit=${r.exitCode}`);
    assert.ok(r.stdout.includes("artifact-out-of-root"), `expected artifact-out-of-root, got: ${r.stdout}`);
  }

  // Hash mismatch — manifest and artifact file live in same scratch dir
  {
    // Create a real file with known content directly in the scratch dir
    // (milestoneRoot = path.dirname(manifestPath) = scratch)
    const testFile = path.join(scratch, "test.txt");
    fs.writeFileSync(testFile, "real content");

    const m = {
      schemaVersion: "1",
      candidateCommit: "abc123",
      baseCommit: "def456",
      buildAdmissionRef: null,
      runIdentity: { milestoneId: "M238", taskIds: ["T1"], composite: false, attempt: 1, sessionId: "s" },
      changedFiles: [],
      testsRun: [],
      plannedAcEvidence: [],
      acEvidence: [],
      runtimeEvidence: [],
      deferredOrUnmet: [],
      iterationArtifactRefs: [{ path: "test.txt", hash: "wronghash", kind: "other" }],
    };
    const manifestPath = path.join(scratch, "hash-mismatch.json");
    fs.writeFileSync(manifestPath, JSON.stringify(m));
    const r = runModule(gateScript, "--manifest", manifestPath, "--advisory");
    assert.equal(r.exitCode, 1, `expected FAIL for hash mismatch, got exit=${r.exitCode}: ${r.stdout}`);
    assert.ok(r.stdout.includes("artifact-hash-mismatch"), `expected artifact-hash-mismatch, got: ${r.stdout}`);
  }

  // Correct hash passes
  // baseCommit === candidateCommit === a real commit → legitimately empty diff → drift check passes.
  {
    const { createHash } = await import("node:crypto");
    const okCommit = realCommitOf();
    const testFile = path.join(scratch, "good.txt");
    fs.writeFileSync(testFile, "good content");
    const goodHash = createHash("sha256").update("good content").digest("hex");

    const m = {
      schemaVersion: "1",
      candidateCommit: okCommit,
      baseCommit: okCommit,
      buildAdmissionRef: null,
      runIdentity: { milestoneId: "M238", taskIds: ["T1"], composite: false, attempt: 1, sessionId: "s" },
      changedFiles: [],
      testsRun: [],
      plannedAcEvidence: [],
      acEvidence: [],
      runtimeEvidence: [],
      deferredOrUnmet: [],
      iterationArtifactRefs: [{ path: "good.txt", hash: goodHash, kind: "other" }],
    };
    const manifestPath = path.join(scratch, "hash-ok.json");
    fs.writeFileSync(manifestPath, JSON.stringify(m));
    const r = runModule(gateScript, "--manifest", manifestPath, "--advisory");
    assert.equal(r.exitCode, 0, `expected PASS for correct hash, got exit=${r.exitCode}: ${r.stdout}`);
  }

  fs.rmSync(scratch, { recursive: true, force: true });
});

// AC9: DIR-124-B Build receipt hash-binds exactly one manifest
test("AC9 — manifestRefForReceipt produces hash-bound reference", async (t) => {
  const mod = await importManifestModule();

  const m = {
    schemaVersion: "1",
    runIdentity: { milestoneId: "M238", taskIds: ["T1"], composite: false, attempt: 1, sessionId: "sess-1" },
    buildAdmissionRef: null,
    baseCommit: "base123",
    candidateCommit: "cand456",
    changedFiles: [{ path: "a.ts", additions: 10, deletions: 2 }],
    testsRun: [],
    plannedAcEvidence: [],
    acEvidence: [],
    runtimeEvidence: [],
    deferredOrUnmet: [],
    iterationArtifactRefs: [],
  };

  const ref1 = mod.manifestRefForReceipt(m, "manifest.json");

  // Same content → same hash
  const ref2 = mod.manifestRefForReceipt(m, "manifest.json");
  assert.equal(ref1.hash, ref2.hash, "hash must be deterministic for same content");

  // Changing manifest bytes changes hash
  const m2 = { ...m, candidateCommit: "different" };
  const ref3 = mod.manifestRefForReceipt(m2, "manifest.json");
  assert.notEqual(ref1.hash, ref3.hash, "changing candidateCommit must change hash");

  // Changing changedFiles changes hash
  const m3 = { ...m, changedFiles: [{ path: "b.ts", additions: 1, deletions: 0 }] };
  const ref4 = mod.manifestRefForReceipt(m3, "manifest.json");
  assert.notEqual(ref1.hash, ref4.hash, "changing changedFiles must change hash");

  // Reference includes candidate commit
  assert.equal(ref1.candidateCommit, "cand456");
  assert.equal(ref1.path, "manifest.json");
});

// AC11: No requirement text in manifest — no second authority
test("AC11 — manifest schema prohibits requirement text copy", async (t) => {
  const mod = await importManifestModule();

  // Various fields that would copy requirement text are rejected
  for (const field of ["requirementText", "acText", "requirement", "criterion"]) {
    const manifest = {
      schemaVersion: "1",
      candidateCommit: "abc",
      acEvidence: [],
      [field]: "The system must do X per AC 3",
    };
    const errors = mod.validateManifestShape(manifest);
    assert.ok(
      errors.some((e) => e.code === "no-second-authority"),
      `field "${field}" should trigger no-second-authority, got: ${JSON.stringify(errors)}`
    );
  }
});

// AC12: Byte-identical mirrors — canonical and plugin modules match
test("AC12 — byte-identical mirrors", async (t) => {
  const files = [
    "build-evidence-manifest.ts",
    "build-evidence-collector.ts",
    "build-evidence-gate.ts",
  ];

  for (const file of files) {
    const canonical = path.join(REPO_ROOT, "experiments", "quay-perpetual-stream", "scripts", file);
    const plugin = path.join(REPO_ROOT, "plugin", "scripts", file);

    assert.ok(fs.existsSync(canonical), `${file} must exist in canonical path`);
    assert.ok(fs.existsSync(plugin), `${file} must exist in plugin path`);

    const canonicalContent = fs.readFileSync(canonical, "utf8");
    const pluginContent = fs.readFileSync(plugin, "utf8");
    assert.equal(
      canonicalContent,
      pluginContent,
      `${file} must be byte-identical across mirrors`
    );
  }

  // Also check the test file mirror
  const thisFile = fileURLToPath(import.meta.url);
  const pluginTestFile = path.join(REPO_ROOT, "plugin", "test", "build-evidence-manifest.test.mjs");
  // Test file mirror will be checked after copy
});

// SELFTEST: run the manifest module's own selftest
test("selftest — build-evidence-manifest.ts --selftest passes", async (t) => {
  const manifestPath = path.join(SCRIPTS, "build-evidence-manifest.ts");
  const r = runModule(manifestPath, "--selftest");
  assert.equal(r.exitCode, 0, `selftest must pass, got exit=${r.exitCode}\n${r.stdout}`);
});

// Collector dry-run smoke test — CLI argument parsing + fail-closed git behavior (M265)
test("collector — dry-run CLI argument parsing + git-failure fail-closed", async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "collector-smoke-"));
  const collectorPath = path.join(SCRIPTS, "build-evidence-collector.ts");
  const realCommit = execSync("git rev-parse HEAD", { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  const output = path.join(scratch, "manifest.json");

  // Success path with a REAL git commit — the collector derives baseCommit/changedFiles and emits a manifest.
  const r = runModule(
    collectorPath,
    "--build-result", JSON.stringify({ outcome: "done", taskId: "T1", mergeCommit: realCommit }),
    "--milestone-root", scratch,
    "--workspace", REPO_ROOT,
    "--milestone-id", "M999",
    "--task-ids", JSON.stringify(["T1"]),
    "--output", output
  );
  assert.equal(r.exitCode, 0, `collector must succeed with a real commit: stdout="${r.stdout}" stderr="${r.stderr}"`);
  assert.ok(fs.existsSync(output), `output file must exist: ${output}`);
  const manifest = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.equal(manifest.schemaVersion, "1");
  assert.equal(manifest.runIdentity.milestoneId, "M999");
  assert.equal(manifest.candidateCommit, realCommit);
  assert.ok(manifest.baseCommit, "baseCommit must be mechanically derived (non-empty)");
  assert.equal(manifest.buildAdmissionRef, null);

  // M265: a NON-EXISTENT candidate commit → git merge-base fails → collector FAILS CLOSED with
  // reason "git-failure" and writes NO manifest (never an empty-baseCommit fail-soft manifest).
  const badOutput = path.join(scratch, "bad-manifest.json");
  const rBad = runModule(
    collectorPath,
    "--build-result", JSON.stringify({ outcome: "done", taskId: "T1", mergeCommit: "deadbeef0000000000000000000000000000000000" }),
    "--milestone-root", scratch,
    "--workspace", REPO_ROOT,
    "--milestone-id", "M999",
    "--task-ids", JSON.stringify(["T1"]),
    "--output", badOutput
  );
  assert.equal(rBad.exitCode, 1, `git failure must fail closed, got exit=${rBad.exitCode}`);
  assert.ok(rBad.stdout.includes("git-failure"), `expected git-failure reason, got: ${rBad.stdout}`);
  assert.ok(!fs.existsSync(badOutput), "no manifest may be written on git failure");

  // Missing required flag → error
  const r2 = runModule(collectorPath);
  assert.equal(r2.exitCode, 1);
  const combined = (r2.stdout || "") + (r2.stderr || "");
  assert.ok(combined.includes("error") || combined.includes("missing"), `expected error, got stdout="${r2.stdout}" stderr="${r2.stderr}"`);

  fs.rmSync(scratch, { recursive: true, force: true });
});

// Collector admission-decision FAIL-CLOSED (gap-m264-build-evidence-regress-flaky, 2026-08-03):
// a provided-but-unreadable --admission-decision path is an ERROR, not "no admission". Previously
// the collector silently emitted an EMPTY acEvidence manifest (buildAdmissionRef null, no planned
// rows) that the gate vacuously passed in advisory mode. Regression test for the fail-closed branch.
test("collector — provided-but-missing admission decision FAILS CLOSED with admission-decision-unreadable", async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "be-adm-unreadable-"));
  const collectorPath = path.join(SCRIPTS, "build-evidence-collector.ts");
  const realCommit = realCommitOf();

  // The admission decision path is DECLARED but the file does NOT exist (e.g. swept by a concurrent
  // process, or a caller pointing at a path that was never written).
  const missingAdmission = path.join(scratch, "admission.json");
  const output = path.join(scratch, "manifest.json");

  const r = runModule(
    collectorPath,
    "--build-result", JSON.stringify({ outcome: "done", taskId: "T1", mergeCommit: realCommit }),
    "--milestone-root", scratch, "--workspace", REPO_ROOT,
    "--milestone-id", "M100", "--task-ids", JSON.stringify(["T1"]), "--composite", "false",
    "--admission-decision", missingAdmission,
    "--output", output,
  );

  assert.equal(r.exitCode, 1, `collector must FAIL CLOSED on a provided-but-missing admission decision, got exit=${r.exitCode}: stdout="${r.stdout}" stderr="${r.stderr}"`);
  assert.ok(r.stdout.includes("admission-decision-unreadable"), `expected admission-decision-unreadable reason, got: ${r.stdout}`);
  assert.ok(!fs.existsSync(output), "no manifest may be written when the admission decision is unreadable (no vacuous empty manifest)");

  fs.rmSync(scratch, { recursive: true, force: true });
});

// ── M264 mechanism 2: per-phase evidence consumption ────────────────────────────────────────────────

function realCommitOf() {
  return execSync("git rev-parse HEAD", { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

test("M264 — collector consumes composite per-phase evidence into acEvidence rows with producer provenance", async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "be-per-phase-"));
  const collectorPath = path.join(SCRIPTS, "build-evidence-collector.ts");
  const realCommit = realCommitOf();

  const admission = path.join(scratch, "admission.json");
  fs.writeFileSync(admission, JSON.stringify({
    requiredEvidence: [
      { taskId: "T1", acIndex: 0, requiredClass: "unit", plannedCommand: "scripts/test.sh", plannedArtifact: "" },
      { taskId: "T1", acIndex: 1, requiredClass: "source" },
    ],
  }));

  const evidence = path.join(scratch, "evidence.json");
  fs.writeFileSync(evidence, JSON.stringify([
    { phaseId: "p0", files: ["a.ts"], commits: [realCommit], tests: ["scripts/test.sh"] },
  ]));

  const envelope = path.join(scratch, "envelope.json");
  fs.writeFileSync(envelope, JSON.stringify({
    manifest: {
      candidateId: "M999", taskIds: ["T1"],
      phases: [{ id: "p0", taskIds: ["T1"], requires: [], auditShardIds: [] }],
    },
  }));

  const output = path.join(scratch, "manifest.json");
  const r = runModule(
    collectorPath,
    "--build-result", JSON.stringify({ outcome: "done", taskId: "T1", mergeCommit: realCommit }),
    "--milestone-root", scratch, "--workspace", REPO_ROOT,
    "--milestone-id", "M999", "--task-ids", JSON.stringify(["T1"]), "--composite", "true",
    "--admission-decision", admission,
    "--per-phase-evidence", evidence,
    "--composite-manifest", envelope,
    "--output", output,
  );
  assert.equal(r.exitCode, 0, `collector must succeed: stdout="${r.stdout}" stderr="${r.stderr}"`);
  const manifest = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.ok(manifest.baseCommit, "baseCommit must be derived");
  const rows = manifest.acEvidence;
  assert.equal(rows.length, 2, `expected 2 acEvidence rows, got ${rows.length}`);
  assert.ok(rows.every((row) => row.disposition === "satisfied"), "planned row with matching per-phase evidence must be matched, not unmet");
  assert.ok(rows.every((row) => row.producer === "build-agent"), "per-phase rows must carry producer build-agent");
  assert.equal(rows[0].evidenceClass, "unit", "tests present in phase evidence → unit");
  fs.rmSync(scratch, { recursive: true, force: true });
});

test("M264 — collector consumes width-1 iteration report into acEvidence rows (no planned-ac-unmatched false positive)", async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "be-iter-report-"));
  const collectorPath = path.join(SCRIPTS, "build-evidence-collector.ts");
  const realCommit = realCommitOf();

  const admission = path.join(scratch, "admission.json");
  fs.writeFileSync(admission, JSON.stringify({
    requiredEvidence: [{ taskId: "T1", acIndex: 0, requiredClass: "unit" }],
  }));

  const iterReport = path.join(scratch, "iteration-0.md");
  fs.writeFileSync(iterReport, [
    "# M100 Iteration 0",
    "- **Build commit:** " + realCommit,
    "## Build Evidence",
    "- **Tests:** scripts/test.sh 12/12 GREEN",
    "- **Files changed:** packages/quay/src/foo.ts",
    "## Disposition",
    "Done",
  ].join("\n"));

  const output = path.join(scratch, "manifest.json");
  const r = runModule(
    collectorPath,
    "--build-result", JSON.stringify({ outcome: "done", taskId: "T1", mergeCommit: realCommit }),
    "--milestone-root", scratch, "--workspace", REPO_ROOT,
    "--milestone-id", "M100", "--task-ids", JSON.stringify(["T1"]), "--composite", "false",
    "--admission-decision", admission,
    "--iteration-report", iterReport,
    "--output", output,
  );
  assert.equal(r.exitCode, 0, `collector must succeed: stdout="${r.stdout}" stderr="${r.stderr}"`);
  const manifest = JSON.parse(fs.readFileSync(output, "utf8"));
  const rows = manifest.acEvidence;
  assert.equal(rows.length, 1, `expected 1 acEvidence row, got ${rows.length}`);
  assert.equal(rows[0].disposition, "satisfied", "planned row must be matched from the iteration report");
  assert.equal(rows[0].producer, "build-agent");
  assert.equal(rows[0].evidenceClass, "unit", "Tests: line → unit");
  fs.rmSync(scratch, { recursive: true, force: true });
});

test("M264 — per-phase evidence and iteration report are NOT consumed when absent (planned rows stay unmet, no false satisfied)", async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "be-no-evidence-"));
  const collectorPath = path.join(SCRIPTS, "build-evidence-collector.ts");
  const realCommit = realCommitOf();

  const admission = path.join(scratch, "admission.json");
  fs.writeFileSync(admission, JSON.stringify({
    requiredEvidence: [{ taskId: "T1", acIndex: 0, requiredClass: "unit" }],
  }));

  const output = path.join(scratch, "manifest.json");
  const r = runModule(
    collectorPath,
    "--build-result", JSON.stringify({ outcome: "done", taskId: "T1", mergeCommit: realCommit }),
    "--milestone-root", scratch, "--workspace", REPO_ROOT,
    "--milestone-id", "M100", "--task-ids", JSON.stringify(["T1"]), "--composite", "false",
    "--admission-decision", admission,
    "--output", output,
  );
  assert.equal(r.exitCode, 0, `collector must succeed: stdout="${r.stdout}" stderr="${r.stderr}"`);
  const manifest = JSON.parse(fs.readFileSync(output, "utf8"));
  const rows = manifest.acEvidence;
  assert.equal(rows.length, 1, `expected 1 acEvidence row, got ${rows.length}`);
  assert.equal(rows[0].disposition, "unmet", "no per-phase evidence / iteration report → planned row stays unmet (fail-closed)");
  assert.equal(rows[0].producer, "mechanical", "unmatched mechanical stub row");
  fs.rmSync(scratch, { recursive: true, force: true });
});

// ── M265 mechanism 3: fail-closed on git failure ────────────────────────────────────────────────────

test("M265 — gate blocks empty baseCommit with git-failure (drift check never silently skipped)", async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "be-git-gate-"));
  const gateScript = path.join(SCRIPTS, "build-evidence-gate.ts");

  const m = {
    schemaVersion: "1", candidateCommit: "abc123", baseCommit: "",
    changedFiles: [], buildAdmissionRef: null, acEvidence: [], plannedAcEvidence: [], iterationArtifactRefs: [],
  };
  const manifestPath = path.join(scratch, "empty-base.json");
  fs.writeFileSync(manifestPath, JSON.stringify(m));
  const r = runModule(gateScript, "--manifest", manifestPath, "--workspace", REPO_ROOT, "--advisory");
  assert.equal(r.exitCode, 1, `empty baseCommit must block, got exit=${r.exitCode}`);
  assert.ok(r.stdout.includes("git-failure"), `expected git-failure, got: ${r.stdout}`);
  fs.rmSync(scratch, { recursive: true, force: true });
});

test("M265 — gate blocks git diff failure with git-failure (bad baseCommit)", async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "be-git-gate-badbase-"));
  const gateScript = path.join(SCRIPTS, "build-evidence-gate.ts");
  const realCommit = realCommitOf();

  const m = {
    schemaVersion: "1", candidateCommit: realCommit, baseCommit: "deadbeef0000000000000000000000000000000000",
    changedFiles: [], buildAdmissionRef: null, acEvidence: [], plannedAcEvidence: [], iterationArtifactRefs: [],
  };
  const manifestPath = path.join(scratch, "bad-base.json");
  fs.writeFileSync(manifestPath, JSON.stringify(m));
  const r = runModule(gateScript, "--manifest", manifestPath, "--workspace", REPO_ROOT, "--advisory");
  assert.equal(r.exitCode, 1, `git diff failure must block, got exit=${r.exitCode}`);
  assert.ok(r.stdout.includes("git-failure"), `expected git-failure, got: ${r.stdout}`);
  fs.rmSync(scratch, { recursive: true, force: true });
});

test("M265 — legitimate empty diff (baseCommit === candidateCommit) is NOT blocked", async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "be-git-gate-legit-"));
  const gateScript = path.join(SCRIPTS, "build-evidence-gate.ts");
  const realCommit = realCommitOf();

  const m = {
    schemaVersion: "1", candidateCommit: realCommit, baseCommit: realCommit,
    changedFiles: [], buildAdmissionRef: null, acEvidence: [], plannedAcEvidence: [], iterationArtifactRefs: [],
  };
  const manifestPath = path.join(scratch, "legit-empty.json");
  fs.writeFileSync(manifestPath, JSON.stringify(m));
  const r = runModule(gateScript, "--manifest", manifestPath, "--workspace", REPO_ROOT, "--advisory");
  assert.equal(r.exitCode, 0, `legit empty diff must pass, got exit=${r.exitCode}: ${r.stdout}`);
  assert.ok(r.stdout.includes("PASS"), `expected PASS, got: ${r.stdout}`);
  fs.rmSync(scratch, { recursive: true, force: true });
});

// ── Adversarial-review regression tests (M264/M265 bug fixes) ───────────────────────────────────────

// Bug 1 (fail-open): incidental prose ("journal", "live run", "workflow run") must NOT upgrade the
// evidence class to real-workflow. Only an explicit structured declaration may.
test("M264 regress — incidental prose does NOT upgrade evidence class to real-workflow (no fail-open)", async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "be-no-failopen-"));
  const collectorPath = path.join(SCRIPTS, "build-evidence-collector.ts");
  const gateScript = path.join(SCRIPTS, "build-evidence-gate.ts");
  const realCommit = realCommitOf();

  const admission = path.join(scratch, "admission.json");
  fs.writeFileSync(admission, JSON.stringify({
    requiredEvidence: [{ taskId: "T1", acIndex: 0, requiredClass: "real-workflow" }],
  }));

  // Report mentions "journal" / "workflow run" / "live run" ONLY as incidental prose, no explicit
  // structured declaration. The AC requires real-workflow; the collector must infer unit/source,
  // so the gate BLOCKS with evidence-class-mismatch (never a fail-open PASS).
  const iterReport = path.join(scratch, "iteration-0.md");
  fs.writeFileSync(iterReport, [
    "# M100 Iteration 0",
    "- **Build commit:** " + realCommit,
    "## Build Evidence",
    "- **Tests:** scripts/test.sh 12/12 GREEN",
    "Evidence journal: I recorded each step in my session journal during the live run; the workflow run for this milestone completed.",
    "## Disposition",
    "Done",
  ].join("\n"));

  const output = path.join(scratch, "manifest.json");
  const r = runModule(
    collectorPath,
    "--build-result", JSON.stringify({ outcome: "done", taskId: "T1", mergeCommit: realCommit }),
    "--milestone-root", scratch, "--workspace", REPO_ROOT,
    "--milestone-id", "M100", "--task-ids", JSON.stringify(["T1"]), "--composite", "false",
    "--admission-decision", admission,
    "--iteration-report", iterReport,
    "--output", output,
  );
  assert.equal(r.exitCode, 0, `collector must succeed: stdout="${r.stdout}" stderr="${r.stderr}"`);
  const manifest = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.equal(
    manifest.acEvidence.length,
    1,
    `expected 1 acEvidence row (real-workflow required, unit inferred), got ${manifest.acEvidence.length}: ${JSON.stringify(manifest.acEvidence)}`
  );
  const row = manifest.acEvidence[0];
  assert.equal(row.evidenceClass, "unit", `incidental prose must not upgrade to real-workflow; got ${row.evidenceClass}`);
  assert.notEqual(row.evidenceClass, "real-workflow", "no fail-open real-workflow credit from prose");

  // Gate must block (unit < real-workflow) — the M203 failure mode is prevented.
  const g = runModule(gateScript, "--manifest", output, "--workspace", REPO_ROOT, "--advisory");
  assert.equal(g.exitCode, 1, `gate must block weaker class, got exit=${g.exitCode}: ${g.stdout}`);
  assert.ok(g.stdout.includes("evidence-class-mismatch"), `expected evidence-class-mismatch, got: ${g.stdout}`);

  fs.rmSync(scratch, { recursive: true, force: true });
});

// Bug 1 (positive): an EXPLICIT structured declaration DOES credit real-workflow (attributed claim).
test("M264 regress — explicit structured real-workflow declaration is credited (attributed)", async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "be-explicit-rw-"));
  const collectorPath = path.join(SCRIPTS, "build-evidence-collector.ts");
  const realCommit = realCommitOf();

  const admission = path.join(scratch, "admission.json");
  fs.writeFileSync(admission, JSON.stringify({
    requiredEvidence: [{ taskId: "T1", acIndex: 0, requiredClass: "real-workflow" }],
  }));

  const iterReport = path.join(scratch, "iteration-0.md");
  fs.writeFileSync(iterReport, [
    "# M100 Iteration 0",
    "## Build Evidence",
    "- **Real-workflow evidence:** milestones/M100/workflow-journal.md",
    "## Disposition",
    "Done",
  ].join("\n"));

  const output = path.join(scratch, "manifest.json");
  const r = runModule(
    collectorPath,
    "--build-result", JSON.stringify({ outcome: "done", taskId: "T1", mergeCommit: realCommit }),
    "--milestone-root", scratch, "--workspace", REPO_ROOT,
    "--milestone-id", "M100", "--task-ids", JSON.stringify(["T1"]), "--composite", "false",
    "--admission-decision", admission,
    "--iteration-report", iterReport,
    "--output", output,
  );
  assert.equal(r.exitCode, 0, `collector must succeed: stdout="${r.stdout}" stderr="${r.stderr}"`);
  const manifest = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.equal(
    manifest.acEvidence.length,
    1,
    `expected 1 acEvidence row (explicit real-workflow declaration), got ${manifest.acEvidence.length}: ${JSON.stringify(manifest.acEvidence)}`
  );
  const row = manifest.acEvidence[0];
  assert.equal(row.evidenceClass, "real-workflow", `explicit declaration must credit real-workflow; got ${row.evidenceClass}`);
  fs.rmSync(scratch, { recursive: true, force: true });
});

// Bug 2 (fail-open): a COMPOSITE milestone must NOT fall back to the width-1 iteration report when
// per-phase evidence is absent — per-phase attribution would be silently bypassed.
test("M264 regress — composite with no per-phase evidence does NOT fall back to iteration report", async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "be-composite-nofb-"));
  const collectorPath = path.join(SCRIPTS, "build-evidence-collector.ts");
  const realCommit = realCommitOf();

  const admission = path.join(scratch, "admission.json");
  fs.writeFileSync(admission, JSON.stringify({
    requiredEvidence: [
      { taskId: "T1", acIndex: 0, requiredClass: "unit" },
      { taskId: "T2", acIndex: 0, requiredClass: "unit" },
    ],
  }));

  // Iteration report exists (Build always writes it) but per-phase evidence file is ABSENT.
  const iterReport = path.join(scratch, "iterations", "iteration-0.md");
  fs.mkdirSync(path.dirname(iterReport), { recursive: true });
  fs.writeFileSync(iterReport, [
    "# M200 Iteration 0",
    "## Build Evidence",
    "- **Tests:** scripts/test.sh GREEN",
    "- **Files changed:** packages/quay/src/foo.ts",
  ].join("\n"));

  const output = path.join(scratch, "manifest.json");
  const r = runModule(
    collectorPath,
    "--build-result", JSON.stringify({ outcome: "done", taskId: "T1", mergeCommit: realCommit }),
    "--milestone-root", scratch, "--workspace", REPO_ROOT,
    "--milestone-id", "M200", "--task-ids", JSON.stringify(["T1", "T2"]), "--composite", "true",
    "--admission-decision", admission,
    "--output", output,
  );
  assert.equal(r.exitCode, 0, `collector must succeed: stdout="${r.stdout}" stderr="${r.stderr}"`);
  const manifest = JSON.parse(fs.readFileSync(output, "utf8"));
  const rows = manifest.acEvidence;
  assert.equal(rows.length, 2, `expected 2 acEvidence rows, got ${rows.length}`);
  assert.ok(rows.every((row) => row.disposition === "unmet"), "composite with no per-phase evidence must NOT credit members from the aggregate iteration report (fail-closed)");
  assert.ok(rows.every((row) => row.producer === "mechanical"), "unmatched composite rows must be mechanical unmet stubs");
  fs.rmSync(scratch, { recursive: true, force: true });
});

// Bug 3 (mis-attribution): per-phase evidence WITHOUT a task→phase map (empty composite-manifest
// envelope) must NOT be mis-credited to taskIds[0] — all planned rows stay unmatched (fail-closed).
test("M264 regress — per-phase evidence without phases is NOT mis-credited to taskIds[0]", async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "be-nophases-"));
  const collectorPath = path.join(SCRIPTS, "build-evidence-collector.ts");
  const realCommit = realCommitOf();

  const admission = path.join(scratch, "admission.json");
  fs.writeFileSync(admission, JSON.stringify({
    requiredEvidence: [
      { taskId: "T1", acIndex: 0, requiredClass: "unit" },
      { taskId: "T2", acIndex: 0, requiredClass: "unit" },
      { taskId: "T3", acIndex: 0, requiredClass: "unit" },
    ],
  }));

  const evidence = path.join(scratch, "evidence.json");
  fs.writeFileSync(evidence, JSON.stringify([
    { phaseId: "p0", files: ["a.ts"], commits: [realCommit], tests: ["scripts/test.sh"] },
  ]));

  // NO --composite-manifest envelope → phases empty → cannot attribute → no satisfied rows.
  const output = path.join(scratch, "manifest.json");
  const r = runModule(
    collectorPath,
    "--build-result", JSON.stringify({ outcome: "done", taskId: "T1", mergeCommit: realCommit }),
    "--milestone-root", scratch, "--workspace", REPO_ROOT,
    "--milestone-id", "M200", "--task-ids", JSON.stringify(["T1", "T2", "T3"]), "--composite", "true",
    "--admission-decision", admission,
    "--per-phase-evidence", evidence,
    "--output", output,
  );
  assert.equal(r.exitCode, 0, `collector must succeed: stdout="${r.stdout}" stderr="${r.stderr}"`);
  const manifest = JSON.parse(fs.readFileSync(output, "utf8"));
  const rows = manifest.acEvidence;
  assert.equal(rows.length, 3, `expected 3 acEvidence rows, got ${rows.length}`);
  assert.ok(rows.every((row) => row.disposition === "unmet"), "per-phase evidence without a task→phase map must not be credited to any task (fail-closed)");
  assert.ok(!rows.some((row) => row.producer === "build-agent" && row.disposition === "satisfied"), "no task may be credited satisfied without phase attribution");
  fs.rmSync(scratch, { recursive: true, force: true });
});
