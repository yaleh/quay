// @test-group serial
// worker-fan-in.test.mjs — gap-goal-branch-done-means-landed-on-merge-target (the B2 carrier:
// "`done` 的语义 = 已落到它的 mergeTarget").
//
// WHAT IS UNDER TEST: plugin/scripts/worker-fan-in.ts — the state dual-write added after the ff step
// (SPEC-goal-branch-2026-10-03 §5 B2, ruling ⑪: `done` means "landed on ITS mergeTarget").
//
// THE DEFECT: `flipTaskDone` commits `status: done` on the task branch, which is ff'd into
// `mergeTarget`. When mergeTarget is a `goal/<id>` branch, `develop` still says `ready` — and
// dispatch/promotion read the main checkout's `tasks/*.md` (which follows develop, CLAUDE.md
// hard-rule 11b). So once the worktree is reclaimed the task is re-dispatched forever. The fix:
// after the ff succeeds, write the SAME done flip to the doc face (main-checkout commit +
// propagateDocBranchToDevelop → develop). mergeTarget === "develop" is byte-for-byte unchanged.
//
// These tests drive the REAL `runMechanicalFanIn` end-to-end against temp git repos: the task
// statuses on `develop` and on the main checkout, and the code-commit ancestry, are all read back
// from git/the filesystem after a real run.
//
//   ① goal target — after the fan-in lands on `goal/GOAL-901`: `git show develop:tasks/<id>.md` AND
//      the main-checkout `tasks/<id>.md` are BOTH `status: done`, while the task's code commit is an
//      ancestor of `goal/GOAL-901` but NOT of `develop` (code stays isolated on the goal branch).
//   ② develop target — the SAME fixture shape with mergeTarget `develop`: the main checkout's task
//      file is STILL `ready` (no extra doc-face commit) and the trace carries no `doc-face-done-sync`
//      step; the code commit IS on develop (develop is the landing target).
//
// FALSIFIABILITY (AC2): revert the post-ff dual-write block with a `cp` backup (⛔ never
// `git checkout --`, which would wipe the fix) ⇒ ① goes red (develop stays `ready`) while ② stays
// green. See the task's ## Evidence for the real run outputs.
//
// Run:
//   node --test plugin/test/worker-fan-in.test.mjs
//   bash scripts/test.sh --for-task gap-goal-branch-done-means-landed-on-merge-target

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

// The module UNDER TEST — imported directly (the fan-in orchestration module, not a re-export hub).
import { runMechanicalFanIn } from "../scripts/worker-fan-in.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
// Shared with the worker-driver-fan-in family: the ff-merge TS module lives in packages/, the suite
// slot helper in plugin/scripts (the hermetic repo has neither, so both are pinned to this tree).
const FF_MERGE_MODULE = path.join(REPO, "packages", "quay", "src", "fan-in", "ff-merge.ts");
const SLOT_LIB = path.join(REPO, "plugin", "scripts", "suite-slot-lib.sh");

const TASK = "gap-doneface-fixture";
const GOAL_BRANCH = "goal/GOAL-901";
const CODE_FILE = "src/feature.js";

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function gitStatus(cwd, args) {
  try { git(cwd, args); return 0; } catch (e) { return e.status ?? 1; }
}
function write(cwd, rel, body) {
  const p = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body, "utf8");
}

/** The `status:` value from a task file's YAML frontmatter (first line-match). */
function statusOf(text) {
  const m = /^status:\s*(\S+)\s*$/m.exec(text);
  return m ? m[1] : null;
}

/** Task body: every AC checked (the flip's ac-completion gate must pass) and a Touches section
 *  covering the fixture's own files. */
function taskBody() {
  return [
    "---",
    `id: ${TASK}`,
    "title: done-face fixture",
    "status: ready",
    "labels: []",
    "extra: {}",
    "---",
    "## Proposal",
    "fixture",
    "## Plan",
    "fixture",
    "## Touches",
    `- ${CODE_FILE}`,
    `- tasks/${TASK}.md`,
    "## Acceptance Criteria",
    "- [x] AC1 fixture",
    "## Definition of Done",
    "- [x] landed",
    "",
  ].join("\n");
}

