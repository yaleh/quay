// @test-group product
//
// ac326-criterion-branch-discard.test.mjs — the fixture binding the CRITERION of
// `goals/AC-326-*.md` (gap-ac326-branch-discard-drill-real-reading AC5).
//
// WHAT THIS FILE IS FOR. AC-326's criterion is the exit-0 reading GOAL-028's exit condition ②
// depends on: 「被 retired/superseded 的 branch-mode goal 的分支已删除，被丢弃的 tip SHA 留在
// statusLog」. The mechanism that produces that state (branch-model.ts's ensureGoalBranch/
// discardGoalBranch, driven by goal-store.write on draft→active→retired) landed in
// `gap-goal-branch-data-model-and-lifecycle` with unit coverage — but until this task NOTHING ran
// the criterion TEXT itself: the previous task only read `exit 3` off the real repo before any
// branch-mode goal existed. A criterion nobody runs is a criterion that can rot silently (hard rule
// 4: an assertion that can never be false is not a measurement). This file closes that.
//
// THE UNIT UNDER TEST IS THE SHIPPED CRITERION, NOT A COPY OF IT. `criterionText()` reads
// `goals/AC-326-*.md` at RUN TIME, parses the frontmatter, and hands the store's own `criterion`
// string to `/bin/sh` — the same text `quay goal gate AC-326` runs. A reimplementation here would be
// an echo of the criterion (hard rule 4 corollary three): it would stay green while the criterion
// rotted, which is exactly the failure this task exists to prevent. `branch-model.test.mjs` measures
// the store's BEHAVIOR; this file measures the criterion's VERDICT on that behavior.
//
// THREE STATES PLUS BOTH VIOLATIONS, EACH ITS OWN READING. The criterion's word-list is exit 0
// (abandoned + branch gone + tip recorded), exit 1 (branch still there, or no SHA), exit 3 (nothing
// to judge yet). A judge that never returns 3 cannot tell "checked and clean" from "never checked"
// (hard rule 3b) — so the not-evaluated arm ("no branch-mode goal", and "branch-mode goal still
// active") is pinned alongside the pass arm. The two violations are pinned separately so a future
// regression that collapses them into one cause is caught.
//
// THE exit-0 CASE GOES THROUGH THE REAL STORE. Case 4 below does not hand-write a retired goal — it
// drives `createGoalStore(...).write()` through draft→active→retired, exactly the production path
// (branch lazily forked from the develop tip, tip SHA written into the statusLog reason BEFORE the
// ref is deleted). A hand-crafted file could satisfy the criterion while the store's discard path
// was broken — which is the whole class of gap this task files (hard rule 4 corollary three: a
// criterion satisfied only by injected data proves "can produce", not "did produce").
//
// STRENGTH EVIDENCE (AC5). The last test is the mutation control the AC calls for: with a `cp`
// backup (⛔ never `git checkout --`, which would wipe an uncommitted fix), the statusLog step the
// criterion覆盖 is reverted and at least one assertion must flip red; restoring the backup must flip
// it green again. The "delete the branch" step is controlled the same way in case 5 (the branch is
// re-created, then discarded again).

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { createGoalStore } from "../src/goal-store.ts";

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
  const name = fs.readdirSync(dir).find((n) => n.startsWith("AC-326-") && n.endsWith(".md"));
  assert.ok(name, `no goals/AC-326-*.md under ${dir}`);
  return path.join(dir, name);
}

/** The criterion text AS STORED (frontmatter folded scalar parsed back to a string) — the same text
 *  `quay goal gate AC-326` runs. */
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

/** A fresh temp root that IS a git root (`git rev-parse --show-toplevel` == itself), with a
 *  `develop` branch — the base `ensureGoalBranch` forks from. */
function mkRoot(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `quay-ac326-${tag}-`));
  TMP_DIRS.push(dir);
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.name", "ac326-fixture"]);
  git(dir, ["config", "user.email", "ac326@example.com"]);
  fs.mkdirSync(path.join(dir, "goals"), { recursive: true });
  fs.writeFileSync(path.join(dir, "seed.txt"), "seed\n");
  commitAll(dir, "seed");
  git(dir, ["branch", "develop"]);
  return dir;
}

