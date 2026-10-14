// @test-group engine
// experiment-manifest.test.mjs — the resumable-long-experiment fixture
// (tasks/gap-resumable-long-experiments-via-driver-adopt-restart-not-separate-scheduler, AC1-AC4).
//
// WHAT THIS FIXTURE IS: a three-stage experiment (1 smoke + 2 full) driven through the REAL
// `runStages`/`planResume` of plugin/scripts/experiment-manifest.ts with an INJECTED stage executor.
// The executor is what a real stage would be — it appends one line to a per-stage log and writes an
// artifact — so "stage 1 was not recomputed" is a DIRECT reading (the log has exactly one line for it,
// and the artifact's bytes are unchanged), not a claim about a returned array.
//
// AC1 — a "driver restart" is modelled the way a real one happens: the process dies between stages, so
//   the executor THROWS at the start of stage 2 and the throw propagates out of runStages (⛔ the
//   module never swallows it — swallowing would turn "died mid-stage" into "finished"). The next
//   dispatch re-enters runStages on the same state dir and must run stages 2+3 only.
//   NEGATIVE CONTROL (non-vacuousness): the same fixture with an EMPTY state dir — exactly the pre-fix
//   behaviour (no checkpoint existed at all) — re-runs stage 1. Without that control, "stage 1 did not
//   run" would also be satisfied by an executor that never ran anything.
// AC2 — a changed commit between passes invalidates the checkpoint and re-runs the stage, and the
//   refusal is RECORDED (invalidations carrier) with both fingerprints, ⛔ never silently overwritten.
// AC3 — the smoke stage is checkpointed before any full stage; a fixture where it FAILS leaves the
//   expensive stages unexecuted (asserted by their own executor invocation counter) and they stay
//   blocked on the next dispatch.
// AC4 — the module introduces no scheduler: no timer, no interval, no daemon, no polling loop. The
//   experiment runs inside the worker's own turn, so it is observable/stoppable via the worker-driver's
//   EXISTING surfaces — which is also what the worker-driver resume clause is pinned to (last test).
//
// ⛔ Every fixture dir is under the resolved writable tmp root (helpers/tmp-workspace.mjs) — nothing is
// written inside the repo tree (checked-in-write-check / test-isolation-check).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { runGit } from "./helpers/worker-driver-harness.mjs";
import { makeTmpDir } from "./helpers/tmp-workspace.mjs";
import {
  buildContinueWorkerPrompt,
  buildWorkerPrompt,
  experimentResumeClause,
} from "../scripts/worker-driver.ts";
import {
  checkpointsFile,
  computeIdentity,
  computeStageInputsHash,
  experimentStateDir,
  identityMismatch,
  invalidationsFile,
  manifestFile,
  planResume,
  readCheckpoints,
  readInvalidations,
  readManifest,
  resolveCommit,
  resolveHost,
  runStages,
  writeCheckpoint,
  writeManifest,
} from "../scripts/experiment-manifest.ts";

const COMMIT_A = "a".repeat(40);
const COMMIT_B = "b".repeat(40);
const HOST = "fixture-host";

function manifestFixture(experiment, { smokeVerdictCommand = "exit 0" } = {}) {
  return {
    experiment,
    inputs: { lanes: [32, 48], rounds: 1 },
    config: { memoryPolicy: "MemoryMax=16G", quayVersion: "0.20.0-dev" },
    host: HOST,
    gitCommit: COMMIT_A,
    outputDir: "out",
    stages: [
      { id: "smoke-lane8", kind: "smoke", inputs: { lane: 8, round: 1 }, command: ["true"], expectedArtifacts: ["smoke.artifact"] },
      { id: "lane32-r1", kind: "full", inputs: { lane: 32, round: 1 }, command: ["true"], expectedArtifacts: ["lane32.artifact"] },
      { id: "lane48-r1", kind: "full", inputs: { lane: 48, round: 1 }, command: ["true"], expectedArtifacts: ["lane48.artifact"] },
    ],
    __smokeVerdictCommand: smokeVerdictCommand,
  };
}

function identity(commit) {
  return computeIdentity({ commit, host: HOST, config: { memoryPolicy: "MemoryMax=16G", quayVersion: "0.20.0-dev" } });
}

/** A stage executor that models a real stage: it logs its own invocation and writes its artifact.
 *  `execLog`/`artifactBytes` are the DIRECT readings the ACs are judged on. */
