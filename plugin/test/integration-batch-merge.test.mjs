// @test-group governance
// gap-integration-batch-merge-ff-only-contradicts-real-merge-ruling — the integration→develop
// batch-merge helper's REAL-MERGE mode.
//
// The original two-line model (gap-branch-model-integration-branch-splits-fork-baseline-from-merge-point,
// AC3) assumed integration→develop is ALWAYS a fast-forward (SPEC §4). That assumption was empirically
// negated 2026-08-06 23:48 (develop advances via direct inner/outer/manager commits within a minute of
// an alignment merge), and the direction ruling changed integration→develop from FF-only to REAL-MERGE
// on divergence. These tests exercise `integration-batch-merge.sh --merge`:
//
//   1. AC1 — on TRUE divergence, the helper reports the divergence surface (develop-only /
//      integration-only counts + would-conflict file list) instead of a one-line "needs human", and
//      (default, no --merge) FAILS CLOSED with nothing moved.
//   2. AC2 — with --merge, conflicts on KNOWN SHARED files (tick-log.md / tasks/*.md / queue-state)
//      auto-resolve develop-authoritative and the merge advances develop (integration absorbed).
//   3. AC3 (load-bearing negative control) — with --merge, a REAL code conflict FAILS CLOSED: nothing
//      moved, the code file is not blind --ours/--theirs'd, and the code-conflict file list is reported.
//   4. AC4 — a full real-merge run produces a merge commit (two parents: old develop tip + integration
//      tip) with integration..develop = 0.
//   5. --dry-run --merge reports the divergence surface AND the shared/code classification WITHOUT
//      moving any ref.
//   6. already-absorbed no-op — integration already an ancestor of develop ⇒ measure 0, exit 0.
//   7. shared-file delete case — develop deletes a shared file, integration modifies it ⇒ resolved
//      develop-authoritative (stays deleted), merge still succeeds.
//
// All fixtures are self-contained temp git repos; nothing in the real checkout is mutated (R3
// test-isolation). `// @test-group governance` — methodology-execution surface, not product.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const batchMerge = join(repoRoot, "plugin", "scripts", "integration-batch-merge.sh");

