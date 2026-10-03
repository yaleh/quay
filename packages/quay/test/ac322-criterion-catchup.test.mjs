// @test-group product
//
// ac322-criterion-catchup.test.mjs — the fixture binding the CRITERION of `goals/AC-322-*.md`
// (gap-ac322-goal-branch-catchup-landing-real-reading AC4).
//
// WHAT THIS FILE IS FOR. AC-322's criterion is the exit-0 reading GOAL-028's exit condition ①
// depends on: 「每次 goal 分支落地都包含其追平时刻的 develop」. The mechanism that produces that
// state landed in `gap-goal-branch-catch-up-develop-at-landing` (worker-fan-in.ts step 2b: merge the
// goal branch, then merge develop) with unit coverage — but until this task NOTHING ran the criterion
// TEXT itself: before this task the only reading ever taken off the real repo was `exit 3`
// ("no goal record carries branch: true yet"), and after the AC-326 drill a different `exit 3`
// ("no goal-branch landing could be checked"). A criterion nobody runs is a criterion that rots
// silently (hard rule 4 corollary three: implemented, unit-green, never exercised in production).
// This file closes that.
//
// THE UNIT UNDER TEST IS THE SHIPPED CRITERION, NOT A COPY OF IT. `criterionText()` reads
// `goals/AC-322-*.md` at RUN TIME, parses the frontmatter, and hands the store's own `criterion`
// string to `/bin/sh` — the same text `quay goal gate AC-322` runs. A reimplementation here would be
// an echo of the criterion (hard rule 4 corollary three): it would stay green while the criterion
// rotted, which is exactly the failure this task exists to prevent.
//
// THREE STATES PLUS THE VIOLATION, EACH ITS OWN READING. The criterion's word-list is exit 0 (a
// branch-mode goal had ≥1 landing that contained the develop tip current at its catch-up point),
// exit 1 (a landing missed that tip: CAUSE=landing-missed-develop-catch-up), exit 3 (nothing to
// judge yet — no branch-mode goal, or no landable landing). A judge that never returns 3 cannot tell
// "checked and clean" from "never checked" (hard rule 3b) — so the not-evaluated arm is pinned
// alongside the pass and the violation arms.
//
// THE TWO LANDING ARMS DIFFER ONLY IN WHICH DEVELOP TIP THE CATCH-UP MERGE PULLED IN — that is the
// whole point. Case `catch-up` merges the CURRENT develop tip (the landing really caught up) ⇒
// exit 0. Case `stale` merges an OLDER develop tip while the develop reflog already records a newer
// one as current at that moment (the realistic failure: you merged a stale `develop` ref) ⇒ exit 1.
// Both landings live on a `goal/GOAL-001` branch (so `flip_of` finds the flip commit) and both are
// otherwise built identically; only the merged tip differs. That is the discriminating reading.
//
// STRENGTH EVIDENCE (AC4). The last test is the mutation control the AC calls for: with a `cp`
// backup (⛔ never `git checkout --`, which would wipe an uncommitted fix), the `branch: true` line
// the criterion覆盖 is stripped, at least one assertion must flip red, and restoring the backup must
// flip it green again.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Repo root of THIS checkout (a task worktree during dispatch). */
const REPO = path.resolve(HERE, "..", "..", "..");

// Every mkdtemp is carried so a single teardown removes the whole tree (R6 mkdtemp-no-cleanup).
const TMP_DIRS = [];
after(() => {
  for (const d of TMP_DIRS) fs.rmSync(d, { recursive: true, force: true });
});

/** The one goal file this fixture is pinned to. Resolved by id prefix, so a rename that keeps the id
 *  still resolves; a missing file fails loudly rather than skipping (a skip would make every
 *  assertion below vacuous). */
function goalFilePath() {
  const dir = path.join(REPO, "goals");
  const name = fs.readdirSync(dir).find((n) => n.startsWith("AC-322-") && n.endsWith(".md"));
  assert.ok(name, `no goals/AC-322-*.md under ${dir}`);
  return path.join(dir, name);
}