function makeExecutor(stateDir, { failSmoke = false, log } = {}) {
  const calls = [];
  const outDir = path.join(stateDir, "out");
  const execute = (stage) => {
    calls.push(stage.id);
    fs.mkdirSync(outDir, { recursive: true });
    fs.appendFileSync(log, `${stage.id}\n`);
    const bytes = `artifact for ${stage.id}\n`;
    fs.writeFileSync(path.join(outDir, `${stage.id}.artifact`), bytes);
    const verdict = failSmoke && stage.kind === "smoke" ? "fail" : "pass";
    return {
      artifacts: [path.join(outDir, `${stage.id}.artifact`)],
      filesPlanned: null,
      oomKill: null,
      peakRssBytes: null,
      wallMs: 1,
      verdict,
      note: verdict === "fail" ? "fixture smoke failure" : null,
    };
  };
  return { execute, calls };
}

function countLines(log, needle) {
  if (!fs.existsSync(log)) return 0;
  return fs
    .readFileSync(log, "utf8")
    .split("\n")
    .filter((l) => l === needle).length;
}

function md5(file) {
  return crypto.createHash("md5").update(fs.readFileSync(file)).digest("hex");
}

/** The interruption a driver restart / SIGTERM produces: the process ends between stages. */
class Interrupted extends Error {}

/** A tmp dir that is ALSO a git repo — built on the tmp-workspace helper so the dir is REGISTERED for
 *  the file-level after() cleanup (the driver harness's own git-root maker mkdtemps without pairing,
 *  and every leaked /tmp dir is a cost this repo already pays for elsewhere). */
function makeGitDir(tag) {
  const dir = makeTmpDir(tag);
  runGit(dir, ["init", "-q"]);
  runGit(dir, ["config", "user.email", "test@example.com"]);
  runGit(dir, ["config", "user.name", "Test"]);
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".gitignore"), ".quay/\n");
  runGit(dir, ["add", ".gitignore"]);
  runGit(dir, ["commit", "-q", "-m", "gitignore .quay"]);
  return dir;
}

function newFixture(tag) {
  const root = makeTmpDir(tag);
  const stateDir = experimentStateDir(root, "demo");
  const log = path.join(root, "stages.log");
  fs.mkdirSync(stateDir, { recursive: true });
  return { root, stateDir, log };
}

// ── AC1 ──────────────────────────────────────────────────────────────────────────────────────────

test("AC1: a restart between stages 1 and 2 resumes at stage 2 — stage 1's output is unchanged and not recomputed", () => {
  const { root, stateDir, log } = newFixture("expm-ac1-");
  const manifest = manifestFixture("demo");
  writeManifest(stateDir, manifest);
  const id = identity(COMMIT_A);

  // Pass 1: completes the smoke stage, then DIES at the start of stage 2 (a driver restart).
  const first = makeExecutor(stateDir, { log });
  const interrupted = (stage) => {
    if (stage.id === "lane32-r1") throw new Interrupted("driver restarted mid-experiment");
    return first.execute(stage);
  };
  assert.throws(
    () => runStages({ manifest, stateDir, identity: id, execute: interrupted }),
    Interrupted,
    "the interruption propagates — runStages must never swallow it",
  );
  assert.deepEqual(first.calls, ["smoke-lane8"], "only the smoke stage completed before the restart");
  const artifact1 = path.join(stateDir, "out", "smoke-lane8.artifact");
  assert.equal(countLines(log, "smoke-lane8"), 1, "stage 1 ran exactly once so far");
  const md5Before = md5(artifact1);

  // The evidence a reader has after the restart: the plan itself says stage 1 is paid for.
  const planAfterRestart = planResume({ manifest, checkpoints: readCheckpoints(stateDir), identity: id });
  assert.deepEqual(planAfterRestart.skip, ["smoke-lane8"]);
  assert.deepEqual(planAfterRestart.run, ["lane32-r1", "lane48-r1"]);

  // Pass 2: the redispatch (a fresh worker on the same state dir) runs the remainder.
  const second = makeExecutor(stateDir, { log });
  const report = runStages({ manifest, stateDir, identity: id, execute: second.execute });

  assert.deepEqual(second.calls, ["lane32-r1", "lane48-r1"], "resumed AT stage 2 — stage 1 was not re-entered");
  assert.deepEqual(report.ran, ["lane32-r1", "lane48-r1"]);
  assert.deepEqual(report.skipped, ["smoke-lane8"]);
  assert.equal(countLines(log, "smoke-lane8"), 1, "stage 1 was NOT recomputed (its log line count is unchanged)");
  assert.equal(md5(artifact1), md5Before, "stage 1's output bytes are unchanged");
  assert.ok(fs.existsSync(path.join(stateDir, "out", "lane48-r1.artifact")), "the remainder really ran");

  // NEGATIVE CONTROL: the pre-fix behaviour — no checkpoint existed at all — recomputes stage 1.
  const pre = newFixture("expm-ac1-neg-");
  writeManifest(pre.stateDir, manifest);
  const preExec = makeExecutor(pre.stateDir, { log: pre.log });
  const preReport = runStages({ manifest, stateDir: pre.stateDir, identity: id, execute: preExec.execute });
  assert.ok(preExec.calls.includes("smoke-lane8"), "negative control: without a checkpoint stage 1 IS recomputed");
  assert.ok(preReport.ran.includes("smoke-lane8"));
  void root;
});

