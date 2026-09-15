// @test-group engine
// release-branch-finish.test.mjs — unit tests for the release-branch finish command
// (gap-release-branch-deleted-after-merge; SPEC-release-and-hotfix-branching-2026-09-15.md §4.1).
//
// The command is the EXECUTION HALF of a protocol the SPEC wrote as prose: `release/vX.Y.Z` is
// cut from develop → version bump → merged back → tagged at the merge point → **deleted**.
// ADR-004: prose gets paraphrased away, so the rule ships with a command that enforces it.
//
// Three load-bearing properties, each with its own non-silent failure — all three are covered
// here as live controls, so a regression in any one of them turns RED:
//   (a) release names only  — `develop` / `master` / `task/<id>` are refused BY NAME, and the
//       refused branch is still resolvable afterwards (a refusal that deleted anyway would be
//       indistinguishable from success on an exit-code-only reading).
//   (b) unmerged ⇒ refused  — `git rev-list --count develop..<branch> != 0` ⇒ exit 3 + the
//       `CAUSE=release-branch-not-merged` token + the branch still present.
//   (c) the remote is never silently ignored — a deleted-then-failed remote push exits non-zero
//       with its own CAUSE, and a remote that cannot be READ is a failure, not "nothing there"
//       (hard rule 3b: "could not look" must not share an output shape with "clean").
//
// Plus the two shape properties: --dry-run mutates no ref (proved by a before/after
// `for-each-ref` byte comparison, not by absence of errors), and --help exits 0 with no side
// effects. Both the legacy `release-vXXX-build` and the new `release/vX.Y.Z` namings are
// exercised — AC-271 judges by tip-vs-tag, not by parsing a version out of the name.
//
// All fixtures are self-contained temp git repos; nothing in the real checkout is mutated
// (R3 test-isolation).
//
// Run:
//   scripts/test.sh plugin/test/release-branch-finish.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const SCRIPT = join(repoRoot, "plugin", "scripts", "release-branch-finish.sh");