/** The criterion text AS STORED (frontmatter folded scalar parsed back to a string) — the same text
 *  `quay goal gate AC-322` runs. */
function criterionText() {
  const raw = fs.readFileSync(goalFilePath(), "utf8");
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw);
  assert.ok(fm, "goal file has no YAML frontmatter");
  const doc = YAML.parse(fm[1]);
  assert.equal(typeof doc.criterion, "string", "goal record has no criterion string");
  return doc.criterion;
}

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}
function commitAll(cwd, msg) {
  git(cwd, ["add", "-A"]);
  git(cwd, ["commit", "-q", "-m", msg]);
}

/** Cross a wall-clock second boundary.
 *
 *  The criterion reads develop through `git reflog show --date=unix` and picks the tip with the
 *  newest entry at-or-before a moment (`dev_at`). Reflog entry times are WALL CLOCK at ref-update
 *  time — they do not follow GIT_COMMITTER_DATE — so a fixture that builds its whole history inside
 *  one second makes every entry tie, and `dev_at` then returns the LAST tip for every moment (which
 *  collapses `base..c` to nothing). Production is minutes wide; the fixture has to be too. */
function settle() {
  spawnSync("sleep", ["1.1"]);
}

/** A fresh temp root that IS a git root (`git rev-parse --show-toplevel` == itself), with a
 *  `develop` branch — the line the criterion reads through `develop`'s reflog. */
function mkRoot(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `quay-ac322-${tag}-`));
  TMP_DIRS.push(dir);
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.name", "ac322-fixture"]);
  git(dir, ["config", "user.email", "ac322@example.com"]);
  fs.mkdirSync(path.join(dir, "goals"), { recursive: true });
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(dir, "seed.txt"), "seed\n");
  commitAll(dir, "seed");
  // The fixture writes everything onto `develop` (the line the criterion reads through its reflog),
  // so HEAD must sit on it — not on `main`.
  git(dir, ["checkout", "-q", "-b", "develop"]);
  return dir;
}

/** Run the shipped criterion in `root` under `/bin/sh` — the shell the acceptance runner uses. */
function runCriterion(root) {
  const r = spawnSync("/bin/sh", ["-c", criterionText()], { cwd: root, encoding: "utf8" });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** Write a GOAL record (frontmatter shape the criterion reads: a literal `branch: true` line inside
 *  the frontmatter block). Hand-authored: the criterion's INPUT is the record's frontmatter, and the
 *  store's own branch lifecycle is covered by branch-model.test.mjs — what this file pins is the
 *  criterion TEXT's verdict. */
function writeGoal(root, id, { status, branch = false }) {
  const fm = [
    "---",
    `id: ${id}`,
    `title: fixture ${id}`,
    `status: ${status}`,
    "kind: goal",
    "origin: ac322-criterion fixture",
    // Since the 2026-10-03 rewrite, `live_goals()` requires `activatedAt:` (the ancestor-based version
    // uses it as the time floor of `act_epoch`). A branch-mode goal without it is invisible to the
    // criterion, so the fixture must carry it or every arm reads the same "nothing to judge" exit 3.
    `activatedAt: ${new Date().toISOString()}`,
    ...(branch ? ["branch: true"] : []),
    "---",
    "",
    `fixture goal for ${id} — not a real goal; exists only to exercise the AC-322 criterion text.`,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(root, "goals", `${id}-fixture.md`), fm);
  commitAll(root, `fixture ${id}`);
}

/** Write an AC record whose `goal:` line the criterion's `goal_acs` grep matches. */
function writeAc(root, id, goalId) {
  const fm = [
    "---",
    `id: ${id}`,
    `status: active`,
    "kind: criterion",
    `goal: ${goalId}`,
    `criterion: "echo ok; exit 0"`,
    "---",
    "",
    `fixture criterion for ${id}.`,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(root, "goals", `${id}-fixture.md`), fm);
  commitAll(root, `fixture ${id}`);
}

/** Write a task file whose `goal_ac:` line the criterion's `ac_tasks` grep matches, status `ready`
 *  (so a landing can flip it done with the mechanical fan-in's exact commit subject). */
function writeTask(root, id, acId) {
  const fm = [
    "---",
    `id: ${id}`,
    `title: fixture ${id}`,
    "status: ready",
    `goal_ac: ${acId}`,
    "---",
    "",
    `fixture task for ${id}.`,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(root, "tasks", `${id}.md`), fm);
  commitAll(root, `fixture ${id}`);
}

/** Flip the task file's status to done and commit with the EXACT subject the criterion greps for
 *  (`翻 <task> done（driver 机械 fan-in）` — the mechanical fan-in's flip-done subject). */
function flipTaskDone(root, id) {
  const f = path.join(root, "tasks", `${id}.md`);
  fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/^status: ready$/m, "status: done"));
  commitAll(root, `tasks: 翻 ${id} done（driver 机械 fan-in）`);
}