// ── AC2 ──────────────────────────────────────────────────────────────────────────────────────────

test("AC2: a changed commit invalidates the checkpoint, reruns the stage, and the mismatch is recorded (not silently overwritten)", () => {
  const { stateDir, log } = newFixture("expm-ac2-");
  const manifest = manifestFixture("demo");
  writeManifest(stateDir, manifest);

  const first = makeExecutor(stateDir, { log });
  runStages({ manifest, stateDir, identity: identity(COMMIT_A), execute: first.execute });
  assert.deepEqual(first.calls, ["smoke-lane8", "lane32-r1", "lane48-r1"]);
  const cpAfterFirst = readCheckpoints(stateDir);
  assert.equal(cpAfterFirst.records.length, 3);
  assert.equal(readInvalidations(stateDir).length, 0, "a first run refuses nothing");

  // The identity moves (a different commit = a different harness).
  const plan = planResume({ manifest, checkpoints: cpAfterFirst, identity: identity(COMMIT_B) });
  assert.deepEqual(plan.skip, [], "nothing is trusted under the new commit");
  assert.deepEqual(plan.run, ["smoke-lane8", "lane32-r1", "lane48-r1"]);
  assert.equal(plan.invalidated.length, 3);
  assert.match(plan.invalidated[0].reason, /identity-changed: commit a{40} -> b{40}/, "the reason NAMES the changed field and both values");

  const second = makeExecutor(stateDir, { log });
  const report = runStages({ manifest, stateDir, identity: identity(COMMIT_B), execute: second.execute });
  assert.deepEqual(second.calls, ["smoke-lane8", "lane32-r1", "lane48-r1"], "the invalidated stages reran");
  assert.equal(report.invalidated.length, 3);

  const recorded = readInvalidations(stateDir);
  assert.equal(recorded.length, 3, "each refusal is RECORDED — not silently overwritten");
  const r0 = recorded.find((r) => r.stageId === "smoke-lane8");
  assert.match(r0.reason, /identity-changed: commit/);
  assert.equal(r0.wasIdentity.commit, COMMIT_A, "the discarded fingerprint is preserved");
  assert.equal(r0.nowIdentity.commit, COMMIT_B, "the fingerprint that replaced it is named too");

  // The new checkpoints carry the new identity — and a third pass under COMMIT_B is a clean skip.
  const third = planResume({ manifest, checkpoints: readCheckpoints(stateDir), identity: identity(COMMIT_B) });
  assert.deepEqual(third.skip, ["smoke-lane8", "lane32-r1", "lane48-r1"]);
  assert.deepEqual(third.run, []);

  // The other two identity fields are enumerated too (硬规则 3 — no boolean "identity changed").
  assert.match(identityMismatch(identity(COMMIT_A), computeIdentity({ commit: COMMIT_A, host: "other-host", config: manifest.config })), /host fixture-host -> other-host/);
  assert.match(
    identityMismatch(identity(COMMIT_A), computeIdentity({ commit: COMMIT_A, host: HOST, config: { ...manifest.config, memoryPolicy: "MemoryMax=8G" } })),
    /policy /,
  );
});

// ── AC3 ──────────────────────────────────────────────────────────────────────────────────────────

