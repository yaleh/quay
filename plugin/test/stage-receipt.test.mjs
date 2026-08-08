// @test-group lowconc
// stage-receipt.test.mjs — DIR-124-B2 (M254): RED/GREEN fixture tests for stage-receipt.ts
// (the versioned stage-receipt contract module, experiments + plugin mirrors).
//
// Byte-identical mirror: experiments/quay-perpetual-stream/test/stage-receipt.test.mjs
//
// Canonical test placement per the Plan (docs/plans/M254-dir-124-b2.md): plugin/test/ is in
// scripts/test.sh's default glob by location alone; the experiments/test/ copy is invoked by
// explicit path. Path-resolution pin: every direct-module import and CLI-subprocess dispatch in
// this file resolves EXCLUSIVELY against the experiments canonical path
// (experiments/quay-perpetual-stream/scripts/stage-receipt.ts) — plugin/scripts/stage-receipt.ts is
// only ever compared byte-for-byte, never imported (matching the Plan's Stage 1 pin).
//
// Run:
//   scripts/test.sh plugin/test/stage-receipt.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
const PLUGIN_SCRIPTS = path.join(REPO_ROOT, "plugin", "scripts");
const TMP = os.tmpdir();

const STAGE_RECEIPT_TS = path.join(SCRIPTS, "stage-receipt.ts");
const PLUGIN_STAGE_RECEIPT_TS = path.join(PLUGIN_SCRIPTS, "stage-receipt.ts");

function sha256(s) {
  return createHash("sha256").update(s).digest("hex");
}

function sha256File(p) {
  return createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

// ── CLI subprocess helper (real shell-shaped dispatch, controlled env) ────────────────────────────

function stageReceipt(args, opts = {}) {
  const { cwd = REPO_ROOT, env = {} } = opts;
  try {
    const stdout = execFileSync("node", ["--no-warnings", "--experimental-strip-types", STAGE_RECEIPT_TS, ...args], {
      cwd,
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, ...env },
    });
    return { stdout, exitCode: 0 };
  } catch (e) {
    return { stdout: e.stdout ? String(e.stdout) : "", exitCode: e.status ?? 1 };
  }
}

// ── git fixture helper ─────────────────────────────────────────────────────────────────────────────

function makeGitFixture(extraFiles = {}) {
  const dir = fs.mkdtempSync(path.join(TMP, "stage-receipt-fixture-"));
  fs.mkdirSync(path.join(dir, "plugin", "workflows"), { recursive: true });
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(dir, "plugin", "workflows", "execute-milestone.js"), "# workflow fixture\n");
  fs.writeFileSync(path.join(dir, "tasks", "T-1.md"), "# T-1\n");
  for (const [rel, content] of Object.entries(extraFiles)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  execSync("git init -q", { cwd: dir });
  execSync("git config user.email fixture@example.com", { cwd: dir });
  execSync("git config user.name fixture", { cwd: dir });
  execSync("git add -A", { cwd: dir });
  execSync("git commit -q -m fixture", { cwd: dir });
  return dir;
}