/**
 * Hermetic repo. `forkFrom` = the branch the task worktree is cut from ("develop" or
 * "goal/GOAL-901"). The MAIN checkout is put on `author` — a doc branch equal to develop at the base
 * commit, mirroring production (`author` tracks develop; develop itself stays an un-checked-out ref
 * so the doc→develop ff-push is a pure ref update).
 */
function makeFixture(tag, { forkFrom }) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `doneface-${tag}-`));
  const repo = path.join(base, "repo");
  const worktree = path.join(base, "wt");
  fs.mkdirSync(repo, { recursive: true });
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.name", "done-face-test"]);
  git(repo, ["config", "user.email", "done-face@example.com"]);
  git(repo, ["branch", "-M", "develop"]);
  // scripts/test.sh + an empty static-check registry: docs/ is doc-only, anything else is code.
  write(repo, "scripts/test.sh", "#!/usr/bin/env bash\nexit 0\n");
  write(repo, "plugin/scripts/runner-static-gate.ts", "// hermetic registry stub — empty registry\n");
  write(repo, `tasks/${TASK}.md`, taskBody());
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "base"]);
  git(repo, ["branch", GOAL_BRANCH]);
  // Main checkout → the doc branch (`author`). develop stays a ref, not a checked-out branch.
  git(repo, ["checkout", "-q", "-b", "author"]);

  // The task branch, cut from the requested line.
  git(repo, ["worktree", "add", "-q", worktree, "-b", `task/${TASK}`, forkFrom]);
  // The task's own committed work — a CODE file, so "code only on the goal branch" is a real
  // assertion (not a doc-only delta that the classifier would wave through).
  write(worktree, CODE_FILE, "export const feature = 1;\n");
  git(worktree, ["add", "-A"]);
  git(worktree, ["commit", "-q", "-m", "implement feature"]);

  const slotBase = path.join(base, "full-suite.lock");
  const capture = path.join(base, "suite.env");
  return { base, repo, worktree, slotBase, capture };
}

function fanInOpts(fx, runId, mergeTarget, overrides = {}) {
  return {
    task: TASK,
    worktree: fx.worktree,
    root: fx.repo,
    runId,
    mergeTarget,
    forceSuite: true,
    scriptsDir: path.join(REPO, "plugin", "scripts"),
    slotBase: fx.slotBase,
    slotLib: SLOT_LIB,
    silenceMs: 500,
    ffMergeModule: FF_MERGE_MODULE,
    suiteCapture: fx.capture,
    suiteLogFile: path.join(fx.base, "suite.log"),
    suiteCommand: ["bash", "-c", "echo suite-running; exit 0"],
    scopedGateCommand: ["true"],
    docCheckCommand: ["true"],
    ...overrides,
  };
}

/** The per-run fan-in trace lines (`.quay/fan-in-<task>-<runId>.log`), parsed. */
function traceSteps(repo, runId) {
  const f = path.join(repo, ".quay", `fan-in-${TASK}-${runId}.log`);
  return fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean)
    .map((l) => JSON.parse(l)).map((r) => r.step);
}

function cleanup(fx) {
  try { fs.rmSync(fx.base, { recursive: true, force: true }); } catch { /* best-effort */ }
}