test("AC3: the smoke stage is checkpointed before the full experiment; a failing smoke stage stops the experiment before the expensive stage runs", () => {
  const { stateDir, log } = newFixture("expm-ac3-");
  const manifest = manifestFixture("demo");
  writeManifest(stateDir, manifest);
  const id = identity(COMMIT_A);

  // A broken harness: the smoke stage completes but reports failure.
  const exec = makeExecutor(stateDir, { failSmoke: true, log });
  const report = runStages({ manifest, stateDir, identity: id, execute: exec.execute });

  assert.deepEqual(exec.calls, ["smoke-lane8"], "the expensive stages were NEVER executed");
  assert.deepEqual(report.ran, ["smoke-lane8"]);
  assert.deepEqual(
    report.blocked.map((b) => b.stageId),
    ["lane32-r1", "lane48-r1"],
  );
  assert.match(report.blocked[0].reason, /smoke stage smoke-lane8 completed with verdict fail/);
  assert.equal(report.smoke.satisfied, false);

  // The smoke result is itself a checkpoint (so it is not re-paid on resume) …
  const cps = readCheckpoints(stateDir);
  const smokeCp = cps.records.find((r) => r.stageId === "smoke-lane8");
  assert.equal(smokeCp.outputs.verdict, "fail", "the failing smoke stage is checkpointed AS failing");

  // … and the next dispatch does not retry it, nor reach the full stages.
  const again = makeExecutor(stateDir, { failSmoke: true, log });
  const report2 = runStages({ manifest, stateDir, identity: id, execute: again.execute });
  assert.deepEqual(again.calls, [], "a failed smoke stage is not silently retried");
  assert.deepEqual(
    report2.blocked.map((b) => b.stageId),
    ["lane32-r1", "lane48-r1"],
    "the full stages stay blocked across a restart",
  );
  assert.equal(countLines(log, "smoke-lane8"), 1);

  // The positive branch: a smoke stage that PASSES unblocks the full stages in the SAME pass
  // (the gate is re-asked between stages — a frozen entry snapshot would need a second invocation).
  const ok = newFixture("expm-ac3-ok-");
  writeManifest(ok.stateDir, manifest);
  const okExec = makeExecutor(ok.stateDir, { log: ok.log });
  const okReport = runStages({ manifest, stateDir: ok.stateDir, identity: id, execute: okExec.execute });
  assert.deepEqual(okExec.calls, ["smoke-lane8", "lane32-r1", "lane48-r1"], "passing smoke unblocks the full stages in one pass");
  assert.deepEqual(okReport.blocked, []);
  assert.equal(okReport.smoke.satisfied, true);
});

// ── NOT-EVALUATED (硬规则 3b) ────────────────────────────────────────────────────────────────────

test("an unreadable checkpoint carrier is NOT-EVALUATED, never a silent 'nothing was paid for' first run", () => {
  const { stateDir, log } = newFixture("expm-ne-");
  const manifest = manifestFixture("demo");
  writeManifest(stateDir, manifest);
  const id = identity(COMMIT_A);
  runStages({ manifest, stateDir, identity: id, execute: makeExecutor(stateDir, { log }).execute });
  assert.equal(readCheckpoints(stateDir).records.length, 3);

  // Truncate the carrier (a kill mid-write is not possible — the write is atomic — but a corrupt file,
  // a bad merge or a hand edit is).
  fs.writeFileSync(checkpointsFile(stateDir), "{ this is not json");

  const read = readCheckpoints(stateDir);
  assert.equal(read.exists, true, "the carrier is still THERE");
  assert.equal(read.readable, false, "…and it is distinguished from an absent one");
  assert.deepEqual(read.records, []);

  const plan = planResume({ manifest, checkpoints: read, identity: id });
  assert.equal(plan.checkpointsReadable, false);
  assert.deepEqual(plan.skip, [], "nothing is trusted");
  assert.equal(plan.invalidated.length, 3, "every stage is a refusal — NOT 'no checkpoint yet'");
  assert.match(plan.invalidated[0].reason, /checkpoints-unreadable/);

  const exec = makeExecutor(stateDir, { log });
  runStages({ manifest, stateDir, identity: id, execute: exec.execute });
  assert.ok(
    readInvalidations(stateDir).some((r) => /checkpoints-unreadable/.test(r.reason)),
    "the unreadable carrier is recorded as the reason, so the replay is not mistaken for a first run",
  );
  assert.equal(readCheckpoints(stateDir).readable, true, "the rewrite heals the carrier");

  // An ABSENT carrier is the legitimate first run — a different reading, not a refusal.
  const fresh = newFixture("expm-ne-fresh-");
  writeManifest(fresh.stateDir, manifest);
  const freshRead = readCheckpoints(fresh.stateDir);
  assert.equal(freshRead.exists, false);
  assert.equal(freshRead.readable, true);
  assert.deepEqual(planResume({ manifest, checkpoints: freshRead, identity: id }).invalidated, []);

  // A manifest that exists but cannot be parsed is likewise not "no experiment declared".
  fs.writeFileSync(manifestFile(fresh.stateDir), "{ nope");
  const bad = readManifest(fresh.stateDir);
  assert.equal(bad.exists, true);
  assert.equal(bad.readable, false);
  assert.equal(bad.manifest, null);
  assert.match(String(bad.error), /parse/);
});

