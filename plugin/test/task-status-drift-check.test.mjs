// @test-group governance
// task-status-drift-check.test.mjs — the closeout detector for direct (fast-mode) execution
// (tasks/gap-task-status-closeout-not-mechanized). The detector reports tasks whose AC-declared
// symbols already resolve in the codebase while status is still todo/ready — the "board lies"
// drift where landed code + stale status re-dispatches already-done work. It ALSO reports
// reverse-drift (status done but the implementation never landed), with the code-root Touches
// partition that keeps fast-mode bookkeeping noise out (tasks/gap-reverse-drift-check-buries-true-positives-in-noise),
// and closed-without-work (status done but 0 ACs checked — the DANGEROUS drift direction where
// status is written directly, bypassing the gate; tasks/gap-drift-check-only-looks-at-the-harmless-direction).
//
// AC1 mirror byte-identity · AC2 zero false positives on genuinely-unlanded tasks (real store)
// AC3 synthetic all-symbols-exist → suspect · AC4 synthetic no-symbols → nothing
// AC5 exits 0 always · AC6 never writes tasks/** · AC7 --json shape.
// Reverse-drift ACs: AC3 code/bookkeeping partition named · AC4 code-root .some() judgment
// AC5 threshold 1/2 pinned by 1/4 fixture · AC6 fail-closed zero/bookkeeping-only Touches.
// Closed-without-work ACs: AC2 live-specimen fixture (done + 0 AC checked + Touches not in tree)
// → reported · AC3 reverse negative (done + complete evidence) → not reported · AC5 each record
// names the missing evidence.
//
// Run: scripts/test.sh plugin/test/task-status-drift-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import {
  extractSymbolCandidates,
  resolveSymbol,
  touchesAllExist,
  scanTasks,
  formatJsonReport,
  findRepoRoot,
  isDistinctiveName,
  parseTouchEntries,
  isBookkeepingTouchEntry,
  isCodeTouchEntry,
  hasAnyCodeRootTouch,
  hasDoneChildren,
  countAcCheckboxes,
  formatClosedText,
  REVERSE_SYMBOL_RATIO_MAX,
  BOOKKEEPING_ROOTS,
  listWorkBranches,
  classifyBranch,
  strandedBranches,
  entriesInBranchDiff,
  formatStrandedText,
} from "../../experiments/quay-perpetual-stream/scripts/task-status-drift-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

// Real-store scans grep the whole codebase per task (~47s for 553 tasks) — NOT something CI should
// run every time (dev-session-handoff §4). The real-store assertions (AC2, the CLI smoke tests) are
// opt-in via QUAY_TEST_REAL_STORE=1; CI runs only the fast fixture cases by default.
const REAL_STORE_ENABLED = process.env.QUAY_TEST_REAL_STORE === "1";

// A git-rooted synthetic workspace the CLI can run in (findRepoRoot walks up to `.git`), so the CLI
// exit-0 / --json tests scan a tiny fixture store, not the real 553-task store.
function makeGitWorkspace(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `drift-cli-${tag}-`));
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, "code"), { recursive: true });
  fs.writeFileSync(path.join(dir, "tasks", "fixture-landed.md"), LANDED_TASK);
  fs.writeFileSync(path.join(dir, "code", "landed-symbol.ts"), "export function distinctiveLandedMarker() {}\nexport function _internalLandedHelper() {}\n");
  return dir;
}

// ── fixtures ──────────────────────────────────────────────────────────────────────────────────────

function makeWorkspace(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `drift-${tag}-`));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, "code"), { recursive: true });
  return dir;
}

// status defaults to todo for the forward-drift fixtures; done tasks go to the reverse-drift path.
function makeTask(id, acBody, touchesBody, status = "todo", children = []) {
  const childrenBlock = children.length > 0
    ? `children:\n${children.map((c) => `  - ${c}`).join("\n")}\n`
    : "children: []\n";
  return `---
id: ${id}
title: fixture ${id}
status: ${status}
labels: [test]
${childrenBlock}---

## Acceptance Criteria

${acBody}

## Touches

${touchesBody}
`;
}

const LANDED_TASK = makeTask(
  "fixture-landed",
  "- [ ] AC1: call `distinctiveLandedMarker` in the landed implementation\n- [ ] AC2: `_internalLandedHelper` handles the boundary",
  "- code/landed-symbol.ts"
);

const UNLANDED_TASK = makeTask(
  "fixture-unlanded",
  "- [ ] AC1: call `noSuchMarkerAnywhereXYZ` in the future implementation\n- [ ] AC2: `_alsoNotPresentAnywhere` handles the boundary",
  "- code/ghost.ts"
);

// A done task whose AC symbols are all ghosts and whose Touches has NO code-root entry — the exact
// reverse-drift shape the detector must STILL catch after the fast-mode relaxation (AC2-intent).
const REVERSE_UNLANDED_TASK = makeTask(
  "fixture-reverse-unlanded",
  "- [ ] AC1: `revGhostOneXYZ` and `_revGhostTwo` never landed\n- [ ] AC2: `_revGhostThree` also absent",
  "- code/ghost.ts",
  "done"
);

// ── closed-without-work fixtures (gap-drift-check-only-looks-at-the-harmless-direction) ───────────
// AC2 LIVE-SPECIMEN reproduction: `gap-no-e2e-proves-install-is-configuration-driven` was once
// `status: done` with 8 ACs ALL unchecked and its Touches files only on an unmerged branch — the
// shape the old scan (todo/ready only) reported nothing for. This fixture reproduces that historical
// state: done + 0 AC checked + Touches files NOT in the tree. Must be reported as closed-without-work.
const SPECIMEN_TASK = makeTask(
  "fixture-specimen",
  "- [ ] AC1: `installConfigDrivenE2E` lands and is RED first\n- [ ] AC2: `antiPassThroughCheck` requires laid-down count > 0\n- [ ] AC3: `renderSubstitutionFree` byte-identical across workspaces\n- [ ] AC4: `upgradePreservesState` keeps tick-log readable\n- [ ] AC5: `findingWithoutPlan` passes author→ready\n- [ ] AC6: `bothInstallsFailNegativeControl` stays red\n- [ ] AC7: `derivedTestCommand` differs (npm test vs go test)\n- [ ] AC8: `nodeTestGovernance` test-group",
  "- packages/quay/test/install-config-driven-e2e.test.mjs\n- plugin/scripts/quay-init.sh\n- orchestration/GOAL-when-to-reinstall.md",
  "done"
);

