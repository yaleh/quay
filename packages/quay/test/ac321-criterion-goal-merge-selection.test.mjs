// @test-group product
//
// ac321-criterion-goal-merge-selection.test.mjs — the fixture binding the goal-merge SELECTOR of
// `goals/AC-321-*.md` (gap-ac321-goal-merge-selector-matches-task-catchup-merge AC3/AC4).
//
// WHAT THIS FILE IS FOR. AC-321's criterion decides, for every task landing of a live branch-mode
// goal, whether the landing reached develop THROUGH the goal branch (`via`) or BYPASSED it
// (`direct`), and exits 1 on the first `direct`. To answer that it must pick the goal's
// goal→develop merge commit (`Mg`). Until 2026-10-09 that selector read
//
//     goal_merges() { git log develop --merges --format='%H %ct %s' | grep -E "goal/$1([^0-9]|\$)"; }
//     Mg=$(goal_merges "$G" | tail -1 | cut -d' ' -f1)
//
// which matches ANY merge whose subject names `goal/<id>` — INCLUDING the merge a TASK branch makes
// to catch up with its goal branch (`Merge branch 'goal/GOAL-030' into task/…`), whose target is the
// task branch, not develop. `tail -1` takes the OLDEST line of `git log` output, so `Mg` landed on
// exactly such a catch-up merge and `classify()` read an INTACT isolation as `direct`. Measured on
// the real repo (2026-10-09): GOAL-030 and GOAL-905 each matched 4 merges wide vs 1 narrow; AC-321,
// AC-324, AC-327, AC-328 all read exit 1 while AC-322/323/325/326 stayed green.
//
// WHY NO EXISTING FIXTURE COULD SEE IT. `ac322-criterion-catchup.test.mjs` forks its task branch
// from the goal branch and then merges the goal branch into it — but the goal branch never MOVED, so
// that merge is a fast-forward and leaves NO merge commit. Its only `goal/<id>`-named merge commit is
// the develop-targeted one, so the wide and narrow selectors pick the same commit and the defect is
// invisible. The catch-up merge only exists when BOTH sides have moved since the fork.
//
// THE UNIT UNDER TEST IS THE SHIPPED CRITERION, NOT A COPY. `criterionText()` reads
// `goals/AC-321-*.md` at RUN TIME, parses the frontmatter and hands the store's own `criterion`
// string to /bin/sh — the same text `quay goal gate AC-321` runs. `classifyDef()` extracts the
// criterion's OWN `classify()` line so the `via`/`direct` reading below is the shipped judge's, not a
// reimplementation (an echo here would stay green while the shipped selector rotted).
//
// THE TWO SELECTOR SPELLINGS ARE NAMED ONCE, HERE. `WIDE_SELECTOR` / `NARROW_SELECTOR` are the
// before/after of that ONE shipped line; assertion (1) pins that the shipped text carries the narrow
// one, and the mutation control swaps exactly this substring back.
//
// THREE-STATE PLUS THE VIOLATION, EACH ITS OWN READING. exit 0 = ≥1 landing via the goal branch and
// none direct; exit 1 = CAUSE=goal-task-landed-on-develop-bypassing-goal-branch; exit 3 =
// NOT-EVALUATED (no live branch-mode goal, or no landing to judge). The mutation control below proves
// the 0/1 boundary is load-bearing on the ONE line this task narrowed, rather than inferred from
// "it was green this time".
//
// ⛔ EVERY WRITE THIS FILE MAKES LANDS IN `os.tmpdir()`. The ship-time fixture repos are mkdtemp'd
// there, and the mutation control operates on a COPY of the shipped goal file placed in the fixture
// root — never on the checked-in `goals/AC-321-*.md` itself (checked-in-write-check judges the
// resolved target path, and a test that rewrites a tracked file mid-run is exactly what it exists to
// stop).

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

/** The ONE shipped line's two spellings (before/after of
 *  gap-ac321-goal-merge-selector-matches-task-catchup-merge). The narrow form requires the merge's
 *  TARGET to be develop; the wide form matched any merge whose subject merely names `goal/<id>`. */