/**
 * Build a goal-branch landing on top of the fixture carrier (GOAL-001 / AC-001 / TT-001 already
 * committed on develop).
 *
 * `stale: false` (the pass arm) — the catch-up merge pulls in the CURRENT develop tip, so the
 * landing really contains the develop of its catch-up moment.
 *
 * `stale: true` (the violation arm) — an OLDER develop tip is merged while the develop reflog
 * already records a NEWER tip as current at that moment. This is the realistic failure shape the
 * criterion targets (catching up to a stale develop ref): the branch is forked BEFORE develop moves
 * on, and the landing merges the tip that was current when the branch started rather than the one
 * current when it landed.
 *
 * Returns the landing commit SHA (the flip-done commit `c`).
 */
function buildLanding(root, { task = "TT-001", goal = "GOAL-001", stale = false } = {}) {
  const base = git(root, ["rev-parse", "develop"]);
  git(root, ["branch", `goal/${goal}`, "develop"]); // lazy fork from the develop tip (base)

  // The develop tip that will be current at the landing's catch-up moment.
  settle(); // keep advance-1's reflog entry strictly AFTER the `branch: true` commit's moment
  fs.writeFileSync(path.join(root, "advance-1.txt"), "advance 1\n");
  commitAll(root, "develop: advance 1");
  const staleTip = git(root, ["rev-parse", "develop"]);

  if (stale) {
    // develop moves on again: `staleTip` is now an OLD tip. The develop reflog will record the new
    // tip as current from here on, so a catch-up that merges `staleTip` is a missed catch-up.
    fs.writeFileSync(path.join(root, "advance-2.txt"), "advance 2\n");
    commitAll(root, "develop: advance 2");
  }
  assert.notEqual(staleTip, base, "premise: develop advanced after the goal branch forked");

  git(root, ["checkout", "-q", "-b", "landing", `goal/${goal}`]);
  // The landing branch must carry its own work before catching up — exactly like a real task branch
  // (the task's commits). Without it `merge develop` would fast-forward and leave NO merge commit,
  // and a fast-forward is precisely the shape that carries no catch-up evidence.
  fs.writeFileSync(path.join(root, "task-work.txt"), "task work\n");
  commitAll(root, `tasks: ${task} work`);
  git(root, ["merge", "-q", "--no-edit", `goal/${goal}`]); // fan-in step 2: merge the goal branch
  const merged = stale ? staleTip : git(root, ["rev-parse", "develop"]);
  settle(); // the catch-up merge must be STRICTLY LATER than the develop tips it could pull in
  git(root, ["merge", "-q", "--no-edit", merged]); // the catch-up merge (step 2b)
  flipTaskDone(root, task); // the flip-done commit `c`
  const c = git(root, ["rev-parse", "HEAD"]);
  git(root, ["checkout", "-q", `goal/${goal}`]);
  git(root, ["merge", "-q", "--ff-only", "landing"]); // ff the goal branch to the landing
  if (!stale) {
    // Cross a wall-clock second before develop advances: the criterion reads the develop tip through
    // `git reflog show --date=unix` (SECOND resolution) at the catch-up merge's commit time. If this
    // merge lands in the SAME second as that merge, `dev_at` sees it and reports develop's post-landing
    // tip instead of the tip current AT the catch-up — a fixture artifact, not a real missed catch-up.
    settle();
    // Production 收尾 (SPEC-goal-branch §4.7 裁定⑲): develop receives the goal branch through ONE
    // `--no-ff` merge commit whose subject names `goal/<id>` — that is the commit the criterion's
    // `goal_merges()` reads to classify this landing as `via`. ⛔ A plain `--ff-only` would leave NO
    // merge commit, so `classify()` would read `direct` and the landing would not be counted at all.
    git(root, ["checkout", "-q", "develop"]);
    git(root, ["merge", "-q", "--no-ff", "--no-edit", `goal/${goal}`]);
    git(root, ["branch", "-D", `goal/${goal}`]);
  }
  // Back to `develop` (⛔ not `main`, which does not carry the goal/AC/task records and would wipe
  // them out of the working tree the criterion reads).
  git(root, ["checkout", "-q", "develop"]);
  return c;
}

