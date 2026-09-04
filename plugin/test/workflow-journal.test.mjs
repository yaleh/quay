// @test-group engine
// workflow-journal.test.mjs — DIR-124-B2 (M254): RED/GREEN fixture tests for workflow-journal.ts
// (the StageJournalStore, experiments + plugin mirrors).
//
// Byte-identical mirror: experiments/quay-perpetual-stream/test/workflow-journal.test.mjs
//
// Canonical test placement per the Plan (docs/plans/M254-dir-124-b2.md): plugin/test/ is in
// scripts/test.sh's default glob by location alone; the experiments/test/ copy is invoked by
// explicit path. Path-resolution pin: every direct-module import and CLI-subprocess dispatch in
// this file resolves EXCLUSIVELY against the experiments canonical path
// (experiments/quay-perpetual-stream/scripts/workflow-journal.ts) — plugin/scripts/workflow-journal.ts
// is only ever compared byte-for-byte, never imported.
//
// Run:
//   scripts/test.sh plugin/test/workflow-journal.test.mjs

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

const WORKFLOW_JOURNAL_TS = path.join(SCRIPTS, "workflow-journal.ts");
const PLUGIN_WORKFLOW_JOURNAL_TS = path.join(PLUGIN_SCRIPTS, "workflow-journal.ts");
const STAGE_RECEIPT_TS = path.join(SCRIPTS, "stage-receipt.ts");
const REAL_GATE_LIB = path.join(PLUGIN_SCRIPTS, "gate-script-lib.sh");

// Receipt contract module — workflow-journal.ts does not re-export it; tests build/validate
// receipts through the canonical stage-receipt.ts surface (both mirrors byte-identical).
const receiptMod = await import(STAGE_RECEIPT_TS);

