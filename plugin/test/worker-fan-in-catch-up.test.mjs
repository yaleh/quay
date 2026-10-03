// @test-group serial
// worker-fan-in-catch-up.test.mjs — gap-goal-branch-catch-up-develop-at-landing
// (the AC-322 carrier: "goal 分支落地的追平").
//
// WHAT IS UNDER TEST: plugin/scripts/worker-fan-in.ts step 2b. SPEC-goal-branch-2026-10-03 §4.4
// ruling ③: a task fanning in to a `goal/<id>` branch has its worktree merge the goal branch AND
// THEN merge `develop` (the per-landing catch-up), so the tree that the task's own full suite
// verified is the exact tree ff'd onto the goal branch — no unverified intermediate tree.
//
// These tests drive the REAL `runMechanicalFanIn` end-to-end against real temp git repos (not
// fixture-only pure functions): the merge commits, the landing ref, and the per-step trace are
// all read back from git/the filesystem after a real run.
//
//   ① goal target — task branch cut from `goal/GOAL-901`, the goal branch has since advanced, and
//      `develop` advanced after the fork ⇒ the landing on `goal/GOAL-901` (a) has the pre-fan-in
//      `develop` tip as an ANCESTOR (`git merge-base --is-ancestor <devTip> <landing>`) and
//      (b) carries a merge commit whose SECOND parent IS `<devTip>` (the catch-up merge). A second
//      merge commit whose second parent is the advanced goal tip proves the mergeTarget merge is
//      still performed — two merges, as SPEC §4.4 prescribes.
//   ② degenerate — `develop` is already an ancestor of the task branch (it never advanced past the
//      fork point) ⇒ `git merge develop` is "Already up to date", NO catch-up merge commit is
//      created, and the ancestor property still holds (the predicate degrades to "earliest commit
//      of this landing" — both paths make the then-current develop tip an ancestor of the landing).
//   ③ develop target (AC1 element-wise equivalence) — the SAME fixture shape with
//      `--merge-target develop`: the trace carries `merge-develop` and NOT `catch-up-develop`, and
//      exactly ONE merge commit is created in the landing range (the develop merge). The goal target
//      in ① creates two. This is the falsifiable statement that the develop path is unchanged.
//
// FALSIFIABILITY (AC3): revert the step-2b block with a `cp` backup (⛔ never `git checkout --`,
// which would wipe the fix) ⇒ ① goes red (no catch-up merge commit; devTip is not an ancestor of
// the landing) while ③ stays green. See the task's ## Evidence for the real run outputs.
//
// Run:
//   node --test plugin/test/worker-fan-in-catch-up.test.mjs
//   bash scripts/test.sh --for-task gap-goal-branch-catch-up-develop-at-landing

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

const TASK = "gap-catchup-fixture";

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

/** Task body: every AC checked (the flip's ac-completion gate must pass) and a Touches section
 *  covering the fixture's own files. */
function taskBody() {
  return [
    "---",
    `id: ${TASK}`,
    "title: catch-up fixture",
    "status: ready",
    "labels: []",
    "extra: {}",
    "---",
    "## Proposal",
    "fixture",
    "## Plan",
    "fixture",
    "## Touches",
    "- docs/feature.md",
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
 * "goal/GOAL-901"). When `goalAdvanced` the goal branch gains a commit AFTER the task forked
 * (a previous sibling task landing on the goal branch), so the mergeTarget merge is a real merge
 * rather than "Already up to date".
 */
function makeFixture(tag, { forkFrom, goalAdvanced = false }) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `catchup-${tag}-`));
  const repo = path.join(base, "repo");
  const worktree = path.join(base, "wt");
  fs.mkdirSync(repo, { recursive: true });
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.name", "catchup-test"]);
  git(repo, ["config", "user.email", "catchup@example.com"]);
  git(repo, ["branch", "-M", "develop"]);
  // scripts/test.sh — the suite entry the classify registry reads; an empty registry makes
  // docs/ doc-only (the fixture delta is doc-only) while anything else fail-closes to code.
  write(repo, "scripts/test.sh", "#!/usr/bin/env bash\nexit 0\n");
  write(repo, "plugin/scripts/runner-static-gate.ts", "// hermetic registry stub — empty registry\n");
  write(repo, `tasks/${TASK}.md`, taskBody());
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "base"]);
  git(repo, ["branch", "goal/GOAL-901"]);

  // The task branch, cut from the requested line.
  git(repo, ["worktree", "add", "-q", worktree, "-b", `task/${TASK}`, forkFrom]);
  // The task's own committed work (doc-only ⇒ the suite-selection delta stays inert).
  write(worktree, "docs/feature.md", "# feature\n");
  git(worktree, ["add", "-A"]);
  git(worktree, ["commit", "-q", "-m", "implement feature"]);

  // develop leaves the main checkout (so the ff is a pure ref update, ⛔ not a checked-out branch).
  git(repo, ["checkout", "-q", "-b", "develop-work"]);

  if (goalAdvanced) {
    // A sibling task landed on the goal branch after this task forked.
    const gw = path.join(base, "goal-wt");
    git(repo, ["worktree", "add", "-q", gw, "goal/GOAL-901"]);
    write(gw, "docs/goal-advance.md", "# goal advance\n");
    git(gw, ["add", "-A"]);
    git(gw, ["commit", "-q", "-m", "sibling landing on the goal branch"]);
    git(repo, ["worktree", "remove", "--force", gw]);
  }

  const slotBase = path.join(base, "full-suite.lock");
  const capture = path.join(base, "suite.env");
  return { base, repo, worktree, slotBase, capture };
}