test("① goal target — after landing on goal/GOAL-901, BOTH develop and the main checkout carry status: done; code stays on the goal branch", async (t) => {
  const fx = makeFixture("goal", { forkFrom: GOAL_BRANCH });
  t.after(() => cleanup(fx));
  const codeCommit = git(fx.worktree, ["rev-parse", "HEAD"]);

  const r = await runMechanicalFanIn(fanInOpts(fx, "doneface-goal", GOAL_BRANCH));
  assert.equal(r.outcome, "landed", `fan-in must land on the goal branch (step=${r.step} reason=${r.reason})`);

  // (a) develop carries the done flip (this is the whole point — otherwise re-dispatch).
  const onDevelop = git(fx.repo, ["show", `develop:tasks/${TASK}.md`]);
  assert.equal(statusOf(onDevelop), "done", "develop:tasks/<id>.md must be status: done (B2 dual-write)");

  // (b) the main checkout's own task file is done (dispatch/promotion read THIS file — hard-rule 11b).
  const onMain = fs.readFileSync(path.join(fx.repo, `tasks/${TASK}.md`), "utf8");
  assert.equal(statusOf(onMain), "done", "main-checkout tasks/<id>.md must be status: done");

  // (c) the goal branch carries done too (the primary landing).
  const onGoal = git(fx.repo, ["show", `${GOAL_BRANCH}:tasks/${TASK}.md`]);
  assert.equal(statusOf(onGoal), "done", "goal branch tasks/<id>.md must be status: done");

  // (d) code isolation: the task's code commit is on the goal branch, NOT on develop.
  assert.equal(
    gitStatus(fx.repo, ["merge-base", "--is-ancestor", codeCommit, GOAL_BRANCH]), 0,
    `code commit ${codeCommit} must be an ancestor of ${GOAL_BRANCH}`,
  );
  assert.equal(
    gitStatus(fx.repo, ["merge-base", "--is-ancestor", codeCommit, "develop"]), 1,
    `code commit ${codeCommit} must NOT be an ancestor of develop (code stays isolated on the goal branch)`,
  );
  // The develop line advanced by EXACTLY the doc-face commit(s) — the code file is absent from its
  // tree (a stronger check than ancestry: the file cannot be on develop via any commit).
  assert.equal(
    git(fx.repo, ["ls-tree", "-r", "--name-only", "develop", "--", CODE_FILE]), "",
    `develop must not contain the code file ${CODE_FILE}`,
  );

  // (e) the trace names the new step.
  const steps = traceSteps(fx.repo, "doneface-goal");
  assert.ok(steps.includes("doc-face-done-sync"), `trace must carry doc-face-done-sync; got ${steps.join(",")}`);
});

test("② develop target — unchanged path: no doc-face commit, the main checkout stays ready, code lands on develop", async (t) => {
  const fx = makeFixture("develop", { forkFrom: "develop" });
  t.after(() => cleanup(fx));
  const codeCommit = git(fx.worktree, ["rev-parse", "HEAD"]);

  const r = await runMechanicalFanIn(fanInOpts(fx, "doneface-develop", "develop"));
  assert.equal(r.outcome, "landed", `fan-in must land (step=${r.step} reason=${r.reason})`);

  // No extra doc-face write: the main checkout's task file is untouched (`ready`).
  const onMain = fs.readFileSync(path.join(fx.repo, `tasks/${TASK}.md`), "utf8");
  assert.equal(statusOf(onMain), "ready", "develop target must NOT write the doc face — main checkout stays ready");

  // The trace must NOT gain the new step on the develop path (AC1 element-wise invariance).
  const steps = traceSteps(fx.repo, "doneface-develop");
  assert.ok(!steps.includes("doc-face-done-sync"), `develop target must NOT run the doc-face step; got ${steps.join(",")}`);

  // develop IS the landing target: the code commit is on it.
  assert.equal(
    gitStatus(fx.repo, ["merge-base", "--is-ancestor", codeCommit, "develop"]), 0,
    `develop target: code commit ${codeCommit} must be an ancestor of develop`,
  );
  assert.equal(
    git(fx.repo, ["show", `develop:tasks/${TASK}.md`]).includes("status: done"), true,
    "develop target: the done flip is on develop via the task-branch ff",
  );
});

// ── ③ the fan-in's status writes leave v1 transition events (AC(d) of
//    tasks/gap-task-status-events-contract-v1-all-driver-writers) ────────────────────────────────
//
// Before that task the fan-in wrote ZERO events: 139 ready→done transitions in the reading window,
// 0 events — the largest measured coverage hole. What is pinned here is not "a field exists" but
// "the event's `evidence.commit` RESOLVES on the repo and names the commit whose diff flips that
// task's status", which is the form the task's AC(d) asks for.