const WIDE_SELECTOR = "goal/$1([^0-9]|\\$)";
const NARROW_SELECTOR = "goal/$1[^ ]* into develop([^0-9]|\\$)";

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
  const name = fs.readdirSync(dir).find((n) => n.startsWith("AC-321-") && n.endsWith(".md"));
  assert.ok(name, `no goals/AC-321-*.md under ${dir}`);
  return path.join(dir, name);
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

/** The criterion text AS STORED (frontmatter folded scalar parsed back to a string) — the same text
 *  `quay goal gate AC-321` runs. `file` defaults to the SHIPPED goal file; the mutation control
 *  passes its temp-root copy so no write ever lands in the checked-in tree. */
function criterionText(file = goalFilePath()) {
  const raw = fs.readFileSync(file, "utf8");
  const fm = FRONTMATTER.exec(raw);
  assert.ok(fm, `goal file has no YAML frontmatter: ${file}`);
  const doc = YAML.parse(fm[1]);
  assert.equal(typeof doc.criterion, "string", `goal record has no criterion string: ${file}`);
  return doc.criterion;
}

/** Replace the frontmatter's `criterion` with `criterion` in `file` (used ONLY on the mutation
 *  control's temp-root copy — see the header). */
function writeCriterion(file, criterion) {
  const raw = fs.readFileSync(file, "utf8");
  const fm = FRONTMATTER.exec(raw);
  assert.ok(fm, "mutation target has no YAML frontmatter");
  const body = raw.slice(fm.index + fm[0].length);
  const doc = YAML.parse(fm[1]);
  doc.criterion = criterion;
  fs.writeFileSync(file, `---\n${YAML.stringify(doc)}---${body}`);
}

/** The criterion's OWN `classify()` definition, taken from the shipped text at RUN TIME (⛔ never
 *  re-typed here). The criterion keeps it on ONE logical line — a folded-scalar store turns an
 *  internal newline into a blank line, so more than one match means the shipped text is malformed. */
function classifyDef() {
  const lines = criterionText().split("\n").filter((l) => l.startsWith("classify() {"));
  assert.equal(lines.length, 1, "the criterion defines exactly one classify() on one logical line");
  return lines[0];
}

/** Run the criterion's OWN `classify()` on (F, Mg) in `root` — the same function the criterion
 *  calls, so `via` here is the shipped judge's verdict, not this file's. */
function runClassify(root, F, Mg) {
  const r = spawnSync("/bin/sh", ["-c", `${classifyDef()}\nclassify "${F}" "${Mg}"`], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(r.status, 0, `classify() must run: ${r.stderr}`);
  return r.stdout.trim();
}

/** Run the shipped criterion (or a mutated variant of it) in `root` under `/bin/sh` — the shell the
 *  acceptance runner uses. */
function runCriterion(root, text = criterionText()) {
  const r = spawnSync("/bin/sh", ["-c", text], { cwd: root, encoding: "utf8" });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}
function commitAll(cwd, msg) {
  git(cwd, ["add", "-A"]);
  git(cwd, ["commit", "-q", "-m", msg]);
}

/** Cross a wall-clock second boundary so two merge commits order deterministically under `git log`'s
 *  commit-date sort — the criterion keeps the LAST line of that output (`tail -1`), i.e. the OLDEST
 *  merge, and a same-second pair would make the fixture's own premise unstable rather than test the
 *  selector. */
function settle() {
  spawnSync("sleep", ["1.1"]);
}

/** A fresh temp root that IS a git root (`git rev-parse --show-toplevel` == itself), with a
 *  `develop` branch — the line the criterion reads. */
function mkRoot(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `quay-ac321-${tag}-`));
  TMP_DIRS.push(dir);
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.name", "ac321-fixture"]);
  git(dir, ["config", "user.email", "ac321@example.com"]);
  fs.mkdirSync(path.join(dir, "goals"), { recursive: true });
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(dir, "seed.txt"), "seed\n");
  commitAll(dir, "seed");
  // Everything else is written onto `develop`, the line the criterion reads — HEAD must sit on it.
  git(dir, ["checkout", "-q", "-b", "develop"]);
  return dir;
}