function git(cwd, ...args) {
  const res = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function run(args, opts = {}) {
  const res = spawnSync("bash", [SCRIPT, ...args], { encoding: "utf8", ...opts });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

/** The enumerated release branches in a repo — the same read AC-271 makes. */
function releaseBranches(root) {
  const r = git(root, "for-each-ref", "--format=%(refname:short)", "refs/heads/release-*", "refs/heads/release/*");
  return r.stdout.split("\n").map((s) => s.trim()).filter(Boolean).sort();
}

/**
 * A temp repo with a `develop` branch and one commit. `releaseBranches()` is empty to start.
 * Returns { root } so every caller cleans it in a `finally` (R3 / tmp-leak pairing).
 */
function makeRepo(prefix) {
  const root = mkdtempSync(join(tmpdir(), `release-branch-finish-${prefix}-`));
  assert.equal(git(root, "init", "-q").status, 0);
  git(root, "config", "user.name", "test");
  git(root, "config", "user.email", "test@example.com");
  writeFileSync(join(root, "README.md"), "seed\n", "utf8");
  assert.equal(git(root, "add", "-A").status, 0);
  assert.equal(git(root, "commit", "-q", "-m", "seed").status, 0);
  assert.equal(git(root, "branch", "develop").status, 0);
  return { root };
}

/** A branch off develop carrying one commit develop has never seen (develop..<b> == 1). */
function makeUnmergedBranch(root, branch) {
  assert.equal(git(root, "checkout", "-q", "-b", branch, "develop").status, 0);
  writeFileSync(join(root, "nc.txt"), "not on develop\n", "utf8");
  assert.equal(git(root, "add", "-A").status, 0);
  assert.equal(git(root, "commit", "-q", "-m", "unmerged").status, 0);
  const head = git(root, "rev-parse", "HEAD").stdout.trim();
  assert.equal(git(root, "checkout", "-q", "develop").status, 0);
  return head;
}

/** A branch parked exactly on develop (develop..<b> == 0 ⇒ finished-and-merged). */
function makeMergedBranch(root, branch) {
  assert.equal(git(root, "branch", branch, "develop").status, 0);
  return git(root, "rev-parse", branch).stdout.trim();
}

// ── (b) unmerged ⇒ refused ────────────────────────────────────────────────────────────────────

test("unmerged release branch is REFUSED: exit 3 + CAUSE=release-branch-not-merged + branch survives", () => {
  const w = makeRepo("unmerged");
  try {
    const tip = makeUnmergedBranch(w.root, "release/v0.0.0-nc");

    const r = run(["release/v0.0.0-nc", "--root", w.root, "--no-remote"]);

    assert.notEqual(r.status, 0, "an unmerged release branch must not be finished");
    assert.equal(r.status, 3, `expected the dedicated not-merged exit code, got ${r.status}`);
    assert.match(r.stderr, /CAUSE=release-branch-not-merged/);
    // The branch is NOT gone — a refusal that deleted anyway would read as success.
    assert.equal(git(w.root, "rev-parse", "--verify", "--quiet", "refs/heads/release/v0.0.0-nc").status, 0);
    assert.equal(git(w.root, "rev-parse", "release/v0.0.0-nc").stdout.trim(), tip);
    assert.deepEqual(releaseBranches(w.root), ["release/v0.0.0-nc"]);
  } finally {
    cleanup(w.root);
  }
});

// ── (a) release names only ────────────────────────────────────────────────────────────────────

test("non-release names are REFUSED by name: develop exits non-zero and is untouched", () => {
  const w = makeRepo("nonrelease");
  try {
    const before = git(w.root, "rev-parse", "develop").stdout.trim();

    for (const bad of ["develop", "master", "task/foo", "hotfix/v1.2.3", "release"]) {
      const r = run([bad, "--root", w.root, "--dry-run"]);
      assert.notEqual(r.status, 0, `'${bad}' must be refused, got exit ${r.status}`);
      assert.equal(r.status, 2, `'${bad}' should be a usage/name refusal (2), got ${r.status}`);
      assert.match(r.stderr, /CAUSE=not-a-release-branch/);
    }

    // Nothing was touched even though every call went through the refusal path.
    assert.equal(git(w.root, "rev-parse", "develop").stdout.trim(), before);
    assert.equal(git(w.root, "rev-parse", "--verify", "--quiet", "refs/heads/develop").status, 0);
    assert.equal(git(w.root, "rev-parse", "--verify", "--quiet", "refs/heads/master").status, 0);
  } finally {
    cleanup(w.root);
  }
});

// ── merged branch: the happy path actually deletes ────────────────────────────────────────────

test("merged release branch is deleted (both the legacy release-* and the new release/* namings)", () => {
  const w = makeRepo("merged");
  try {
    makeMergedBranch(w.root, "release-v0.0.4-build");
    makeMergedBranch(w.root, "release/v0.0.4");

    const r1 = run(["release-v0.0.4-build", "--root", w.root, "--no-remote"]);
    assert.equal(r1.status, 0, `legacy naming should finish: ${r1.stdout}${r1.stderr}`);
    assert.match(r1.stdout, /deleted-local: release-v0\.0\.4-build/);

    const r2 = run(["release/v0.0.4", "--root", w.root, "--no-remote"]);
    assert.equal(r2.status, 0, `new naming should finish: ${r2.stdout}${r2.stderr}`);

    assert.deepEqual(releaseBranches(w.root), [], "both release branches must be gone");
  } finally {
    cleanup(w.root);
  }
});

test("finish is idempotent: a second run on an already-gone branch exits 0", () => {
  const w = makeRepo("idempotent");
  try {
    makeMergedBranch(w.root, "release/v0.0.5");
    assert.equal(run(["release/v0.0.5", "--root", w.root, "--no-remote"]).status, 0);

    const again = run(["release/v0.0.5", "--root", w.root, "--no-remote"]);
    assert.equal(again.status, 0, `re-finish should be idempotent: ${again.stdout}${again.stderr}`);
    assert.match(again.stdout, /local-already-gone/);
  } finally {
    cleanup(w.root);
  }
});

// ── --dry-run mutates NOTHING (proved by a byte comparison, not by absence of errors) ─────────

test("--dry-run exits 0, prints the planned action, and mutates no ref", () => {
  const w = makeRepo("dryrun");
  try {
    makeMergedBranch(w.root, "release/v0.0.6");
    const before = git(w.root, "for-each-ref").stdout;

    const r = run(["release/v0.0.6", "--root", w.root, "--no-remote", "--dry-run"]);
    assert.equal(r.status, 0, `dry-run must exit 0: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /would-delete-local: release\/v0\.0\.6/);
    assert.match(r.stdout, /no ref was touched/);

    assert.equal(git(w.root, "for-each-ref").stdout, before, "dry-run must not change any ref");
    assert.deepEqual(releaseBranches(w.root), ["release/v0.0.6"]);
  } finally {
    cleanup(w.root);
  }
});

// ── --help: usage first, exit 0, no side effects ──────────────────────────────────────────────

test("--help exits 0, prints 用法 first, and has no business side effect", () => {
  const w = makeRepo("help");
  try {
    makeMergedBranch(w.root, "release/v0.0.7");
    const before = git(w.root, "for-each-ref").stdout;

    const r = run(["--help", "--root", w.root]);
    assert.equal(r.status, 0, "--help must exit 0");
    assert.match(r.stdout.split("\n")[0], /用法/, "--help's first line must carry the 用法 token");

    assert.equal(git(w.root, "for-each-ref").stdout, before, "--help must not touch refs");
    assert.deepEqual(releaseBranches(w.root), ["release/v0.0.7"]);
  } finally {
    cleanup(w.root);
  }
});

// ── (c) the remote half: deleted when present, and never silently ignored ─────────────────────

test("a remote ref with the same name is deleted alongside the local branch", () => {
  const w = makeRepo("remote");
  try {
    const bare = join(w.root, "origin.git");
    assert.equal(git(w.root, "init", "-q", "--bare", bare).status, 0);
    assert.equal(git(w.root, "remote", "add", "origin", bare).status, 0);
    makeMergedBranch(w.root, "release/v0.0.8");
    assert.equal(git(w.root, "push", "-q", "origin", "refs/heads/release/v0.0.8:refs/heads/release/v0.0.8").status, 0);

    const r = run(["release/v0.0.8", "--root", w.root, "--remote", "origin"]);
    assert.equal(r.status, 0, `remote finish should succeed: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /deleted-remote: origin\/release\/v0\.0\.8/);

    const remoteRef = git(w.root, "ls-remote", "--heads", "origin", "refs/heads/release/v0.0.8").stdout.trim();
    assert.equal(remoteRef, "", "the remote ref must be gone too");
    assert.deepEqual(releaseBranches(w.root), []);
  } finally {
    cleanup(w.root);
  }
});

test("an UNREADABLE remote is a failure, not a silent 'nothing there' (hard rule 3b)", () => {
  const w = makeRepo("badremote");
  try {
    makeMergedBranch(w.root, "release/v0.0.9");

    const r = run(["release/v0.0.9", "--root", w.root, "--remote", "no-such-remote"]);

    assert.notEqual(r.status, 0, "an unreadable remote must not report a clean finish");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /CAUSE=release-branch-remote-unreadable/);
    // Fail-closed BEFORE the local delete: the branch is still there, so a retry is possible.
    assert.deepEqual(releaseBranches(w.root), ["release/v0.0.9"]);
  } finally {
    cleanup(w.root);
  }
});

// ── the merge check itself must not be silence-able ───────────────────────────────────────────

test("an unresolvable merge base is refused rather than treated as 'merged'", () => {
  const w = makeRepo("nobase");
  try {
    makeMergedBranch(w.root, "release/v0.1.0");
    git(w.root, "branch", "-D", "develop");

    const r = run(["release/v0.1.0", "--root", w.root, "--no-remote"]);

    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /CAUSE=release-branch-base-unresolvable/);
    assert.deepEqual(releaseBranches(w.root), ["release/v0.1.0"], "nothing may be deleted when the check cannot run");
  } finally {
    cleanup(w.root);
  }
});