/** The fan-in's transition events, read from the workspace carrier at `fx.repo/.quay/`. */
function readTransitionEvents(fx) {
  const file = path.join(fx.repo, ".quay", "task-status-events.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l));
}

test("③ develop target — ONE v1 event for the ready→done flip, whose evidence.commit resolves to the flipping commit", async (t) => {
  const fx = makeFixture("events-develop", { forkFrom: "develop" });
  t.after(() => cleanup(fx));

  const r = await runMechanicalFanIn(fanInOpts(fx, "fanin-events-develop", "develop"));
  assert.equal(r.outcome, "landed", `fan-in must land (step=${r.step} reason=${r.reason})`);

  const events = readTransitionEvents(fx);
  assert.equal(events.length, 1, `one status change on this path ⇒ exactly ONE event; got ${JSON.stringify(events)}`);
  const ev = events[0];
  assert.equal(ev.schema, "task-status-event/v1");
  assert.equal(ev.taskId, TASK);
  assert.equal(ev.from, "ready");
  assert.equal(ev.to, "done");
  assert.equal(ev.kind, "promote");
  assert.deepEqual(ev.actor, { kind: "fan-in", id: "worker-fan-in flipTaskDone" });
  assert.equal(ev.cause.runId, "fanin-events-develop", "the cause names the fan-in round that wrote it");

  // The evidence is CHECKABLE, not decorative: the sha exists on develop (the ff carried it there),
  // and the diff at that commit flips THIS task's status to done with exactly the blob the event names.
  assert.match(ev.evidence.commit, /^[0-9a-f]{40}$/);
  assert.equal(
    gitStatus(fx.repo, ["merge-base", "--is-ancestor", ev.evidence.commit, "develop"]), 0,
    `evidence.commit ${ev.evidence.commit} must be an ancestor of develop (the flip was ff'd there)`,
  );
  assert.match(git(fx.repo, ["show", `${ev.evidence.commit}:tasks/${TASK}.md`]), /^status:\s*done$/m, "the evidencing commit carries status: done");
  assert.equal(
    ev.evidence.statusBlobSha,
    git(fx.repo, ["rev-parse", `${ev.evidence.commit}:tasks/${TASK}.md`]),
    "statusBlobSha is the blob hash of the task file at that commit",
  );
});

test("③ reset shape — the 'done but not landed' rerun emits TWO events (done→ready, then ready→done)", async (t) => {
  const fx = makeFixture("events-reset", { forkFrom: "develop" });
  t.after(() => cleanup(fx));

  // Put the worktree into the intermediate state the rerun must converge: done on the task branch,
  // NOT landed on develop (gap-fan-in-flip-done-already-done-not-landed).
  const wtTask = path.join(fx.worktree, `tasks/${TASK}.md`);
  fs.writeFileSync(wtTask, fs.readFileSync(wtTask, "utf8").replace(/^status:\s*ready$/m, "status: done"), "utf8");
  git(fx.worktree, ["add", "-A"]);
  git(fx.worktree, ["commit", "-q", "-m", "flip done on the branch only"]);

  const r = await runMechanicalFanIn(fanInOpts(fx, "fanin-events-reset", "develop"));
  assert.equal(r.outcome, "landed", `fan-in must converge and land (step=${r.step} reason=${r.reason})`);

  const events = readTransitionEvents(fx);
  assert.deepEqual(
    events.map((e) => `${e.from}→${e.to}`),
    ["done→ready", "ready→done"],
    "the reset and the re-flip are TWO status changes ⇒ two events, in that order",
  );
  assert.equal(events[0].kind, "retreat", "done→ready is the retreat edge");
  assert.equal(events[1].kind, "promote");
  // Each event carries its OWN commit — the two commits are different.
  assert.notEqual(events[0].evidence.commit, events[1].evidence.commit);
  assert.equal(git(fx.repo, ["show", `${events[1].evidence.commit}:tasks/${TASK}.md`]).match(/^status:\s*(\S+)/m)[1], "done");
});

test("③ goal target — the doc-face done write emits its own event whose commit resolves to a done flip", async (t) => {
  const fx = makeFixture("events-goal", { forkFrom: GOAL_BRANCH });
  t.after(() => cleanup(fx));

  const r = await runMechanicalFanIn(fanInOpts(fx, "fanin-events-goal", GOAL_BRANCH));
  assert.equal(r.outcome, "landed", `fan-in must land (step=${r.step} reason=${r.reason})`);

  const events = readTransitionEvents(fx);
  const docFace = events.find((e) => e.actor.id === "worker-fan-in syncDoneToDocFace");
  assert.ok(docFace, `the doc-face write must emit its own event; got ${JSON.stringify(events.map((e) => e.actor.id))}`);
  assert.equal(docFace.from, "ready");
  assert.equal(docFace.to, "done");
  // The doc-face commit is propagated to develop (the state dual-write this fixture exists for), so
  // its sha resolves there and carries the done flip.
  assert.match(docFace.evidence.commit, /^[0-9a-f]{40}$/);
  assert.match(git(fx.repo, ["show", `${docFace.evidence.commit}:tasks/${TASK}.md`]), /^status:\s*done$/m);
  assert.equal(gitStatus(fx.repo, ["merge-base", "--is-ancestor", docFace.evidence.commit, "develop"]), 0);
});

// ── ADR-007 per-milestone predicate at the MECHANICAL flip ────────────────────────────────────────
//    (tasks/gap-mechanical-fan-in-flip-bypasses-adr007-dark-axis-predicate, AC1/AC2/AC3)
//
// Before this task `runMechanicalFanIn` flipped `status: done` with the ac-gate as its only
// completeness check: `grep -n -i 'darkaxis\|dark-axis' plugin/scripts/worker-fan-in.ts` returned
// zero hits while 795 of 816 `complete` events since 2026-09-14 came from this path. These tests pin
// the new step at the three states the predicate can reach, plus its negative/positive controls.

/** A fixture whose workspace DECLARES ADR-007 (`gates.adr`) — the same switch the lifecycle verbs
 *  read — and whose task body is `body`. The body lives in the WORKTREE (the tree the flip merges),
 *  so it is committed on the task branch; the config lives in the main checkout (the workspace root
 *  `workspaceEnforcesDarkAxis(root)` reads). */
function makeDarkAxisFixture(tag, { body }) {
  const fx = makeFixture(tag, { forkFrom: "develop" });
  write(fx.repo, ".quay/config.yml", 'providers:\n  native:\n    enabled: true\n    path: ./tasks\ngates:\n  adr:\n    - "ADR-007"\n');
  git(fx.repo, ["add", "-A"]);
  git(fx.repo, ["commit", "-q", "-m", "declare ADR-007 in gates.adr"]);
  write(fx.worktree, `tasks/${TASK}.md`, body);
  git(fx.worktree, ["add", "-A"]);
  // The base body (no dark-axis material) is byte-identical to the fixture's own — commit only a
  // real change rather than an empty commit.
  if (git(fx.worktree, ["status", "--porcelain"]).trim() !== "") {
    git(fx.worktree, ["commit", "-q", "-m", "task body under test"]);
  }
  return fx;
}

/** The base body (all AC/DoD boxes checked) with dark-axis material spliced in ahead of `## Touches`. */
function taskBodyWithDarkAxis({ record = null, disclaimer = null } = {}) {
  const lines = taskBody().split("\n");
  const extra = [];
  if (record) extra.push("## Dark-axis reading", record, "");
  if (disclaimer) extra.push(disclaimer, "");
  lines.splice(lines.indexOf("## Touches"), 0, ...extra);
  return lines.join("\n");
}

function readGateEvents(fx) {
  const file = path.join(fx.repo, ".quay", "gate-events.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
}

test("AC1 (能取假) — every AC/DoD box checked but NO L_D/L_G record: the flip is REFUSED at the dark-axis step, status stays ready, a fail event lands", async (t) => {
  const fx = makeDarkAxisFixture("darkaxis-missing", { body: taskBodyWithDarkAxis() });
  t.after(() => cleanup(fx));

  const r = await runMechanicalFanIn(fanInOpts(fx, "darkaxis-missing", "develop"));

  // The failure is the NEW step, and it names the missing artifact.
  assert.equal(r.outcome, "red", `a record-less task must NOT land; got outcome=${r.outcome} step=${r.step}`);
  assert.equal(r.step, "dark-axis");
  assert.match(r.reason, /MISSING/);
  assert.match(r.reason, /L_D\/L_G/);

  // mergeTarget is untouched (the flip never ran), and so is the worktree's own task file.
  assert.match(git(fx.repo, ["show", `develop:tasks/${TASK}.md`]), /^status:\s*ready$/m, "develop must still say ready");
  assert.equal(statusOf(fs.readFileSync(path.join(fx.worktree, `tasks/${TASK}.md`), "utf8")), "ready");

  // The judgment left a ledger entry — the readout AC6 joins on.
  const darkEvents = readGateEvents(fx).filter((e) => e.gate === "dark-axis");
  assert.equal(darkEvents.length, 1, `exactly one dark-axis event; got ${JSON.stringify(readGateEvents(fx))}`);
  assert.equal(darkEvents[0].item_id, TASK);
  assert.equal(darkEvents[0].verdict, "fail");
  assert.equal(darkEvents[0].actor, "quay-driver");
  assert.equal(darkEvents[0].payload.state, "MISSING");
  // ⛔ No `complete` event: a refused flip is not a landing.
  assert.equal(readGateEvents(fx).filter((e) => e.gate === "complete").length, 0);

  // The step is visible in the per-run trace.
  assert.ok(traceSteps(fx.repo, "darkaxis-missing").includes("dark-axis"));
});

test("AC2 (能取假) — a RECORDED reading lets the flip through and writes a pass event", async (t) => {
  const fx = makeDarkAxisFixture("darkaxis-recorded", {
    body: taskBodyWithDarkAxis({ record: "- L_G archguard: cycles=0, god-modules=0" }),
  });
  t.after(() => cleanup(fx));

  const r = await runMechanicalFanIn(fanInOpts(fx, "darkaxis-recorded", "develop"));
  assert.equal(r.outcome, "landed", `a recorded reading must land (step=${r.step} reason=${r.reason})`);
  assert.match(git(fx.repo, ["show", `develop:tasks/${TASK}.md`]), /^status:\s*done$/m);

  const darkEvents = readGateEvents(fx).filter((e) => e.gate === "dark-axis");
  assert.equal(darkEvents.length, 1);
  assert.equal(darkEvents[0].verdict, "pass");
  assert.equal(darkEvents[0].payload.state, "RECORDED");
});

test("AC2 (能取假) — an explicit 该轴仍暗,理由: declaration also lands, with a pass event whose state is DISCLAIMED", async (t) => {
  const fx = makeDarkAxisFixture("darkaxis-disclaimed", {
    body: taskBodyWithDarkAxis({ disclaimer: "- L_G：该轴仍暗,理由:the git-lens probes are archived; this fixture consults no structural instrument" }),
  });
  t.after(() => cleanup(fx));

  const r = await runMechanicalFanIn(fanInOpts(fx, "darkaxis-disclaimed", "develop"));
  assert.equal(r.outcome, "landed", `a reasoned declaration must land (step=${r.step} reason=${r.reason})`);

  const darkEvents = readGateEvents(fx).filter((e) => e.gate === "dark-axis");
  assert.equal(darkEvents.length, 1);
  assert.equal(darkEvents[0].verdict, "pass");
  assert.equal(darkEvents[0].payload.state, "DISCLAIMED");
});

test("AC2 (硬规则 3b) — an UNREADABLE body is NOT-EVALUATED, with its own reason and its own ledger verdict (never folded into MISSING)", async (t) => {
  // Two fixtures differing ONLY in readability: (a) a readable body with no record, (b) an
  // unreadable one. The refusal must be distinguishable — same step, DIFFERENT state/verdict/reason.
  const missingFx = makeDarkAxisFixture("darkaxis-ne-missing", { body: taskBodyWithDarkAxis() });
  t.after(() => cleanup(missingFx));
  const missingRun = await runMechanicalFanIn(fanInOpts(missingFx, "darkaxis-ne-missing", "develop"));

  const unreadableFx = makeDarkAxisFixture("darkaxis-ne", { body: taskBodyWithDarkAxis() });
  t.after(() => cleanup(unreadableFx));
  // The production reader is `<worktree>/tasks/<id>.md`; the seam points at a file that cannot be
  // read, which is the ONLY way to reach this state while ac-gate (same file) still passes.
  const unreadableRun = await runMechanicalFanIn(
    fanInOpts(unreadableFx, "darkaxis-ne", "develop", { darkAxisTaskFile: path.join(unreadableFx.base, "absent-task.md") }),
  );

  assert.equal(unreadableRun.outcome, "red");
  assert.equal(unreadableRun.step, "dark-axis");
  assert.match(unreadableRun.reason, /NOT-EVALUATED/);
  assert.doesNotMatch(unreadableRun.reason, /MISSING —/);
  assert.notEqual(unreadableRun.reason, missingRun.reason, "the two states must not share a reason (硬规则 3b)");

  const neEvent = readGateEvents(unreadableFx).filter((e) => e.gate === "dark-axis");
  assert.equal(neEvent.length, 1);
  assert.equal(neEvent[0].payload.state, "NOT-EVALUATED");
  assert.equal(neEvent[0].verdict, "not-evaluated", "the ledger keeps 'could not read' distinct from 'recorded nothing'");

  const missingEvent = readGateEvents(missingFx).filter((e) => e.gate === "dark-axis");
  assert.equal(missingEvent.length, 1);
  assert.equal(missingEvent[0].verdict, "fail");
});

test("AC3 (能取假) — the flip's judgment and the standalone CLI agree state-for-state / exit-code-for-exit-code", async () => {
  // The mechanical step must NOT carry a second rule. Drive the exported judgment and the CLI over
  // the same four fixtures: RECORDED / DISCLAIMED / MISSING / absent file.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "darkaxis-parity-"));
  try {
    fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
    const files = {
      "fixture-recorded": `---\nid: fixture-recorded\nstatus: ready\n---\n- L_G archguard: cycles=0\n`,
      "fixture-disclaimed": `---\nid: fixture-disclaimed\nstatus: ready\n---\n- L_G：该轴仍暗,理由:probes archived\n`,
      "fixture-missing": `---\nid: fixture-missing\nstatus: ready\n---\n## Plan\nnothing recorded here\n`,
    };
    for (const [id, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, "tasks", `${id}.md`), text, "utf8");
    const cases = [
      ["fixture-recorded", "RECORDED", 0],
      ["fixture-disclaimed", "DISCLAIMED", 0],
      ["fixture-missing", "MISSING", 1],
      ["fixture-absent", "NOT-EVALUATED", 2],
    ];
    const { darkAxisVerdictForTaskFile } = await import("../scripts/worker-fan-in.ts");
    for (const [id, state, exit] of cases) {
      const mine = darkAxisVerdictForTaskFile(path.join(dir, "tasks", `${id}.md`));
      assert.equal(mine.state, state, `${id}: the flip's judgment must be ${state}`);
      const cli = spawnSync(process.execPath, [
        "--no-warnings", "--experimental-strip-types",
        path.join(REPO, "plugin", "scripts", "dark-axis-record-check.ts"), id, "--root", dir,
      ], { encoding: "utf8" });
      assert.equal(cli.status, exit, `${id}: CLI exit ${cli.status} must be ${exit} (stderr=${cli.stderr})`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