/** Write a GOAL record (the frontmatter shape the criterion reads: a literal `branch: true` line
 *  inside the frontmatter block, plus the `activatedAt:` that `live_goals()` requires — without it a
 *  branch-mode goal is invisible and every arm would read the same "nothing to judge" exit 3). */
function writeGoal(root, id, { status, branch = false }) {
  const fm = [
    "---",
    `id: ${id}`,
    `title: fixture ${id}`,
    `status: ${status}`,
    "kind: goal",
    "origin: ac321-criterion fixture",
    `activatedAt: ${new Date(Date.now() - 600_000).toISOString()}`,
    ...(branch ? ["branch: true"] : []),
    "---",
    "",
    `fixture goal for ${id} — not a real goal; exists only to exercise the AC-321 criterion text.`,
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

/** Seed a root whose develop already carries the branch-mode goal + AC + two tasks. */
function seedCarrier(tag) {
  const root = mkRoot(tag);
  writeGoal(root, "GOAL-001", { status: "active", branch: true });
  writeAc(root, "AC-001", "GOAL-001");
  writeTask(root, "TT-001", "AC-001");
  writeTask(root, "TT-002", "AC-001");
  return root;
}

/**
 * Build the production shape the wide selector mis-read: a TASK-branch catch-up merge.
 *
 * The catch-up merge (`Merge branch 'goal/GOAL-001' into landingB`) exists only because BOTH sides
 * moved since `landingB` forked: the task branch added its own commit, and the goal branch advanced
 * again. Its target is the TASK branch, and its subject names `goal/GOAL-001` — so the old selector
 * matched it. It is reachable from develop (through the goal branch) and OLDER than the
 * goal→develop merge, which is exactly why `tail -1` handed it to `classify()` as `Mg`.
 *
 * Returns every commit the assertions need to name.
 */
function buildCatchUpTopology(root) {
  const base = git(root, ["rev-parse", "develop"]);
  git(root, ["branch", "goal/GOAL-001", "develop"]); // lazy fork from the develop tip

  // develop moves on, so the goal branch and develop diverge: the final goal→develop merge is a real
  // (non-ff) merge commit rather than a fast-forward, and `F` is NOT an ancestor of its first parent.
  fs.writeFileSync(path.join(root, "develop-1.txt"), "develop 1\n");
  commitAll(root, "develop: advance 1");
  const developTip = git(root, ["rev-parse", "develop"]);

  // ── the EARLY landing: its flip commit is the `F` the criterion classifies. It lands on the goal
  //    branch, exactly like a real task landing, so develop receives it only through the goal merge.
  git(root, ["checkout", "-q", "-b", "landingA", "goal/GOAL-001"]);
  fs.writeFileSync(path.join(root, "task-a.txt"), "task A work\n");
  commitAll(root, "tasks: TT-001 work");
  flipTaskDone(root, "TT-001");
  const earlyFlip = git(root, ["rev-parse", "HEAD"]);
  git(root, ["checkout", "-q", "goal/GOAL-001"]);
  git(root, ["merge", "-q", "--ff-only", "landingA"]);
  git(root, ["branch", "-D", "landingA"]);

  // ── the LATER task branch. It forks from a goal branch that ALREADY carries the early landing, so
  //    both its parents will contain `F`.
  git(root, ["checkout", "-q", "-b", "landingB", "goal/GOAL-001"]);
  fs.writeFileSync(path.join(root, "task-b.txt"), "task B work\n");
  commitAll(root, "tasks: TT-002 work");

  // the goal branch advances AGAIN: without this the catch-up merge would be a fast-forward and
  // leave no merge commit at all — the shape `ac322-criterion-catchup.test.mjs` builds, and the
  // reason that fixture cannot see this defect.
  git(root, ["checkout", "-q", "goal/GOAL-001"]);
  fs.writeFileSync(path.join(root, "goal-2.txt"), "goal work 2\n");
  commitAll(root, "goal: GOAL-001 work 2");

  git(root, ["checkout", "-q", "landingB"]);
  git(root, ["merge", "-q", "--no-edit", "goal/GOAL-001"]); // ← the TASK-branch catch-up merge
  const catchUpMerge = git(root, ["rev-parse", "HEAD"]);
  flipTaskDone(root, "TT-002");
  const laterFlip = git(root, ["rev-parse", "HEAD"]);
  git(root, ["checkout", "-q", "goal/GOAL-001"]);
  git(root, ["merge", "-q", "--ff-only", "landingB"]);
  git(root, ["branch", "-D", "landingB"]);

  // ── production 收尾 (SPEC-goal-branch §4.7 裁定⑲): develop receives the goal branch through ONE
  //    `--no-ff` merge commit whose subject names `goal/<id>`; the goal branch is then discarded.
  settle(); // keep the two merge commits strictly ordered so `tail -1` is deterministic
  git(root, ["checkout", "-q", "develop"]);
  git(root, ["merge", "-q", "--no-ff", "--no-edit", "goal/GOAL-001"]);
  const goalMerge = git(root, ["rev-parse", "HEAD"]);
  git(root, ["branch", "-D", "goal/GOAL-001"]);

  return { base, developTip, earlyFlip, laterFlip, catchUpMerge, goalMerge };
}

/**
 * The 取假 half's shape: the SAME carrier and the SAME landing, but the one merge commit is TARGETED
 * AT DEVELOP (`git merge` run while on develop) instead of at a task branch — i.e. exactly the form
 * the narrowed selector is supposed to accept, however the merge message is spelled (git's default
 * `Merge branch 'goal/GOAL-001' into develop` here; production's `merge: goal/<id> into develop
 * (request …)` on develop). The criterion must pass here as well, so its green is not an artifact of
 * the task-branch shape being the only thing it ever sees.
 */
function buildDevelopTargetedMerge(root) {
  git(root, ["branch", "goal/GOAL-001", "develop"]);
  fs.writeFileSync(path.join(root, "develop-1.txt"), "develop 1\n");
  commitAll(root, "develop: advance 1");

  git(root, ["checkout", "-q", "-b", "landing", "goal/GOAL-001"]);
  fs.writeFileSync(path.join(root, "task.txt"), "task work\n");
  commitAll(root, "tasks: TT-001 work");
  flipTaskDone(root, "TT-001");
  const flip = git(root, ["rev-parse", "HEAD"]);
  git(root, ["checkout", "-q", "goal/GOAL-001"]);
  git(root, ["merge", "-q", "--ff-only", "landing"]);
  git(root, ["branch", "-D", "landing"]);

  git(root, ["checkout", "-q", "develop"]);
  git(root, ["merge", "-q", "--no-ff", "--no-edit", "goal/GOAL-001"]); // ← target IS develop
  const goalMerge = git(root, ["rev-parse", "HEAD"]);
  git(root, ["branch", "-D", "goal/GOAL-001"]);
  return { flip, goalMerge };
}

/** The merges on develop a `grep -E <selector>` over the criterion's own log format selects. The
 *  format string is the criterion's (`%H %ct %s`), so the reading is over the same object — but the
 *  stored text spells the end-anchor `$` as `\$` because the SHELL is what strips that backslash;
 *  feeding the stored bytes straight to a JS RegExp would look for a literal `$` and match nothing.
 *  So unescape first: this is the pattern grep actually receives. */
function selectedMerges(root, selector) {
  const shellPattern = selector.replace(/\\\$/g, () => "$").replace("$1", "GOAL-001");
  const pattern = new RegExp(shellPattern);
  return git(root, ["log", "develop", "--merges", "--format=%H %ct %s"])
    .split("\n")
    .filter((l) => pattern.test(l));
}

// ── (1) the shipped selector, read VERBATIM from goals/AC-321-*.md ──────────────────────────────────

test("the shipped criterion carries the NARROW selector (the merge's target must be develop)", () => {
  const text = criterionText();
  assert.ok(text.includes(NARROW_SELECTOR), `the shipped criterion is missing ${NARROW_SELECTOR}`);
  assert.ok(text.includes(`grep -E "${NARROW_SELECTOR}"`), "the selector is used by goal_merges()");
  // Positive control (hard rule 2, second half): the predicate is not vacuously true — the WIDE
  // spelling this task replaced no longer appears as the selector.
  assert.equal(text.includes(`grep -E "${WIDE_SELECTOR}"`), false, "the wide selector must be gone");
  // The rejection vocabulary the first assertion above must never be confused with.
  assert.ok(
    text.includes("CAUSE=goal-task-landed-on-develop-bypassing-goal-branch"),
    "the direct-bypass cause is still the criterion's exit-1 vocabulary",
  );
});

// ── (2) AC3 — the catch-up-merge topology reads exit 0, and classify() reads `via` ──────────────────

test("a TASK-branch catch-up merge is not mistaken for the goal merge ⇒ exit 0 and classify() reads `via`", (t) => {
  const root = seedCarrier("catch-up");
  const { earlyFlip, catchUpMerge, goalMerge } = buildCatchUpTopology(root);

  // Premises: the fixture really built both merges, and both are reachable from develop.
  assert.match(catchUpMerge, /^[0-9a-f]{40}$/, "premise: the catch-up merge is a real commit");
  assert.notEqual(catchUpMerge, goalMerge, "premise: two distinct merge commits");
  assert.match(git(root, ["log", "-1", "--format=%s", catchUpMerge]), /^Merge branch 'goal\/GOAL-001' into /);
  assert.ok(
    !/into develop$/.test(git(root, ["log", "-1", "--format=%s", catchUpMerge])),
    "premise: the catch-up merge's TARGET is the task branch, not develop",
  );
  for (const sha of [catchUpMerge, goalMerge]) {
    assert.doesNotThrow(() => git(root, ["merge-base", "--is-ancestor", sha, "develop"]),
      `premise: ${sha} is reachable from develop`);
  }

  // The reading the selector decides: wide matches BOTH merges (and `tail -1` keeps the OLDEST, i.e.
  // the catch-up one), narrow matches ONLY the develop-targeted one. This is the whole defect.
  const wide = selectedMerges(root, WIDE_SELECTOR);
  const narrow = selectedMerges(root, NARROW_SELECTOR);
  assert.equal(wide.length, 2, `wide selector matches both merges: ${JSON.stringify(wide)}`);
  assert.equal(narrow.length, 1, `narrow selector matches only the goal merge: ${JSON.stringify(narrow)}`);
  assert.match(narrow[0], new RegExp(`^${goalMerge} `), "the narrow selector keeps the develop-targeted merge");
  assert.match(wide[wide.length - 1], new RegExp(`^${catchUpMerge} `), "tail -1 of the wide match is the catch-up merge");

  // The criterion's OWN classify(): with the merge the narrow selector keeps, the early landing went
  // THROUGH the goal branch; with the one the wide selector handed it, the same landing reads
  // `direct` — which is what turned a correct isolation into exit 1.
  assert.equal(runClassify(root, earlyFlip, goalMerge), "via", "narrow selection ⇒ via");
  assert.equal(runClassify(root, earlyFlip, catchUpMerge), "direct", "wide selection ⇒ the false `direct`");

  // And the shipped criterion, run end to end, exits 0 with its PASS line.
  const r = runCriterion(root);
  t.diagnostic(`catch-up topology + shipped criterion ⇒ exit ${r.code}; stdout=${r.stdout.trim()}`);
  assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /^PASS: 2 landing\(s\) via goal branch, none landed on develop directly$/m);
  assert.doesNotMatch(r.stderr, /CAUSE=/, "a pass must not also print a cause");
});

// ── (3) the 取假 half — the same carrier, the merge TARGETED AT DEVELOP, still passes ───────────────

test("取假半边：同一夹具把那次合并换成目标为 develop 的形态 ⇒ 判据同样 exit 0（绿跟着「目标」走）", () => {
  const root = seedCarrier("develop-targeted");
  const { flip, goalMerge } = buildDevelopTargetedMerge(root);

  // Premise: the ONLY merge commit here targets develop — this is the form the narrowed selector
  // accepts, spelled with git's default merge message rather than production's `merge: goal/<id>
  // into develop (request …)`.
  assert.equal(selectedMerges(root, WIDE_SELECTOR).length, 1, "premise: exactly one goal merge");
  assert.equal(selectedMerges(root, NARROW_SELECTOR).length, 1, "premise: the narrow selector matches it too");
  assert.equal(
    git(root, ["log", "-1", "--format=%s", goalMerge]),
    "Merge branch 'goal/GOAL-001' into develop",
  );
  assert.equal(runClassify(root, flip, goalMerge), "via", "the develop-targeted merge reads via");

  const r = runCriterion(root);
  assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /^PASS: 1 landing\(s\) via goal branch, none landed on develop directly$/m);
});

