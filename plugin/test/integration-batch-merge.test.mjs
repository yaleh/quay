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
//   8. REVERSE EDGE (gap-batch-merge-authoritative-direction-hardcoded-develop) — the conflict
//      resolution direction is NOT a fixed "develop always wins". A runtime-config file declared via
//      --integration-authoritative (e.g. orchestration/session-liveness.env, which tasks edit on
//      INTEGRATION) resolves to the INTEGRATION side on conflict, driven by a CONTENT criterion
//      (--reverse-edge-criterion, "the SESSION_TRANSCRIPTS name must be in the SESSION_TARGETS
//      table"): develop's defective "inner" side loses to integration's fixed "quay" side. Negative
//      controls: undeclared env conflict FAILS CLOSED; a declared candidate whose integration side
//      FAILS the criterion FAILS CLOSED (never blind-choose).
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

// The merge-mechanics tests below PREDATE the freshness gate (gap-batch-merge-gate-reads-stale-green)
// — they exercise the object / reconcile / real-merge-conflict gates in isolation and their fixtures
// have no `.quay/full-suite-state.json`. The freshness gate is ON by default (mechanical, not
// self-judged); these tests opt out EXPLICITLY via --skip-freshness-gate so the OTHER gates stay
// reachable. The freshness-gate tests at the bottom run WITHOUT the opt-out.
function runMerge(args, opts = {}) {
  return run([batchMerge, "--skip-freshness-gate", ...args], opts);
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

// Build a diverged repo with the REVERSE-EDGE (session-liveness.env) shape: BOTH sides modify
// orchestration/session-liveness.env (a runtime-config file tasks edit on INTEGRATION) PLUS the usual
// shared-file conflicts. develop's side is the DEFECTIVE version (SESSION_TRANSCRIPTS name "inner" NOT
// in the SESSION_TARGETS table — the transcript is silently ignored); integration's side is the FIXED
// version (name "quay" IN the table). `.env` is a real non-shared file, so WITHOUT a reverse-edge
// declaration the merge fails closed on it; WITH `--integration-authoritative` + a content criterion it
// resolves integration-side. `integrationDefective` swaps integration's side for a DIFFERENT defective
// name ("archguard", also not in the table) — the criterion-fail negative-control shape.
function reverseEdgeRepo(prefix, { integrationDefective = false } = {}) {
  const dir = makeTmp(prefix);
  initGitRepo(dir);
  mkdirSync(join(dir, "orchestration"), { recursive: true });
  mkdirSync(join(dir, "tasks"), { recursive: true });
  const envBase = 'SESSION_TARGETS="quay /home/yale/work/quay quay-0:inner"\n';
  writeFileSync(join(dir, "orchestration", "session-liveness.env"), envBase, "utf8");
  writeFileSync(join(dir, "orchestration", "tick-log.md"), "tick line 1\n", "utf8");
  writeFileSync(join(dir, "tasks", "one.md"), "task 1\n", "utf8");
  commitAll(dir, "base");
  gitCmd(dir, "branch", "-M", "master");
  gitCmd(dir, "checkout", "-q", "-b", "develop");
  gitCmd(dir, "checkout", "-q", "-b", "integration");

  // develop advances with the DEFECTIVE env + shared-file drift.
  gitCmd(dir, "checkout", "-q", "develop");
  writeFileSync(join(dir, "orchestration", "session-liveness.env"),
    envBase + 'SESSION_TRANSCRIPTS="inner /home/yale/.claude/projects/x.jsonl"\n', "utf8");
  writeFileSync(join(dir, "orchestration", "tick-log.md"), "tick dev\n", "utf8");
  writeFileSync(join(dir, "tasks", "one.md"), "task dev\n", "utf8");
  commitAll(dir, "develop defective env commit");

  // integration receives the FIXED env (or a DIFFERENT defective name when integrationDefective).
  gitCmd(dir, "checkout", "-q", "integration");
  const intTranscript = integrationDefective
    ? 'SESSION_TRANSCRIPTS="archguard /home/yale/.claude/projects/y.jsonl"\n'
    : 'SESSION_TRANSCRIPTS="quay /home/yale/.claude/projects/y.jsonl"\n';
  writeFileSync(join(dir, "orchestration", "session-liveness.env"), envBase + intTranscript, "utf8");
  writeFileSync(join(dir, "orchestration", "tick-log.md"), "tick int\n", "utf8");
  writeFileSync(join(dir, "tasks", "one.md"), "task int\n", "utf8");
  writeFileSync(join(dir, "int-only.txt"), "int only\n", "utf8");
  commitAll(dir, "integration fixed env commit");

  return dir;
}

// Write the session-liveness CONTENT criterion: "the SESSION_TRANSCRIPTS name must be in the
// SESSION_TARGETS table". Reads the integration-side env from stdin ONCE (stdin is a single stream — a
// second read would be empty), extracts the transcript name and the target name via `cut -d'"' -f2` +
// awk (NOT bash `${var#pat}` — an unescaped `"` inside a double-quoted parameter-expansion pattern is
// a bash syntax error), and exits 0 iff the transcript name is in the table. This is the mechanical
// rule that makes the reverse-edge direction CONTENT-driven (develop "inner" loses to integration
// "quay"), not a fixed "integration always wins".
function writeSessionCriterion(dir) {
  const path = join(dir, "session-criterion.sh");
  writeFileSync(path, [
    "#!/usr/bin/env bash",
    "set -u",
    "# stdin = integration-side session-liveness.env; read ONCE (stdin is a single stream).",
    'input="$(cat)"',
    'tr_line="$(printf \'%s\\n\' "$input" | grep \'^SESSION_TRANSCRIPTS=\' | head -1)"',
    'tgt_line="$(printf \'%s\\n\' "$input" | grep \'^SESSION_TARGETS=\' | head -1)"',
    '[ -z "$tr_line" ] && exit 1',
    '[ -z "$tgt_line" ] && exit 1',
    "tr_name=\"$(printf '%s\\n' \"$tr_line\" | cut -d'\"' -f2 | awk '{print $1}')\"",
    "tgt_name=\"$(printf '%s\\n' \"$tgt_line\" | cut -d'\"' -f2 | awk '{print $1}')\"",
    '[ -z "$tr_name" ] && exit 1',
    'printf \'%s\\n\' "$tgt_name" | grep -qx "$tr_name"',
  ].join("\n"), "utf8");
  return path;
}

// ── AC1: divergence surface on NOT-FF, fail-closed (no --merge) ─────────────────────────────────────

test("AC1: TRUE divergence (no --merge) reports the divergence surface AND fails closed, nothing moved", () => {
  const dir = divergedRepo("ac1");
  try {
    const before = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    const r = runMerge(["--root", dir]);
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
    const r = runMerge(["--root", dir, "--dry-run"]);
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
    const r = runMerge(["--root", dir, "--merge"]);
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
    const r = runMerge(["--root", dir, "--merge"]);
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
    const r = runMerge(["--root", dir, "--merge"]);
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
    const r = runMerge(["--root", dir, "--dry-run", "--merge"]);
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
    const r = runMerge(["--root", dir, "--merge"]);
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

    const r = runMerge(["--root", dir, "--merge"]);
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

    const r = runMerge(["--root", dir, "--reconcile"]);
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

    const r = runMerge(["--root", dir, "--reconcile"]);
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
    const r = runMerge(["--root", dir, "--merge", "--reconcile"]);
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
    const r = runMerge(["--root", dir, "--merge"]);
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
    const r = runMerge(["--root", dir, "--merge"]);
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

    const r = runMerge(["--root", dir]);
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
    const r = runMerge(["--root", dir, "--dry-run", "--merge"]);
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

// ── REVERSE EDGE (gap-batch-merge-authoritative-direction-hardcoded-develop) ────────────────────────
//
// The conflict resolution direction is NOT a fixed "develop always wins". Runtime-config files (env/
// config) that tasks edit on INTEGRATION can have develop's copy be the STALE/DEFECTIVE one. The
// empirical anchor (2026-08-08 14:1xZ): orchestration/session-liveness.env — develop has
// SESSION_TRANSCRIPTS="inner /path" (name NOT in the SESSION_TARGETS table ⇒ defective), integration
// has "quay /path" (name IN the table ⇒ fixed). The correct resolution is integration-authoritative,
// driven by the CONTENT criterion "the transcript name must be in the target table", not a fixed
// direction. `--integration-authoritative <glob>` declares the reverse edge; `--reverse-edge-criterion
// <script>` gates it on the integration side's content (taken only when the criterion passes, else
// fail-closed — never blind-choose).

test("REVERSE-EDGE AC2: --integration-authoritative + content criterion resolves session-liveness.env integration-side (develop defective, integration fixed)", () => {
  const dir = reverseEdgeRepo("re1");
  try {
    const criterion = writeSessionCriterion(dir);
    const before = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    const integ = gitCmd(dir, "rev-parse", "integration").stdout.trim();
    const r = runMerge(["--root", dir, "--merge",
      "--integration-authoritative", "orchestration/session-liveness.env",
      "--reverse-edge-criterion", criterion]);
    assert.equal(r.status, 0, `reverse-edge merge should succeed: ${r.stdout}${r.stderr}`);
    // The env resolved INTEGRATION-authoritative: the fixed "quay" version (not develop's "inner").
    const env = gitCmd(dir, "show", "develop:orchestration/session-liveness.env").stdout;
    assert.match(env, /^SESSION_TRANSCRIPTS="quay /m, "develop must carry the integration (fixed) env");
    assert.ok(!/^SESSION_TRANSCRIPTS="inner /.test(env), "develop's defective 'inner' must NOT win");
    // The criterion gate was applied and satisfied.
    assert.match(r.stdout, /content criterion satisfied for orchestration\/session-liveness\.env/);
    assert.match(r.stdout, /resolving integration-authoritative conflicts \(integration side, 1\)/);
    // AC3: the unlisted SHARED files still resolve develop-authoritative in the SAME merge (mixed
    // direction — the reverse edge is per-file, not a global direction flip).
    assert.equal(gitCmd(dir, "show", "develop:orchestration/tick-log.md").stdout, "tick dev\n");
    assert.equal(gitCmd(dir, "show", "develop:tasks/one.md").stdout, "task dev\n");
    // Real merge commit (two parents), integration absorbed.
    const parents = gitCmd(dir, "rev-list", "--parents", "-n", "1", "develop").stdout.trim().split(/\s+/);
    assert.equal(parents.length, 3, "merge commit must have two parents");
    assert.equal(parents[1], before, "parent 1 = the old develop tip");
    assert.equal(parents[2], integ, "parent 2 = integration tip");
    assert.equal(gitCmd(dir, "merge-base", "--is-ancestor", "integration", "develop").status, 0);
    assert.equal(gitCmd(dir, "rev-list", "--count", "develop..integration").stdout.trim(), "0");
  } finally {
    cleanup(dir);
  }
});

test("REVERSE-EDGE AC2 (fixed-direction form): --integration-authoritative WITHOUT a criterion resolves the declared file integration-side", () => {
  // Candidate A's minimal form: the declared file resolves integration-side unconditionally. The
  // content-criterion form (above) is the RECOMMENDED backing; this form is the direct expression.
  const dir = reverseEdgeRepo("re2");
  try {
    const r = runMerge(["--root", dir, "--merge",
      "--integration-authoritative", "orchestration/session-liveness.env"]);
    assert.equal(r.status, 0, `fixed-direction reverse-edge merge should succeed: ${r.stdout}${r.stderr}`);
    const env = gitCmd(dir, "show", "develop:orchestration/session-liveness.env").stdout;
    assert.match(env, /^SESSION_TRANSCRIPTS="quay /m);
    assert.equal(gitCmd(dir, "show", "develop:orchestration/tick-log.md").stdout, "tick dev\n");
    assert.equal(gitCmd(dir, "merge-base", "--is-ancestor", "integration", "develop").status, 0);
    assert.equal(gitCmd(dir, "rev-list", "--count", "develop..integration").stdout.trim(), "0");
  } finally {
    cleanup(dir);
  }
});

test("REVERSE-EDGE AC4 (negative control): WITHOUT a reverse-edge declaration, the env conflict is a real conflict → FAIL-CLOSED, nothing moved, shared files NOT silently resolved", () => {
  // The `.env` file is NOT one of the object gate's .ts/.js/.mjs/.sh extensions (gate passes), so the
  // REAL-MERGE code-conflict backstop is what blocks — exactly the pre-fix behavior the task fixes.
  const dir = reverseEdgeRepo("re3");
  try {
    const before = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    const r = runMerge(["--root", dir, "--merge"]);
    assert.notEqual(r.status, 0, "an undeclared env conflict must fail closed");
    assert.match(r.stdout, /measure unmerged_develop_files=0/, "object gate must NOT be the blocker (.env)");
    assert.match(r.stderr, /REAL-MERGE FAIL-CLOSED/);
    assert.match(r.stderr, /code conflict files:/);
    assert.match(r.stderr, /orchestration\/session-liveness\.env/);
    // Shared files are reported as blocked (not silently resolved either).
    assert.match(r.stderr, /would auto-resolve develop-authoritative/);
    assert.match(r.stderr, /orchestration\/tick-log\.md/);
    // Nothing moved; develop's defective env is intact (never blindly resolved).
    assert.equal(gitCmd(dir, "rev-parse", "develop").stdout.trim(), before);
    assert.notEqual(gitCmd(dir, "merge-base", "--is-ancestor", "integration", "develop").status, 0);
    assert.equal(gitCmd(dir, "show", "develop:orchestration/session-liveness.env").stdout,
      'SESSION_TARGETS="quay /home/yale/work/quay quay-0:inner"\nSESSION_TRANSCRIPTS="inner /home/yale/.claude/projects/x.jsonl"\n');
  } finally {
    cleanup(dir);
  }
});

test("REVERSE-EDGE AC4 (negative control): declared reverse-edge but the integration side FAILS the content criterion → FAIL-CLOSED (never blind-choose)", () => {
  // integration's side is ALSO defective ("archguard" not in the quay-only table) — the criterion is
  // NOT satisfied on the integration side, so there is NO mechanical basis to take it. The file fails
  // closed rather than shipping either side: this is what makes the direction CONTENT-driven, not a
  // fixed "integration always wins" either.
  const dir = reverseEdgeRepo("re4", { integrationDefective: true });
  try {
    const criterion = writeSessionCriterion(dir);
    const before = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    const r = runMerge(["--root", dir, "--merge",
      "--integration-authoritative", "orchestration/session-liveness.env",
      "--reverse-edge-criterion", criterion]);
    assert.notEqual(r.status, 0, "a criterion-failing reverse-edge candidate must fail closed");
    assert.match(r.stderr, /content criterion NOT satisfied for orchestration\/session-liveness\.env/);
    assert.match(r.stderr, /REAL-MERGE FAIL-CLOSED/);
    assert.match(r.stderr, /orchestration\/session-liveness\.env/);
    // Nothing moved — neither side was blindly chosen.
    assert.equal(gitCmd(dir, "rev-parse", "develop").stdout.trim(), before);
    assert.notEqual(gitCmd(dir, "merge-base", "--is-ancestor", "integration", "develop").status, 0);
    assert.equal(gitCmd(dir, "show", "develop:orchestration/session-liveness.env").stdout,
      'SESSION_TARGETS="quay /home/yale/work/quay quay-0:inner"\nSESSION_TRANSCRIPTS="inner /home/yale/.claude/projects/x.jsonl"\n');
  } finally {
    cleanup(dir);
  }
});

test("REVERSE-EDGE contract measure: --merge --integration-authoritative 'orchestration/session-liveness.env' --dry-run reports the env as integration-authoritative (resolvable, integration side) without moving any ref", () => {
  const dir = reverseEdgeRepo("re5");
  try {
    const before = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    const r = runMerge(["--root", dir, "--merge", "--dry-run",
      "--integration-authoritative", "orchestration/session-liveness.env"]);
    assert.notEqual(r.status, 0, "dry-run on divergence exits non-zero (NOT a clean FF)");
    assert.match(r.stdout, /DIVERGENCE/);
    assert.match(r.stdout, /conflict classification:/);
    // The env file is classified in the integration-authoritative (reverse-edge) bucket — the tool
    // can now EXPRESS the correct resolution direction (integration side), unlike pre-fix.
    assert.match(r.stdout, /integration-authoritative \(reverse-edge, integration side\):\s+1/);
    assert.match(r.stdout, /orchestration\/session-liveness\.env/);
    // It is NOT in the code (fail-closed) bucket; shared files remain develop-authoritative.
    assert.match(r.stdout, /shared \(auto-resolve develop-authoritative\):\s+2/);
    assert.match(r.stdout, /code \(fail-closed, needs human\):\s+0/);
    // No ref moved.
    assert.equal(gitCmd(dir, "rev-parse", "develop").stdout.trim(), before);
    assert.notEqual(gitCmd(dir, "merge-base", "--is-ancestor", "integration", "develop").status, 0);
  } finally {
    cleanup(dir);
  }
});

// ── FRESHNESS GATE (gap-batch-merge-gate-reads-stale-green) ────────────────────────────────────────
//
// The batch-merge gate previously read ONLY `state == green` and treated a 3-hour-old green — measuring
// a COMPLETELY DIFFERENT batch of commits — as a pass for THIS tree (7b1ac3a1, 2026-08-08: merge at
// 06:07:22, state file green from 02:50→03:02, zero suites in between). The freshness gate adds two
// dimensions, both required before any ref moves:
//   1. AGE — `finishedAt` within `--freshness-window` (default 3600s) of now.
//   2. COVERAGE — the suite STARTED at/after the most recent integration fan-in commit time (a fan-in
//      that landed after the suite ran means the green did not test the pending tip).
// Fail-closed on: absent state file, state != green, missing/unparseable finishedAt, age > window,
// or suite-started-before-last-fan-in. `--dry-run` reports the would-block without failing.
//
// These tests run the batch-merge script WITHOUT --skip-freshness-gate (the opt-out the merge-mechanics
// tests above use) — the freshness gate is the gate under test.

// Build an FF-able two-line repo (develop at base, integration = base + one fan-in committed at a
// CONTROLLED epoch) so the freshness gate's COVERAGE axis is deterministic (git commit dates are
// otherwise "now" and would race the suite times the test writes).
function freshnessRepo(prefix, fanInEpochSec) {
  const dir = makeTmp(prefix);
  initGitRepo(dir);
  mkdirSync(join(dir, "orchestration"), { recursive: true });
  writeFileSync(join(dir, "orchestration", "tick-log.md"), "tick base\n", "utf8");
  commitAll(dir, "base");
  gitCmd(dir, "branch", "-M", "master");
  gitCmd(dir, "checkout", "-q", "-b", "develop");
  gitCmd(dir, "checkout", "-q", "-b", "integration");
  writeFileSync(join(dir, "int-only.txt"), "int only\n", "utf8");
  const env = {
    ...process.env,
    GIT_AUTHOR_DATE: new Date(fanInEpochSec * 1000).toISOString(),
    GIT_COMMITTER_DATE: new Date(fanInEpochSec * 1000).toISOString(),
  };
  gitCmd(dir, "add", "-A");
  const res = spawnSync("git", ["-C", dir, "commit", "-q", "-m", "fan-in (controlled time)"], { encoding: "utf8", env });
  assert.equal(res.status, 0, `fan-in commit failed: ${res.stderr}`);
  gitCmd(dir, "checkout", "-q", "develop");
  return dir;
}

// Write a suite-state file (finishedAt EPOCH SECONDS — the format the runner now writes, and the
// format the freshness gate's Contract measure `int(time.time() - finishedAt)` consumes).
function writeSuiteStateFile(dir, { state = "green", finishedAtEpoch, startedAtIso } = {}) {
  const stateDir = join(dir, ".quay");
  mkdirSync(stateDir, { recursive: true });
  const data = {
    state,
    runner: "outer",
    startedAt: startedAtIso ?? new Date().toISOString(),
    finishedAt: finishedAtEpoch ?? Math.floor(Date.now() / 1000),
    durationMs: 1000,
    laneCount: 8,
  };
  const file = join(stateDir, "full-suite-state.json");
  writeFileSync(file, JSON.stringify(data), "utf8");
  return file;
}

test("FRESHNESS GATE (AC2, 7b1ac3a1 scenario): a 3-hour-old green + a fan-in that landed after the suite ⇒ batch merge BLOCKED, nothing moved", () => {
  const now = Math.floor(Date.now() / 1000);
  // The 7b1ac3a1 shape: suite finished 03:02 (3h ago); the last fan-in landed at ~06:0x (1h ago) —
  // AFTER the suite finished, so the green measured a completely different batch of commits.
  const dir = freshnessRepo("fsa1", now - 3600);
  try {
    const devBefore = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    writeSuiteStateFile(dir, {
      finishedAtEpoch: now - 10800,
      startedAtIso: new Date((now - 11400) * 1000).toISOString(),
    });
    const r = run([batchMerge, "--root", dir]);
    assert.notEqual(r.status, 0, "stale green + new fan-in must block the batch merge");
    assert.match(r.stderr, /FRESHNESS-GATE FAIL-CLOSED/);
    assert.match(r.stderr, /STALE|fan-in landed on integration after the suite started/);
    assert.match(r.stdout, /measure suite_freshness=1080\d/, "age ≈ 3h (10800s, ±drift for test clock time)");
    // Nothing moved: develop unchanged, integration NOT absorbed.
    assert.equal(gitCmd(dir, "rev-parse", "develop").stdout.trim(), devBefore);
    assert.notEqual(gitCmd(dir, "merge-base", "--is-ancestor", "integration", "develop").status, 0);
  } finally {
    cleanup(dir);
  }
});

test("FRESHNESS GATE (AC2 negative control): a fresh green that tested the current tip ⇒ batch merge ALLOWED (develop fast-forwards)", () => {
  const now = Math.floor(Date.now() / 1000);
  const dir = freshnessRepo("fsa2", now - 600); // last fan-in 10m ago — BEFORE the suite ran
  try {
    // Suite just finished: started 2m ago, finished 30s ago (well within the 3600s window, after the fan-in).
    writeSuiteStateFile(dir, {
      finishedAtEpoch: now - 30,
      startedAtIso: new Date((now - 120) * 1000).toISOString(),
    });
    const r = run([batchMerge, "--root", dir]);
    assert.equal(r.status, 0, `fresh green must allow the batch merge: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /freshness-gate OK/);
    assert.match(r.stdout, /measure suite_freshness=\d+/);
    assert.match(r.stdout, /fast-forwarded to integration/);
    // Develop advanced to the integration tip; integration absorbed.
    assert.equal(gitCmd(dir, "merge-base", "--is-ancestor", "integration", "develop").status, 0);
    assert.equal(gitCmd(dir, "rev-list", "--count", "develop..integration").stdout.trim(), "0");
  } finally {
    cleanup(dir);
  }
});

test("FRESHNESS GATE (coverage axis): a fresh green (within window) that did NOT test the current tip (fan-in landed after the suite started) ⇒ BLOCKED", () => {
  const now = Math.floor(Date.now() / 1000);
  const dir = freshnessRepo("fsa3", now - 60); // fan-in 1m ago — AFTER the suite started 2m ago
  try {
    const devBefore = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    writeSuiteStateFile(dir, {
      finishedAtEpoch: now - 30, // within window — the AGE axis would pass
      startedAtIso: new Date((now - 120) * 1000).toISOString(),
    });
    const r = run([batchMerge, "--root", dir]);
    assert.notEqual(r.status, 0, "a green that predates the current tip must block even when fresh");
    assert.match(r.stderr, /FRESHNESS-GATE FAIL-CLOSED/);
    assert.match(r.stderr, /a fan-in landed on integration after the suite started/);
    assert.match(r.stdout, /measure suite_freshness=3\d/, "age ≈ 30s, within the window — the coverage axis is what blocks");
    assert.equal(gitCmd(dir, "rev-parse", "develop").stdout.trim(), devBefore);
    assert.notEqual(gitCmd(dir, "merge-base", "--is-ancestor", "integration", "develop").status, 0);
  } finally {
    cleanup(dir);
  }
});

test("FRESHNESS GATE: absent suite-state file ⇒ BLOCKED (no valid green — the '缺 state 同路径：不批量合' rule)", () => {
  const dir = freshnessRepo("fsa4", Math.floor(Date.now() / 1000) - 60);
  try {
    const devBefore = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    const r = run([batchMerge, "--root", dir]);
    assert.notEqual(r.status, 0, "no suite-state file = no valid green = no batch merge");
    assert.match(r.stderr, /FRESHNESS-GATE FAIL-CLOSED/);
    assert.match(r.stderr, /suite-state file not found/);
    assert.match(r.stdout, /measure suite_freshness=unknown/);
    assert.equal(gitCmd(dir, "rev-parse", "develop").stdout.trim(), devBefore);
  } finally {
    cleanup(dir);
  }
});

test("FRESHNESS GATE: state=running (no completed green) ⇒ BLOCKED", () => {
  const dir = freshnessRepo("fsa5", Math.floor(Date.now() / 1000) - 60);
  try {
    const devBefore = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    writeSuiteStateFile(dir, { state: "running", finishedAtEpoch: Math.floor(Date.now() / 1000) });
    const r = run([batchMerge, "--root", dir]);
    assert.notEqual(r.status, 0, "a running suite has produced no completed green — no batch merge");
    assert.match(r.stderr, /FRESHNESS-GATE FAIL-CLOSED/);
    assert.match(r.stderr, /state='running'/);
    assert.equal(gitCmd(dir, "rev-parse", "develop").stdout.trim(), devBefore);
  } finally {
    cleanup(dir);
  }
});

test("FRESHNESS GATE: --dry-run with a stale green reports the would-block measure WITHOUT failing (no ref moved)", () => {
  const now = Math.floor(Date.now() / 1000);
  const dir = freshnessRepo("fsa6", now - 3600);
  try {
    const devBefore = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    writeSuiteStateFile(dir, {
      finishedAtEpoch: now - 10800,
      startedAtIso: new Date((now - 11400) * 1000).toISOString(),
    });
    const r = run([batchMerge, "--root", dir, "--dry-run"]);
    // Dry-run does NOT fail even when the gate would block — it reports the would-block (mirrors the
    // object gate's dry-run contract). No ref moved.
    assert.equal(r.status, 0, "dry-run must not fail even when the freshness gate would block");
    assert.match(r.stdout, /DRY-RUN — freshness gate WOULD fail closed/);
    assert.match(r.stdout, /measure suite_freshness=1080\d/, "age ≈ 3h (10800s, ±drift)");
    assert.equal(gitCmd(dir, "rev-parse", "develop").stdout.trim(), devBefore);
    assert.notEqual(gitCmd(dir, "merge-base", "--is-ancestor", "integration", "develop").status, 0);
  } finally {
    cleanup(dir);
  }
});

test("FRESHNESS GATE: legacy ISO finishedAt (pre-normalization state file) is parsed correctly and a fresh green is allowed", () => {
  const now = Math.floor(Date.now() / 1000);
  const dir = freshnessRepo("fsa7", now - 600);
  try {
    // Legacy state files (written before the 2026-08-08 epoch normalization) carry finishedAt as ISO 8601.
    const stateDir = join(dir, ".quay");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "full-suite-state.json"), JSON.stringify({
      state: "green",
      runner: "outer",
      startedAt: new Date((now - 120) * 1000).toISOString(),
      finishedAt: new Date((now - 30) * 1000).toISOString(),
      durationMs: 90000,
      laneCount: 8,
    }), "utf8");
    const r = run([batchMerge, "--root", dir]);
    assert.equal(r.status, 0, `legacy ISO finishedAt must parse as fresh: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /freshness-gate OK/);
    assert.match(r.stdout, /measure suite_freshness=\d+/);
    assert.equal(gitCmd(dir, "merge-base", "--is-ancestor", "integration", "develop").status, 0);
  } finally {
    cleanup(dir);
  }
});