function makeInput(cwd, overrides = {}) {
  const baseCommit = execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
  return {
    runId: "M254::DIR-124-B2::1",
    candidateId: "M254",
    taskIds: ["DIR-124-B2"],
    attempt: 1,
    stage: "Build",
    baseCommit,
    workflowSourcePath: "plugin/workflows/execute-milestone.js",
    materialInputHashes: { "tasks/T-1.md": sha256File(path.join(cwd, "tasks", "T-1.md")) },
    cwd,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────────────────────────────

test("mirror parity: stage-receipt.ts byte-identical across experiments/plugin", () => {
  const a = fs.readFileSync(STAGE_RECEIPT_TS, "utf8");
  const b = fs.readFileSync(PLUGIN_STAGE_RECEIPT_TS, "utf8");
  assert.equal(a, b, "experiments/ and plugin/ stage-receipt.ts must be byte-identical");
});

test("AC1: ONE versioned schema family; CONTRACT_SCHEMA_VERSION exported and receipts carry it", async () => {
  const mod = await import(STAGE_RECEIPT_TS);
  assert.equal(mod.CONTRACT_SCHEMA_VERSION, "1");
  const dir = makeGitFixture();
  try {
    const input = makeInput(dir);
    const receipt = mod.buildReceiptEnvelope(input);
    assert.equal(receipt.schemaVersion, "1");
    assert.ok(receipt.contentHash.length === 64, "contentHash is a sha256");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC1: canReuseFinding — recurrence does not permit reuse when material input hashes differ", async () => {
  const mod = await import(STAGE_RECEIPT_TS);
  const prior = {
    schemaVersion: "1",
    findingId: "f-1",
    recurrenceKey: "abc123",
    observerStage: "Receipt",
    subsystem: "Proposal",
    claimRef: "DD10",
    severity: "blocker",
    blocking: false,
    everBlocking: true,
    evidence: [],
    materialInputHashes: { "tasks/T-1.md": "hash-a" },
    firstSeenGeneration: 0,
    lastSeenGeneration: 1,
    disposition: "backlog",
    resolution: null,
    generalization: "task-specific",
  };

  // same recurrenceKey + same material hashes → reusable
  const same = mod.canReuseFinding(prior, { recurrenceKey: "abc123", materialInputHashes: { "tasks/T-1.md": "hash-a" } });
  assert.equal(same.ok, true, `code=${same.code}`);

  // same recurrenceKey + DIFFERENT material hash → NOT reusable (negative control, B2-CLAIM-14)
  const diffHash = mod.canReuseFinding(prior, { recurrenceKey: "abc123", materialInputHashes: { "tasks/T-1.md": "hash-b" } });
  assert.equal(diffHash.ok, false);
  assert.equal(diffHash.code, "material-input-hash-mismatch");

  // different recurrenceKey → NOT reusable
  const diffKey = mod.canReuseFinding(prior, { recurrenceKey: "other", materialInputHashes: { "tasks/T-1.md": "hash-a" } });
  assert.equal(diffKey.ok, false);
  assert.equal(diffKey.code, "recurrence-key-mismatch");
});

test("AC2: bindReceipt binds base/candidate commits, source, runtime generation, material hashes", async () => {
  const mod = await import(STAGE_RECEIPT_TS);
  const dir = makeGitFixture();
  try {
    const input = makeInput(dir);
    const receipt = mod.buildReceiptEnvelope(input);
    assert.equal(receipt.baseCommit, input.baseCommit);
    assert.equal(receipt.workflowSourceHash, sha256File(path.join(dir, "plugin", "workflows", "execute-milestone.js")));
    assert.ok(receipt.runtimeGeneration.length > 0);
    assert.equal(receipt.materialInputHashes["tasks/T-1.md"], input.materialInputHashes["tasks/T-1.md"]);

    const bound = mod.bindReceipt(receipt, { candidateCommit: "cafe1234" });
    assert.equal(bound.candidateCommit, "cafe1234");
    assert.notEqual(bound.contentHash, receipt.contentHash, "binding changes contentHash");

    // empty materialInputHashes → not reusable
    const empty = { ...receipt, materialInputHashes: {}, contentHash: "" };
    const emptyCanonical = mod.serializeReceipt(empty);
    empty.contentHash = sha256(emptyCanonical);
    const vr = mod.validateReceipt(empty);
    assert.equal(vr.ok, false);
    assert.equal(vr.code, "empty-material-inputs");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC3: validateReceipt returns ONE distinct fail-closed code per AC6 hazard", async () => {
  const mod = await import(STAGE_RECEIPT_TS);
  const dir = makeGitFixture();
  try {
    const input = makeInput(dir);
    const receipt = mod.buildReceiptEnvelope(input);
    const materialHash = input.materialInputHashes["tasks/T-1.md"];

    // wrong-base
    let r = mod.validateReceipt(receipt, { baseCommit: "beef0000" });
    assert.equal(r.ok, false); assert.equal(r.code, "wrong-base");

    // wrong-candidate (unbound receipt when a candidate is expected) — DISTINCT code
    r = mod.validateReceipt(receipt, { candidateCommit: "cafe1234" });
    assert.equal(r.ok, false); assert.equal(r.code, "wrong-candidate");

    // moved-candidate-commit (bound receipt, commit moved since) — DISTINCT code
    const bound = mod.bindReceipt(receipt, { candidateCommit: "cafe1234" });
    r = mod.validateReceipt(bound, { candidateCommit: "d00d0000" });
    assert.equal(r.ok, false); assert.equal(r.code, "moved-candidate-commit");

    // modified-plan (a plan material input hash changed)
    r = mod.validateReceipt(receipt, { materialInputHashes: { "docs/plans/M254.md": "0".repeat(64) } });
    assert.equal(r.ok, false); assert.equal(r.code, "modified-plan");

    // stale-workflow-materialization
    r = mod.validateReceipt(receipt, { workflowSourceHash: "1".repeat(64) });
    assert.equal(r.ok, false); assert.equal(r.code, "stale-workflow-materialization");

    // wrong-runtime-generation
    r = mod.validateReceipt(receipt, { runtimeGeneration: "other-gen" });
    assert.equal(r.ok, false); assert.equal(r.code, "wrong-runtime-generation");

    // missing-artifact via evidence-manifest ref
    const refReceipt = mod.buildReceiptEnvelope({ ...input, evidenceManifestRef: { hash: "0".repeat(64), path: "nope/missing.json", candidateCommit: "cafe1234" } });
    r = mod.validateReceipt(refReceipt);
    assert.equal(r.ok, false); assert.equal(r.code, "missing-artifact");

    // tampered-receipt
    const tampered = { ...receipt, baseCommit: "deadbeef" };
    r = mod.validateReceipt(tampered);
    assert.equal(r.ok, false); assert.equal(r.code, "tampered-receipt");

    // empty-material-inputs
    const empty = { ...receipt, materialInputHashes: {}, contentHash: "" };
    empty.contentHash = sha256(mod.serializeReceipt(empty));
    r = mod.validateReceipt(empty);
    assert.equal(r.ok, false); assert.equal(r.code, "empty-material-inputs");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC4: validateEvidenceManifestRef hash-validates; rejectDuplicateAuthority rejects embedded content", async () => {
  const mod = await import(STAGE_RECEIPT_TS);
  const dir = makeGitFixture({ "build-evidence-manifest.json": JSON.stringify({ schemaVersion: "1", candidateCommit: "cafe1234" }) });
  try {
    const mhash = sha256File(path.join(dir, "build-evidence-manifest.json"));
    const okRef = mod.validateEvidenceManifestRef({ path: "build-evidence-manifest.json", sha256: mhash }, dir);
    assert.equal(okRef.ok, true);

    const badRef = mod.validateEvidenceManifestRef({ path: "build-evidence-manifest.json", sha256: "0".repeat(64) }, dir);
    assert.equal(badRef.ok, false); assert.equal(badRef.code, "missing-artifact");

    const missingRef = mod.validateEvidenceManifestRef({ path: "does-not-exist.json", sha256: mhash }, dir);
    assert.equal(missingRef.ok, false); assert.equal(missingRef.code, "missing-artifact");

    const dup = mod.rejectDuplicateAuthority({ receiptId: "r1", requirementText: "must do X" });
    assert.equal(dup.ok, false); assert.equal(dup.code, "duplicate-authority");
    const clean = mod.rejectDuplicateAuthority({ receiptId: "r1", baseCommit: "abc" });
    assert.equal(clean.ok, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC6: migratePrepareLedger maps proposal-ledger entry one-way preserving source fields + hashes", async () => {
  const mod = await import(STAGE_RECEIPT_TS);
  const entry = {
    id: "bde091ab",
    subsystem: "Proposal DD10 / A1a-SELFTEST",
    severity: "blocker",
    blocking: false,
    everBlocking: true,
    disposition: "backlog",
    evidence: "grep -c selftest …",
    claimRef: "DD10, wiring-claim A1a-SELFTEST",
    rootCauseKey: "proposal-factual-error-selftest-precedent-missing",
    status: "resolved",
    firstSeenRound: 0,
    lastSeenRound: 1,
  };
  const r = mod.migratePrepareLedger(entry, { sourceRecordId: "bde091ab", sourceHashes: { ledger: "abc" } });
  assert.equal(r.ok, true);
  assert.equal(r.finding.findingId, "bde091ab");
  assert.equal(r.finding.severity, "blocker");
  assert.equal(r.finding.everBlocking, true);
  assert.equal(r.finding.disposition, "backlog");
  assert.equal(r.finding.recurrenceKey, entry.rootCauseKey);
  assert.equal(r.finding.sourceRecordId, "bde091ab");
  assert.deepEqual(r.finding.sourceHashes, { ledger: "abc" });
});

test("CLI: --validate-receipt valid exits 0, tampered exits 1; --selftest exits 0", async () => {
  const mod = await import(STAGE_RECEIPT_TS);
  const dir = makeGitFixture();
  try {
    const input = makeInput(dir);
    const receipt = mod.buildReceiptEnvelope(input);
    const json = JSON.stringify(receipt);

    const ok = stageReceipt(["--validate-receipt", json]);
    assert.equal(ok.exitCode, 0);
    assert.ok(ok.stdout.includes('"code":"ok"'));

    const tampered = { ...receipt, baseCommit: "deadbeef" };
    const bad = stageReceipt(["--validate-receipt", JSON.stringify(tampered)]);
    assert.equal(bad.exitCode, 1);
    assert.ok(bad.stdout.includes("tampered-receipt"));

    const st = stageReceipt(["--selftest"]);
    assert.equal(st.exitCode, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