// ── (4) AC4 — the mutation control: the ONE narrowed line is load-bearing ───────────────────────────

test("mutation control (cp backup): reverting the selector to the WIDE regex flips the criterion red, restoring flips it green", (t) => {
  const root = seedCarrier("mutation-control");
  const { earlyFlip } = buildCatchUpTopology(root);
  assert.equal(runCriterion(root).code, 0, "premise: the topology is green before the mutation");

  // The `cp` backup is a real byte copy of the SHIPPED goal file. ⛔ NOT `git checkout --` (it would
  // restore a working-tree state the mutation never touched), and ⛔ NOT a write into the checked-in
  // tree: the copy lives in the fixture root, which is under os.tmpdir().
  const shipped = goalFilePath();
  const copy = path.join(root, "goals", path.basename(shipped));
  fs.copyFileSync(shipped, copy);
  assert.equal(criterionText(copy), criterionText(shipped),
    "premise: the copy starts byte-identical to the shipped criterion");

  let red;
  try {
    // Revert EXACTLY the one line this task narrowed — the selector back to "any merge naming
    // goal/<id>", which is what read `direct` on an intact isolation.
    const mutated = criterionText(copy).replace(NARROW_SELECTOR, WIDE_SELECTOR);
    assert.notEqual(mutated, criterionText(copy), "premise: the mutation replaced the narrow selector");
    assert.ok(mutated.includes(`grep -E "${WIDE_SELECTOR}"`), "premise: the wide selector is now in force");
    writeCriterion(copy, mutated);

    red = runCriterion(root, criterionText(copy));
  } finally {
    fs.copyFileSync(shipped, copy); // restore the shipped bytes into the copy
  }

  t.diagnostic(`wide (mutated) ⇒ exit ${red.code}; stdout=${JSON.stringify(red.stdout.trim())}; stderr=${red.stderr.trim()}`);
  assert.equal(red.code, 1, `the wide selector must flip this topology red, got ${red.code}: ${red.stdout}${red.stderr}`);
  assert.match(red.stderr, /CAUSE=goal-task-landed-on-develop-bypassing-goal-branch/);
  assert.doesNotMatch(red.stdout, /PASS:/, "a violation must not also print a PASS");

  // The false `direct` the mutation produces is exactly the one the shipped narrow selector does not:
  // same fixture, same landing, one line of judge between them.
  assert.equal(criterionText(copy), criterionText(shipped), "premise: the copy is back to the shipped text");
  const green = runCriterion(root, criterionText(copy));
  t.diagnostic(`narrow (shipped, restored) ⇒ exit ${green.code}; stdout=${green.stdout.trim()}`);
  assert.equal(green.code, 0, `restoring the shipped selector must flip it green, got ${green.code}: ${green.stdout}${green.stderr}`);
  assert.match(green.stdout, /^PASS: 2 landing\(s\) via goal branch, none landed on develop directly$/m);
  assert.notEqual(earlyFlip, "", "the early landing commit was named by this fixture");
});
