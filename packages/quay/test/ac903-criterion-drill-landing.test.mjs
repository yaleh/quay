// @test-group product
//
// ac903-criterion-drill-landing.test.mjs — the fixture binding the CRITERION of `goals/AC-903-*.md`
// (gap-goal903-drill-landing-missing AC5/AC3).
//
// WHAT THIS FILE IS FOR. AC-903's criterion asks one question, and it asks it of `develop`:
// 「GOAL-903 drill 任务的翻 done 提交在 develop 上存在吗」— exit 0 = 在，exit 1 =
// `CAUSE=goal903-drill-landing-missing`。The mechanism that produces such a commit (`runMechanicalFanIn`
// 的 flip 步, `plugin/scripts/worker-fan-in.ts`) has unit coverage; the GOAL-903 drill itself was
// landed onto `goal/GOAL-903` — but a landing that never reaches `develop` reads exit 1 forever, and
// NOTHING ran this criterion TEXT against either state. A criterion nobody runs is a criterion that
// rots silently (hard rule 4 corollary three: implemented, unit-green, never exercised). This file
// closes that.
//
// THE UNIT UNDER TEST IS THE SHIPPED CRITERION, NOT A COPY OF IT. `criterionText()` reads
// `goals/AC-903-*.md` at RUN TIME, parses the frontmatter, and hands the store's own `criterion`
// string to `/bin/sh` — the same text `quay goal gate AC-903` runs. A reimplementation here would be
// an echo of the criterion (hard rule 4 corollary three): it would stay green while the criterion
// rotted, which is exactly the failure this task exists to prevent.
//
// TWO REACHABLE STATES, EACH ITS OWN READING. The criterion's word-list has no exit-3 arm — off a
// non-git directory it still reads exit 1 with the same CAUSE (measured on the shipped text), so the
// fixture pins the two states that are actually reachable:
//   · exit 0 — `develop` carries a commit whose subject is VERBATIM the mechanical fan-in's flip
//     subject `tasks: 翻 T-903-drill done（driver 机械 fan-in）`;
//   · exit 1 — it does not. The discriminating arm is `flip exists but ONLY off develop`: the same
//     commit is reachable from a `goal/GOAL-903` branch and from no `develop` — the real production
//     shape this task was filed against (the landing sat on the goal branch, develop never saw it).
//     That arm is what proves the criterion reads the `develop` REF and not "any commit anywhere".
//
// STRENGTH EVIDENCE (AC5). The last test is the mutation control the AC calls for: the step that
// constructs the flip-done commit is reverted (the commit is given a subject the criterion's
// fixed-string grep cannot match), at least one assertion must flip red, and restoring it must flip
// green again — so the pass arm cannot be passing for a reason other than that exact subject. The
// AC asks for the same control to be run once against THIS FILE with a `cp` backup (⛔ never
// `git checkout --`, which would wipe an uncommitted fix); that external reading is recorded in the
// task's `## Evidence`.

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

/** The drill carrier the shipped criterion names, and the flip subject the criterion greps for —
 *  spelled ONCE here so the fixture's constructor and its assertions cannot drift apart (硬规则 5b).
 *  `FLIP_CORE` is the fixed string the criterion's `--grep` carries (a SUBSTRING of the commit
 *  subject); `FLIP_SUBJECT` is the commit subject the mechanical fan-in's flip step writes
 *  (`worker-fan-in.ts` `commitTaskStatusChange`: `` `tasks: 翻 ${task} done（driver 机械 fan-in）` ``),
 *  which contains it. */
const DRILL_TASK = "T-903-drill";
const FLIP_CORE = `翻 ${DRILL_TASK} done（driver 机械 fan-in）`;
const FLIP_SUBJECT = `tasks: ${FLIP_CORE}`;

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
  const name = fs.readdirSync(dir).find((n) => n.startsWith("AC-903-") && n.endsWith(".md"));
  assert.ok(name, `no goals/AC-903-*.md under ${dir}`);
  return path.join(dir, name);
}

/** The criterion text AS STORED (frontmatter folded scalar parsed back to a string) — the same text
 *  `quay goal gate AC-903` runs. */
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
function gitCode(cwd, args) {
  return spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).status;
}
function commitAll(cwd, msg) {
  git(cwd, ["add", "-A"]);
  git(cwd, ["commit", "-q", "-m", msg]);
}

/** A fresh temp root that IS a git root (`git rev-parse --show-toplevel` == itself) with a `develop`
 *  branch — the line the criterion greps. */
function mkRoot(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `quay-ac903-${tag}-`));
  TMP_DIRS.push(dir);
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.name", "ac903-fixture"]);
  git(dir, ["config", "user.email", "ac903@example.com"]);
  fs.mkdirSync(path.join(dir, "goals"), { recursive: true });
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(dir, "seed.txt"), "seed\n");
  commitAll(dir, "seed");
  // The fixture writes everything onto `develop` (the line the criterion greps), so HEAD must sit on
  // it — not on `main`.
  git(dir, ["checkout", "-q", "-b", "develop"]);
  return dir;
}