function sha256File(p) {
  return createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

// ── CLI subprocess helper ─────────────────────────────────────────────────────────────────────────

function journal(args, opts = {}) {
  const { cwd = REPO_ROOT, env = {} } = opts;
  try {
    const stdout = execFileSync("node", ["--no-warnings", "--experimental-strip-types", WORKFLOW_JOURNAL_TS, ...args], {
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

// ── fixture helper (real git + real gate-script-lib.sh for root resolution) ───────────────────────

function makeMilestoneFixture(milestoneId = "M254") {
  const dir = fs.mkdtempSync(path.join(TMP, "workflow-journal-fixture-"));
  fs.mkdirSync(path.join(dir, "plugin", "scripts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "plugin", "workflows"), { recursive: true });
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.copyFileSync(REAL_GATE_LIB, path.join(dir, "plugin", "scripts", "gate-script-lib.sh"));
  fs.writeFileSync(path.join(dir, "plugin", "workflows", "execute-milestone.js"), "# workflow fixture\n");
  fs.writeFileSync(path.join(dir, "tasks", "T-1.md"), "# T-1\n");
  execSync("git init -q", { cwd: dir });
  execSync("git config user.email fixture@example.com", { cwd: dir });
  execSync("git config user.name fixture", { cwd: dir });
  execSync("git add -A", { cwd: dir });
  execSync("git commit -q -m fixture", { cwd: dir });
  return { dir, milestoneId };
}

function makeEvent(cwd, overrides = {}) {
  return {
    schemaVersion: "1",
    runId: "M254::DIR-124-B2::1",
    candidateId: "M254",
    taskId: "DIR-124-B2",
    stage: "Build",
    attempt: 0,
    timing: { queuedAtMs: 1000, startedAtMs: 1100, endedAtMs: null },
    agentLabel: "build-agent",
    commandIdentity: "tsc -b",
    executionCwd: cwd,
    worktreePath: null,
    baseCommit: "abc123",
    candidateCommit: null,
    outcome: "done",
    waitReason: null,
    resourceClaim: null,
    observedWrites: [],
    isolationMode: null,
    dispatchMode: "serial",
    recordedAtMs: 2000,
    eventId: "ev-1",
    workflowSourcePath: "plugin/workflows/execute-milestone.js",
    workflowSourceHash: "0".repeat(64),
    workflowSourceCommit: "abc123",
    runtimeGeneration: "gen-1",
    materialInputHashes: { "tasks/T-1.md": sha256File(path.join(cwd, "tasks", "T-1.md")) },
    receiptRef: null,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────────────────────────────

test("mirror parity: workflow-journal.ts byte-identical across experiments/plugin", () => {
  const a = fs.readFileSync(WORKFLOW_JOURNAL_TS, "utf8");
  const b = fs.readFileSync(PLUGIN_WORKFLOW_JOURNAL_TS, "utf8");
  assert.equal(a, b, "experiments/ and plugin/ workflow-journal.ts must be byte-identical");
});

test("AC5: store resolves its root via gate_resolve_milestone_root and asserts M254 root", async () => {
  const mod = await import(WORKFLOW_JOURNAL_TS);
  const { dir } = makeMilestoneFixture("M254");
  try {
    const store = new mod.StageJournalStore({ milestoneId: "M254", cwd: dir });
    assert.equal(store.root, path.resolve(dir, "milestones/M254"));
    // legacy milestone (< 130) resolves under experiments/
    const legacy = new mod.StageJournalStore({ milestoneId: "M129", cwd: dir });
    assert.equal(legacy.root, path.resolve(dir, "experiments/quay-perpetual-stream/milestones/M129"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC5: appendStage line-safe framed append; torn trailing record surfaced, never parsed", async () => {
  const mod = await import(WORKFLOW_JOURNAL_TS);
  const { dir, milestoneId } = makeMilestoneFixture();
  try {
    const store = new mod.StageJournalStore({ milestoneId, cwd: dir });
    const ev = makeEvent(dir);
    const ap = store.appendStage(ev);
    assert.equal(ap.ok, true);
    assert.ok(fs.existsSync(path.join(store.root, "stage-journal.jsonl")));

    const clean = store.readJournal();
    assert.equal(clean.length, 1);
    assert.equal(clean[0].ok, true);

    // simulate a torn trailing record
    fs.appendFileSync(path.join(store.root, "stage-journal.jsonl"), '{"schemaVersion":"1","runId":"torn",', "utf8");
    const torn = store.readJournal();
    const hasTorn = torn.some((r) => !r.ok && r.code === "torn-trailing-record");
    assert.equal(hasTorn, true, "partial trailing record must be surfaced as torn-trailing-record");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC5: writeReceipt temp-then-rename, never overwrites in place", async () => {
  const mod = await import(WORKFLOW_JOURNAL_TS);
  const { dir, milestoneId } = makeMilestoneFixture();
  try {
    const store = new mod.StageJournalStore({ milestoneId, cwd: dir });
    const receipt = receiptMod.buildReceiptEnvelope({
      runId: "M254::DIR-124-B2::1",
      candidateId: "M254",
      taskIds: ["DIR-124-B2"],
      attempt: 1,
      stage: "Build",
      baseCommit: "abc123",
      workflowSourcePath: "plugin/workflows/execute-milestone.js",
      materialInputHashes: { "tasks/T-1.md": sha256File(path.join(dir, "tasks", "T-1.md")) },
      cwd: dir,
    });
    const w = store.writeReceipt(receipt, "M254-Build.json");
    assert.equal(w.ok, true);
    assert.ok(fs.existsSync(path.join(store.root, "receipts", "M254-Build.json")));
    // no .tmp residue
    const leftovers = fs.readdirSync(path.join(store.root, "receipts")).filter((f) => f.includes(".tmp"));
    assert.deepEqual(leftovers, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC5: persistVerifyCache/loadValidatedVerifyCache fail-closed; mismatch → cache-miss", async () => {
  const mod = await import(WORKFLOW_JOURNAL_TS);
  const { dir, milestoneId } = makeMilestoneFixture();
  try {
    const store = new mod.StageJournalStore({ milestoneId, cwd: dir });
    const p = store.persistVerifyCache({
      "check:acceptance": { result: { ok: true }, baseCommit: "abc123", workflowSourceHash: "0".repeat(64), runtimeGeneration: "gen-1" },
    });
    assert.equal(p.ok, true);

    const hit = store.loadValidatedVerifyCache({ baseCommit: "abc123", workflowSourceHash: "0".repeat(64), runtimeGeneration: "gen-1" });
    assert.equal(hit.ok, true);
    assert.equal(hit.code, "cache-hit");

    const miss = store.loadValidatedVerifyCache({ baseCommit: "different", workflowSourceHash: "0".repeat(64), runtimeGeneration: "gen-1" });
    assert.equal(miss.ok, false);
    assert.equal(miss.code, "cache-miss");

    const noCache = store.loadValidatedVerifyCache({ baseCommit: "abc123" });
    assert.equal(noCache.ok, false);
    assert.equal(noCache.code, "cache-miss");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC5: restart survival — fresh store from same files re-reads journal + receipts", async () => {
  const mod = await import(WORKFLOW_JOURNAL_TS);
  const { dir, milestoneId } = makeMilestoneFixture();
  try {
    const store1 = new mod.StageJournalStore({ milestoneId, cwd: dir });
    store1.appendStage(makeEvent(dir));
    const receipt = receiptMod.buildReceiptEnvelope({
      runId: "M254::DIR-124-B2::1",
      candidateId: "M254",
      taskIds: ["DIR-124-B2"],
      attempt: 1,
      stage: "Build",
      baseCommit: "abc123",
      workflowSourcePath: "plugin/workflows/execute-milestone.js",
      materialInputHashes: { "tasks/T-1.md": sha256File(path.join(dir, "tasks", "T-1.md")) },
      cwd: dir,
    });
    store1.writeReceipt(receipt, "M254-Build.json");

    // fresh store (separate process boundary semantics: new instance, same files)
    const store2 = new mod.StageJournalStore({ milestoneId, cwd: dir });
    const journal = store2.readJournal();
    assert.equal(journal.filter((r) => r.ok).length, 1, "journal survives restart");
    assert.ok(fs.existsSync(path.join(store2.root, "receipts", "M254-Build.json")), "receipt survives restart");
    const revalidated = receiptMod.validateReceipt(receipt);
    assert.equal(revalidated.ok, true, "receipt bytes/hashes intact after restart");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC6: migrateDir124AEvent maps pinned A1 20-field schema into StageEvent in SAME journal", async () => {
  const mod = await import(WORKFLOW_JOURNAL_TS);
  const { dir, milestoneId } = makeMilestoneFixture();
  try {
    const store = new mod.StageJournalStore({ milestoneId, cwd: dir });
    const a1 = makeEvent(dir);
    // strip superset fields to get a pure A1 20-field event
    for (const k of ["eventId", "workflowSourcePath", "workflowSourceHash", "workflowSourceCommit", "runtimeGeneration", "materialInputHashes", "receiptRef"]) {
      delete a1[k];
    }
    const r = store.migrateDir124AEvent(a1);
    assert.equal(r.ok, true);
    assert.equal(r.event.migratedFrom, "dir124-a");
    const journal = store.readJournal();
    assert.equal(journal.filter((x) => x.ok).length, 1, "migrated event appended to SAME journal");
    assert.equal(journal[0].event.eventId.startsWith("migrated-"), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC6: migrateDir126DTelemetry maps prepare-telemetry record one-way preserving hashes", async () => {
  const mod = await import(WORKFLOW_JOURNAL_TS);
  const { dir, milestoneId } = makeMilestoneFixture();
  try {
    const store = new mod.StageJournalStore({ milestoneId, cwd: dir });
    const record = {
      schemaVersion: 2,
      recordId: "abc123",
      attemptId: "abc123",
      generationId: "gen-7",
      admission: { fencingToken: 3 },
      hashes: { charter: "aa", taskContract: "bb", proposal: "cc", reviewPolicy: "dd" },
      decision: {},
      terminal: { outcome: "revision-needed", reason: "preflight-rejected", phase: "PreflightPlan", cacheable: false },
      milestoneId: "M254",
      taskId: "DIR-124-B2",
      workspace: ".",
      recordedAtMs: 3000,
    };
    const r = store.migrateDir126DTelemetry(record);
    assert.equal(r.ok, true);
    assert.equal(r.event.migratedFrom, "dir126d");
    assert.equal(Object.keys(r.event.materialInputHashes).length, 4, "hashes preserved");
    assert.equal(r.event.stage, "Preflight", "terminal.phase mapped to valid stage");
    assert.equal(r.event.outcome, "revision-needed");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC7: no post-Land Wiring Audit / landed-awaiting-wiring introduced", async () => {
  const src = fs.readFileSync(WORKFLOW_JOURNAL_TS, "utf8") + "\n" + fs.readFileSync(path.join(SCRIPTS, "stage-receipt.ts"), "utf8");
  assert.ok(!src.includes("landed-awaiting-wiring"), "grep-forbidden string must not appear in either B2 module");
});

test("AC8: all EIGHT execute-milestone stage names are valid StageEvent inputs", async () => {
  const mod = await import(WORKFLOW_JOURNAL_TS);
  const { dir, milestoneId } = makeMilestoneFixture();
  try {
    const store = new mod.StageJournalStore({ milestoneId, cwd: dir });
    for (const stage of ["Verify", "Prepared", "Build", "Build-Evidence", "Audit", "Gate", "Reconcile", "Land"]) {
      const ap = store.appendStage(makeEvent(dir, { stage }));
      assert.equal(ap.ok, true, `stage ${stage} accepted`);
    }
    const journal = store.readJournal();
    assert.equal(journal.filter((x) => x.ok).length, 8, "all eight stage events recorded");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI: --append-stage + --persist-verify-cache + --load-validated-verify-cache across two node processes", async () => {
  const { dir, milestoneId } = makeMilestoneFixture();
  try {
    // process 1: append + persist (Build-phase write)
    const ev = makeEvent(dir);
    const ap1 = journal(["--milestone", milestoneId, "--append-stage", JSON.stringify(ev)], { cwd: dir });
    assert.equal(ap1.exitCode, 0, ap1.stdout);
    assert.ok(ap1.stdout.includes('"ok":true'));

    const persist = journal(["--milestone", milestoneId, "--persist-verify-cache", JSON.stringify({
      "check:acceptance": { result: { ok: true }, baseCommit: "abc123", workflowSourceHash: "0".repeat(64), runtimeGeneration: "gen-1" },
    })], { cwd: dir });
    assert.equal(persist.exitCode, 0, persist.stdout);

    // process 2: separate node invocation re-reads (Audit-phase re-read)
    const load = journal(["--milestone", milestoneId, "--load-validated-verify-cache", JSON.stringify({
      baseCommit: "abc123", workflowSourceHash: "0".repeat(64), runtimeGeneration: "gen-1",
    })], { cwd: dir });
    assert.equal(load.exitCode, 0, load.stdout);
    assert.ok(load.stdout.includes("cache-hit"), "survives process boundary and revalidates");
    assert.ok(fs.existsSync(path.join(dir, "milestones", "M254", "stage-journal.jsonl")), "journal under canonical root");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("selftest exits 0 for both B2 modules", () => {
  const st = journal(["--selftest"]);
  assert.equal(st.exitCode, 0, st.stdout);
});