// AC3 REVERSE NEGATIVE: done + COMPLETE evidence (every AC checked + Touches file in the tree).
// Must NOT be reported by ANY drift direction (not closed-without-work, not reverse-drift).
const COMPLETE_DONE_TASK = makeTask(
  "fixture-complete",
  "- [x] AC1: `distinctiveLandedMarker` in the landed implementation\n- [x] AC2: `_internalLandedHelper` handles the boundary",
  "- code/landed-symbol.ts",
  "done"
);

// ── stranded-branch check helpers (REAL git repos — two-way negative control) ────────────────────
function git(repoDir, ...args) {
  return execFileSync("git", args, { cwd: repoDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function makeRealGitRepo(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `drift-git-${tag}-`));
  git(dir, "init", "-b", "master", "-q", ".");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test");
  fs.writeFileSync(path.join(dir, "base.txt"), "base\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "init");
  return dir;
}

/** Create branch <branch> at current HEAD, commit <file> onto it, return to master. */
function commitFile(repoDir, branch, file, content, msg) {
  git(repoDir, "checkout", "-q", "-b", branch);
  fs.writeFileSync(path.join(repoDir, file), content);
  git(repoDir, "add", ".");
  git(repoDir, "commit", "-q", "-m", msg);
  git(repoDir, "checkout", "-q", "master");
}

// ── stranded-branch check (gap-stranded-worktree-branches-have-no-alarm-channel) ────────────────
// The acceptance is a TWO-WAY NEGATIVE CONTROL (outer re-scope 2026-08-03): a fabricated branch ahead
// of master MUST be reported; deleting it MUST un-report. The current real repo is NOT the expected
// value (only the human-retained M239 exception remains there). Criterion = the three-gate logic from
// gap-reclaim-21-merged-worktrees-and-fix-my-bad-criterion, reused verbatim.

test("stranded: a fabricated branch ahead of master is REPORTED; deleting it un-reports (two-way negative control)", () => {
  const repo = makeRealGitRepo("neg");
  try {
    assert.deepEqual(strandedBranches(repo), [], "no milestone/task branches → nothing stranded");
    commitFile(repo, "milestone/M222/iteration-0", "work.ts", "work\n", "stranded work");
    const stranded = strandedBranches(repo);
    assert.equal(stranded.length, 1, "fabricated ahead branch must be reported");
    assert.equal(stranded[0].branch, "milestone/M222/iteration-0");
    assert.equal(stranded[0].classification, "has-commits");
    assert.equal(stranded[0].aheadCount, 1);
    assert.equal(stranded[0].insertions, 1, "three-dot shortstat insertions");
    assert.ok(stranded[0].lastCommitDate, "last commit date present");
    // Negative control: delete the branch → nothing reported.
    git(repo, "branch", "-D", "milestone/M222/iteration-0");
    assert.deepEqual(strandedBranches(repo), [], "deleting the branch un-reports it");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("stranded: merged-clean is NOT reported; merged-then-reverted IS (Gate 2 — merge-added files missing from master)", () => {
  const repo = makeRealGitRepo("gate2");
  try {
    // Merged cleanly with --no-ff → the branch is an ancestor AND its merge-added file still exists.
    commitFile(repo, "milestone/M10/iteration-0", "m10.ts", "m10\n", "m10 work");
    git(repo, "merge", "--no-ff", "milestone/M10/iteration-0", "-m", "merge M10", "-q");
    // Merged then reverted → still an ancestor, but the merge-added file is gone from master.
    commitFile(repo, "milestone/M11/iteration-0", "m11.ts", "m11\n", "m11 work");
    git(repo, "merge", "--no-ff", "milestone/M11/iteration-0", "-m", "merge M11", "-q");
    git(repo, "revert", "-m", "1", "--no-edit", "HEAD");
    const stranded = strandedBranches(repo);
    assert.deepEqual(stranded.map((s) => s.branch), ["milestone/M11/iteration-0"],
      "merged-clean M10 absent; merged-then-reverted M11 present");
    assert.equal(stranded[0].classification, "merged-then-reverted");
    assert.ok(stranded[0].detail.includes("m11.ts"), "detail names the missing merge-added file");
    // The revert signal must survive master ADVANCING past the branch (the old two-dot-diff bug):
    // advance master with an unrelated commit, then re-check — M11 is still merged-then-reverted.
    fs.writeFileSync(path.join(repo, "later.txt"), "later\n");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "master advances past the branch");
    const after = strandedBranches(repo);
    assert.equal(after.length, 1, "master advancing must not hide merged-then-reverted");
    assert.equal(after[0].classification, "merged-then-reverted");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("stranded: a worktree with uncommitted changes is reported (Gate 3), still exit-friendly", () => {
  const repo = makeRealGitRepo("gate3");
  const wt = path.join(os.tmpdir(), `drift-git-wt-${Date.now()}`);
  fs.rmSync(wt, { recursive: true, force: true });
  try {
    git(repo, "checkout", "-qb", "task/foo");
    git(repo, "checkout", "-q", "master");
    git(repo, "worktree", "add", "-q", wt, "task/foo");
    fs.writeFileSync(path.join(wt, "dirty.ts"), "uncommitted\n");
    const stranded = strandedBranches(repo);
    assert.equal(stranded.length, 1);
    assert.equal(stranded[0].branch, "task/foo");
    assert.equal(stranded[0].classification, "has-uncommitted");
    assert.equal(stranded[0].aheadCount, 0, "a dirty worktree branch is still zero-ahead");
    assert.ok(stranded[0].detail.includes("dirty.ts"), "detail names the uncommitted file");
    // Once committed inside the worktree, the branch has commits ahead → has-commits, not uncommitted.
    git(repo, "-C", wt, "add", "dirty.ts");
    git(repo, "-C", wt, "commit", "-q", "-m", "commit the dirty work");
    const stranded2 = strandedBranches(repo);
    assert.equal(stranded2[0].classification, "has-commits", "committed work ahead → has-commits");
  } finally {
    try { git(repo, "worktree", "remove", wt, "--force"); } catch (_) { /* best-effort */ }
    fs.rmSync(wt, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("stranded: listWorkBranches scopes to milestone/* and task/* (no legacy experiment-* noise)", () => {
  const repo = makeRealGitRepo("scope");
  try {
    commitFile(repo, "milestone/M9/iteration-0", "a.ts", "a\n", "milestone work");
    commitFile(repo, "task/gap-something", "b.ts", "b\n", "task work");
    // A legacy branch name that is NOT a live worktree namespace must NOT be reported.
    commitFile(repo, "experiment-4-iteration-13", "c.ts", "c\n", "legacy");
    const names = listWorkBranches(repo).sort();
    assert.deepEqual(names, ["milestone/M9/iteration-0", "task/gap-something"]);
    const stranded = strandedBranches(repo);
    assert.deepEqual(stranded.map((s) => s.branch).sort(), ["milestone/M9/iteration-0", "task/gap-something"]);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("formatStrandedText: clean → one-line; stranded → per-branch lines with classification", () => {
  assert.match(formatStrandedText([]), /no stranded worktree branches/);
  const out = formatStrandedText([
    { branch: "milestone/M239/iteration-0", classification: "has-commits", aheadCount: 2, insertions: 6901, lastCommitDate: "2026-08-01T00:00:00Z" },
  ]);
  assert.match(out, /milestone\/M239\/iteration-0/);
  assert.match(out, /has-commits/);
  assert.match(out, /2 commit\(s\) ahead/);
  assert.match(out, /\+6901 lines/);
});

test("AC6 (stranded): done task whose Touches file exists only on a stranded branch → stranded-not-merged, NOT reverse-drift", () => {
  const repo = makeRealGitRepo("ac6");
  try {
    fs.mkdirSync(path.join(repo, "code"), { recursive: true });
    fs.mkdirSync(path.join(repo, "tasks"), { recursive: true });
    // The stranded branch holds the task's code; master does not.
    commitFile(repo, "milestone/M243/iteration-0", "code/impl.ts", "export function strandedMarkerXYZ() {}\n", "DIR-124-A2 work");
    const task = makeTask(
      "fixture-stranded",
      "- [ ] AC1: call `strandedMarkerXYZ` in the implementation",
      "- code/impl.ts",
      "done"
    );
    fs.writeFileSync(path.join(repo, "tasks", "fixture-stranded.md"), task);
    const stranded = strandedBranches(repo);
    const { reverse, strandedTasks } = scanTasks({
      repoRoot: repo, roots: [path.join(repo, "code")], strandedBranches: stranded,
    });
    assert.equal(reverse.length, 0, "code on a stranded branch is NOT reverse-drift (never landed)");
    assert.equal(strandedTasks.length, 1, "it IS stranded-not-merged");
    assert.equal(strandedTasks[0].taskId, "fixture-stranded");
    assert.equal(strandedTasks[0].branch, "milestone/M243/iteration-0");
    // Negative control: merge the branch → code now on master → NOT flagged at all.
    git(repo, "merge", "--no-ff", "milestone/M243/iteration-0", "-m", "merge M243", "-q");
    const { reverse: r2, strandedTasks: s2 } = scanTasks({
      repoRoot: repo, roots: [path.join(repo, "code")], strandedBranches: strandedBranches(repo),
    });
    assert.equal(r2.length, 0, "merged → no reverse-drift");
    assert.equal(s2.length, 0, "merged → no stranded-not-merged");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("AC6 (stranded): entriesInBranchDiff matches the branch's DIVERGENT files, not inherited ones (no cat-file false positive)", () => {
  const repo = makeRealGitRepo("diff");
  try {
    fs.mkdirSync(path.join(repo, "code"), { recursive: true });
    // code/committed.ts is committed ON the branch (ahead of master) → in the divergent diff.
    commitFile(repo, "milestone/M9/iteration-0", "code/committed.ts", "x\n", "committed");
    assert.ok(entriesInBranchDiff(repo, ["code/committed.ts"], "milestone/M9/iteration-0"),
      "branch-committed file is in the divergent diff");
    assert.equal(entriesInBranchDiff(repo, ["base.txt"], "milestone/M9/iteration-0"), false,
      "a file inherited from the base (in the branch tree but NOT divergent) must NOT match — the cat-file false-positive class");
    assert.equal(entriesInBranchDiff(repo, ["code/ghost.ts"], "milestone/M9/iteration-0"), false,
      "absent file does not match");
    assert.equal(entriesInBranchDiff(repo, ["code/*.ts"], "milestone/M9/iteration-0"), false,
      "globs are skipped (exact-path signal only)");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("CLI --stranded: prints stranded branches and exits 0 (report-only, never a gate)", () => {
  const cli = path.join(REPO_ROOT, "plugin", "scripts", "task-status-drift-check.ts");
  const repo = makeRealGitRepo("cli");
  try {
    let out = execFileSync("node", ["--experimental-strip-types", cli, "--stranded"], {
      cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    assert.match(out, /no stranded worktree branches/, "clean repo → no-stranded line");
    commitFile(repo, "milestone/M9/iteration-0", "work.ts", "w\n", "stranded");
    out = execFileSync("node", ["--experimental-strip-types", cli, "--stranded"], {
      cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    assert.match(out, /milestone\/M9\/iteration-0/, "stranded branch appears in output");
    assert.match(out, /has-commits/, "classification appears");
    const jsonOut = execFileSync("node", ["--experimental-strip-types", cli, "--stranded", "--json"], {
      cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    const parsed = JSON.parse(jsonOut);
    assert.deepEqual(Object.keys(parsed), ["stranded"]);
    assert.equal(parsed.stranded.length, 1);
    assert.equal(parsed.stranded[0].classification, "has-commits");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// ── AC1: both mirrors byte-identical ─────────────────────────────────────────────────────────────

test("AC1: experiments and plugin mirrors are byte-identical", () => {
  const a = fs.readFileSync(path.join(REPO_ROOT, "experiments", "quay-perpetual-stream", "scripts", "task-status-drift-check.ts"), "utf8");
  const b = fs.readFileSync(path.join(REPO_ROOT, "plugin", "scripts", "task-status-drift-check.ts"), "utf8");
  assert.equal(a, b, "mirrors must be byte-identical");
});

// ── pure extraction ──────────────────────────────────────────────────────────────────────────────

test("extractSymbolCandidates: distinctive names yes, generic words / file basenames no", () => {
  const cands = extractSymbolCandidates(
    "Call `_splitCheck()` and `planCheckNextAction`, then `BuildEvidenceGate`. " +
    "Do not touch `findings`, `quay`, `test`, `loader.ts`; `task_write` is a generic API."
  );
  assert.ok(cands.includes("_splitCheck"), "call-parens stripped, underscore internal kept");
  assert.ok(cands.includes("planCheckNextAction"), "camelCase kept");
  assert.ok(cands.includes("BuildEvidenceGate"), "PascalCase kept");
  // Generic single words and file basenames are weak signals — never candidates.
  for (const noise of ["findings", "quay", "test", "loader.ts"]) {
    assert.ok(!cands.includes(noise), `generic/basename must not be a candidate: ${noise}`);
  }
  // Compound identifiers like `task_write` ARE name-distinctive; the resolve stage's frequency
  // filter (≤8 files) is what keeps over-recurring infrastructure words from resolving.
  assert.ok(cands.includes("task_write"), "task_write is a candidate by name; resolveSymbol freq-filters it");
  assert.equal(resolveSymbol("task_write", findRepoRoot(process.cwd())), false, "task_write recurs across many files → must not resolve");
});

test("isDistinctiveName: multi-part identifiers only", () => {
  assert.ok(isDistinctiveName("planCheckNextAction"));
  assert.ok(isDistinctiveName("_splitCheck"));
  assert.ok(isDistinctiveName("BuildEvidenceGate"));
  assert.ok(!isDistinctiveName("findings"));
  assert.ok(!isDistinctiveName("quay"));
  assert.ok(!isDistinctiveName("test"));
});

// ── AC3 (forward) / AC4 (forward): synthetic fixture workspaces ──────────────────────────────────

test("AC3: fixture task whose declared symbols all exist → reports status-drift-suspect", () => {
  const ws = makeWorkspace("ac3");
  try {
    fs.writeFileSync(path.join(ws, "code", "landed-symbol.ts"), "export function distinctiveLandedMarker() {}\nexport function _internalLandedHelper() {}\n");
    fs.writeFileSync(path.join(ws, "tasks", "fixture-landed.md"), LANDED_TASK);

    const { suspects } = scanTasks({ repoRoot: ws, roots: [path.join(ws, "code")] });
    const hit = suspects.find((s) => s.taskId === "fixture-landed");
    assert.ok(hit, "fixture-landed should be a status-drift-suspect");
    assert.ok(hit.matchedSymbols.includes("distinctiveLandedMarker"), "marker symbol must be reported");
    assert.equal(hit.touchesAllExist, true);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC4: fixture task whose symbols do not exist → reports nothing", () => {
  const ws = makeWorkspace("ac4");
  try {
    fs.writeFileSync(path.join(ws, "code", "landed-symbol.ts"), "export function distinctiveLandedMarker() {}\n");
    fs.writeFileSync(path.join(ws, "tasks", "fixture-unlanded.md"), UNLANDED_TASK);

    const { suspects } = scanTasks({ repoRoot: ws, roots: [path.join(ws, "code")] });
    const hit = suspects.find((s) => s.taskId === "fixture-unlanded");
    assert.equal(hit, undefined, "fixture-unlanded must NOT be flagged (symbols absent)");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── reverse-drift AC3: code-root / bookkeeping partition is a named constant + predicates ─────────

test("AC3 (reverse): code-root / bookkeeping partition is a named constant + predicates", () => {
  assert.ok(Array.isArray(BOOKKEEPING_ROOTS) && BOOKKEEPING_ROOTS.length >= 4, "BOOKKEEPING_ROOTS named constant exists");
  // Bookkeeping roots: pipeline artifacts a fast-mode task never produces.
  for (const b of ["milestones/M1/x.json", "docs/plans/M1.md", ".quay/config.yml", "receipts/x.json", "tasks/DIR-1.md"]) {
    assert.equal(isBookkeepingTouchEntry(b), true, `${b} is bookkeeping`);
    assert.equal(isCodeTouchEntry(b), false, `${b} is not code`);
  }
  // Code/implementation roots: packages, plugin code+tests, experiments code+tests, scripts,
  // orchestration/, docs/ outside docs/plans (a fast-mode doc/metric task's implementation surface).
  for (const c of [
    "packages/quay/src/x.ts", "plugin/scripts/x.ts", "plugin/test/x.test.mjs",
    "experiments/quay-perpetual-stream/scripts/x.ts", "experiments/quay-perpetual-stream/test/x.test.mjs",
    "scripts/x.sh", "orchestration/x.md", "docs/x.md", ".claude/workflows/execute-milestone.js",
  ]) {
    assert.equal(isBookkeepingTouchEntry(c), false, `${c} is not bookkeeping`);
    assert.equal(isCodeTouchEntry(c), true, `${c} is code`);
  }
});

// ── reverse-drift: parseTouchEntries annotation stripping ────────────────────────────────────────

test("parseTouchEntries strips backticks and trailing (…) annotations (both forms)", () => {
  const section = "- `code/foo.ts` (extract from)\n"
    + "- `code/bar.ts (new)`\n"
    + "- code/baz.ts (update imports)\n"
    + "- code/plain.ts\n"
    + "- `experiments/quay-perpetual-stream/scripts/*run-identity*`";
  assert.deepEqual(parseTouchEntries(section), [
    "code/foo.ts", "code/bar.ts", "code/baz.ts", "code/plain.ts",
    "experiments/quay-perpetual-stream/scripts/*run-identity*",
  ]);
  assert.deepEqual(parseTouchEntries(null), []);
  assert.deepEqual(parseTouchEntries(""), []);
});

// ── reverse-drift AC4: hasAnyCodeRootTouch (code-root .some() evidence) ─────────────────────────

test("hasAnyCodeRootTouch: any code-root entry exists → true; bookkeeping-only/missing → false", () => {
  const ws = makeWorkspace("rt");
  try {
    fs.writeFileSync(path.join(ws, "code", "landed.ts"), "// landed");
    // At least one code-root entry exists → implementation evidence present.
    assert.equal(hasAnyCodeRootTouch("- code/landed.ts\n- docs/plans/M1.md\n- milestones/M1/x.json", ws), true);
    // All code-root entries absent → no evidence (reverse-drift candidate).
    assert.equal(hasAnyCodeRootTouch("- code/ghost.ts\n- docs/plans/M1.md", ws), false);
    // Bookkeeping-only entries → fail-closed, zero code evidence (AC6).
    assert.equal(hasAnyCodeRootTouch("- docs/plans/M1.md\n- milestones/M1/x.json", ws), false);
    // Section parses to zero entries → fail-closed (AC6).
    assert.equal(hasAnyCodeRootTouch("\nJust a paragraph, no bullets.\n", ws), false);
    // No Touches section → no evidence.
    assert.equal(hasAnyCodeRootTouch(null, ws), false);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── reverse-drift AC5: threshold pinned by a 1/4-resolved fixture ────────────────────────────────

test("AC5 (reverse): 1/4-resolved unlanded done task is STILL reverse-flagged (threshold < 1/2)", () => {
  const ws = makeWorkspace("ac5");
  try {
    // Exactly ONE of four declared symbols resolves (1/4 < REVERSE_SYMBOL_RATIO_MAX = 0.5), and the
    // task's only code-root Touches entry does not exist → must still be reverse-drift. This pins
    // the threshold: the relaxation must not let a mostly-unresolved never-landed task through.
    fs.writeFileSync(path.join(ws, "code", "landed-symbol.ts"), "export function distinctiveLandedMarker() {}\n");
    const task = makeTask(
      "fixture-rev-1of4",
      "- [ ] AC1: `distinctiveLandedMarker` resolves (1/4)\n"
      + "- [ ] AC2: `revGhostOneXYZ` absent\n"
      + "- [ ] AC3: `revGhostTwoXYZ` absent\n"
      + "- [ ] AC4: `revGhostThreeXYZ` absent",
      "- code/ghost.ts",
      "done"
    );
    fs.writeFileSync(path.join(ws, "tasks", "fixture-rev-1of4.md"), task);

    const { reverse } = scanTasks({ repoRoot: ws, roots: [path.join(ws, "code")] });
    const hit = reverse.find((r) => r.taskId === "fixture-rev-1of4");
    assert.ok(hit, "1/4-resolved unlanded done task must be reverse-flagged");
    assert.equal(hit.matchedSymbols.length, 1, "exactly 1 of 4 symbols resolves");
    assert.equal(hit.totalSymbols, 4);
    assert.equal(hit.codeTouchExists, false);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC5 (reverse): 2/4-resolved task is NOT reverse-flagged (0.5 is not < 0.5 boundary)", () => {
  const ws = makeWorkspace("ac5b");
  try {
    fs.writeFileSync(path.join(ws, "code", "landed-symbol.ts"), "export function distinctiveLandedMarker() {}\n");
    fs.writeFileSync(path.join(ws, "code", "second.ts"), "export function _revGhostTwoResolved() {}\n");
    const task = makeTask(
      "fixture-rev-2of4",
      "- [ ] AC1: `distinctiveLandedMarker` resolves (1/4)\n"
      + "- [ ] AC2: `_revGhostTwoResolved` resolves (2/4)\n"
      + "- [ ] AC3: `revGhostThreeXYZ` absent\n"
      + "- [ ] AC4: `revGhostFourXYZ` absent",
      "- code/ghost.ts",
      "done"
    );
    fs.writeFileSync(path.join(ws, "tasks", "fixture-rev-2of4.md"), task);

    const { reverse } = scanTasks({ repoRoot: ws, roots: [path.join(ws, "code")] });
    const hit = reverse.find((r) => r.taskId === "fixture-rev-2of4");
    assert.equal(hit, undefined, "2/4 = 0.5 is not < 0.5 → must NOT be reverse-flagged");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC5: REVERSE_SYMBOL_RATIO_MAX is 0.5 and its source comment agrees (no stale 'NONE resolve')", () => {
  assert.equal(REVERSE_SYMBOL_RATIO_MAX, 0.5, "threshold pinned at 0.5");
  const src = fs.readFileSync(
    path.join(REPO_ROOT, "experiments", "quay-perpetual-stream", "scripts", "task-status-drift-check.ts"),
    "utf8"
  );
  const nearConst = src.split("REVERSE_SYMBOL_RATIO_MAX =")[0];
  assert.match(nearConst, /FEWER than half/i, "comment must say 'fewer than half' (matches < 0.5 impl)");
  assert.ok(!/NONE of them resolve/i.test(src), "stale 'NONE resolve' phrasing must be gone");
});

// ── reverse-drift AC1/AC4: code-root Touches landed → NOT flagged (fast-mode relaxation) ─────────

test("AC1 (reverse): done task with landed code-root Touches + missing bookkeeping is NOT flagged", () => {
  const ws = makeWorkspace("ac1r");
  try {
    fs.writeFileSync(path.join(ws, "code", "run-identity.ts"), "export interface RunIdentity {}\n");
    // B1 shape: code-root globs all exist; bookkeeping (milestones/**, docs/plans/**, .quay/**,
    // tasks/**) is absent — fast mode never produces it. The reverse-drift judgment must ignore the
    // missing bookkeeping and see the landed code.
    const task = makeTask(
      "fixture-rev-b1",
      "- [ ] AC1: `RunIdentity` is the single identity entry point\n- [ ] AC2: `_runIdDerivation` never landed",
      "- code/run-identity.ts\n- docs/plans/M-x.md\n- milestones/M1/preparation.json\n- tasks/fixture-rev-b1.md",
      "done"
    );
    fs.writeFileSync(path.join(ws, "tasks", "fixture-rev-b1.md"), task);

    const { reverse } = scanTasks({ repoRoot: ws, roots: [path.join(ws, "code")] });
    assert.equal(reverse.length, 0, "landed code-root touch → must NOT be reverse-flagged (AC1)");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── reverse-drift AC6: fail-closed zero / bookkeeping-only Touches ──────────────────────────────

test("AC6 (reverse): zero-entry Touches section is still fail-closed (never relaxed)", () => {
  const ws = makeWorkspace("ac6z");
  try {
    const task = makeTask(
      "fixture-rev-zero",
      "- [ ] AC1: `revGhostZeroXYZ` absent\n- [ ] AC2: `_revGhostZeroTwo` absent",
      "\nA Touches section that claims no paths proves nothing.\n",
      "done"
    );
    fs.writeFileSync(path.join(ws, "tasks", "fixture-rev-zero.md"), task);

    const { reverse } = scanTasks({ repoRoot: ws, roots: [path.join(ws, "code")] });
    const hit = reverse.find((r) => r.taskId === "fixture-rev-zero");
    assert.ok(hit, "zero-entry Touches → fail-closed → must be reverse-flagged (AC6)");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC6 (reverse): bookkeeping-only Touches is still fail-closed (never relaxed)", () => {
  const ws = makeWorkspace("ac6b");
  try {
    // Touches lists ONLY bookkeeping paths (docs/plans + milestones + the task's own file) — zero
    // code-root entries. A leaf (no children) task like this provides no implementation evidence →
    // fail-closed reverse-drift.
    const task = makeTask(
      "fixture-rev-book",
      "- [ ] AC1: `revGhostBookXYZ` absent\n- [ ] AC2: `_revGhostBookTwo` absent",
      "- docs/plans/M-x.md\n- milestones/M1/preparation.json\n- tasks/fixture-rev-book.md",
      "done"
    );
    fs.writeFileSync(path.join(ws, "tasks", "fixture-rev-book.md"), task);

    const { reverse } = scanTasks({ repoRoot: ws, roots: [path.join(ws, "code")] });
    const hit = reverse.find((r) => r.taskId === "fixture-rev-book");
    assert.ok(hit, "bookkeeping-only Touches → fail-closed → must be reverse-flagged (AC6)");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC6 (reverse): no ## Touches section stays un-judgeable → NOT flagged (preserved)", () => {
  const ws = makeWorkspace("ac6n");
  try {
    // A done task with NO ## Touches heading at all and unresolved symbols. The OLD detector
    // deliberately treated no-Touches as un-judgeable and skipped it; flagging pre-convention done
    // tasks is noise (measured: DIR-044, DIR-073, exp5-DEFECT-* all have landed code but no
    // Touches). Preserved — note this differs from an EMPTY Touches section (heading present, zero
    // bullets), which IS fail-closed per AC6.
    const noTouchesTask = `---
id: fixture-rev-nosection
title: fixture no-touches
status: done
labels: [test]
children: []
---

## Acceptance Criteria

- [ ] AC1: \`revGhostNoSectionXYZ\` absent
- [ ] AC2: \`_revGhostNoSectionTwo\` absent
`;
    fs.writeFileSync(path.join(ws, "tasks", "fixture-rev-nosection.md"), noTouchesTask);

    const { reverse } = scanTasks({ repoRoot: ws, roots: [path.join(ws, "code")] });
    assert.equal(reverse.length, 0, "no Touches section → un-judgeable → must NOT be reverse-flagged");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC6 (reverse): done parent whose children are all done is NOT reverse-flagged", () => {
  const ws = makeWorkspace("ac6p");
  try {
    // DIR-126 shape: a parent directive whose Touches delegates to its (all-done) children. Its
    // implementation IS the children's work, so it is not "implementation never landed".
    const parent = makeTask(
      "fixture-rev-parent",
      "- [ ] AC1: `ProposalReviewGhostXYZ` absent\n- [ ] AC2: `_ProposalAuthorsGhost` absent",
      "- tasks/fixture-rev-parent.md",
      "done",
      ["fixture-rev-child"]
    );
    const child = makeTask("fixture-rev-child", "- [ ] AC1: real work", "- code/child.ts", "done");
    fs.writeFileSync(path.join(ws, "tasks", "fixture-rev-parent.md"), parent);
    fs.writeFileSync(path.join(ws, "tasks", "fixture-rev-child.md"), child);
    fs.writeFileSync(path.join(ws, "code", "child.ts"), "// child landed");

    const { reverse } = scanTasks({ repoRoot: ws, roots: [path.join(ws, "code")] });
    assert.equal(reverse.length, 0, "done parent with all-done children → must NOT be reverse-flagged");
    assert.equal(hasDoneChildren(parent, path.join(ws, "tasks")), true, "hasDoneChildren recognizes the pattern");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── closed-without-work — the DANGEROUS direction (gap-drift-check-only-looks-at-the-harmless-direction)
// AC2 (live specimen): done + 0 AC checked + Touches files not in the tree ⇒ MUST be reported.
// AC3 (reverse negative): done + complete evidence ⇒ MUST NOT be reported. The two-way control is
// the task's true criterion — "turning 'invisible' into 'report everything' is another way of being
// invisible".

test("countAcCheckboxes: counts GFM boxes; only [x]/[X] counts as checked ([~] partial = unchecked)", () => {
  const ac = "- [ ] AC1: a\n- [x] AC2: b\n- [X] AC3: c\n- [~] AC4: d\n- [ ] AC5: e";
  const r = countAcCheckboxes(ac);
  assert.equal(r.total, 5);
  assert.equal(r.checked, 2);
  assert.equal(r.unchecked, 3);
  assert.deepEqual(countAcCheckboxes(null), { total: 0, checked: 0, unchecked: 0 });
  assert.deepEqual(countAcCheckboxes("no boxes here"), { total: 0, checked: 0, unchecked: 0 });
});

test("AC2 (closed): LIVE-SPECIMEN reproduction — done + 0 AC checked + Touches files NOT in tree ⇒ reported as closed-without-work", () => {
  const ws = makeWorkspace("c2");
  try {
    fs.writeFileSync(path.join(ws, "tasks", "fixture-specimen.md"), SPECIMEN_TASK);
    // The Touches files are NOT created — this reproduces the specimen's historical state where the
    // work existed only on an unmerged branch and the task was marked done directly.
    const { closedWithoutWork, reverse } = scanTasks({ repoRoot: ws, roots: [path.join(ws, "code")] });
    const hit = closedWithoutWork.find((c) => c.taskId === "fixture-specimen");
    assert.ok(hit, "the specimen shape MUST be reported (done + 0 AC checked)");
    assert.equal(hit.acChecked, 0, "reports 0 checked");
    assert.equal(hit.acTotal, 8, "reports the total AC count");
    assert.equal(hit.touchesAllExist, false, "Touches files not in tree is reported");
    assert.equal(hit.codeTouchExists, false, "no code-root Touches entry exists");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC3 (closed): REVERSE NEGATIVE — done + complete evidence (ACs all checked + Touches in tree) ⇒ NOT reported by any direction", () => {
  const ws = makeWorkspace("c3");
  try {
    fs.writeFileSync(path.join(ws, "code", "landed-symbol.ts"), "export function distinctiveLandedMarker() {}\nexport function _internalLandedHelper() {}\n");
    fs.writeFileSync(path.join(ws, "tasks", "fixture-complete.md"), COMPLETE_DONE_TASK);
    const { closedWithoutWork, suspects, reverse } = scanTasks({ repoRoot: ws, roots: [path.join(ws, "code")] });
    assert.equal(closedWithoutWork.length, 0, "complete evidence → must NOT be closed-without-work");
    assert.equal(suspects.length, 0, "done status → not a forward-drift suspect");
    assert.equal(reverse.length, 0, "code landed → not reverse-drift");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC3b (closed): the 0-checked boundary — a done task with ≥1 AC checked is NOT closed-without-work", () => {
  const ws = makeWorkspace("c3b");
  try {
    const partial = makeTask(
      "fixture-partial",
      "- [x] AC1: `distinctiveLandedMarker` done\n- [ ] AC2: `revGhostTwoXYZ` not yet\n- [ ] AC3: `revGhostThreeXYZ` not yet",
      "- code/ghost.ts",
      "done"
    );
    fs.writeFileSync(path.join(ws, "tasks", "fixture-partial.md"), partial);
    const { closedWithoutWork } = scanTasks({ repoRoot: ws, roots: [path.join(ws, "code")] });
    assert.equal(closedWithoutWork.length, 0, "1+ checked AC → the acceptance gate could have partially passed; not the 0-checked bypass shape");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC5 (closed): each reported record names the missing evidence (AC unchecked / file not in tree / branch unmerged)", () => {
  const ws = makeWorkspace("c5");
  try {
    // A real git repo with a stranded branch so branchUnmerged can be demonstrated end-to-end.
    const repo = makeRealGitRepo("c5");
    try {
      fs.mkdirSync(path.join(repo, "tasks"), { recursive: true });
      fs.mkdirSync(path.join(repo, "code"), { recursive: true });
      // The specimen's Touches live on a stranded branch, NOT master. Order matters: commit the code
      // files on the branch FIRST (before the task file exists, so `git add .` can't sweep it onto
      // the branch), THEN write the task file on master — the task file must be in master's tree for
      // the scan to see it, while its Touches files exist only on the branch.
      fs.mkdirSync(path.join(repo, "packages", "quay", "test"), { recursive: true });
      fs.mkdirSync(path.join(repo, "plugin", "scripts"), { recursive: true });
      git(repo, "checkout", "-q", "-b", "milestone/M250/iteration-0");
      fs.writeFileSync(path.join(repo, "packages/quay/test/install-config-driven-e2e.test.mjs"), "// e2e\n");
      fs.writeFileSync(path.join(repo, "plugin/scripts/quay-init.sh"), "#!/bin/sh\n");
      git(repo, "add", ".");
      git(repo, "commit", "-q", "-m", "specimen work");
      git(repo, "checkout", "-q", "master");
      fs.writeFileSync(path.join(repo, "tasks", "fixture-specimen.md"), SPECIMEN_TASK);
      const stranded = strandedBranches(repo);
      const { closedWithoutWork } = scanTasks({ repoRoot: repo, roots: [path.join(repo, "code")], strandedBranches: stranded });
      const hit = closedWithoutWork.find((c) => c.taskId === "fixture-specimen");
      assert.ok(hit, "specimen on a stranded branch is reported");
      assert.equal(hit.acUnchecked, 8, "AC unchecked dimension");
      assert.equal(hit.touchesAllExist, false, "Touches file not in tree dimension");
      assert.equal(hit.branchUnmerged, true, "branch unmerged dimension");
      assert.equal(hit.branch, "milestone/M250/iteration-0");
      // The human-readable report names each missing dimension.
      const text = formatClosedText(closedWithoutWork);
      assert.match(text, /AC unchecked \(0\/8 checked\)/);
      assert.match(text, /Touches file\(s\) not in tree/);
      assert.match(text, /branch not merged \(milestone\/M250\/iteration-0\)/);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC2/AC3 (closed): done-parent whose children are all done is NOT closed-without-work (delegation pattern, matches reverse-drift)", () => {
  const ws = makeWorkspace("c2p");
  try {
    const parent = makeTask(
      "fixture-closed-parent",
      "- [ ] AC1: `ProposalReviewGhostXYZ` absent\n- [ ] AC2: `_ProposalAuthorsGhost` absent",
      "- tasks/fixture-closed-parent.md",
      "done",
      ["fixture-closed-child"]
    );
    const child = makeTask("fixture-closed-child", "- [x] AC1: real work", "- code/child.ts", "done");
    fs.writeFileSync(path.join(ws, "tasks", "fixture-closed-parent.md"), parent);
    fs.writeFileSync(path.join(ws, "tasks", "fixture-closed-child.md"), child);
    fs.writeFileSync(path.join(ws, "code", "child.ts"), "// child landed");
    const { closedWithoutWork } = scanTasks({ repoRoot: ws, roots: [path.join(ws, "code")] });
    assert.equal(closedWithoutWork.length, 0, "done parent whose implementation IS the children's work → not closed-without-work");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("--closed-direction: json emits a bare array (jq length counts it); text names the missing evidence", () => {
  const cli = path.join(REPO_ROOT, "plugin", "scripts", "task-status-drift-check.ts");
  const repo = makeRealGitRepo("cdir");
  try {
    fs.mkdirSync(path.join(repo, "tasks"), { recursive: true });
    fs.writeFileSync(path.join(repo, "tasks", "fixture-specimen.md"), SPECIMEN_TASK);
    const jsonOut = execFileSync("node", ["--no-warnings", "--experimental-strip-types", cli, "--closed-direction", "--json"], {
      cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    const arr = JSON.parse(jsonOut);
    assert.ok(Array.isArray(arr), "--closed-direction --json emits a bare ARRAY (so `| jq length` counts it)");
    assert.equal(arr.length, 1, "exactly the specimen is reported");
    assert.equal(arr[0].taskId, "fixture-specimen");
    assert.equal(arr[0].acChecked, 0);
    assert.equal(arr[0].acTotal, 8);
    const textOut = execFileSync("node", ["--no-warnings", "--experimental-strip-types", cli, "--closed-direction"], {
      cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    assert.match(textOut, /CLOSED-without-work/);
    assert.match(textOut, /fixture-specimen/);
    assert.match(textOut, /AC unchecked \(0\/8 checked\)/, "text report names the missing evidence (AC5)");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// ── AC2: real store — genuinely-unlanded tasks are not flagged, landed-but-stale are ─────────────
// OPT-IN (QUAY_TEST_REAL_STORE=1): scans 553 real tasks, grepping the codebase per task (~47s).
// The default CI run exercises the same scanTasks logic on synthetic fixtures (AC3/AC4 + the
// reverse-drift fixtures above) instead. The exact task-id sets below are snapshots that drift as
// the store changes — the durable assertions are the fixture-based ones.

test("AC2: real store — batch-1 todo tasks (code not landed) are NOT flagged; landed stale tasks ARE",
  { skip: !REAL_STORE_ENABLED && "opt-in with QUAY_TEST_REAL_STORE=1 (scans the real 553-task store, ~47s)" },
  () => {
  const repoRoot = findRepoRoot(process.cwd());
  const { suspects, reverse } = scanTasks({ repoRoot });

  // Forward-drift (todo/ready but code in the tree) measured 2026-08-03: these must be flagged.
  for (const landed of [
    "gap-prepare-milestone-no-worktree-isolation",
    "DIR-100-B",
    "DIR-100-C",
  ]) {
    assert.ok(
      suspects.some((s) => s.taskId === landed),
      `${landed} code is in the tree (measured drift) — must be flagged`
    );
  }

  // Forward-drift: tasks whose code is NOT yet in the tree must NOT be flagged. (Several formerly
  // todo/ready members of this set have since moved to done and left the todo/ready scan set.)
  for (const unlanded of [
    "DIR-124-F-plancheck",
    "gap-extract-mechanism-claims-calibration",
  ]) {
    assert.equal(
      suspects.some((s) => s.taskId === unlanded),
      false,
      `${unlanded} code is NOT landed yet — must not be flagged`
    );
  }

  // Reverse-drift: the five suspects the 2026-08-02 tick reported are ALL false positives — their
  // code landed (DIR-124-B1 run-identity, DIR-073 diagnose-verify-failure, DIR-075 serve.ts, DIR-087
  // gate config, DIR-124-A5 baseline-metrics) or they are done parents (DIR-126). The relaxation must
  // clear exactly these; genuine reverse-drift is covered by the synthetic fixtures (AC5 1/4, AC6).
  for (const falsePositive of [
    "DIR-124-B1",
    "DIR-073",
    "DIR-075",
    "DIR-087",
    "DIR-124-A5",
    "DIR-126",
  ]) {
    assert.equal(
      reverse.some((r) => r.taskId === falsePositive),
      false,
      `${falsePositive} code landed (or is a done parent) — must NOT be reverse-flagged`
    );
  }
});

// ── AC6: never writes to tasks/** ────────────────────────────────────────────────────────────────

test("AC6: source contains zero write calls, and a run leaves a task store byte-identical", () => {
  const src = fs.readFileSync(
    path.join(REPO_ROOT, "experiments", "quay-perpetual-stream", "scripts", "task-status-drift-check.ts"),
    "utf8"
  );
  // Zero fs-write APIs in the module ⇒ no code path can mutate tasks/** (the detector's Touches
  // walk only reads). The literal `tasks/**` string in its own doc comment is fine — what matters
  // is that no write primitive exists.
  assert.ok(!/writeFile|appendFile|createWriteStream|mkdirSync|rmSync|rm\(|unlink|copyFile|rename/.test(src), "no filesystem write calls in the detector");

  // A run must not mutate the store: snapshot and compare on a synthetic workspace (fast — the real
  // 553-task store scan is opt-in via AC2).
  const ws = makeGitWorkspace("ac6");
  try {
    const tasksDir = path.join(ws, "tasks");
    const before = {};
    for (const f of fs.readdirSync(tasksDir).filter((f) => f.endsWith(".md"))) {
      before[f] = fs.readFileSync(path.join(tasksDir, f), "utf8");
    }
    scanTasks({ repoRoot: ws, roots: [path.join(ws, "code")] });
    for (const f of Object.keys(before)) {
      assert.equal(fs.readFileSync(path.join(tasksDir, f), "utf8"), before[f], `task ${f} must be untouched`);
    }
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── AC5: exits 0 always ─────────────────────────────────────────────────────────────────────────

test("AC5: CLI exits 0 in all cases (report-only, never a gate)", () => {
  const cli = path.join(REPO_ROOT, "plugin", "scripts", "task-status-drift-check.ts");
  const ws = makeGitWorkspace("ac5");
  try {
    for (const args of [[], ["--json"], ["--bogus-flag"]]) {
      const r = execFileSync("node", ["--experimental-strip-types", cli, ...args], {
        cwd: ws, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      });
      assert.equal(typeof r, "string", `CLI ${args} must exit 0 (execFileSync throws on non-zero)`);
    }
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── AC7: --json shape ───────────────────────────────────────────────────────────────────────────

test("AC7: --json mode emits { suspects, reverse, closedWithoutWork, strandedTasks, stranded, scanned }", () => {
  const report = formatJsonReport(
    [{ taskId: "X-1", matchedSymbols: ["planCheckNextAction"], touchesAllExist: true }],
    [{ taskId: "X-2", matchedSymbols: [], codeTouchExists: false, touchesAllExist: false }],
    10,
    [{ taskId: "X-3", matchedSymbols: [], branch: "milestone/M243/iteration-0", branchClassification: "has-commits" }],
    [{ branch: "milestone/M239/iteration-0", classification: "has-commits", aheadCount: 2, insertions: 6901, lastCommitDate: "2026-08-01T00:00:00Z" }],
    [{ taskId: "X-4", acChecked: 0, acTotal: 3, acUnchecked: 3, touchesAllExist: false, codeTouchExists: false, branch: null, branchUnmerged: false }]
  );
  const parsed = JSON.parse(report);
  assert.deepEqual(Object.keys(parsed).sort(), ["closedWithoutWork", "reverse", "scanned", "stranded", "strandedTasks", "suspects"]);
  assert.equal(parsed.suspects.length, 1);
  assert.equal(parsed.reverse.length, 1);
  assert.equal(parsed.closedWithoutWork.length, 1);
  assert.equal(parsed.strandedTasks.length, 1);
  assert.equal(parsed.stranded.length, 1);
  assert.deepEqual(
    Object.keys(parsed.suspects[0]).sort(),
    ["matchedSymbols", "taskId", "touchesAllExist"]
  );
  assert.deepEqual(
    Object.keys(parsed.reverse[0]).sort(),
    ["codeTouchExists", "matchedSymbols", "taskId", "touchesAllExist"],
    "reverse entries carry codeTouchExists (the code-root landing signal)"
  );
  assert.deepEqual(
    Object.keys(parsed.closedWithoutWork[0]).sort(),
    ["acChecked", "acTotal", "acUnchecked", "branch", "branchUnmerged", "codeTouchExists", "taskId", "touchesAllExist"],
    "closed-without-work entries carry the actionable missing-evidence fields (AC5)"
  );
  assert.deepEqual(
    Object.keys(parsed.stranded[0]).sort(),
    ["aheadCount", "branch", "classification", "detail", "insertions", "lastCommitDate"]
  );
  assert.deepEqual(
    Object.keys(parsed.strandedTasks[0]).sort(),
    ["branch", "branchClassification", "matchedSymbols", "taskId"]
  );

  // The CLI itself emits the same shape (synthetic workspace — fast, no real store).
  const cli = path.join(REPO_ROOT, "plugin", "scripts", "task-status-drift-check.ts");
  const ws = makeGitWorkspace("ac7");
  try {
    const out = execFileSync("node", ["--experimental-strip-types", cli, "--json"], {
      cwd: ws, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    const fromCli = JSON.parse(out);
    assert.deepEqual(Object.keys(fromCli).sort(), ["closedWithoutWork", "reverse", "scanned", "stranded", "strandedTasks", "suspects"]);
    assert.ok(Array.isArray(fromCli.suspects), "suspects must be an array");
    assert.ok(Array.isArray(fromCli.reverse), "reverse must be an array");
    assert.ok(Array.isArray(fromCli.closedWithoutWork), "closedWithoutWork must be an array");
    assert.ok(Array.isArray(fromCli.stranded), "stranded must be an array");
    assert.ok(Array.isArray(fromCli.strandedTasks), "strandedTasks must be an array");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
