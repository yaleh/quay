// @test-group engine
// anti-drift-touches-check.test.mjs — gap-goal-branch-antidrift-two-line-base (AC1).
//
// The anti-drift Touches judgment compares the declared `## Touches` against the files the fan-in
// would land. When the merge target is the landing baseline (`develop`), that set is
// `git diff --name-only develop...HEAD` — the task's own commits. On a `goal/<id>` branch
// (orchestration/SPEC-goal-branch-2026-10-03 §4.4, ruling ③) the task worktree merges `goal/<id>`
// and THEN merges `develop` (the per-landing catch-up). The `goal...HEAD` diff then contains every
// develop change the catch-up brought in — and the goal branch's own prior changes — none of which
// the task wrote, so EVERY catch-up would be judged `out-of-declared` and hard-fail. The two-line
// base fixes exactly that: files changed by commits reachable from HEAD but from NEITHER the merge
// target NOR `develop`.
//
// This file pins all three directions on a REAL temp git repo (develop + goal/GOAL-901 + a task
// branch that merges both, in the SPEC's order):
//   ① develop's out-of-Touches file X is NOT judged (pass, output does not name X);
//   ② a file the task itself wrote outside its Touches (Z) IS a hard fail naming Z;
//   ③ `--merge-target develop` is byte-identical to the pre-change behavior (same fixture).
// Plus the property that motivates the commit-set over a naive `develop...HEAD`: a GOAL branch's own
// prior change must not leak into the task's judged set either.
//
// Run: scripts/test.sh plugin/test/anti-drift-touches-check.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync, execFileSync } from "node:child_process";

import { computeActualFiles, computeTaskOwnedFiles, isProjectGoalLine } from "../scripts/anti-drift-touches-check.ts";
import { classifyBranch, detectDefaultBranch } from "../../packages/quay/src/branch-model.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECKER = path.join(REPO_ROOT, "plugin", "scripts", "anti-drift-touches-check.ts");

// R6 (gap-tests-never-clean-up-their-tmpdirs): every mkdtemp dir is tracked and removed at the end.
const tempDirs = [];
after(() => {
  for (const d of tempDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
  }
});

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

const TASK_ID = "gap-goal-branch-antidrift-two-line-base-fixture";
const taskBody = (extraTouches = []) => [
  "---",
  `id: ${TASK_ID}`,
  "title: fixture task",
  "status: ready",
  "labels:",
  "  - gap",
  "extra: {}",
  "---",
  "## Proposal",
  "fixture proposal prose",
  "## Plan",
  "fixture plan prose",
  "## Acceptance Criteria",
  "- [ ] an AC",
  "## Definition of Done",
  "- [ ] a DoD",
  "## Touches",
  "",
  "- Y.txt",
  `- tasks/${TASK_ID}.md`,
  ...extraTouches.map((t) => `- ${t}`),
  "",
].join("\n");

/** The SPEC §4.4 shape, built end to end in a real repo:
 *    base ── develop: X (outside the task's Touches)
 *        └── goal/GOAL-901 (forked BEFORE X; optionally carries its own prior change W)
 *              └── task/<id>: Y (declared Touches) [+ Z when taskOutside]
 *  then the catch-up the task worktree performs: `git merge goal/GOAL-901` (no-op) → `git merge develop`. */
