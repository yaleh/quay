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
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
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

// Build a diverged two-line repo. `withCodeConflict` makes BOTH sides touch `code.ts` (a real code
// conflict); otherwise only known-shared files conflict.
function divergedRepo(prefix, { withCodeConflict = false } = {}) {
  const dir = makeTmp(prefix);
  initGitRepo(dir);
  mkdirSync(join(dir, "orchestration"), { recursive: true });
  mkdirSync(join(dir, "tasks"), { recursive: true });
  writeFileSync(join(dir, "orchestration", "tick-log.md"), "tick line 1\n", "utf8");
  writeFileSync(join(dir, "orchestration", "queue-state.md"), "queue 1\n", "utf8");
  writeFileSync(join(dir, "tasks", "one.md"), "task 1\n", "utf8");
  if (withCodeConflict) writeFileSync(join(dir, "code.ts"), "v1\n", "utf8");
  commitAll(dir, "base");
  gitCmd(dir, "branch", "-M", "master");
  gitCmd(dir, "checkout", "-q", "-b", "develop");
  gitCmd(dir, "checkout", "-q", "-b", "integration");

  // develop advances via direct commits (the empirical reality that negated FF-only).
  gitCmd(dir, "checkout", "-q", "develop");
  writeFileSync(join(dir, "orchestration", "tick-log.md"), "tick dev\n", "utf8");
  writeFileSync(join(dir, "orchestration", "queue-state.md"), "queue dev\n", "utf8");
  writeFileSync(join(dir, "tasks", "one.md"), "task dev\n", "utf8");
  if (withCodeConflict) writeFileSync(join(dir, "code.ts"), "dev v2\n", "utf8");
  writeFileSync(join(dir, "dev-only.txt"), "dev only\n", "utf8");
  commitAll(dir, "develop direct commit");

  // integration receives task merges.
  gitCmd(dir, "checkout", "-q", "integration");
  writeFileSync(join(dir, "orchestration", "tick-log.md"), "tick int\n", "utf8");
  writeFileSync(join(dir, "tasks", "one.md"), "task int\n", "utf8");
  if (withCodeConflict) writeFileSync(join(dir, "code.ts"), "int v2\n", "utf8");
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
  const dir = divergedRepo("ac3", { withCodeConflict: true });
  try {
    const before = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    const r = run([batchMerge, "--root", dir, "--merge"]);
    assert.notEqual(r.status, 0, "a real code conflict must fail closed even with --merge");
    assert.match(r.stdout, /DIVERGENCE/);
    assert.match(r.stderr, /REAL-MERGE FAIL-CLOSED/);
    // The code-conflict file list is reported.
    assert.match(r.stderr, /code conflict files:/);
    assert.match(r.stderr, /code\.ts/);
    // The shared conflict is NOT silently overwritten either — it is reported as blocked.
    assert.match(r.stderr, /would auto-resolve develop-authoritative/);
    assert.match(r.stderr, /orchestration\/tick-log\.md/);
    // Nothing moved — develop unchanged, integration NOT absorbed.
    assert.equal(gitCmd(dir, "rev-parse", "develop").stdout.trim(), before);
    assert.notEqual(gitCmd(dir, "merge-base", "--is-ancestor", "integration", "develop").status, 0);
    // No blind --ours/--theirs: develop's code.ts is still develop's version.
    assert.equal(gitCmd(dir, "show", "develop:code.ts").stdout, "dev v2\n");
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
    assert.match(r.stdout, /DIVERGENCE/);
    assert.match(r.stdout, /conflict classification:/);
    assert.match(r.stdout, /shared \(auto-resolve develop-authoritative\): 2/);
    assert.match(r.stdout, /code \(fail-closed, needs human\):\s+1/);
    assert.match(r.stdout, /orchestration\/tick-log\.md/);
    assert.match(r.stdout, /code\.ts/);
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
