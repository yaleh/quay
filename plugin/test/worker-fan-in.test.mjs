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
import { execFileSync } from "node:child_process";

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