/** Seed a root whose develop already carries the branch-mode goal + AC + task. */
function seedCarrier(tag) {
  const root = mkRoot(tag);
  writeGoal(root, "GOAL-001", { status: "active", branch: true });
  writeAc(root, "AC-001", "GOAL-001");
  writeTask(root, "TT-001", "AC-001");
  return root;
}

// ── the extraction itself: the criterion is read, not copied ────────────────────────────────────────

test("criterion is extracted VERBATIM from goals/AC-322-*.md (not a copy that can drift)", () => {
  const text = criterionText();
  for (const needle of [
    "CAUSE=landing-missed-develop-catch-up",
    // The 2026-10-03 rewrite deleted the old `no goal record carries branch: true yet` message and added
    // `activatedAt:` as a live_goals() precondition — pin the NEW shape, not the retired one.
    "^activatedAt: ",
    "NOT-EVALUATED: no goal-branch landing could be checked against the develop reflog",
    "PASS: $checked goal-branch landing(s) each contained develop as of their",
  ]) {
    assert.ok(text.includes(needle), `the extracted criterion does not contain ${needle}`);
  }
  // Positive control (hard rule 2, second half): the predicate above is not vacuously true.
  const empty = "";
  assert.equal(empty.includes("CAUSE=landing-missed-develop-catch-up"), false);
});

// ── exit 3: the not-evaluated arm ───────────────────────────────────────────────────────────────────

test("no branch-mode goal ⇒ exit 3 (nothing to judge — same not-evaluated reading as an unlanded branch-mode goal)", () => {
  const root = mkRoot("no-branch-mode");
  writeGoal(root, "GOAL-001", { status: "active" }); // NO branch: true
  writeAc(root, "AC-001", "GOAL-001");
  writeTask(root, "TT-001", "AC-001");
  const r = runCriterion(root);
  assert.equal(r.code, 3, `expected exit 3, got ${r.code}: ${r.stdout}${r.stderr}`);
  // The 2026-10-03 rewrite deleted the old dedicated `no goal record carries branch: true yet` message:
  // `live_goals()` now filters on branch-mode ∧ non-retired ∧ `activatedAt:`, and an empty set simply
  // means there is no landing to check — the SAME not-evaluated reading as an unlanded branch-mode goal.
  assert.match(r.stderr, /NOT-EVALUATED: no goal-branch landing could be checked against the develop reflog/);
  assert.equal(r.stdout, "", "nothing to judge must not also print a PASS");
});