/** Run the shipped criterion in `root` under `/bin/sh` — the shell the acceptance runner uses. */
function runCriterion(root) {
  const r = spawnSync("/bin/sh", ["-c", criterionText()], { cwd: root, encoding: "utf8" });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** Write the drill carrier task file (the `tasks/<id>.md` the flip commit would touch). */
function writeTask(root) {
  const fm = [
    "---",
    `id: ${DRILL_TASK}`,
    `title: fixture ${DRILL_TASK}`,
    "status: ready",
    "---",
    "",
    `fixture drill carrier for ${DRILL_TASK}.`,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(root, "tasks", `${DRILL_TASK}.md`), fm);
  commitAll(root, `fixture ${DRILL_TASK}`);
}

/** Flip the carrier's status to done and commit with EXACTLY the subject the criterion greps for.
 *  `subject` is overridable ONLY so the mutation control below can revert this step — the shipped
 *  subject is `FLIP_SUBJECT`, and no test passes anything else except that control. */
function flipTaskDone(root, subject = FLIP_SUBJECT) {
  const f = path.join(root, "tasks", `${DRILL_TASK}.md`);
  fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/^status: ready$/m, "status: done"));
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", subject]);
}

// ── the extraction itself: the criterion is read, not copied ────────────────────────────────────────

test("criterion is extracted VERBATIM from goals/AC-903-*.md (not a copy that can drift)", () => {
  const text = criterionText();
  for (const needle of [
    "CAUSE=goal903-drill-landing-missing",
    "PASS: GOAL-903 drill landing present",
    FLIP_CORE,
    "develop",
  ]) {
    assert.ok(text.includes(needle), `the extracted criterion does not contain ${needle}`);
  }
  // Positive control (hard rule 2, second half): the predicate above is not vacuously true.
  const empty = "";
  assert.equal(empty.includes("CAUSE=goal903-drill-landing-missing"), false);
});

// ── exit 1: the flip commit is absent from develop ──────────────────────────────────────────────────

test("no flip-done commit anywhere ⇒ exit 1 CAUSE=goal903-drill-landing-missing", () => {
  const root = mkRoot("absent");
  writeTask(root); // a ready carrier, never flipped
  const r = runCriterion(root);
  assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /CAUSE=goal903-drill-landing-missing/);
  assert.doesNotMatch(r.stdout, /PASS/, "a violation must not also print a PASS");
});

test("flip-done commit exists ONLY off develop (on goal/GOAL-903) ⇒ still exit 1", () => {
  const root = mkRoot("off-develop");
  writeTask(root);
  // The production shape this task was filed against: the landing sat on the goal branch and develop
  // never saw it. Build it exactly that way — flip on a `goal/GOAL-903` branch, then come back to a
  // develop that does not contain it.
  git(root, ["checkout", "-q", "-b", "goal/GOAL-903"]);
  flipTaskDone(root);
  const flipSha = git(root, ["rev-parse", "HEAD"]);
  git(root, ["checkout", "-q", "develop"]);

  // Premises: the commit really exists, and really is NOT reachable from develop.
  assert.match(flipSha, /^[0-9a-f]{40}$/, "premise: the flip produced a real 40-hex commit");
  assert.equal(git(root, ["branch", "--contains", flipSha]).includes("goal/GOAL-903"), true);
  assert.equal(gitCode(root, ["merge-base", "--is-ancestor", flipSha, "develop"]) !== 0, true,
    "premise: the flip is NOT an ancestor of develop");

  const r = runCriterion(root);
  assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /CAUSE=goal903-drill-landing-missing/);
  assert.doesNotMatch(r.stdout, /PASS/, "a violation must not also print a PASS");
});

// ── exit 0: the landing reached develop ─────────────────────────────────────────────────────────────

test("flip-done commit on develop ⇒ exit 0 PASS", () => {
  const root = mkRoot("on-develop");
  writeTask(root);
  flipTaskDone(root);
  const flipSha = git(root, ["rev-parse", "HEAD"]);

  // Premise: the commit with the verbatim subject is ON develop — asserted through the same
  // fixed-string grep the criterion uses, so the fixture cannot pass on a near-miss subject.
  assert.equal(
    git(root, ["log", "--fixed-strings", `--grep=${FLIP_SUBJECT}`, "--format=%H", "develop"]),
    flipSha,
    "premise: develop carries the flip commit with the verbatim subject",
  );

  const r = runCriterion(root);
  assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /PASS: GOAL-903 drill landing present/);
  assert.doesNotMatch(r.stderr, /CAUSE=/);
});

// ── strength evidence (AC5): the targeted mutation control ──────────────────────────────────────────

test("mutation control: reverting the flip-subject step turns the pass arm red, restoring turns it green", () => {
  // Same root, same carrier, same flip STEP — only the subject the step commits with differs. If the
  // pass arm were passing for any reason other than that exact subject (e.g. "some commit exists"),
  // the mutated arm would stay green too.
  const root = mkRoot("mutation-control");
  writeTask(root);

  flipTaskDone(root, `tasks: 翻 ${DRILL_TASK} done（semantic fallback）`); // the step, reverted
  const red = runCriterion(root);
  assert.equal(red.code, 1, `the reverted flip step must read exit 1, got ${red.code}: ${red.stdout}${red.stderr}`);
  assert.match(red.stderr, /CAUSE=goal903-drill-landing-missing/);

  // Restore the step (a second commit, exactly as a re-run of the fan-in's flip would produce) and
  // the very same criterion must flip green.
  fs.writeFileSync(path.join(root, "tasks", `${DRILL_TASK}.md`), `---\nid: ${DRILL_TASK}\nstatus: ready\n---\n\nrestored\n`);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "reset carrier for the restored flip"]);
  flipTaskDone(root);
  const green = runCriterion(root);
  assert.equal(green.code, 0, `restoring the flip step must read exit 0, got ${green.code}: ${green.stdout}${green.stderr}`);
  assert.match(green.stdout, /PASS: GOAL-903 drill landing present/);
});