test("inputs change invalidates only the affected stage (the inputs hash is per stage)", () => {
  const { stateDir, log } = newFixture("expm-inputs-");
  const manifest = manifestFixture("demo");
  writeManifest(stateDir, manifest);
  const id = identity(COMMIT_A);
  runStages({ manifest, stateDir, identity: id, execute: makeExecutor(stateDir, { log }).execute });

  const changed = {
    ...manifest,
    stages: manifest.stages.map((s) => (s.id === "lane32-r1" ? { ...s, inputs: { lane: 32, round: 2 } } : s)),
  };
  const plan = planResume({ manifest: changed, checkpoints: readCheckpoints(stateDir), identity: id });
  assert.deepEqual(plan.run, ["lane32-r1"], "only the stage whose inputs moved owes work");
  assert.deepEqual(plan.skip, ["smoke-lane8", "lane48-r1"]);
  assert.match(plan.invalidated[0].reason, /inputs-changed/);

  // The inputs hash really does depend on the stage's own inputs AND on the manifest's shared inputs.
  const s32 = changed.stages.find((s) => s.id === "lane32-r1");
  const base = computeStageInputsHash(changed, s32);
  assert.notEqual(base, computeStageInputsHash(manifest, manifest.stages.find((s) => s.id === "lane32-r1")));
  assert.notEqual(base, computeStageInputsHash({ ...changed, inputs: { lanes: [64], rounds: 1 } }, s32));
});

test("the checkpoint round-trips a stage's measurement, and an unmeasured counter stays null (never 0)", () => {
  const { stateDir } = newFixture("expm-out-");
  const manifest = manifestFixture("demo");
  writeManifest(stateDir, manifest);
  const id = identity(COMMIT_A);
  writeCheckpoint(stateDir, {
    stageId: "lane32-r1",
    inputsHash: computeStageInputsHash(manifest, manifest.stages[1]),
    identity: id,
    outputs: { artifacts: ["/nowhere/lane32.artifact"], filesPlanned: 32, oomKill: 0, peakRssBytes: null, wallMs: 1234, verdict: "pass", note: null },
    completedAt: new Date().toISOString(),
  });
  const [cp] = readCheckpoints(stateDir).records;
  assert.equal(cp.outputs.filesPlanned, 32);
  assert.equal(cp.outputs.oomKill, 0, "a MEASURED zero is a zero");
  assert.equal(cp.outputs.peakRssBytes, null, "an UNMEASURED counter is null — 硬规则 3b, not 0");
  assert.deepEqual(planResume({ manifest, checkpoints: readCheckpoints(stateDir), identity: id }).skip, ["lane32-r1"]);
});

// ── the module is a library, not a scheduler ─────────────────────────────────────────────────────