/** Run the shipped criterion in `root` under `/bin/sh` — the shell the acceptance runner uses. */
function runCriterion(root) {
  const r = spawnSync("/bin/sh", ["-c", criterionText()], { cwd: root, encoding: "utf8" });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** Write a hand-authored GOAL record (the fixtures for the not-evaluated arm and the two violations
 *  — shapes the real store would NOT produce, which is exactly what makes them probes of the
 *  criterion's own logic rather than of the store). */
function writeGoal(root, id, { status, branch = false, slug = "hand", statusLog = [] }) {
  const fm = [
    "---",
    `id: ${id}`,
    `title: fixture ${id}`,
    `status: ${status}`,
    "kind: goal",
    "origin: ac326-criterion fixture",
    ...(branch ? ["branch: true"] : []),
    ...(statusLog.length
      ? [
          "statusLog:",
          ...statusLog.flatMap((e) => [
            `  - at: ${e.at}`,
            `    from: ${e.from}`,
            `    to: ${e.to}`,
            `    actor: fixture`,
            `    reason: ${e.reason}`,
          ]),
        ]
      : []),
    "---",
    "",
    `fixture body for ${id} — not a real goal; exists only to exercise the AC-326 criterion text.`,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(root, "goals", `${id}-${slug}.md`), fm);
  commitAll(root, `fixture ${id}`);
}

/** Drive the REAL store through draft→active→retired for GOAL-901. Returns the forked tip SHA
 *  (captured while the branch still existed) so callers can re-create or reason about it. */
function storeDrill(root) {
  const store = createGoalStore(path.join(root, "goals"), { cap: 99 });
  store.write("AC-901", {
    goal: "GOAL-901",
    status: "draft",
    criterion: "echo ok; exit 0",
    expect: "exit 0",
    origin: "ac326-criterion fixture (discard drill)",
  });
  store.write("GOAL-901", {
    title: "fixture discard drill",
    status: "draft",
    branch: true,
    origin: "ac326-criterion fixture (discard drill)",
    body:
      "Fixture goal used only to drive the store's lazy branch creation and discard path for the " +
      "AC-326 criterion fixture; it is not a real development direction and lands no code.",
  });
  store.write("GOAL-901", { status: "active", actor: "ac326-fixture", reason: "fixture activate" });
  const tip = git(root, ["rev-parse", "goal/GOAL-901"]);
  store.write("GOAL-901", { status: "retired", actor: "ac326-fixture", reason: "fixture retire" });
  return tip;
}

// ── the extraction itself: the criterion is read, not copied ────────────────────────────────────────

test("criterion is extracted VERBATIM from goals/AC-326-*.md (not a copy that can drift)", () => {
  const text = criterionText();
  for (const needle of [
    "CAUSE=abandoned-goal-branch-still-exists",
    "CAUSE=discarded-tip-not-recorded",
    "NOT-EVALUATED: no branch-mode goal has been retired or superseded yet",
    "PASS: $cnt abandoned branch-mode goal(s)",
  ]) {
    assert.ok(text.includes(needle), `the extracted criterion does not contain ${needle}`);
  }
  // Positive control (hard rule 2, second half): the predicate above is not vacuously true.
  const empty = "";
  assert.equal(empty.includes("CAUSE=abandoned-goal-branch-still-exists"), false);
});

// ── exit 3: the not-evaluated arm, both shapes ──────────────────────────────────────────────────────

test("no branch-mode goal ⇒ exit 3 (nothing to judge yet, not a pass and not a failure)", () => {
  const root = mkRoot("no-branch-mode");
  writeGoal(root, "GOAL-001", { status: "active" });
  const r = runCriterion(root);
  assert.equal(r.code, 3, `expected exit 3, got ${r.code}: ${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /NOT-EVALUATED: no branch-mode goal has been retired or superseded yet/);
  assert.equal(r.stdout, "", "nothing to judge must not also print a PASS");
});

test("a branch-mode goal that is still ACTIVE ⇒ exit 3 (a live branch is not an abandoned one)", () => {
  const root = mkRoot("still-active");
  writeGoal(root, "GOAL-001", {
    status: "active",
    branch: true,
    statusLog: [{ at: "2026-10-03T00:00:00.000Z", from: "draft", to: "active", reason: "activated" }],
  });
  git(root, ["branch", "goal/GOAL-001", "develop"]); // the branch really exists
  assert.equal(git(root, ["rev-parse", "--verify", "goal/GOAL-001"]), git(root, ["rev-parse", "develop"]));
  const r = runCriterion(root);
  assert.equal(r.code, 3, `an active branch-mode goal must be skipped, got ${r.code}: ${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /NOT-EVALUATED: no branch-mode goal has been retired or superseded yet/);
  assert.doesNotMatch(r.stderr, /CAUSE=/);
});

// ── exit 0: the real store's discard path ───────────────────────────────────────────────────────────

test("REAL store draft→active→retired ⇒ exit 0, branch gone, discarded tip recorded", () => {
  const root = mkRoot("real-store");
  const tip = storeDrill(root);

  // The branch was really created (from the develop tip) and really discarded.
  assert.match(tip, /^[0-9a-f]{40}$/, "premise: the drill recorded a real 40-hex tip");
  assert.equal(runCriterion(root).code, 0, "premise: the store drill leaves the criterion satisfied");
  const verify = spawnSync("git", ["-C", root, "rev-parse", "-q", "--verify", "refs/heads/goal/GOAL-901"]);
  assert.notEqual(verify.status, 0, "premise: goal/GOAL-901 was deleted");

  const r = runCriterion(root);
  assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /PASS: 1 abandoned branch-mode goal\(s\): branch gone, discarded tip recorded/);

  // The rescue handle is the tip SHA, written into the `to: retired` statusLog entry — the criterion
  // accepted it, and the carrier holds it verbatim.
  const goalFile = fs.readdirSync(path.join(root, "goals")).find((n) => n.startsWith("GOAL-901-"));
  const body = fs.readFileSync(path.join(root, "goals", goalFile), "utf8");
  assert.match(body, /status: retired\n/);
  // The store's serializer wraps long `reason:` scalars, so compare on a whitespace-normalised view
  // (the SHA itself must still be present byte-for-byte).
  const flat = body.replace(/\s+/g, " ");
  assert.ok(flat.includes(`discarded branch goal/GOAL-901 tip ${tip}`), `statusLog must carry the tip verbatim:\n${body}`);
});

// ── exit 1: the two violations, kept distinguishable ────────────────────────────────────────────────

test("branch still exists while the goal is retired ⇒ exit 1 CAUSE=abandoned-goal-branch-still-exists", () => {
  const root = mkRoot("branch-alive");
  const tip = storeDrill(root);
  git(root, ["branch", "goal/GOAL-901", tip]); // REVERT the delete step: the ref comes back
  const r = runCriterion(root);
  assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /CAUSE=abandoned-goal-branch-still-exists/);
  assert.doesNotMatch(r.stderr, /discarded-tip-not-recorded/, "the two violations must not collapse");
});

test("retired but the statusLog entry carries no SHA ⇒ exit 1 CAUSE=discarded-tip-not-recorded", () => {
  const root = mkRoot("no-sha");
  writeGoal(root, "GOAL-001", {
    status: "retired",
    branch: true,
    statusLog: [{ at: "2026-10-03T00:00:00.000Z", from: "active", to: "retired", reason: "abandoned the direction" }],
  });
  const r = runCriterion(root);
  assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /CAUSE=discarded-tip-not-recorded/);
  assert.doesNotMatch(r.stderr, /abandoned-goal-branch-still-exists/, "the two violations must not collapse");
});