function gitCmd(cwd, ...args) {
  const res = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function run(args, opts = {}) {
  const res = spawnSync("bash", args, { encoding: "utf8", ...opts });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function makeTmp(prefix) {
  return mkdtempSync(join(tmpdir(), `ibm-${prefix}-`));
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

function initGitRepo(dir) {
  gitCmd(dir, "init", "-q");
  gitCmd(dir, "config", "user.name", "ibm-test");
  gitCmd(dir, "config", "user.email", "ibm@example.com");
}

function commitAll(dir, message) {
  gitCmd(dir, "add", "-A");
  const res = gitCmd(dir, "commit", "-q", "-m", message);
  assert.equal(res.status, 0, `commit "${message}" failed: ${res.stderr}`);
}

// Build a diverged two-line repo. `withCodeConflict` makes BOTH sides touch `code.json` (a real code
// conflict — deliberately NOT one of the object gate's .ts/.js/.mjs/.sh extensions, so the REAL-MERGE
// code-conflict backstop stays reachable past the object gate, AC3); otherwise only known-shared files
// conflict.
function divergedRepo(prefix, { withCodeConflict = false } = {}) {
  const dir = makeTmp(prefix);
  initGitRepo(dir);
  mkdirSync(join(dir, "orchestration"), { recursive: true });
  mkdirSync(join(dir, "tasks"), { recursive: true });
  writeFileSync(join(dir, "orchestration", "tick-log.md"), "tick line 1\n", "utf8");
  writeFileSync(join(dir, "orchestration", "queue-state.md"), "queue 1\n", "utf8");
  writeFileSync(join(dir, "tasks", "one.md"), "task 1\n", "utf8");
  if (withCodeConflict) writeFileSync(join(dir, "code.json"), "v1\n", "utf8");
  commitAll(dir, "base");
  gitCmd(dir, "branch", "-M", "master");
  gitCmd(dir, "checkout", "-q", "-b", "develop");
  gitCmd(dir, "checkout", "-q", "-b", "integration");

  // develop advances via direct commits (the empirical reality that negated FF-only).
  gitCmd(dir, "checkout", "-q", "develop");
  writeFileSync(join(dir, "orchestration", "tick-log.md"), "tick dev\n", "utf8");
  writeFileSync(join(dir, "orchestration", "queue-state.md"), "queue dev\n", "utf8");
  writeFileSync(join(dir, "tasks", "one.md"), "task dev\n", "utf8");
  if (withCodeConflict) writeFileSync(join(dir, "code.json"), "dev v2\n", "utf8");
  writeFileSync(join(dir, "dev-only.txt"), "dev only\n", "utf8");
  commitAll(dir, "develop direct commit");

  // integration receives task merges.
  gitCmd(dir, "checkout", "-q", "integration");
  writeFileSync(join(dir, "orchestration", "tick-log.md"), "tick int\n", "utf8");
  writeFileSync(join(dir, "tasks", "one.md"), "task int\n", "utf8");
  if (withCodeConflict) writeFileSync(join(dir, "code.json"), "int v2\n", "utf8");
  writeFileSync(join(dir, "int-only.txt"), "int only\n", "utf8");
  commitAll(dir, "integration task merge");

  return dir;
}

// Build a diverged repo where DEVELOP adds a code file (a .ts — one of the object gate's tracked
// extensions) that INTEGRATION never touches: the exact object-problem shape — develop-side code that
// never entered the tested tree (the integration tip). The merge would be a real merge; the object gate
// must fail closed BEFORE any ref moves. `pureMd` instead gives develop ONLY .md/tasks changes (the
// 2026-08-08 report's 5 files) — the gate must PASS and the real merge proceed.
function developCodeRepo(prefix, { pureMd = false } = {}) {
  const dir = makeTmp(prefix);
  initGitRepo(dir);
  mkdirSync(join(dir, "orchestration"), { recursive: true });
  mkdirSync(join(dir, "tasks"), { recursive: true });
  writeFileSync(join(dir, "orchestration", "tick-log.md"), "tick line\n", "utf8");
  writeFileSync(join(dir, "tasks", "one.md"), "task 1\n", "utf8");
  commitAll(dir, "base");
  gitCmd(dir, "branch", "-M", "master");
  gitCmd(dir, "checkout", "-q", "-b", "develop");
  gitCmd(dir, "checkout", "-q", "-b", "integration");

  // develop advances: a manager tick (md) AND, unless pureMd, a code file.
  gitCmd(dir, "checkout", "-q", "develop");
  writeFileSync(join(dir, "orchestration", "tick-log.md"), "tick dev\n", "utf8");
  writeFileSync(join(dir, "orchestration", "manager-tick.md"), "manager md\n", "utf8");
  if (!pureMd) writeFileSync(join(dir, "src-new-code.ts"), "dev code\n", "utf8");
  commitAll(dir, "develop manager commit");

  // integration receives a task merge (never touches the develop-side code file).
  gitCmd(dir, "checkout", "-q", "integration");
  writeFileSync(join(dir, "tasks", "one.md"), "task int\n", "utf8");
  writeFileSync(join(dir, "int-only.txt"), "int only\n", "utf8");
  commitAll(dir, "integration task merge");

  return dir;
}

// ── AC1: divergence surface on NOT-FF, fail-closed (no --merge) ─────────────────────────────────────

test("AC1: TRUE divergence (no --merge) reports the divergence surface AND fails closed, nothing moved", () => {
  const dir = divergedRepo("ac1");
  try {
    const before = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    const r = run([batchMerge, "--root", dir]);
    assert.notEqual(r.status, 0, "a true divergence must fail closed without --merge");
    // AC1: the divergence surface, not a one-line "needs human".
    assert.match(r.stdout, /DIVERGENCE/);
    assert.match(r.stdout, /develop-only commits:/);
    assert.match(r.stdout, /integration-only commits:/);
    assert.match(r.stdout, /would-conflict files:/);
    assert.match(r.stdout, /orchestration\/tick-log\.md/);
    assert.match(r.stdout, /tasks\/one\.md/);
    // The fail-closed verdict (stderr keeps the historical NOT-FAST-FORWARD / needs-a-human contract).
    assert.match(r.stderr, /NOT-FAST-FORWARD/);
    assert.match(r.stderr, /needs a human/i);
    // Nothing moved; integration NOT forced into develop.
    assert.equal(gitCmd(dir, "rev-parse", "develop").stdout.trim(), before);
    assert.notEqual(gitCmd(dir, "merge-base", "--is-ancestor", "integration", "develop").status, 0);
  } finally {
    cleanup(dir);
  }
});

test("AC1 --dry-run on divergence reports the surface WITHOUT moving any ref", () => {
  const dir = divergedRepo("ac1dry");
  try {
    const before = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    const r = run([batchMerge, "--root", dir, "--dry-run"]);
    assert.notEqual(r.status, 0, "dry-run on divergence exits non-zero (not a clean FF)");
    assert.match(r.stdout, /DIVERGENCE/);
    assert.match(r.stdout, /develop-only commits:/);
    assert.match(r.stdout, /would-conflict files:/);
    assert.equal(gitCmd(dir, "rev-parse", "develop").stdout.trim(), before);
  } finally {
    cleanup(dir);
  }
});

// ── AC2: --merge auto-resolves known-shared-file conflicts develop-authoritative ────────────────────

test("AC2: --merge auto-resolves shared-file conflicts develop-authoritative and advances develop", () => {
  const dir = divergedRepo("ac2");
  try {
    const before = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    const integ = gitCmd(dir, "rev-parse", "integration").stdout.trim();
    const r = run([batchMerge, "--root", dir, "--merge"]);
    assert.equal(r.status, 0, `--merge should succeed: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /auto-resolving shared-file conflicts develop-authoritative/);
    assert.match(r.stdout, /orchestration\/tick-log\.md/);
    assert.match(r.stdout, /tasks\/one\.md/);
    assert.match(r.stdout, /measure integration_ff_merges=0/);

    const after = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    assert.notEqual(after, before, "develop must advance");
    assert.notEqual(after, integ, "a real merge is NOT a fast-forward onto integration's tip");
    // The merge commit has exactly two parents: old develop tip + integration tip.
    const parents = gitCmd(dir, "rev-list", "--parents", "-n", "1", "develop").stdout.trim().split(/\s+/);
    assert.equal(parents.length, 3, "merge commit must have two parents: ${parents}");
    assert.equal(parents[1], before, "parent 1 = the old develop tip");
    assert.equal(parents[2], integ, "parent 2 = integration tip");

    // Shared files resolved develop-authoritative.
    assert.equal(gitCmd(dir, "show", "develop:orchestration/tick-log.md").stdout, "tick dev\n");
    assert.equal(gitCmd(dir, "show", "develop:tasks/one.md").stdout, "task dev\n");
    assert.equal(gitCmd(dir, "show", "develop:orchestration/queue-state.md").stdout, "queue dev\n");
    // Integration-only file comes across the merge (normal merge behavior).
    assert.equal(gitCmd(dir, "show", "develop:int-only.txt").stdout, "int only\n");
    // Measure / absorption (AC4 surface): integration fully absorbed, pending = 0.
    assert.equal(gitCmd(dir, "merge-base", "--is-ancestor", "integration", "develop").status, 0);
    assert.equal(gitCmd(dir, "rev-list", "--count", "develop..integration").stdout.trim(), "0");
    // The throwaway worktree is cleaned up.
    const wl = gitCmd(dir, "worktree", "list").stdout;
    assert.ok(!/integration-batch-merge\./.test(wl), "temp worktree must be cleaned up after the merge");
  } finally {
    cleanup(dir);
  }
});

// ── AC3 (load-bearing): real code conflicts FAIL CLOSED even with --merge ──────────────────────────

test("AC3 (load-bearing negative control): --merge on a REAL code conflict fails closed, nothing moved", () => {
  // code.json is a REAL code file but NOT one of the object gate's tracked extensions (.ts/.js/.mjs/.sh),
  // so the object gate passes (measure 0) and the REAL-MERGE code-conflict backstop is what blocks.
  const dir = divergedRepo("ac3", { withCodeConflict: true });
  try {
    const before = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    const r = run([batchMerge, "--root", dir, "--merge"]);
    assert.notEqual(r.status, 0, "a real code conflict must fail closed even with --merge");
    // The object gate does NOT flag .json (it is not a develop-side untested .ts/.js/.mjs/.sh file).
    assert.match(r.stdout, /measure unmerged_develop_files=0/);
    assert.match(r.stdout, /DIVERGENCE/);
    assert.match(r.stderr, /REAL-MERGE FAIL-CLOSED/);
    // The code-conflict file list is reported.
    assert.match(r.stderr, /code conflict files:/);
    assert.match(r.stderr, /code\.json/);
    // The shared conflict is NOT silently overwritten either — it is reported as blocked.
    assert.match(r.stderr, /would auto-resolve develop-authoritative/);
    assert.match(r.stderr, /orchestration\/tick-log\.md/);
    // Nothing moved — develop unchanged, integration NOT absorbed.
    assert.equal(gitCmd(dir, "rev-parse", "develop").stdout.trim(), before);
    assert.notEqual(gitCmd(dir, "merge-base", "--is-ancestor", "integration", "develop").status, 0);
    // No blind --ours/--theirs: develop's code.json is still develop's version.
    assert.equal(gitCmd(dir, "show", "develop:code.json").stdout, "dev v2\n");
    // No temp worktree leak.
    const wl = gitCmd(dir, "worktree", "list").stdout;
    assert.ok(!/integration-batch-merge\./.test(wl), "temp worktree must be cleaned up after fail-closed");
  } finally {
    cleanup(dir);
  }
});

// ── AC4: full real-merge run, pending absorbed ──────────────────────────────────────────────────────

test("AC4: full real-merge run (divergence) absorbs integration (develop..integration = 0) and lands a merge commit", () => {
  const dir = divergedRepo("ac4");
  try {
    assert.notEqual(gitCmd(dir, "rev-list", "--count", "develop..integration").stdout.trim(), "0",
      "pre: integration has pending commits develop lacks (the merge gap)");
    const r = run([batchMerge, "--root", dir, "--merge"]);
    assert.equal(r.status, 0, r.stderr);
    // Pending absorbed: integration's commits are all in develop now (the Contract's measure,
    // `pending_commits = git rev-list --count develop..integration` → 0).
    assert.equal(gitCmd(dir, "rev-list", "--count", "develop..integration").stdout.trim(), "0",
      "AC4: integration's pending commits are absorbed into develop");
    assert.equal(gitCmd(dir, "merge-base", "--is-ancestor", "integration", "develop").status, 0,
      "AC4: integration is an ancestor of develop (measure integration_ff_merges = 0)");
    // develop is a merge commit (2 parents: old develop tip + integration tip).
    const parents = gitCmd(dir, "rev-list", "--parents", "-n", "1", "develop").stdout.trim().split(/\s+/);
    assert.equal(parents.length, 3);
  } finally {
    cleanup(dir);
  }
});

// ── --dry-run --merge: surface + shared/code classification, no ref moved ──────────────────────────

test("--dry-run --merge reports the divergence surface AND the shared/code classification WITHOUT moving any ref", () => {
  const dir = divergedRepo("drymerge", { withCodeConflict: true });
  try {
    const before = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    const r = run([batchMerge, "--root", dir, "--dry-run", "--merge"]);
    assert.notEqual(r.status, 0, "dry-run on divergence exits non-zero (not a clean FF)");
    // The object gate runs in dry-run too: code.json is not a gate extension ⇒ measure 0, no would-block.
    assert.match(r.stdout, /measure unmerged_develop_files=0/);
    assert.match(r.stdout, /DIVERGENCE/);
    assert.match(r.stdout, /conflict classification:/);
    assert.match(r.stdout, /shared \(auto-resolve develop-authoritative\): 2/);
    assert.match(r.stdout, /code \(fail-closed, needs human\):\s+1/);
    assert.match(r.stdout, /orchestration\/tick-log\.md/);
    assert.match(r.stdout, /code\.json/);
    assert.equal(gitCmd(dir, "rev-parse", "develop").stdout.trim(), before);
  } finally {
    cleanup(dir);
  }
});

// ── already-absorbed no-op ──────────────────────────────────────────────────────────────────────────

test("already-absorbed (integration is an ancestor of develop) is a clean no-op with measure 0", () => {
  const dir = makeTmp("absorbed");
  try {
    initGitRepo(dir);
    writeFileSync(join(dir, "f.txt"), "base\n", "utf8");
    commitAll(dir, "base");
    gitCmd(dir, "branch", "-M", "master");
    gitCmd(dir, "checkout", "-q", "-b", "develop");
    gitCmd(dir, "checkout", "-q", "-b", "integration");
    gitCmd(dir, "checkout", "-q", "integration");
    writeFileSync(join(dir, "g.txt"), "task work\n", "utf8");
    commitAll(dir, "task work");
    gitCmd(dir, "checkout", "-q", "develop");
    assert.equal(gitCmd(dir, "merge", "-q", "--no-ff", "integration", "-m", "Merge integration").status, 0);

    const before = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    const r = run([batchMerge, "--root", dir, "--merge"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /already an ancestor of develop \(nothing pending\)/);
    assert.match(r.stdout, /measure integration_ff_merges=0/);
    assert.equal(gitCmd(dir, "rev-parse", "develop").stdout.trim(), before, "no-op must not move develop");
  } finally {
    cleanup(dir);
  }
});

// ── shared-file delete edge: develop deletes a shared file, integration modifies it ────────────────

test("--merge: develop deletes a shared file, integration modifies it ⇒ kept deleted (develop-authoritative)", () => {
  const dir = makeTmp("deleteshared");
  try {
    initGitRepo(dir);
    mkdirSync(join(dir, "orchestration"), { recursive: true });
    writeFileSync(join(dir, "orchestration", "tick-log.md"), "tick line\n", "utf8");
    commitAll(dir, "base");
    gitCmd(dir, "branch", "-M", "master");
    gitCmd(dir, "checkout", "-q", "-b", "develop");
    gitCmd(dir, "checkout", "-q", "-b", "integration");

    gitCmd(dir, "checkout", "-q", "develop");
    assert.equal(gitCmd(dir, "rm", "-q", "orchestration/tick-log.md").status, 0);
    commitAll(dir, "develop deletes tick-log");

    gitCmd(dir, "checkout", "-q", "integration");
    writeFileSync(join(dir, "orchestration", "tick-log.md"), "int newest\n", "utf8");
    commitAll(dir, "integration modifies tick-log");

    const r = run([batchMerge, "--root", dir, "--merge"]);
    assert.equal(r.status, 0, `--merge should resolve the shared delete/modify as develop-authoritative: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /auto-resolving shared-file conflicts develop-authoritative/);
    // develop-authoritative = the file stays deleted on develop.
    const ls = gitCmd(dir, "ls-tree", "--name-only", "develop", "orchestration/").stdout;
    assert.ok(!ls.includes("tick-log.md"), "tick-log.md must stay deleted on develop (develop-authoritative)");
    assert.equal(gitCmd(dir, "merge-base", "--is-ancestor", "integration", "develop").status, 0);
  } finally {
    cleanup(dir);
  }
});

// ── --reconcile: primary-checkout reconcile (gap-batch-merge-reconcile-destroys-uncommitted-work) ──
//
// The batch merge is REF-LEVEL (update-ref CAS); when the primary checkout has the advanced branch
// checked out, its HEAD/index go STALE after the merge. The reconcile is provided by the script
// (`--reconcile`): a porcelain-empty guard runs BEFORE any ref moves (fail-closed on uncommitted/
// untracked work — the guard that would have caught the 2026-08-08 08:08:24 `git reset --hard`
// incident), and the post-merge reconcile is `git reset --mixed <new tip>` (index only, never --hard,
// working tree untouched).
//
// Build a repo where the primary checkout ends ON develop (the branch the batch merge advances),
// with integration a fast-forwardable descendant — the exact stale-index scenario --reconcile handles.
function ffRepoOnDevelop(prefix) {
  const dir = makeTmp(prefix);
  initGitRepo(dir);
  mkdirSync(join(dir, "orchestration"), { recursive: true });
  writeFileSync(join(dir, "orchestration", "tick-log.md"), "tick dev\n", "utf8");
  writeFileSync(join(dir, "orchestration", "manager-phase-goal.md"), "manager base\n", "utf8");
  commitAll(dir, "base");
  gitCmd(dir, "branch", "-M", "master");
  gitCmd(dir, "checkout", "-q", "-b", "develop");
  writeFileSync(join(dir, "dev-only.txt"), "dev only\n", "utf8");
  commitAll(dir, "dev-1");
  gitCmd(dir, "checkout", "-q", "-b", "integration");
  writeFileSync(join(dir, "orchestration", "tick-log.md"), "tick int\n", "utf8");
  writeFileSync(join(dir, "int-only.txt"), "int only\n", "utf8");
  commitAll(dir, "int-1");
  // Primary checkout ends on develop at dev-1 (clean, index in sync with the OLD HEAD).
  gitCmd(dir, "checkout", "-q", "develop");
  return dir;
}

test("--reconcile: clean primary checkout → guard passes, FF advances develop, `git reset --mixed` refreshes the index and leaves the working tree untouched", () => {
  const dir = ffRepoOnDevelop("reconcileclean");
  try {
    const devBefore = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    const intTip = gitCmd(dir, "rev-parse", "integration").stdout.trim();
    assert.notEqual(intTip, devBefore);

    const r = run([batchMerge, "--root", dir, "--reconcile"]);
    assert.equal(r.status, 0, `--reconcile should succeed on a clean tree: ${r.stdout}${r.stderr}`);
    // Guard passed (porcelain empty) and the post-merge reconcile is a --mixed reset.
    assert.match(r.stdout, /reconcile: primary checkout clean \(porcelain empty\)/);
    assert.match(r.stdout, /reconcile: git reset --mixed/);
    assert.match(r.stdout, /reconcile: index refreshed to develop tip/);
    // NEVER --hard anywhere in the reconcile path.
    assert.ok(!/reset --hard/.test(r.stdout + r.stderr), "--reconcile must never invoke git reset --hard");

    // develop advanced to the integration tip (FF), and integration absorbed.
    assert.equal(gitCmd(dir, "rev-parse", "develop").stdout.trim(), intTip);
    assert.equal(gitCmd(dir, "merge-base", "--is-ancestor", "integration", "develop").status, 0);

    // Index refreshed: no staged changes vs the new HEAD (the stale old-vs-new tree is gone).
    assert.equal(gitCmd(dir, "diff", "--cached").stdout.trim(), "", "index must match the new develop tip after --mixed");

    // Working tree UNTOUCHED: tick-log.md still holds the OLD develop content (dev-1), not int-1.
    assert.equal(readFileSync(join(dir, "orchestration", "tick-log.md"), "utf8"), "tick dev\n",
      "--mixed must not overwrite working-tree files");
    // The honest old-vs-new diff surfaces as unstaged changes, NOT staged ones.
    const porcelain = gitCmd(dir, "status", "--porcelain").stdout;
    assert.ok(!/^[^ ] /.test(porcelain), "no staged (index-vs-HEAD) entries should remain: ${porcelain}");
  } finally {
    cleanup(dir);
  }
});

test("--reconcile: uncommitted primary-checkout edit → FAIL CLOSED before any ref moves, edit preserved, owners reported", () => {
  const dir = ffRepoOnDevelop("reconcilefail");
  try {
    const devBefore = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    // The incident: a manager's uncommitted edit to manager-phase-goal.md.
    writeFileSync(join(dir, "orchestration", "manager-phase-goal.md"), "manager base\nMANAGER EDIT\n", "utf8");
    assert.equal(gitCmd(dir, "status", "--porcelain").stdout.trim(), "M orchestration/manager-phase-goal.md");

    const r = run([batchMerge, "--root", dir, "--reconcile"]);
    assert.notEqual(r.status, 0, "--reconcile must fail closed on uncommitted work");
    // Fail-closed verdict + the owner (file) surface reported.
    assert.match(r.stderr, /reconcile FAIL-CLOSED/);
    assert.match(r.stderr, /orchestration\/manager-phase-goal\.md/);
    assert.match(r.stderr, /NOT moving any ref/);
    // Nothing moved: develop unchanged, integration NOT absorbed.
    assert.equal(gitCmd(dir, "rev-parse", "develop").stdout.trim(), devBefore);
    assert.notEqual(gitCmd(dir, "merge-base", "--is-ancestor", "integration", "develop").status, 0);
    // The edit is preserved on disk.
    assert.match(readFileSync(join(dir, "orchestration", "manager-phase-goal.md"), "utf8"), /MANAGER EDIT/);
  } finally {
    cleanup(dir);
  }
});

test("--reconcile: primary checkout NOT on the advanced branch → reconcile is a no-op (guard skipped), the merge still proceeds", () => {
  // The divergedRepo fixture leaves the primary checkout on `integration`; advancing `develop` does
  // NOT stale its index, so --reconcile must skip the guard/reset yet still perform the real merge.
  const dir = divergedRepo("reconcilenop");
  try {
    const r = run([batchMerge, "--root", dir, "--merge", "--reconcile"]);
    assert.equal(r.status, 0, `--reconcile --merge on a non-develop checkout should still merge: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /not 'develop'\) — index refresh not needed/);
    assert.match(r.stdout, /measure integration_ff_merges=0/);
    assert.equal(gitCmd(dir, "merge-base", "--is-ancestor", "integration", "develop").status, 0);
  } finally {
    cleanup(dir);
  }
});

// ── OBJECT GATE (gap-batch-merge-gate-validates-tip-not-merge-result) ──────────────────────────────
//
// The suite tested the INTEGRATION TIP; the batch merge produces integration ⊕ develop (the MERGE
// RESULT). develop-only changes since the divergence point never entered the tested tree — if any are
// code files (.ts/.js/.mjs/.sh), the gate fails closed BEFORE any ref moves. Three-dot semantics
// (`git diff <merge-base> <develop>`) isolate the develop side; the raw two-dot `git diff integration
// develop` also lists integration's OWN tested files (a false positive this gate must avoid).

test("OBJECT GATE (AC1/AC2): develop-side .ts code never entered the tested tree ⇒ FAIL-CLOSED before any ref moves", () => {
  const dir = developCodeRepo("objgateblock");
  try {
    const devBefore = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    const r = run([batchMerge, "--root", dir, "--merge"]);
    assert.notEqual(r.status, 0, "develop-side untested code must fail closed even with --merge");
    assert.match(r.stdout, /measure unmerged_develop_files=1/);
    // The offending file is reported (the develop-side code that the suite never saw).
    assert.match(r.stdout, /src-new-code\.ts/);
    assert.match(r.stderr, /OBJECT-GATE FAIL-CLOSED/);
    assert.match(r.stderr, /tested tree = integration tip/);
    // Nothing moved: develop unchanged, integration NOT absorbed.
    assert.equal(gitCmd(dir, "rev-parse", "develop").stdout.trim(), devBefore);
    assert.notEqual(gitCmd(dir, "merge-base", "--is-ancestor", "integration", "develop").status, 0);
    // The develop-side code file is untouched on develop.
    assert.equal(gitCmd(dir, "show", "develop:src-new-code.ts").stdout, "dev code\n");
  } finally {
    cleanup(dir);
  }
});

test("OBJECT GATE (AC1 negative control): develop-side pure .md/tasks files PASS and the real merge proceeds", () => {
  // The 2026-08-08 report's shape: develop advanced with .md/tasks only (orchestration/manager-*.md +
  // tasks/*.md) — the gate must NOT block and the real merge must absorb integration.
  const dir = developCodeRepo("objgatemd", { pureMd: true });
  try {
    const r = run([batchMerge, "--root", dir, "--merge"]);
    assert.equal(r.status, 0, `pure-md develop-side changes must pass the object gate: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /measure unmerged_develop_files=0/);
    assert.match(r.stdout, /measure integration_ff_merges=0/);
    // Integration absorbed; the merge produced a real merge commit (develop-only .md survives).
    assert.equal(gitCmd(dir, "merge-base", "--is-ancestor", "integration", "develop").status, 0);
    assert.equal(gitCmd(dir, "rev-list", "--count", "develop..integration").stdout.trim(), "0");
    assert.equal(gitCmd(dir, "show", "develop:orchestration/manager-tick.md").stdout, "manager md\n");
  } finally {
    cleanup(dir);
  }
});

test("OBJECT GATE (AC1 negative control): a fast-forward of TESTED code (integration's own .ts) is NOT a false positive", () => {
  // integration is a descendant of develop (FF): the three-dot develop-side surface is EMPTY, so a
  // code file that integration itself added (and the suite tested on the integration tip) must NOT be
  // flagged — the gate is about develop-side untested code, not integration's tested code.
  const dir = makeTmp("objgateff");
  try {
    initGitRepo(dir);
    mkdirSync(join(dir, "orchestration"), { recursive: true });
    writeFileSync(join(dir, "orchestration", "tick-log.md"), "tick base\n", "utf8");
    commitAll(dir, "base");
    gitCmd(dir, "branch", "-M", "master");
    gitCmd(dir, "checkout", "-q", "-b", "develop");
    writeFileSync(join(dir, "orchestration", "tick-log.md"), "tick dev\n", "utf8");
    commitAll(dir, "dev-1");
    gitCmd(dir, "checkout", "-q", "-b", "integration");
    // integration adds TESTED code.
    writeFileSync(join(dir, "feature.ts"), "feature v1\n", "utf8");
    commitAll(dir, "integration feature (tested)");

    const r = run([batchMerge, "--root", dir]);
    assert.equal(r.status, 0, `FF of tested code must pass the object gate: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /measure unmerged_develop_files=0/);
    assert.match(r.stdout, /fast-forwarded to integration/);
    assert.equal(gitCmd(dir, "merge-base", "--is-ancestor", "integration", "develop").status, 0);
    assert.equal(gitCmd(dir, "show", "develop:feature.ts").stdout, "feature v1\n");
  } finally {
    cleanup(dir);
  }
});

test("OBJECT GATE: dry-run reports the would-block measure and the offending file WITHOUT failing (no ref moved)", () => {
  const dir = developCodeRepo("objgatedry");
  try {
    const devBefore = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    const r = run([batchMerge, "--root", dir, "--dry-run", "--merge"]);
    // Dry-run on divergence exits non-zero regardless (NOT a clean FF) — but the object gate reports
    // the would-block without a fail-closed verdict of its own.
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /measure unmerged_develop_files=1/);
    assert.match(r.stdout, /src-new-code\.ts/);
    assert.match(r.stdout, /object gate WOULD fail closed/);
    assert.ok(!/OBJECT-GATE FAIL-CLOSED/.test(r.stderr), "dry-run must not emit the fail-closed verdict");
    assert.equal(gitCmd(dir, "rev-parse", "develop").stdout.trim(), devBefore);
  } finally {
    cleanup(dir);
  }
});