/** `develop` advances with a doc commit (the drift the catch-up exists to absorb). Returns its tip. */
function advanceDevelop(fx, name) {
  git(fx.repo, ["checkout", "-q", "develop"]);
  write(fx.repo, `docs/${name}.md`, `# ${name}\n`);
  git(fx.repo, ["add", "-A"]);
  git(fx.repo, ["commit", "-q", "-m", `develop advance (${name})`]);
  const tip = git(fx.repo, ["rev-parse", "develop"]);
  git(fx.repo, ["checkout", "-q", "develop-work"]);
  return tip;
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

/** Merge commits reachable from `tip` but from NEITHER of `notRefs`, as [[commit, p1, p2], …]. */
function mergesIn(repo, tip, ...notRefs) {
  const out = git(repo, ["rev-list", "--merges", "--parents", tip, "--not", ...notRefs]);
  return out.split("\n").filter(Boolean).map((l) => l.split(/\s+/));
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

test("① goal target — the landing on goal/GOAL-901 carries a catch-up merge whose 2nd parent is the pre-fan-in develop tip, and devTip is an ancestor of the landing", async (t) => {
  const fx = makeFixture("goal", { forkFrom: "goal/GOAL-901", goalAdvanced: true });
  t.after(() => cleanup(fx));
  const goalTipBefore = git(fx.repo, ["rev-parse", "goal/GOAL-901"]);
  const devTip = advanceDevelop(fx, "adv-goal");

  const r = await runMechanicalFanIn(fanInOpts(fx, "catchup-goal", "goal/GOAL-901"));
  assert.equal(r.outcome, "landed", `fan-in must land on the goal branch (step=${r.step} reason=${r.reason})`);

  const landing = git(fx.repo, ["rev-parse", "goal/GOAL-901"]);
  assert.equal(landing, r.landedSha, "landedSha must be the goal branch tip");

  // (a) AC-322's core predicate: the then-current develop tip is an ancestor of the landing.
  assert.equal(
    gitStatus(fx.repo, ["merge-base", "--is-ancestor", devTip, landing]), 0,
    `landing ${landing} must have develop tip ${devTip} as an ancestor`,
  );

  // (b) a merge commit whose second parent IS devTip (the catch-up merge — the timestamp AC-322
  //     reads as "the catch-up moment"). Plus the goal-branch merge, which the fixture forces by
  //     advancing goal/GOAL-901 after the fork.
  const merges = mergesIn(fx.repo, landing, goalTipBefore);
  const catchUp = merges.filter((m) => m[2] === devTip);
  assert.equal(catchUp.length, 1, `exactly one catch-up merge commit parented by develop tip ${devTip}; got ${JSON.stringify(merges)}`);
  const goalMerge = merges.filter((m) => m[2] === goalTipBefore);
  assert.equal(goalMerge.length, 1, `the mergeTarget merge must still happen (2nd parent = advanced goal tip ${goalTipBefore}); got ${JSON.stringify(merges)}`);
  assert.equal(merges.length, 2, `two merges for a goal target (mergeTarget + catch-up); got ${JSON.stringify(merges)}`);

  // The catch-up merge happens AFTER the mergeTarget merge in history (SPEC §4.4 order: 1 then 2).
  assert.equal(
    gitStatus(fx.repo, ["merge-base", "--is-ancestor", goalMerge[0][0], catchUp[0][0]]), 0,
    "the catch-up merge must be a descendant of the mergeTarget merge (mergeTarget first, then develop)",
  );

  // The trace names both steps, in order.
  const steps = traceSteps(fx.repo, "catchup-goal");
  assert.ok(steps.includes("merge-develop"), `trace must carry merge-develop; got ${steps.join(",")}`);
  assert.ok(steps.includes("catch-up-develop"), `trace must carry catch-up-develop; got ${steps.join(",")}`);
  assert.ok(steps.indexOf("merge-develop") < steps.indexOf("catch-up-develop"), "mergeTarget must be merged before the develop catch-up");
});

test("② degenerate — develop is already an ancestor: no catch-up merge commit is created, the ancestor property still holds", async (t) => {
  const fx = makeFixture("degen", { forkFrom: "goal/GOAL-901" });
  t.after(() => cleanup(fx));
  const goalTipBefore = git(fx.repo, ["rev-parse", "goal/GOAL-901"]);
  const devTip = git(fx.repo, ["rev-parse", "develop"]); // NOT advanced — already an ancestor

  const r = await runMechanicalFanIn(fanInOpts(fx, "catchup-degen", "goal/GOAL-901"));
  assert.equal(r.outcome, "landed", `fan-in must land (step=${r.step} reason=${r.reason})`);

  const landing = git(fx.repo, ["rev-parse", "goal/GOAL-901"]);
  // Same predicate as ①, reached through the OTHER branch of the mechanism (git says "Already up to
  // date" ⇒ no merge commit ⇒ the AC-322 predicate degrades to the landing's earliest commit).
  assert.equal(
    gitStatus(fx.repo, ["merge-base", "--is-ancestor", devTip, landing]), 0,
    `degenerate: develop tip ${devTip} must still be an ancestor of the landing ${landing}`,
  );
  // And the falsifiable half: with nothing to catch up, no develop-parented merge commit appears.
  const merges = mergesIn(fx.repo, landing, goalTipBefore);
  assert.equal(
    merges.filter((m) => m[2] === devTip).length, 0,
    `degenerate: no catch-up merge commit may be created; got ${JSON.stringify(merges)}`,
  );
});

test("③ develop target — element-wise equivalent to the pre-change path: merge-develop only, exactly one merge, no catch-up-develop step", async (t) => {
  const fx = makeFixture("develop", { forkFrom: "develop" });
  t.after(() => cleanup(fx));
  const devTipBefore = git(fx.repo, ["rev-parse", "develop"]);
  const developTip = advanceDevelop(fx, "adv-develop");

  const r = await runMechanicalFanIn(fanInOpts(fx, "catchup-develop", "develop"));
  assert.equal(r.outcome, "landed", `fan-in must land (step=${r.step} reason=${r.reason})`);

  const landing = git(fx.repo, ["rev-parse", "develop"]);
  assert.equal(
    gitStatus(fx.repo, ["merge-base", "--is-ancestor", developTip, landing]), 0,
    "develop path: the develop tip must be an ancestor of the landing",
  );

  // The trace of the develop path must NOT gain the new step (AC1).
  const steps = traceSteps(fx.repo, "catchup-develop");
  assert.ok(steps.includes("merge-develop"), `trace must carry merge-develop; got ${steps.join(",")}`);
  assert.ok(!steps.includes("catch-up-develop"), `develop target must NOT run the catch-up step; got ${steps.join(",")}`);

  // Exactly ONE merge commit in the landing range (the develop merge) — the goal target in ①
  // produced two. This is what "逐元素等价" means on the changed surface.
  const merges = mergesIn(fx.repo, landing, devTipBefore);
  assert.equal(merges.length, 1, `develop target ⇒ exactly one merge commit; got ${JSON.stringify(merges)}`);
  assert.equal(merges[0][2], developTip, "the single merge's second parent is the develop tip");
});