test("AC4 (wiring): the driver's dispatch + continue prompts carry the resume clause exactly when the task has an unfinished experiment", () => {
  // A REAL git root: the clause reads the identity (commit + host) from the workspace, so a bare tmp
  // dir would put every checkpoint into the "identity-changed" arm for the wrong reason.
  const root = makeGitDir("expm-clause-");
  fs.writeFileSync(
    path.join(root, "tasks", "demo.md"),
    "---\nid: demo\ntitle: a task with a long experiment\nstatus: ready\n---\n\n## Acceptance Criteria\n- [ ] AC1: x\n",
  );
  // The retained worktree is a REAL checkout: the clause reads the identity commit from the tree under
  // test, so a bare path would put the checkpoint into the "identity-changed" arm for the wrong reason.
  const wt = makeGitDir("expm-clause-wt-");
  const manifest = manifestFixture("demo");

  // OPT-IN: no manifest ⇒ null, and the prompt is the clause-free prompt of today.
  assert.equal(experimentResumeClause(root, "demo", null), null);
  assert.equal(buildWorkerPrompt("demo", root).includes("RESUMABLE LONG EXPERIMENT"), false);

  // A manifest with one paid-for stage: the clause names it as ⛔ not-to-be-recomputed, and points at
  // the plan CLI for the rest.
  const stateDir = experimentStateDir(root, "demo");
  writeManifest(stateDir, manifest);
  writeCheckpoint(stateDir, {
    stageId: "smoke-lane8",
    inputsHash: computeStageInputsHash(manifest, manifest.stages[0]),
    identity: computeIdentity({ commit: resolveCommit(wt), host: resolveHost(), config: manifest.config }),
    outputs: { artifacts: [], filesPlanned: 8, oomKill: 0, peakRssBytes: null, wallMs: 5, verdict: "pass", note: null },
    completedAt: new Date().toISOString(),
  });
  const clause = experimentResumeClause(root, "demo", wt);
  assert.match(clause, /MUST NOT be recomputed: smoke-lane8/, "the paid-for stage is named");
  assert.match(clause, /lane32-r1, lane48-r1/, "the owed stages are named");
  assert.match(clause, /--plan --task demo/);
  assert.match(clause, /SYNCHRONOUS and runs in YOUR turn/, "the no-second-loop requirement travels with the clause");
  assert.match(clause, new RegExp(`--measure-root ${wt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));

  // The clause reaches BOTH dispatch prompts. The fresh prompt has no worktree yet, so it names the
  // same placeholder the other clauses use; the continue prompt knows the retained worktree.
  assert.match(buildWorkerPrompt("demo", root), /RESUMABLE LONG EXPERIMENT/);
  assert.match(buildWorkerPrompt("demo", root), /--measure-root <the worktree path you created in step 1>/);
  const continueState = {
    worktreePath: wt,
    branchCommits: 0,
    branchHeadSubject: null,
    acChecked: 0,
    acTotal: 1,
    failureReason: "fixture",
    attempts: [],
  };
  const continuePrompt = buildContinueWorkerPrompt("demo", root, continueState);
  assert.match(continuePrompt, /RESUMABLE LONG EXPERIMENT/);
  assert.match(continuePrompt, new RegExp(`--measure-root ${wt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));

  // A FINISHED experiment (every stage checkpointed under the current identity) yields no clause: the
  // clause is about owed work, not about the mere existence of a manifest.
  const fresh = makeGitDir("expm-clause-done-");
  fs.mkdirSync(experimentStateDir(fresh, "demo"), { recursive: true });
  writeManifest(experimentStateDir(fresh, "demo"), manifest);
  const id = computeIdentity({ commit: resolveCommit(fresh), host: resolveHost(), config: manifest.config });
  for (const stage of manifest.stages) {
    writeCheckpoint(experimentStateDir(fresh, "demo"), {
      stageId: stage.id,
      inputsHash: computeStageInputsHash(manifest, stage),
      identity: id,
      outputs: { artifacts: [], filesPlanned: null, oomKill: null, peakRssBytes: null, wallMs: 1, verdict: "pass", note: null },
      completedAt: new Date().toISOString(),
    });
  }
  assert.equal(experimentResumeClause(fresh, "demo", null), null, "a finished experiment says nothing");

  // An UNREADABLE manifest is not "no experiment" — the clause says so instead of staying silent.
  fs.writeFileSync(manifestFile(experimentStateDir(fresh, "demo")), "{ broken");
  assert.match(experimentResumeClause(fresh, "demo", null), /NOT READABLE/);
});

test("no scheduler: the module starts no timer, no interval and no polling loop", () => {
  const src = fs.readFileSync(new URL("../scripts/experiment-manifest.ts", import.meta.url), "utf8");
  // Position, not keyword (硬规则 2): the assertions below read CALL SHAPES, and the module's own
  // docblock explains why they are absent — so a prose mention can never make this pass or fail.
  const calls = src
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");
  for (const banned of ["setInterval(", "setTimeout(", "setImmediate(", "cron", "daemon", "while (true)"]) {
    assert.equal(calls.includes(banned), false, `the module must not carry a scheduler shape: ${banned}`);
  }
  // The ONE child process it may start is a single synchronous stage command, awaited in the caller's
  // own turn (spawnStageExecutor). Nothing async is left running behind it.
  assert.match(calls, /spawnSync\(/, "the stage executor runs a command synchronously");
  assert.equal(/\bawait\b|Promise/.test(calls), false, "the whole module is synchronous — no background work");
});