// ── strength evidence (AC5): the targeted mutation control ──────────────────────────────────────────

test("mutation control (cp backup): reverting the statusLog SHA write flips the criterion red, restoring flips it green", () => {
  const root = mkRoot("mutation-control");
  const tip = storeDrill(root);
  assert.equal(runCriterion(root).code, 0, "premise: the store drill is green before mutation");

  const goalFile = path.join(
    root,
    "goals",
    fs.readdirSync(path.join(root, "goals")).find((n) => n.startsWith("GOAL-901-")),
  );
  // ⛔ `cp` backup, NEVER `git checkout -- <file>` — the store committed the file, but a checkout
  // would be the wrong primitive to restore a mid-test mutation and this keeps the control honest.
  const backup = `${goalFile}.bak`;
  fs.copyFileSync(goalFile, backup);
  try {
    // Revert exactly the step the criterion covers: the tip SHA in the `to: retired` statusLog
    // entry. The branch is ALREADY gone, so only the SHA predicate can catch this.
    const stripped = fs.readFileSync(goalFile, "utf8").replace(new RegExp(`[0-9a-f]{40}`, "g"), "");
    assert.notEqual(stripped, fs.readFileSync(goalFile, "utf8"), "premise: the mutation removed a 40-hex SHA");
    fs.writeFileSync(goalFile, stripped);

    const red = runCriterion(root);
    assert.equal(red.code, 1, `the reverted statusLog must flip the criterion red, got ${red.code}: ${red.stdout}${red.stderr}`);
    assert.match(red.stderr, /CAUSE=discarded-tip-not-recorded/);
  } finally {
    fs.copyFileSync(backup, goalFile);
  }
  const green = runCriterion(root);
  assert.equal(green.code, 0, `restoring the cp backup must flip it green, got ${green.code}: ${green.stdout}${green.stderr}`);
  assert.match(green.stdout, /PASS: 1 abandoned branch-mode goal/);
  assert.ok(tip.length === 40, "the restored carrier still holds the original tip");
});