test("branch-mode goal with no landing yet ⇒ exit 3 (a branch-mode goal alone is not a landing)", () => {
  const root = mkRoot("branch-mode-no-landing");
  writeGoal(root, "GOAL-001", { status: "active", branch: true });
  writeAc(root, "AC-001", "GOAL-001");
  writeTask(root, "TT-001", "AC-001");
  const r = runCriterion(root);
  assert.equal(r.code, 3, `expected exit 3, got ${r.code}: ${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /NOT-EVALUATED: no goal-branch landing could be checked against the develop reflog/);
  assert.doesNotMatch(r.stderr, /CAUSE=/);
});

// ── exit 0: the landing really caught up with develop ───────────────────────────────────────────────

test("branch-mode goal + landing whose catch-up merge pulled the CURRENT develop tip ⇒ exit 0", () => {
  const root = seedCarrier("catch-up");
  const c = buildLanding(root, { stale: false });

  // Premises: the landing really exists on develop, and the goal branch was really discarded.
  assert.match(c, /^[0-9a-f]{40}$/, "premise: the landing produced a real 40-hex commit");
  assert.equal(
    spawnSync("git", ["-C", root, "rev-parse", "-q", "--verify", "refs/heads/goal/GOAL-001"]).status !== 0,
    true,
    "premise: the goal branch was discarded (production 收尾)",
  );
  // The landing is reachable from develop THROUGH the goal merge commit (develop is advanced by a
  // `--no-ff` merge), so the flip commit `c` is an ancestor of develop rather than its tip.
  assert.doesNotThrow(
    () => git(root, ["merge-base", "--is-ancestor", c, "develop"]),
    "premise: the landing is reachable from develop",
  );

  const r = runCriterion(root);
  assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /PASS: 1 goal-branch landing\(s\) each contained develop as of their catch-up point/);
});

// ── exit 1: the violation — the catch-up merge pulled a STALE develop tip ───────────────────────────

test("branch-mode goal + landing that merged a STALE develop tip ⇒ exit 1 CAUSE=landing-missed-develop-catch-up", () => {
  const root = seedCarrier("stale-catch-up");
  const c = buildLanding(root, { stale: true });

  // Premise: the landing IS reachable (matching flip subjects exist), so exit 1 must come from the
  // catch-up predicate and not from an empty landing set (which would read exit 3).
  assert.equal(git(root, ["branch", "--list", "goal/GOAL-001"]).includes("goal/GOAL-001"), true);
  assert.match(c, /^[0-9a-f]{40}$/);

  const r = runCriterion(root);
  assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /CAUSE=landing-missed-develop-catch-up/);
  assert.doesNotMatch(r.stdout, /PASS:/, "a violation must not also print a PASS");
});

// ── strength evidence (AC4): the targeted mutation control ──────────────────────────────────────────

test("mutation control (cp backup): reverting the branch: true write flips the criterion red, restoring flips it green", () => {
  const root = seedCarrier("mutation-control");
  buildLanding(root, { stale: false });
  assert.equal(runCriterion(root).code, 0, "premise: the landing is green before mutation");

  const goalFile = path.join(
    root,
    "goals",
    fs.readdirSync(path.join(root, "goals")).find((n) => n.startsWith("GOAL-001-")),
  );
  // ⛔ `cp` backup, NEVER `git checkout -- <file>` — the fixture committed the file, but a checkout
  // would be the wrong primitive to restore a mid-test mutation and this keeps the control honest.
  const backup = `${goalFile}.bak`;
  fs.copyFileSync(goalFile, backup);
  try {
    // Revert exactly the step the criterion covers: the `branch: true` line that makes the goal
    // branch-mode. The landing is untouched, so only the branch-mode predicate can catch this.
    const stripped = fs.readFileSync(goalFile, "utf8").replace(/^branch: true\n/m, "");
    assert.notEqual(stripped, fs.readFileSync(goalFile, "utf8"), "premise: the mutation removed branch: true");
    fs.writeFileSync(goalFile, stripped);

    const red = runCriterion(root);
    assert.equal(red.code, 3, `the reverted branch-mode write must flip the criterion red, got ${red.code}: ${red.stdout}${red.stderr}`);
    // Stripping `branch: true` empties `live_goals()` ⇒ the same "no landing could be checked" exit 3.
    assert.match(red.stderr, /NOT-EVALUATED: no goal-branch landing could be checked against the develop reflog/);
  } finally {
    fs.copyFileSync(backup, goalFile);
  }
  const green = runCriterion(root);
  assert.equal(green.code, 0, `restoring the cp backup must flip it green, got ${green.code}: ${green.stdout}${green.stderr}`);
  assert.match(green.stdout, /PASS: 1 goal-branch landing\(s\)/);
});
