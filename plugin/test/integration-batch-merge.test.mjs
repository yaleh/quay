// @test-group engine
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
//      --integration-authoritative (e.g. orchestration/session-config.env, which tasks edit on
//      INTEGRATION) resolves to the INTEGRATION side on conflict, driven by a CONTENT criterion
//      (--reverse-edge-criterion, "the SESSION_TRANSCRIPTS name must be in the SESSION_TARGETS
//      table"): develop's defective "inner" side loses to integration's fixed "quay" side. Negative
//      controls: undeclared env conflict FAILS CLOSED; a declared candidate whose integration side
//      FAILS the criterion FAILS CLOSED (never blind-choose).
//
// All fixtures are self-contained temp git repos; nothing in the real checkout is mutated (R3
// test-isolation). `// @test-group engine` — methodology-execution surface, not product.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
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
// and the worktree-green gate (gap-suite-fix-scope-worktree-green-merge-gate) — they exercise the
// object / reconcile / real-merge-conflict gates in isolation and their fixtures have no
// `.quay/full-suite-state.json` and no `.quay/verification-round.jsonl`. Both gates are ON by default
// (mechanical, not self-judged); these tests opt out EXPLICITLY via --skip-freshness-gate and
// --skip-worktree-green-gate so the OTHER gates stay reachable. The freshness-gate tests at the bottom
// run WITHOUT the opt-outs.
function runMerge(args, opts = {}) {
  return run([batchMerge, "--skip-freshness-gate", "--skip-worktree-green-gate", ...args], opts);
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

// Build a diverged repo with the REVERSE-EDGE (session-config.env) shape: BOTH sides modify
// orchestration/session-config.env (a runtime-config file tasks edit on INTEGRATION) PLUS the usual
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
  writeFileSync(join(dir, "orchestration", "session-config.env"), envBase, "utf8");
  writeFileSync(join(dir, "orchestration", "tick-log.md"), "tick line 1\n", "utf8");
  writeFileSync(join(dir, "tasks", "one.md"), "task 1\n", "utf8");
  commitAll(dir, "base");
  gitCmd(dir, "branch", "-M", "master");
  gitCmd(dir, "checkout", "-q", "-b", "develop");
  gitCmd(dir, "checkout", "-q", "-b", "integration");

  // develop advances with the DEFECTIVE env + shared-file drift.
  gitCmd(dir, "checkout", "-q", "develop");
  writeFileSync(join(dir, "orchestration", "session-config.env"),
    envBase + 'SESSION_TRANSCRIPTS="inner /home/yale/.claude/projects/x.jsonl"\n', "utf8");
  writeFileSync(join(dir, "orchestration", "tick-log.md"), "tick dev\n", "utf8");
  writeFileSync(join(dir, "tasks", "one.md"), "task dev\n", "utf8");
  commitAll(dir, "develop defective env commit");

  // integration receives the FIXED env (or a DIFFERENT defective name when integrationDefective).
  gitCmd(dir, "checkout", "-q", "integration");
  const intTranscript = integrationDefective
    ? 'SESSION_TRANSCRIPTS="archguard /home/yale/.claude/projects/y.jsonl"\n'
    : 'SESSION_TRANSCRIPTS="quay /home/yale/.claude/projects/y.jsonl"\n';
  writeFileSync(join(dir, "orchestration", "session-config.env"), envBase + intTranscript, "utf8");
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
    "# stdin = integration-side session-config.env; read ONCE (stdin is a single stream).",
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

// ── --run-id: real-merge commit carries the runId (gap-task-telemetry-6-percent-join) ──────────────

test("--run-id: a real merge commit's subject carries (runId: <id>)", () => {
  const dir = divergedRepo("runid");
  try {
    const r = runMerge(["--root", dir, "--merge", "--run-id", "fm-ac2-123-abc"]);
    assert.equal(r.status, 0, `--merge --run-id should succeed: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /measure fanin_runid_present=true/);
    const subject = gitCmd(dir, "log", "-1", "--format=%s", "develop").stdout.trim();
    assert.match(subject, /runId: fm-ac2-123-abc/, `merge commit subject must carry the runId, got: ${subject}`);
    assert.match(subject, /^merge: fan-in /, "the runId-bearing merge subject keeps the fan-in prefix");
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
// empirical anchor (2026-08-08 14:1xZ): orchestration/session-config.env — develop has
// SESSION_TRANSCRIPTS="inner /path" (name NOT in the SESSION_TARGETS table ⇒ defective), integration
// has "quay /path" (name IN the table ⇒ fixed). The correct resolution is integration-authoritative,
// driven by the CONTENT criterion "the transcript name must be in the target table", not a fixed
// direction. `--integration-authoritative <glob>` declares the reverse edge; `--reverse-edge-criterion
// <script>` gates it on the integration side's content (taken only when the criterion passes, else
// fail-closed — never blind-choose).

test("REVERSE-EDGE AC2: --integration-authoritative + content criterion resolves session-config.env integration-side (develop defective, integration fixed)", () => {
  const dir = reverseEdgeRepo("re1");
  try {
    const criterion = writeSessionCriterion(dir);
    const before = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    const integ = gitCmd(dir, "rev-parse", "integration").stdout.trim();
    const r = runMerge(["--root", dir, "--merge",
      "--integration-authoritative", "orchestration/session-config.env",
      "--reverse-edge-criterion", criterion]);
    assert.equal(r.status, 0, `reverse-edge merge should succeed: ${r.stdout}${r.stderr}`);
    // The env resolved INTEGRATION-authoritative: the fixed "quay" version (not develop's "inner").
    const env = gitCmd(dir, "show", "develop:orchestration/session-config.env").stdout;
    assert.match(env, /^SESSION_TRANSCRIPTS="quay /m, "develop must carry the integration (fixed) env");
    assert.ok(!/^SESSION_TRANSCRIPTS="inner /.test(env), "develop's defective 'inner' must NOT win");
    // The criterion gate was applied and satisfied.
    assert.match(r.stdout, /content criterion satisfied for orchestration\/session-config.env/);
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
      "--integration-authoritative", "orchestration/session-config.env"]);
    assert.equal(r.status, 0, `fixed-direction reverse-edge merge should succeed: ${r.stdout}${r.stderr}`);
    const env = gitCmd(dir, "show", "develop:orchestration/session-config.env").stdout;
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
    assert.match(r.stderr, /orchestration\/session-config.env/);
    // Shared files are reported as blocked (not silently resolved either).
    assert.match(r.stderr, /would auto-resolve develop-authoritative/);
    assert.match(r.stderr, /orchestration\/tick-log\.md/);
    // Nothing moved; develop's defective env is intact (never blindly resolved).
    assert.equal(gitCmd(dir, "rev-parse", "develop").stdout.trim(), before);
    assert.notEqual(gitCmd(dir, "merge-base", "--is-ancestor", "integration", "develop").status, 0);
    assert.equal(gitCmd(dir, "show", "develop:orchestration/session-config.env").stdout,
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
      "--integration-authoritative", "orchestration/session-config.env",
      "--reverse-edge-criterion", criterion]);
    assert.notEqual(r.status, 0, "a criterion-failing reverse-edge candidate must fail closed");
    assert.match(r.stderr, /content criterion NOT satisfied for orchestration\/session-config.env/);
    assert.match(r.stderr, /REAL-MERGE FAIL-CLOSED/);
    assert.match(r.stderr, /orchestration\/session-config.env/);
    // Nothing moved — neither side was blindly chosen.
    assert.equal(gitCmd(dir, "rev-parse", "develop").stdout.trim(), before);
    assert.notEqual(gitCmd(dir, "merge-base", "--is-ancestor", "integration", "develop").status, 0);
    assert.equal(gitCmd(dir, "show", "develop:orchestration/session-config.env").stdout,
      'SESSION_TARGETS="quay /home/yale/work/quay quay-0:inner"\nSESSION_TRANSCRIPTS="inner /home/yale/.claude/projects/x.jsonl"\n');
  } finally {
    cleanup(dir);
  }
});

test("REVERSE-EDGE contract measure: --merge --integration-authoritative 'orchestration/session-config.env' --dry-run reports the env as integration-authoritative (resolvable, integration side) without moving any ref", () => {
  const dir = reverseEdgeRepo("re5");
  try {
    const before = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    const r = runMerge(["--root", dir, "--merge", "--dry-run",
      "--integration-authoritative", "orchestration/session-config.env"]);
    assert.notEqual(r.status, 0, "dry-run on divergence exits non-zero (NOT a clean FF)");
    assert.match(r.stdout, /DIVERGENCE/);
    assert.match(r.stdout, /conflict classification:/);
    // The env file is classified in the integration-authoritative (reverse-edge) bucket — the tool
    // can now EXPRESS the correct resolution direction (integration side), unlike pre-fix.
    assert.match(r.stdout, /integration-authoritative \(reverse-edge, integration side\):\s+1/);
    assert.match(r.stdout, /orchestration\/session-config.env/);
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
// `docOnly` makes the fan-in touch ONLY .md/.jsonl files (the doc-only-exemption shape — the
// observed phase-goal / SPEC-goal-store / SPEC-edit commits); `codeFile` makes it add a real code
// file (feature.ts) instead. The default keeps the historical `int-only.txt` fan-in.
// `worktreeRound=false` omits the worktree+green verification-round record (gap-suite-fix-scope-
// worktree-green-merge-gate) so the worktree-green gate is the gate under test (rejection path).
function freshnessRepo(prefix, fanInEpochSec, { docOnly = false, codeFile = false, worktreeRound = true } = {}) {
  const dir = makeTmp(prefix);
  initGitRepo(dir);
  mkdirSync(join(dir, "orchestration"), { recursive: true });
  writeFileSync(join(dir, "orchestration", "tick-log.md"), "tick base\n", "utf8");
  commitAll(dir, "base");
  gitCmd(dir, "branch", "-M", "master");
  gitCmd(dir, "checkout", "-q", "-b", "develop");
  gitCmd(dir, "checkout", "-q", "-b", "integration");
  if (docOnly) {
    // The doc-only fan-in: .md + .jsonl only — the phase-goal / SPEC-goal-store / SPEC-edit shape.
    writeFileSync(join(dir, "orchestration", "tick-log.md"), "tick int doc\n", "utf8");
    writeFileSync(join(dir, "orchestration", "SPEC-goal-store.md"), "SPEC update\n", "utf8");
    writeFileSync(join(dir, "orchestration", "events.jsonl"), '{"event":1}\n', "utf8");
  } else if (codeFile) {
    writeFileSync(join(dir, "feature.ts"), "export const x = 1;\n", "utf8");
  } else {
    writeFileSync(join(dir, "int-only.txt"), "int only\n", "utf8");
  }
  const env = {
    ...process.env,
    GIT_AUTHOR_DATE: new Date(fanInEpochSec * 1000).toISOString(),
    GIT_COMMITTER_DATE: new Date(fanInEpochSec * 1000).toISOString(),
  };
  gitCmd(dir, "add", "-A");
  const res = spawnSync("git", ["-C", dir, "commit", "-q", "-m", "fan-in (controlled time)"], { encoding: "utf8", env });
  assert.equal(res.status, 0, `fan-in commit failed: ${res.stderr}`);
  gitCmd(dir, "checkout", "-q", "develop");
  // gap-suite-fix-scope-worktree-green-merge-gate: the fan-in path requires ≥1 worktree+green round on
  // record BEFORE merging. These freshness fixtures model the NORMAL shape (a suite-fix subagent already
  // self-tested green in a worktree, then the current main-scoped green is what freshness judges), so
  // the worktree-green gate PASSES and the freshness gate stays the gate under test.
  if (worktreeRound) writeWorktreeGreenRound(dir);
  return dir;
}

// Commit every staged change with a CONTROLLED author/committer date (epoch seconds) — the same
// deterministic-time pattern freshnessRepo uses inline, factored out so the verified-merge repo can
// make two fan-ins at two distinct epochs.
function commitAt(dir, message, epochSec) {
  const env = {
    ...process.env,
    GIT_AUTHOR_DATE: new Date(epochSec * 1000).toISOString(),
    GIT_COMMITTER_DATE: new Date(epochSec * 1000).toISOString(),
  };
  gitCmd(dir, "add", "-A");
  const res = spawnSync("git", ["-C", dir, "commit", "-q", "-m", message], { encoding: "utf8", env });
  assert.equal(res.status, 0, `commit "${message}" failed: ${res.stderr}`);
}

// Build the STRUCTURAL-LIVELOCK shape (gap-merge-green-snapshot-verified-commit-livelock): an FF-able
// two-line repo where integration has TWO commits — V (the VERIFIED commit: the integration tip when
// the green suite STARTED, measured at `verifiedEpochSec`) then N (a NEWER fan-in that landed AFTER the
// suite started at `newerEpochSec`; a code file feature.ts so the COVERAGE axis would fail-closed on it
// WITHOUT the verified-commit fix). The batch merge must advance develop to V (the tested point), NOT N.
function verifiedMergeRepo(prefix, { verifiedEpochSec, newerEpochSec }) {
  const dir = makeTmp(prefix);
  initGitRepo(dir);
  mkdirSync(join(dir, "orchestration"), { recursive: true });
  writeFileSync(join(dir, "orchestration", "tick-log.md"), "tick base\n", "utf8");
  commitAll(dir, "base");
  gitCmd(dir, "branch", "-M", "master");
  gitCmd(dir, "checkout", "-q", "-b", "develop");
  gitCmd(dir, "checkout", "-q", "-b", "integration");

  // Commit V — the integration tip the green suite VERIFIED (the tested point).
  writeFileSync(join(dir, "orchestration", "tick-log.md"), "tick int V\n", "utf8");
  writeFileSync(join(dir, "int-v.txt"), "int v\n", "utf8");
  commitAt(dir, "verified commit V (tested tip)", verifiedEpochSec);

  // Commit N — a NEWER fan-in that landed AFTER the suite started (untested; touches a code file so
  // the COVERAGE axis would fail-closed on it under the legacy merge-HEAD behavior).
  writeFileSync(join(dir, "orchestration", "tick-log.md"), "tick int N\n", "utf8");
  writeFileSync(join(dir, "feature.ts"), "new code\n", "utf8");
  commitAt(dir, "newer fan-in N (after suite start)", newerEpochSec);

  gitCmd(dir, "checkout", "-q", "develop");
  // gap-suite-fix-scope-worktree-green-merge-gate: fan-in requires ≥1 worktree+green round on record;
  // the verified-merge tests run the FULL gate stack (no skip flags), so give the fixture the normal
  // shape (suite-fix already self-tested green in a worktree) to keep the verified-commit behavior
  // under test.
  writeWorktreeGreenRound(dir);
  return dir;
}

// Write a suite-state file (finishedAt EPOCH SECONDS — the format the runner now writes, and the
// format the freshness gate's Contract measure `int(time.time() - finishedAt)` consumes).
// `scope` (main|worktree) is written by the runner (gap-worktree-scoped-runs-consume-resources-but-
// produce-no-signal AC1); when omitted the state is a legacy pre-scope file — the gate must treat it
// as main (fail-open, the runner's documented legacy semantics).
function writeSuiteStateFile(dir, { state = "green", scope, finishedAtEpoch, startedAtIso, verifiedCommit } = {}) {
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
  if (scope !== undefined) data.scope = scope;
  // gap-merge-green-snapshot-verified-commit-livelock AC2 — the commit the green VERIFIED (written by
  // full-suite-runner.ts at suite start); the batch merge merges THIS commit, not integration HEAD.
  if (verifiedCommit !== undefined) data.verifiedCommit = verifiedCommit;
  const file = join(stateDir, "full-suite-state.json");
  writeFileSync(file, JSON.stringify(data), "utf8");
  return file;
}

// Write a worktree+green verification-round record (gap-suite-fix-scope-worktree-green-merge-gate):
// the fan-in (batch-merge) path requires ≥1 `scope=worktree` AND `state=green` round on record before
// it will merge. The freshness-gate fixtures use this so the worktree-green gate PASSES and the
// freshness gate stays the gate under test (their fixture shape: a suite-fix subagent already
// self-tested green in a worktree, and the current main-scoped green is what freshness judges).
function writeWorktreeGreenRound(dir, { round = 1, state = "green", scope = "worktree" } = {}) {
  const stateDir = join(dir, ".quay");
  mkdirSync(stateDir, { recursive: true });
  const file = join(stateDir, "verification-round.jsonl");
  appendFileSync(file, JSON.stringify({ round, state, scope, startedAt: new Date().toISOString(), tests: 3000, runner: "suite-fix" }) + "\n", "utf8");
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

// ── FRESHNESS GATE DOC-ONLY EXEMPTION (gap-batch-merge-freshness-gate-doc-only-exemption) ───────────
//
// 3 consecutive doc-only blocks (rounds 153/157/158 — manager AC35 phase-goal →
// orchestration/manager-phase-goal.md, MILESTONE-NNN adjudication → orchestration/SPEC-goal-store.md,
// ongoing manager SPEC edits → orchestration/*.md) each cost a 17-min full-suite re-run: the batch
// merge ran green on the integration tip, a DOC-ONLY commit landed after the suite started, and the
// coverage axis fail-closed because the gate could not distinguish doc from code. The fix: when the
// fan-in(s) after the suite started touch ONLY .md/.jsonl files (which cannot change the test
// surface), the coverage axis is EXEMPT — the merge proceeds without a re-run. A fan-in touching ANY
// other file type (a code file) is NOT exempt — fail-closed exactly as before (negative control, AC3).

test("FRESHNESS GATE (doc-only exemption, AC2): a fan-in that landed after the suite started but touches ONLY .md/.jsonl ⇒ EXEMPT — no re-run, develop fast-forwards", () => {
  const now = Math.floor(Date.now() / 1000);
  // The observed shape: suite green on the integration tip, then a doc-only fan-in (phase-goal/SPEC
  // edit) landed AFTER the suite started. The AGE (finished 30s ago) + SCOPE (main) axes pass; the
  // COVERAGE axis would block — but the pending content is doc-only (.md/.jsonl), so the exemption
  // applies and the merge proceeds WITHOUT a re-run.
  const dir = freshnessRepo("fsd1", now - 60, { docOnly: true });
  try {
    const devBefore = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    writeSuiteStateFile(dir, {
      scope: "main",
      finishedAtEpoch: now - 30,
      startedAtIso: new Date((now - 120) * 1000).toISOString(),
    });
    const r = run([batchMerge, "--root", dir]);
    assert.equal(r.status, 0, `a doc-only fan-in after the suite start must be exempt: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /DOC-ONLY EXEMPT/);
    assert.match(r.stdout, /freshness-gate DOC-ONLY EXEMPT/);
    assert.match(r.stdout, /measure suite_freshness=\d+/);
    assert.match(r.stdout, /fast-forwarded to integration/);
    // Develop advanced to the integration tip; integration absorbed.
    assert.equal(gitCmd(dir, "merge-base", "--is-ancestor", "integration", "develop").status, 0);
    assert.equal(gitCmd(dir, "rev-list", "--count", "develop..integration").stdout.trim(), "0");
    assert.equal(gitCmd(dir, "show", "develop:orchestration/SPEC-goal-store.md").stdout, "SPEC update\n");
    assert.equal(gitCmd(dir, "show", "develop:orchestration/events.jsonl").stdout, '{"event":1}\n');
  } finally {
    cleanup(dir);
  }
});

test("FRESHNESS GATE (doc-only exemption, AC2 negative control): a fan-in that landed after the suite started and touches a CODE file ⇒ NOT exempt ⇒ BLOCKED, nothing moved", () => {
  const now = Math.floor(Date.now() / 1000);
  // The negative control: a real code file (feature.ts) in the pending fan-in — the exemption must
  // NOT apply, the coverage axis fails closed exactly as before.
  const dir = freshnessRepo("fsd2", now - 60, { codeFile: true });
  try {
    const devBefore = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    writeSuiteStateFile(dir, {
      scope: "main",
      finishedAtEpoch: now - 30,
      startedAtIso: new Date((now - 120) * 1000).toISOString(),
    });
    const r = run([batchMerge, "--root", dir]);
    assert.notEqual(r.status, 0, "a code-touching fan-in after the suite start must still block");
    assert.match(r.stderr, /FRESHNESS-GATE FAIL-CLOSED/);
    assert.match(r.stderr, /a fan-in landed on integration after the suite started/);
    assert.ok(!/DOC-ONLY EXEMPT/.test(r.stdout), "a code-touching fan-in must NOT be exempt");
    assert.equal(gitCmd(dir, "rev-parse", "develop").stdout.trim(), devBefore);
    assert.notEqual(gitCmd(dir, "merge-base", "--is-ancestor", "integration", "develop").status, 0);
  } finally {
    cleanup(dir);
  }
});

test("FRESHNESS GATE (doc-only exemption, dry-run): --dry-run on a doc-only fan-in reports the exemption and does NOT report a would-block (no ref moved)", () => {
  const now = Math.floor(Date.now() / 1000);
  const dir = freshnessRepo("fsd3", now - 60, { docOnly: true });
  try {
    const devBefore = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    writeSuiteStateFile(dir, {
      scope: "main",
      finishedAtEpoch: now - 30,
      startedAtIso: new Date((now - 120) * 1000).toISOString(),
    });
    const r = run([batchMerge, "--root", dir, "--dry-run"]);
    assert.equal(r.status, 0, "dry-run of a doc-only-exempt batch merge must not fail");
    assert.match(r.stdout, /DOC-ONLY EXEMPT/);
    assert.ok(!/WOULD fail closed/.test(r.stdout), "a doc-only exempt merge must not report a would-block");
    assert.ok(!/FRESHNESS-GATE FAIL-CLOSED/.test(r.stderr), "no fail-closed verdict for an exempt merge");
    // No ref moved (dry-run).
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

// ── FRESHNESS GATE SCOPE AXIS (gap-batch-merge-freshness-gate-ignores-scope) ───────────────────────
//
// The batch-merge gate previously read ONLY `state == green` + time freshness and IGNORED the state's
// `scope` field — so a green from ANY linked worktree (even one testing a completely unrelated tree,
// e.g. another task's checkout) satisfied the gate and an unverified tree could be merged into
// develop. The runner tags every state `scope: main|worktree` (gap-worktree-scoped-runs-consume-
// resources-but-produce-no-signal AC1): main = the authoritative signal (the batch merge may trust
// it); worktree = DEFERRABLE ("its completion updates nothing anyone waits on"). The fix adds the
// SCOPE axis: a green with `scope` present but != "main" FAILS CLOSED; a green with scope=="main"
// (or scope ABSENT — a legacy pre-scope state, treated as main per the runner's documented fail-open
// legacy semantics) passes the axis. The batch merge therefore requires a MAIN-sourced green — the
// outer verification-round's full-suite run IS main-sourced (orchestrator-loop-tick.md step 3 runs
// full-suite-runner from the outer layer), so a same-tree worktree green is NOT a substitute: the
// authoritative verification happens on main.

test("FRESHNESS GATE (scope axis, gap-batch-merge-freshness-gate-ignores-scope): a WORKTREE-sourced green (scope=='worktree', fresh + covering the tip) ⇒ BLOCKED, nothing moved", () => {
  // The green is fresh (finished 30s ago) and the suite STARTED after the fan-in — the AGE and
  // COVERAGE axes would pass; ONLY the SCOPE axis (worktree, not main) blocks.
  const now = Math.floor(Date.now() / 1000);
  const dir = freshnessRepo("fss1", now - 600); // last fan-in 10m ago — BEFORE the suite ran
  try {
    const devBefore = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    writeSuiteStateFile(dir, {
      scope: "worktree",
      finishedAtEpoch: now - 30,
      startedAtIso: new Date((now - 120) * 1000).toISOString(),
    });
    const r = run([batchMerge, "--root", dir]);
    assert.notEqual(r.status, 0, "a worktree-sourced green must NOT satisfy the batch merge gate");
    assert.match(r.stderr, /FRESHNESS-GATE FAIL-CLOSED/);
    assert.match(r.stderr, /scope='worktree'/);
    assert.match(r.stdout, /measure suite_freshness=unknown/);
    // Nothing moved: develop unchanged, integration NOT absorbed.
    assert.equal(gitCmd(dir, "rev-parse", "develop").stdout.trim(), devBefore);
    assert.notEqual(gitCmd(dir, "merge-base", "--is-ancestor", "integration", "develop").status, 0);
  } finally {
    cleanup(dir);
  }
});

test("FRESHNESS GATE (scope axis negative control): a MAIN-sourced green (scope=='main', fresh + covering the tip) ⇒ ALLOWED (develop fast-forwards)", () => {
  const now = Math.floor(Date.now() / 1000);
  const dir = freshnessRepo("fss2", now - 600);
  try {
    writeSuiteStateFile(dir, {
      scope: "main",
      finishedAtEpoch: now - 30,
      startedAtIso: new Date((now - 120) * 1000).toISOString(),
    });
    const r = run([batchMerge, "--root", dir]);
    assert.equal(r.status, 0, `a main-sourced green must pass the batch merge gate: ${r.stdout}${r.stderr}`);
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

test("FRESHNESS GATE (scope axis legacy): an ABSENT scope field (pre-scope state) ⇒ treated as main ⇒ ALLOWED (fail-open legacy semantics)", () => {
  // The runner documented the legacy rule itself: "Absent (legacy states) ⇒ treat as main (fail-open)".
  const now = Math.floor(Date.now() / 1000);
  const dir = freshnessRepo("fss3", now - 600);
  try {
    writeSuiteStateFile(dir, {
      finishedAtEpoch: now - 30,
      startedAtIso: new Date((now - 120) * 1000).toISOString(),
    });
    const r = run([batchMerge, "--root", dir]);
    assert.equal(r.status, 0, `a legacy no-scope green must be treated as main (fail-open): ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /freshness-gate OK/);
    assert.match(r.stdout, /fast-forwarded to integration/);
    assert.equal(gitCmd(dir, "merge-base", "--is-ancestor", "integration", "develop").status, 0);
  } finally {
    cleanup(dir);
  }
});

test("FRESHNESS GATE (scope axis dry-run): a worktree-sourced green in --dry-run reports the would-block WITHOUT failing (no ref moved)", () => {
  const now = Math.floor(Date.now() / 1000);
  const dir = freshnessRepo("fss4", now - 600);
  try {
    const devBefore = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    writeSuiteStateFile(dir, {
      scope: "worktree",
      finishedAtEpoch: now - 30,
      startedAtIso: new Date((now - 120) * 1000).toISOString(),
    });
    const r = run([batchMerge, "--root", dir, "--dry-run"]);
    // Dry-run does NOT fail even when the scope gate would block — it reports the would-block
    // (mirrors the object gate's and the other freshness axes' dry-run contract). No ref moved.
    assert.equal(r.status, 0, "dry-run must not fail even when the scope gate would block");
    assert.match(r.stdout, /DRY-RUN — freshness gate WOULD fail closed/);
    assert.match(r.stdout, /scope='worktree'/);
    assert.match(r.stdout, /measure suite_freshness=unknown/);
    assert.equal(gitCmd(dir, "rev-parse", "develop").stdout.trim(), devBefore);
    assert.notEqual(gitCmd(dir, "merge-base", "--is-ancestor", "integration", "develop").status, 0);
  } finally {
    cleanup(dir);
  }
});

// ── MERGE-TO-VERIFIED-COMMIT (gap-merge-green-snapshot-verified-commit-livelock AC3/AC4) ──────────────
//
// The structural livelock: the full suite takes ~1847s (~31 min) while integration gets ~12 commits/
// round (median 147s) — a green that only records `state == green` never catches integration HEAD
// (COVERAGE fail-closed forever). Fix: the green snapshot records the commit it VERIFIED
// (`verifiedCommit` — the integration tip at suite start) and the batch merge merges THAT commit, not
// the moving HEAD. The merged point WAS tested → COVERAGE satisfied by construction (AC4: the
// criterion is NOT loosened — the merged point is exactly the tested point; the untested newer commits
// stay pending). These tests run the batch-merge WITHOUT --skip-freshness-gate (the freshness gate IS
// the axis under test).

test("MERGE-TO-VERIFIED-COMMIT (AC3/AC4): a green with verifiedCommit merges the VERIFIED commit, NOT integration HEAD — COVERAGE passes at it", () => {
  const now = Math.floor(Date.now() / 1000);
  const dir = verifiedMergeRepo("mtv1", {
    verifiedEpochSec: now - 600, // the tested tip, 10m ago
    newerEpochSec: now - 60, // a fan-in landed 1m ago — AFTER the suite started (untested)
  });
  try {
    const verifiedCommit = gitCmd(dir, "rev-parse", "integration~1").stdout.trim();
    const intTip = gitCmd(dir, "rev-parse", "integration").stdout.trim();
    assert.notEqual(verifiedCommit, intTip, "there IS a newer untested fan-in on integration");
    const devBefore = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    // The green snapshot: started 5m ago (after the verified commit was made, BEFORE the newer fan-in),
    // finished 30s ago (within the window), and records the commit it actually measured.
    writeSuiteStateFile(dir, {
      scope: "main",
      finishedAtEpoch: now - 30,
      startedAtIso: new Date((now - 300) * 1000).toISOString(),
      verifiedCommit,
    });
    const r = run([batchMerge, "--root", dir]);
    assert.equal(r.status, 0, `merge to the verified commit must succeed: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /MERGE-TO-VERIFIED-COMMIT/);
    assert.match(r.stdout, /freshness-gate OK/, "COVERAGE passes AT the verified commit (no re-run needed)");
    assert.match(r.stdout, /fast-forwarded to the VERIFIED commit/);
    assert.match(r.stdout, /measure integration_ff_merges=1/, "the newer untested fan-in stays pending");
    assert.equal(
      gitCmd(dir, "rev-parse", "develop").stdout.trim(),
      verifiedCommit,
      "develop advanced to the VERIFIED commit, NOT integration HEAD",
    );
    assert.equal(gitCmd(dir, "rev-parse", "integration").stdout.trim(), intTip, "integration HEAD untouched");
    // integration NOT fully absorbed — the newer untested fan-in awaits the next green.
    assert.notEqual(gitCmd(dir, "merge-base", "--is-ancestor", "integration", "develop").status, 0);
    assert.equal(gitCmd(dir, "rev-list", "--count", "develop..integration").stdout.trim(), "1", "one newer untested commit stays pending");
    assert.equal(gitCmd(dir, "show", "develop:int-v.txt").stdout, "int v\n", "the verified point's content is on develop");
    assert.notEqual(gitCmd(dir, "rev-parse", "develop").stdout.trim(), devBefore, "develop DID advance");
  } finally {
    cleanup(dir);
  }
});

test("MERGE-TO-VERIFIED-COMMIT dry-run (AC3): reports COVERAGE passes at the verified commit and the deferred surface, no ref moved", () => {
  const now = Math.floor(Date.now() / 1000);
  const dir = verifiedMergeRepo("mtv2", {
    verifiedEpochSec: now - 600,
    newerEpochSec: now - 60,
  });
  try {
    const verifiedCommit = gitCmd(dir, "rev-parse", "integration~1").stdout.trim();
    const devBefore = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    writeSuiteStateFile(dir, {
      scope: "main",
      finishedAtEpoch: now - 30,
      startedAtIso: new Date((now - 300) * 1000).toISOString(),
      verifiedCommit,
    });
    const r = run([batchMerge, "--root", dir, "--dry-run"]);
    assert.equal(r.status, 0, `dry-run at the verified commit must report a passing COVERAGE: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /MERGE-TO-VERIFIED-COMMIT/);
    assert.match(r.stdout, /freshness-gate OK/);
    assert.match(r.stdout, /at merge point [0-9a-f]{40}/);
    assert.match(r.stdout, /deferred to the next green/);
    assert.equal(gitCmd(dir, "rev-parse", "develop").stdout.trim(), devBefore, "dry-run moves no ref");
  } finally {
    cleanup(dir);
  }
});

test("MERGE-TO-VERIFIED-COMMIT already-absorbed (AC3): the verified commit already merged ⇒ no-op, newer untested commits deferred", () => {
  const now = Math.floor(Date.now() / 1000);
  const dir = verifiedMergeRepo("mtv4", {
    verifiedEpochSec: now - 600,
    newerEpochSec: now - 60,
  });
  try {
    const verifiedCommit = gitCmd(dir, "rev-parse", "integration~1").stdout.trim();
    // Pre-advance develop to the verified commit — simulating the previous round already merged it.
    gitCmd(dir, "update-ref", "refs/heads/develop", verifiedCommit);
    writeSuiteStateFile(dir, {
      scope: "main",
      finishedAtEpoch: now - 30,
      startedAtIso: new Date((now - 300) * 1000).toISOString(),
      verifiedCommit,
    });
    const r = run([batchMerge, "--root", dir]);
    assert.equal(r.status, 0, "an already-merged verified commit is a clean no-op");
    assert.match(r.stdout, /verified commit .* is already an ancestor of develop/);
    assert.equal(
      gitCmd(dir, "rev-parse", "develop").stdout.trim(),
      verifiedCommit,
      "develop stays at the verified commit (integration HEAD's newer untested commits await the next green)",
    );
    assert.notEqual(gitCmd(dir, "merge-base", "--is-ancestor", "integration", "develop").status, 0);
  } finally {
    cleanup(dir);
  }
});

test("MERGE-TO-VERIFIED-COMMIT negative control (AC4): WITHOUT verifiedCommit the COVERAGE criterion still holds — an untested tip still blocks", () => {
  const now = Math.floor(Date.now() / 1000);
  const dir = verifiedMergeRepo("mtv3", {
    verifiedEpochSec: now - 600,
    newerEpochSec: now - 60,
  });
  try {
    const devBefore = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    // NO verifiedCommit in the state — the legacy gate must still fail closed on the untested tip
    // (a fan-in landed after the suite started and touches a CODE file ⇒ NOT doc-only exempt).
    writeSuiteStateFile(dir, {
      scope: "main",
      finishedAtEpoch: now - 30,
      startedAtIso: new Date((now - 300) * 1000).toISOString(),
    });
    const r = run([batchMerge, "--root", dir]);
    assert.notEqual(r.status, 0, "without verifiedCommit the untested integration tip must still block");
    assert.match(r.stderr, /FRESHNESS-GATE FAIL-CLOSED/);
    assert.ok(!/MERGE-TO-VERIFIED-COMMIT/.test(r.stdout), "no merge-to-verified path when the snapshot has no verifiedCommit");
    assert.equal(gitCmd(dir, "rev-parse", "develop").stdout.trim(), devBefore, "nothing moved");
    assert.notEqual(gitCmd(dir, "merge-base", "--is-ancestor", "integration", "develop").status, 0);
  } finally {
    cleanup(dir);
  }
});

// ── WORKTREE-GREEN GATE (gap-suite-fix-scope-worktree-green-merge-gate) ─────────────────────────────
// suite-fix subagent fan-in 前置断言：fan-in（批量合）前，`.quay/verification-round.jsonl` 必须存在
// ≥1 条 `scope=worktree` 且 `state=green` 的轮次记录，否则拒绝 merge（不自测绿不许合）。数据已在
// verification-round.jsonl（full-suite-runner.ts 写 scope/state），不新建机件——只在消费者侧加门。
// 实证：第二 suite-fix subagent（08:50）rounds 230/231 scope=main，从未在自带 worktree 自测 ⇒ 三保障
// 同时失效而条文每条「没被违反」——只有读 scope 字段才看得见。这些测试把该判据机械化。
//
// These tests run WITHOUT --skip-freshness-gate (the gate under test is the worktree-green gate; a
// FRESH MAIN-sourced green is provided so the freshness gate passes and the worktree-green gate is the
// sole blocker on the rejection path).

function wgGreenRepo(prefix, fanInEpochSec) {
  const dir = freshnessRepo(prefix, fanInEpochSec, { worktreeRound: false });
  const now = Math.floor(Date.now() / 1000);
  writeSuiteStateFile(dir, {
    scope: "main",
    finishedAtEpoch: now,
    startedAtIso: new Date(now * 1000).toISOString(),
  });
  return dir;
}

test("WORKTREE-GREEN GATE (AC2/AC4): no scope=worktree+state=green round on record ⇒ batch merge REJECTED, nothing moved, actionable message", () => {
  const now = Math.floor(Date.now() / 1000);
  const dir = wgGreenRepo("wgg1", now - 600); // fresh main green, BUT no worktree+green round
  try {
    const devBefore = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    const r = run([batchMerge, "--root", dir]);
    assert.notEqual(r.status, 0, "a fan-in with NO worktree+green round must be rejected");
    assert.match(r.stderr, /WORKTREE-GREEN-GATE FAIL-CLOSED/);
    assert.match(r.stderr, /scope=worktree\+state=green round/);
    assert.match(r.stderr, /先在自己 worktree 自测绿/, "rejection must carry the actionable fix (AC4)");
    assert.match(r.stderr, /node --test/, "actionable fix must name node --test (AC4)");
    assert.match(r.stderr, /scripts\/test\.sh/, "actionable fix must name scoped test.sh (AC4)");
    assert.match(r.stdout, /measure has_worktree_green_round=False/, "contract measure False on rejection");
    assert.equal(gitCmd(dir, "rev-parse", "develop").stdout.trim(), devBefore, "nothing moved");
    assert.notEqual(gitCmd(dir, "merge-base", "--is-ancestor", "integration", "develop").status, 0, "integration NOT absorbed");
  } finally {
    cleanup(dir);
  }
});

test("WORKTREE-GREEN GATE (AC2): a scope=worktree+state=green round on record ⇒ batch merge ALLOWED (develop fast-forwards)", () => {
  const now = Math.floor(Date.now() / 1000);
  const dir = freshnessRepo("wgg2", now - 600); // freshnessRepo default: includes the worktree+green round
  writeSuiteStateFile(dir, {
    scope: "main",
    finishedAtEpoch: now,
    startedAtIso: new Date(now * 1000).toISOString(),
  });
  try {
    const r = run([batchMerge, "--root", dir]);
    assert.equal(r.status, 0, "with a worktree+green round on record the merge proceeds");
    assert.match(r.stdout, /worktree-green-gate OK/, "gate reports OK");
    assert.match(r.stdout, /measure has_worktree_green_round=True/, "contract measure True on allowance");
    assert.match(r.stdout, /OK — develop fast-forwarded/, "develop advances");
    assert.equal(gitCmd(dir, "merge-base", "--is-ancestor", "integration", "develop").status, 0, "integration absorbed");
  } finally {
    cleanup(dir);
  }
});

test("WORKTREE-GREEN GATE dry-run: no round ⇒ reports would-block WITHOUT failing (no ref moved)", () => {
  const now = Math.floor(Date.now() / 1000);
  const dir = wgGreenRepo("wgg3", now - 600);
  try {
    const devBefore = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    const r = run([batchMerge, "--root", dir, "--dry-run"]);
    assert.equal(r.status, 0, "dry-run must not fail even when the worktree-green gate would block");
    assert.match(r.stdout, /DRY-RUN — worktree-green gate WOULD fail closed/);
    assert.match(r.stdout, /measure has_worktree_green_round=False/);
    assert.equal(gitCmd(dir, "rev-parse", "develop").stdout.trim(), devBefore, "nothing moved");
  } finally {
    cleanup(dir);
  }
});

test("WORKTREE-GREEN GATE scope-missing legacy line: a round WITHOUT a scope field does NOT satisfy the gate (no worktree+green evidence)", () => {
  const now = Math.floor(Date.now() / 1000);
  const dir = wgGreenRepo("wgg4", now - 600);
  try {
    // Append a LEGACY round (no scope field) — the gate must NOT count it as worktree+green evidence.
    const stateDir = join(dir, ".quay");
    mkdirSync(stateDir, { recursive: true });
    appendFileSync(join(stateDir, "verification-round.jsonl"), JSON.stringify({ round: 1, state: "green", tests: 3000 }) + "\n", "utf8");
    const r = run([batchMerge, "--root", dir]);
    assert.notEqual(r.status, 0, "a legacy round WITHOUT scope is not worktree+green evidence ⇒ rejected");
    assert.match(r.stderr, /WORKTREE-GREEN-GATE FAIL-CLOSED/);
    assert.match(r.stdout, /measure has_worktree_green_round=False/);
  } finally {
    cleanup(dir);
  }
});

test("WORKTREE-GREEN GATE opt-out: --skip-worktree-green-gate bypasses the gate (other-gate isolation)", () => {
  const now = Math.floor(Date.now() / 1000);
  const dir = wgGreenRepo("wgg5", now - 600); // NO worktree+green round
  try {
    const r = run([batchMerge, "--skip-worktree-green-gate", "--root", dir]);
    assert.equal(r.status, 0, "with --skip-worktree-green-gate the merge proceeds (freshness still passes)");
    assert.match(r.stdout, /worktree-green-gate SKIPPED/);
    assert.match(r.stdout, /OK — develop fast-forwarded/);
  } finally {
    cleanup(dir);
  }
});

// ── FAN-IN MODE (gap-task-telemetry-6-percent-join) ─────────────────────────────────────────────────
// Per-task fan-in (task/<id> → the current checkout) with the telemetry runId embedded in the commit
// subject at a fixed position-parseable location — the bridge that makes git landing records and
// telemetry records joinable (the 6% join-rate defect). The batch-merge flow (develop/integration
// gates) is untouched; this mode is the mechanical way to produce a runId-carrying fan-in commit.
test("FAN-IN MODE — --fan-in <id> --run-id <r> merges the task branch with the runId in the subject", () => {
  const dir = makeTmp("fanin");
  try {
    initGitRepo(dir);
    writeFileSync(join(dir, "base.txt"), "base\n", "utf8");
    commitAll(dir, "base");
    gitCmd(dir, "branch", "-M", "master");
    gitCmd(dir, "checkout", "-q", "-b", "task/gap-fanin-a");
    writeFileSync(join(dir, "work.txt"), "work\n", "utf8");
    commitAll(dir, "task work");
    gitCmd(dir, "checkout", "-q", "master");

    const r = runMerge(["--fan-in", "gap-fanin-a", "--run-id", "fm-gap-fanin-a-1750-abc123", "--root", dir]);
    assert.equal(r.status, 0, `fan-in should exit 0: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /measure fanin_runid_present=true/);
    const subject = gitCmd(dir, "log", "-1", "--format=%s").stdout.trim();
    assert.equal(subject, "merge: fan-in task/gap-fanin-a (runId: fm-gap-fanin-a-1750-abc123)",
      "the fan-in commit subject must carry the runId at the fixed position");
    // Two parents: a real merge commit.
    const parents = gitCmd(dir, "rev-list", "--parents", "-n", "1", "HEAD").stdout.trim().split(" ").length;
    assert.equal(parents, 3, "fan-in merge commit has two parents (base + task branch)");
  } finally {
    cleanup(dir);
  }
});

test("FAN-IN MODE negative — --fan-in without --run-id fails closed (exit 2), nothing merged", () => {
  const dir = makeTmp("fanin2");
  try {
    initGitRepo(dir);
    writeFileSync(join(dir, "base.txt"), "base\n", "utf8");
    commitAll(dir, "base");
    gitCmd(dir, "branch", "-M", "master");
    gitCmd(dir, "checkout", "-q", "-b", "task/gap-fanin-b");
    writeFileSync(join(dir, "work.txt"), "work\n", "utf8");
    commitAll(dir, "task work");
    gitCmd(dir, "checkout", "-q", "master");
    const before = gitCmd(dir, "rev-parse", "HEAD").stdout.trim();

    const r = runMerge(["--fan-in", "gap-fanin-b", "--root", dir]);
    assert.equal(r.status, 2, "missing --run-id is a usage error");
    assert.match(r.stderr, /--fan-in requires --run-id/);
    assert.equal(gitCmd(dir, "rev-parse", "HEAD").stdout.trim(), before, "nothing merged");
  } finally {
    cleanup(dir);
  }
});

test("FAN-IN MODE negative — a non-filename-safe --run-id fails closed (exit 2); a missing task branch fails closed (exit 1)", () => {
  const dir = makeTmp("fanin3");
  try {
    initGitRepo(dir);
    writeFileSync(join(dir, "base.txt"), "base\n", "utf8");
    commitAll(dir, "base");
    gitCmd(dir, "branch", "-M", "master");

    const badRunId = runMerge(["--fan-in", "gap-fanin-c", "--run-id", "../../evil", "--root", dir]);
    assert.equal(badRunId.status, 2, "a path-traversal runId must be rejected");
    assert.match(badRunId.stderr, /not filename-safe/);

    const missingBranch = runMerge(["--fan-in", "gap-fanin-c", "--run-id", "fm-gap-fanin-c-1750-x", "--root", dir]);
    assert.equal(missingBranch.status, 1, "a missing task branch must fail closed");
    assert.match(missingBranch.stderr, /task branch task\/gap-fanin-c not found/);
  } finally {
    cleanup(dir);
  }
});