function makeFixture({ taskOutside = false, goalOwnChange = false, resolvesDefaultBranch = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adgb-"));
  tempDirs.push(root);
  execFileSync("git", ["init", "-q", "-b", "develop", root]);
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  if (resolvesDefaultBranch) {
    // Make `detectDefaultBranch` resolve `develop` EXACTLY like the real repo does (an `origin/HEAD`
    // symbolic ref pointing at the develop line). Without this the fixture's `detectDefaultBranch`
    // returns null and `classifyBranch` reports `unreadable` — so the BASELINE-MISMATCH precondition
    // (which only fires on `divergent`) never runs and the defect is invisible. That null shape is
    // precisely what hid this defect in the pre-existing fixtures (gap-goal-branch-catchup-blocked-
    // by-antidrift-baseline-mismatch).
    git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/develop");
  }

  fs.writeFileSync(path.join(root, "base.txt"), "base\n");
  git(root, "add", "base.txt");
  git(root, "commit", "-q", "--no-verify", "-m", "base");

  // develop-only change X — the file the catch-up brings in (outside the task's Touches).
  fs.writeFileSync(path.join(root, "X.txt"), "X\n");
  git(root, "add", "X.txt");
  git(root, "commit", "-q", "--no-verify", "-m", "develop: X (outside Touches)");

  // the goal line forks from BEFORE X — a real goal branch that has not caught up to develop yet.
  git(root, "checkout", "-q", "-b", "goal/GOAL-901", "HEAD~1");
  if (goalOwnChange) {
    // a change a PRIOR task on the goal branch already landed (reachable from the merge target).
    fs.writeFileSync(path.join(root, "W.txt"), "W\n");
    git(root, "add", "W.txt");
    git(root, "commit", "-q", "--no-verify", "-m", "goal: W (a prior task's change)");
  }

  git(root, "checkout", "-q", "-b", `task/${TASK_ID}`);
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(root, "tasks", `${TASK_ID}.md`), taskBody());
  fs.writeFileSync(path.join(root, "Y.txt"), "Y\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "--no-verify", "-m", "task: Y (declared Touches)");
  if (taskOutside) {
    fs.writeFileSync(path.join(root, "Z.txt"), "Z\n");
    git(root, "add", "Z.txt");
    git(root, "commit", "-q", "--no-verify", "-m", "task: Z (NOT declared)");
  }

  git(root, "merge", "-q", "--no-edit", "goal/GOAL-901");
  git(root, "merge", "-q", "--no-edit", "develop");
  return root;
}

function runChecker(root, mergeTarget) {
  return spawnSync(
    process.execPath,
    ["--experimental-strip-types", CHECKER, "--task", TASK_ID, "--worktree", root, "--merge-target", mergeTarget],
    { encoding: "utf8" },
  );
}

// ── AC①: a develop-only file brought in by the catch-up is NOT judged ───────────────────────────────
test("AC① goal merge target — the develop change the catch-up merged in is not judged (pass, X unnamed)", () => {
  const root = makeFixture();
  // Control: the PRE-change base really does surface X (so the assertion below is not vacuous).
  const oldBase = git(root, "diff", "--name-only", "goal/GOAL-901...HEAD").split(/\r?\n/).filter(Boolean);
  assert.ok(oldBase.includes("X.txt"), `fixture must reproduce the bug's base: ${JSON.stringify(oldBase)}`);

  const r = runChecker(root, "goal/GOAL-901");
  assert.equal(r.status, 0, `expected ANTI-DRIFT OK, got exit ${r.status}:\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /ANTI-DRIFT OK/);
  assert.ok(!r.stdout.includes("X.txt"), `the develop-only file X must not appear in the verdict:\n${r.stdout}`);

  // The file set itself (not just the rendered verdict) must exclude X and include the task's own Y.
  const files = computeActualFiles(root, "goal/GOAL-901");
  assert.ok(!files.includes("X.txt"), JSON.stringify(files));
  assert.ok(files.includes("Y.txt"), JSON.stringify(files));
  assert.ok(files.includes(`tasks/${TASK_ID}.md`), JSON.stringify(files));
});

// ── AC②: a file the TASK wrote outside its Touches is still a hard fail naming it ──────────────────
test("AC② goal merge target — the task's own out-of-Touches write still HARD FAILS, naming it", () => {
  const root = makeFixture({ taskOutside: true });
  const r = runChecker(root, "goal/GOAL-901");
  assert.equal(r.status, 1, `expected HARD FAIL, got exit ${r.status}:\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /ANTI-DRIFT HARD FAIL/);
  assert.match(r.stdout, /out-of-declared: task wrote Z\.txt\b/, r.stdout);
  // The bug's false positive must NOT reappear alongside the true one.
  assert.ok(!r.stdout.includes("X.txt"), r.stdout);
});

// ── AC③: `--merge-target develop` is unchanged (same fixture) ──────────────────────────────────────
test("AC③ --merge-target develop keeps the pre-change behavior byte for byte (same fixture)", () => {
  const root = makeFixture({ taskOutside: true });
  // The develop path is literally the old `git diff --name-only develop...HEAD` — assert byte equality.
  const raw = execFileSync(
    "git",
    ["-C", root, "-c", "core.quotepath=false", "diff", "--name-only", "develop...HEAD"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  assert.deepEqual(computeActualFiles(root, "develop"), raw);

  const r = runChecker(root, "develop");
  assert.equal(r.status, 1, `expected the task's own Z to still fail, got exit ${r.status}:\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /out-of-declared: task wrote Z\.txt\b/, r.stdout);
  assert.ok(!r.stdout.includes("X.txt"), `X lives on develop — it is not in the develop...HEAD diff:\n${r.stdout}`);
});

test("AC③ --merge-target develop, no out-of-Touches write ⇒ still OK (unchanged pass path)", () => {
  const root = makeFixture();
  const r = runChecker(root, "develop");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /ANTI-DRIFT OK/);
});

// ── the property that rules out the naive `develop...HEAD` alternative ──────────────────────────────
test("two-line base — a GOAL branch's own prior change does not leak into the task's judged set", () => {
  const root = makeFixture({ goalOwnChange: true });
  // The naive alternative (diff vs develop) WOULD leak the goal's own file W — that is why the base
  // is the commit set (reachable from neither line), not `develop...HEAD`.
  const naive = git(root, "diff", "--name-only", "develop...HEAD").split(/\r?\n/).filter(Boolean);
  assert.ok(naive.includes("W.txt"), `naive base must leak the goal's own change: ${JSON.stringify(naive)}`);

  const files = computeActualFiles(root, "goal/GOAL-901");
  assert.ok(!files.includes("W.txt"), `the goal's own change is not the task's: ${JSON.stringify(files)}`);
  assert.deepEqual(files.sort(), [`tasks/${TASK_ID}.md`, "Y.txt"].sort());
  assert.deepEqual(computeTaskOwnedFiles(root, "goal/GOAL-901").sort(), [`tasks/${TASK_ID}.md`, "Y.txt"].sort());

  const r = runChecker(root, "goal/GOAL-901");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(!r.stdout.includes("W.txt"), r.stdout);
});

// ── the Proposal's conflict-resolution question: how does a CONFLICTING catch-up count? ─────────────
// Decision (recorded in the task's ## Evidence): a catch-up merge commit contributes NO file list of
// its own — `git log --name-only` suppresses merge diffs by default — so the conflict RESOLUTION is
// counted exactly to the extent the task's OWN commits already carry the file. That keeps the judged
// set = "what the task committed", never "what the catch-up happened to touch".
test("conflicting catch-up merge — the task's own file is judged; develop's is still excluded", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adgb-conflict-"));
  tempDirs.push(root);
  execFileSync("git", ["init", "-q", "-b", "develop", root]);
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");

  fs.writeFileSync(path.join(root, "base.txt"), "base\n");
  fs.writeFileSync(path.join(root, "C.txt"), "base\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "--no-verify", "-m", "base");
  // develop changes C.txt AND adds X.txt.
  fs.writeFileSync(path.join(root, "C.txt"), "develop\n");
  fs.writeFileSync(path.join(root, "X.txt"), "X\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "--no-verify", "-m", "develop: C + X");
  // goal forks BEFORE that; the task changes the SAME file C.txt (declared) plus Y.
  git(root, "checkout", "-q", "-b", "goal/GOAL-901", "HEAD~1");
  git(root, "checkout", "-q", "-b", `task/${TASK_ID}`);
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(root, "tasks", `${TASK_ID}.md`), taskBody(["C.txt"]));
  fs.writeFileSync(path.join(root, "C.txt"), "task\n");
  fs.writeFileSync(path.join(root, "Y.txt"), "Y\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "--no-verify", "-m", "task: C + Y");
  git(root, "merge", "-q", "--no-edit", "goal/GOAL-901");
  // the catch-up CONFLICTS on C.txt — resolve it on the task's side and complete the merge.
  const mergeR = spawnSync("git", ["-C", root, "merge", "--no-edit", "develop"], { encoding: "utf8" });
  assert.notEqual(mergeR.status, 0, "fixture must actually conflict on C.txt");
  fs.writeFileSync(path.join(root, "C.txt"), "resolved\n");
  git(root, "add", "C.txt");
  git(root, "commit", "-q", "--no-verify", "--no-edit");

  const files = computeActualFiles(root, "goal/GOAL-901");
  assert.ok(files.includes("C.txt"), `the task's own file must be judged: ${JSON.stringify(files)}`);
  assert.ok(!files.includes("X.txt"), `develop's file must stay excluded: ${JSON.stringify(files)}`);
  const r = runChecker(root, "goal/GOAL-901");
  assert.equal(r.status, 0, `declared C.txt/Y.txt must pass after a conflicting catch-up:\n${r.stdout}${r.stderr}`);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// BASELINE-MISMATCH carve-out — gap-goal-branch-catchup-blocked-by-antidrift-baseline-mismatch (AC1/AC2)
//
// The tests above all run with `detectDefaultBranch` returning null (no origin/HEAD) ⇒ `classifyBranch`
// reports `unreadable`, and the BASELINE-MISMATCH precondition (`state === "divergent"`) NEVER fires.
// That degenerate fixture is why the defect went unseen: in the REAL repo `detectDefaultBranch`
// resolves `develop` (origin/HEAD → origin/develop), so a `goal/*` target that does not contain the
// develop tip is `divergent` — and the pre-fix code hard-failed it (exit 3) BEFORE the two-line base
// could run, even though step 2b (the catch-up) exists for exactly that shape. These tests build the
// resolved-default fixture so the precondition really fires.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** Non-vacuity: the fixture really reproduces the production shape (default branch RESOLVED). */
test("AC2 (取假前提) — the resolved-default fixture really reports the goal line divergent", () => {
  const root = makeFixture({ resolvesDefaultBranch: true });
  assert.equal(detectDefaultBranch(root, { allowCurrentBranch: false }), "develop");
  const cls = classifyBranch(root, "goal/GOAL-901", "develop");
  assert.equal(cls.state, "divergent", `pre-fix trigger must be live: ${cls.detail}`);
  assert.equal(cls.aheadOfDefault, 0, "fresh goal line is a develop ANCESTOR (behind)");
  assert.equal(isProjectGoalLine(root, "goal/GOAL-901"), true);
});

// AC1/AC2: a goal line behind develop ⇒ the carve-out applies ⇒ exit 0 (was exit 3 before the fix).
test("AC1/AC2 — a goal/* merge target behind develop passes (carve-out; exit 0, not BASELINE-MISMATCH)", () => {
  const root = makeFixture({ resolvesDefaultBranch: true });
  const r = runChecker(root, "goal/GOAL-901");
  assert.equal(r.status, 0, `expected the catch-up landing to pass, got exit ${r.status}:\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /ANTI-DRIFT OK/);
  assert.ok(!r.stdout.includes("BASELINE-MISMATCH"), r.stdout);
  // The develop-only file X (brought in by the catch-up) must not be judged, and the two-line base
  // is what produced the pass — not a skipped check.
  assert.ok(!r.stdout.includes("X.txt"), r.stdout);
  // The relaxation is ENUMERATED, not silent (hard rule 3).
  assert.match(r.stdout, /BASELINE: merge target 'goal\/GOAL-901' is a goal line behind the landing baseline/);

  // Direct: the two-line base is used for the goal target (files = the task's own, not the goal's W).
  assert.deepEqual(computeActualFiles(root, "goal/GOAL-901").sort(), [`tasks/${TASK_ID}.md`, "Y.txt"].sort());
});

// AC1: a goal line that ALREADY carries its own landings (a divergent SIBLING of develop) also passes.
// This is the shape every landing AFTER the first one takes — a fix that only accepted a strict
// ancestor would unblock the first landing and re-block the second.
test("AC1 — a goal/* line WITH its own landed commits (divergent sibling) still passes", () => {
  const root = makeFixture({ resolvesDefaultBranch: true, goalOwnChange: true });
  // Premise: this shape IS divergent and is NOT a strict ancestor (ahead > 0) — the harder half.
  const cls = classifyBranch(root, "goal/GOAL-901", "develop");
  assert.equal(cls.state, "divergent", cls.detail);
  assert.ok(cls.aheadOfDefault > 0, `expected the goal's own landed commit, got ahead=${cls.aheadOfDefault}`);
  assert.equal(isProjectGoalLine(root, "goal/GOAL-901"), true);

  const r = runChecker(root, "goal/GOAL-901");
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}:\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /ANTI-DRIFT OK/);
  // The goal's own prior landing W is not this task's write and must stay out of the judged set.
  assert.ok(!r.stdout.includes("W.txt"), r.stdout);
});

// AC1: the relaxation is goal-SPECIFIC — a non-goal branch behind develop still fail-closes.
test("AC1 — a NON-goal branch behind develop still reports BASELINE-MISMATCH (exit 3)", () => {
  const root = makeFixture({ resolvesDefaultBranch: true });
  git(root, "branch", "release/old", "develop~1"); // an ancestor line, but NOT a goal line
  assert.equal(isProjectGoalLine(root, "release/old"), false);
  const r = runChecker(root, "release/old");
  assert.equal(r.status, 3, `expected BASELINE-MISMATCH, got ${r.status}:\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /BASELINE-MISMATCH/);
  assert.match(r.stdout, /'release\/old' is not a continuation/);
});

// AC1: a goal-NAMED but FOREIGN (unrelated-root) fork must still fail-closed — the carve-out is not a
// name match (hard rule 3b: an unreadable/unrelated line is not "a goal line we couldn't judge").
test("AC1 — a goal-NAMED unrelated-root fork still fail-closes (exit 3)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adgb-orphan-"));
  tempDirs.push(root);
  execFileSync("git", ["init", "-q", "-b", "develop", root]);
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/develop");
  fs.writeFileSync(path.join(root, "base.txt"), "base\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "--no-verify", "-m", "base");
  // an ORPHAN line named exactly like a goal branch — shares NO ancestry with develop.
  git(root, "checkout", "-q", "--orphan", "goal/GOAL-999");
  fs.writeFileSync(path.join(root, "foreign.txt"), "unrelated\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "--no-verify", "-m", "unrelated root");
  git(root, "checkout", "-q", "-b", `task/${TASK_ID}`, "goal/GOAL-999");
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(root, "tasks", `${TASK_ID}.md`), taskBody());
  fs.writeFileSync(path.join(root, "Y.txt"), "Y\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "--no-verify", "-m", "task work");
  git(root, "merge", "-q", "--no-edit", "--allow-unrelated-histories", "develop"); // a catch-up that can never connect the lines

  assert.equal(isProjectGoalLine(root, "goal/GOAL-999"), false, "no merge base ⇒ not a project goal line");
  const r = runChecker(root, "goal/GOAL-999");
  assert.equal(r.status, 3, `expected BASELINE-MISMATCH, got ${r.status}:\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /BASELINE-MISMATCH/);
});

