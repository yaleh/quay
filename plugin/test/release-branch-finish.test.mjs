// @test-group engine
// release-branch-finish.test.mjs — unit tests for the release-branch finish command
// (gap-release-branch-deleted-after-merge; SPEC-release-and-hotfix-branching-2026-09-15.md §4.1;
// extended by gap-ac271-release-branch-outlives-its-tag-again).
//
// The command is the EXECUTION HALF of a protocol the SPEC wrote as prose: `release/vX.Y.Z` is
// cut from develop → version bump → merged back → tagged at the merge point → **deleted**.
// ADR-004: prose gets paraphrased away, so the rule ships with a command that enforces it.
//
// Four load-bearing properties, each with its own non-silent failure — all four are covered
// here as live controls, so a regression in any one of them turns RED:
//   (a) release names only  — `develop` / `master` / `task/<id>` are refused BY NAME, and the
//       refused branch is still resolvable afterwards (a refusal that deleted anyway would be
//       indistinguishable from success on an exit-code-only reading).
//   (b) NO LICENSE ⇒ REFUSED — a branch may be deleted only when it is merged into `<base>` OR
//       its tip is contained in a tag (AC-271's two compliant forms, ONE shared definition).
//       Neither ⇒ exit 3 + `CAUSE=release-branch-not-merged` + the branch still present. The
//       tag arm is a two-arm control below: same fixture, tag present ⇒ deleted; tag absent ⇒
//       refused — so the tag is provably what licensed it (AC-271's second form, which the
//       pre-change default predicate refused; that old reading is recorded in the task body).
//       A tag scan that cannot be RUN is its own failure (exit 2), never read as "no tag".
//   (c) the remote is never silently ignored — a deleted-then-failed remote push exits non-zero
//       with its own CAUSE, and a remote that cannot be READ is a failure, not "nothing there"
//       (hard rule 3b: "could not look" must not share an output shape with "clean").
//   (d) the finish LEAVES A RECORD — every decision is appended to the local trace, and `--log`
//       reads it back with branch + time + result. An absent trace is NOT-EVALUATED (exit 2,
//       its own CAUSE), never "ran with no records" (hard rule 3b/9).
//
// Plus the cut's LANDING FACE (`--cut`): merge back into base → tag the merge point → finish, in
// ONE invocation, so "this cut got all the way through" and "the branch is gone" are the same
// command's exit 0 (AC4). Its preconditions (missing --tag / an existing tag / HEAD not base)
// each refuse with their own CAUSE and mutate nothing.
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
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
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
 *
 * `.quay/` is gitignored here for the same reason the real repo gitignores its runtime carriers
 * (see the root `.gitignore`'s runtime-state family): the finish command's record lives there, and
 * without the ignore a fixture's `git add -A` sweeps it into a commit — whereupon the next
 * `git checkout` (which does not have that commit) DELETES the file, and the trace silently loses
 * records. That is a fixture-visible version of the real hazard the ignore exists to prevent.
 */
function makeRepo(prefix) {
  const root = mkdtempSync(join(tmpdir(), `release-branch-finish-${prefix}-`));
  assert.equal(git(root, "init", "-q").status, 0);
  git(root, "config", "user.name", "test");
  git(root, "config", "user.email", "test@example.com");
  writeFileSync(join(root, "README.md"), "seed\n", "utf8");
  writeFileSync(join(root, ".gitignore"), ".quay/\n", "utf8");
  assert.equal(git(root, "add", "-A").status, 0);
  assert.equal(git(root, "commit", "-q", "-m", "seed").status, 0);
  assert.equal(git(root, "branch", "develop").status, 0);
  return { root };
}

/**
 * A branch off develop carrying one commit develop has never seen (develop..<b> == 1).
 * `marker` distinguishes the commit's content so two such branches are two DISTINCT tips —
 * two branches pointing at the SAME commit are one commit away from sharing a tag, which would
 * make a tag-license control meaningless.
 */
function makeUnmergedBranch(root, branch, marker = "nc") {
  assert.equal(git(root, "checkout", "-q", "-b", branch, "develop").status, 0);
  writeFileSync(join(root, `${marker}.txt`), "not on develop\n", "utf8");
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

// ══════════════════════════════════════════════════════════════════════════════════════════════
// (b′) AC-271's SECOND compliant form: the tip is contained in a tag
// (gap-ac271-release-branch-outlives-its-tag-again). Before this, the predicate only knew
// "merged into develop", so a branch parked on its version tag — the case AC-271's criterion
// itself accepts — was REFUSED by the command. Criterion and command must share ONE definition.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Tag `<tag>` at the tip of a branch develop has never seen (develop..<b> != 0, tag contains it). */
function makeTaggedBranch(root, branch, tag, marker = "nc") {
  const tip = makeUnmergedBranch(root, branch, marker);
  assert.equal(git(root, "tag", "-a", tag, "-m", `release ${tag}`, tip).status, 0);
  return tip;
}

/** A branch whose tip is 2 commits past develop and whose tag sits on the FIRST one ⇒ the tag
 *  does NOT contain the tip (deleting would lose the second commit). */
function makeBranchWithTagBehindTip(root, branch, tag) {
  assert.equal(git(root, "checkout", "-q", "-b", branch, "develop").status, 0);
  writeFileSync(join(root, "a.txt"), "a\n", "utf8");
  assert.equal(git(root, "add", "-A").status, 0);
  assert.equal(git(root, "commit", "-q", "-m", "first").status, 0);
  assert.equal(git(root, "tag", "-a", tag, "-m", "x").status, 0);
  writeFileSync(join(root, "b.txt"), "b\n", "utf8");
  assert.equal(git(root, "add", "-A").status, 0);
  assert.equal(git(root, "commit", "-q", "-m", "second").status, 0);
  const tip = git(root, "rev-parse", "HEAD").stdout.trim();
  assert.equal(git(root, "checkout", "-q", "develop").status, 0);
  return tip;
}

test("a tip CONTAINED IN A TAG licenses the delete even though develop..<b> != 0 (AC-271's second form)", () => {
  const w = makeRepo("taglicense");
  try {
    const tagged = makeTaggedBranch(w.root, "release/v0.3.0", "v0.3.0", "tagged");
    const untagged = makeUnmergedBranch(w.root, "release/v0.3.1", "untagged");
    assert.notEqual(git(w.root, "rev-list", "--count", "develop..release/v0.3.0").stdout.trim(), "0");
    assert.equal(git(w.root, "tag", "--contains", "release/v0.3.0").stdout.trim(), "v0.3.0");
    assert.notEqual(tagged, untagged, "the two arms must be DISTINCT tips, or the tag would license both");

    // ARM 1 — the tag alone licenses the delete (the pre-change default predicate refused this).
    const r = run(["release/v0.3.0", "--root", w.root, "--no-remote"]);
    assert.equal(r.status, 0, `a tag-parked branch must be finishable: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /tag-license: 'v0\.3\.0' contains 'release\/v0\.3\.0'/);
    assert.match(r.stdout, /deleted-local: release\/v0\.3\.0 \(license: tagged via tag v0\.3\.0\)/);

    // ARM 2 — SAME fixture, SAME shape, only the tag missing ⇒ refused, and nothing is lost.
    // This is the control that makes arm 1 mean something: the tag is the licensor.
    const c = run(["release/v0.3.1", "--root", w.root, "--no-remote"]);
    assert.equal(c.status, 3, `an untagged unmerged branch must still be refused: ${c.stdout}${c.stderr}`);
    assert.match(c.stderr, /CAUSE=release-branch-not-merged/);
    assert.equal(git(w.root, "rev-parse", "release/v0.3.1").stdout.trim(), untagged);

    assert.deepEqual(releaseBranches(w.root), ["release/v0.3.1"]);
  } finally {
    cleanup(w.root);
  }
});

test("a tag that does NOT contain the tip is no license: refused, branch survives (AC6)", () => {
  const w = makeRepo("tagbehind");
  try {
    const tip = makeBranchWithTagBehindTip(w.root, "release/v0.4.0", "v0.4.0");
    assert.equal(git(w.root, "tag", "--points-at", "release/v0.4.0").stdout.trim(), "", "the tag does not point at the tip");
    assert.equal(git(w.root, "tag", "--contains", "release/v0.4.0").stdout.trim(), "", "the tag does not contain the tip either");

    const r = run(["release/v0.4.0", "--root", w.root, "--no-remote"]);

    assert.equal(r.status, 3, `a tag behind the tip must not license a delete: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /CAUSE=release-branch-not-merged/);
    assert.equal(git(w.root, "rev-parse", "release/v0.4.0").stdout.trim(), tip, "the branch must survive intact");
    assert.deepEqual(releaseBranches(w.root), ["release/v0.4.0"]);
  } finally {
    cleanup(w.root);
  }
});

test("a tag scan that cannot be PERFORMED is a failure, not 'no tag holds it' (hard rule 3b)", () => {
  const w = makeRepo("tagscan");
  const shimDir = mkdtempSync(join(tmpdir(), "release-branch-finish-shim-"));
  try {
    makeUnmergedBranch(w.root, "release/v0.5.0");
    const realGit = spawnSync("bash", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
    assert.notEqual(realGit, "", "the fixture needs the real git to delegate to");
    const shim = join(shimDir, "git");
    writeFileSync(
      shim,
      `#!/usr/bin/env bash\nfor a in "$@"; do if [ "$a" = "--contains" ]; then echo "shim: tag scan unavailable" >&2; exit 9; fi; done\nexec ${JSON.stringify(realGit)} "$@"\n`,
      "utf8",
    );
    chmodSync(shim, 0o755);

    const r = run(["release/v0.5.0", "--root", w.root, "--no-remote"], {
      env: { ...process.env, PATH: `${shimDir}:${process.env.PATH}` },
    });

    assert.equal(r.status, 2, `an unanswerable tag scan must exit 2: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /CAUSE=release-branch-tag-scan-failed/);
    assert.deepEqual(releaseBranches(w.root), ["release/v0.5.0"], "an unanswerable scan must not delete");
  } finally {
    cleanup(w.root);
    cleanup(shimDir);
  }
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// (d) the finish leaves a RECORD, and --log reads it back (hard rule 9: before this, "was the
// finish step run, and how?" was indistinguishable in the record from "it never ran" — a release
// branch vanished on 2026-09-19 with no attributable trace at all).
// ══════════════════════════════════════════════════════════════════════════════════════════════

test("every finish decision is recorded and --log reads it back (branch + time + result)", () => {
  const w = makeRepo("trace");
  try {
    // A REFUSAL is a decision too — it must be recorded, not only the successes.
    makeUnmergedBranch(w.root, "release/v0.2.0");
    assert.equal(run(["release/v0.2.0", "--root", w.root, "--no-remote"]).status, 3);

    makeTaggedBranch(w.root, "release/v0.2.1", "v0.2.1");
    assert.equal(run(["release/v0.2.1", "--root", w.root, "--no-remote"]).status, 0);

    const log = run(["--log", "--root", w.root]);
    assert.equal(log.status, 0, `--log must succeed on a readable trace: ${log.stderr}`);
    assert.match(log.stdout, /release\/v0\.2\.0/);
    assert.match(log.stdout, /form=none/);
    assert.match(log.stdout, /result=refused-no-license/);
    assert.match(log.stdout, /release\/v0\.2\.1/);
    assert.match(log.stdout, /form=tagged/);
    assert.match(log.stdout, /tag=v0\.2\.1/);
    assert.match(log.stdout, /result=deleted-local/);
    assert.match(log.stdout, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/, "the record carries a timestamp");
    assert.match(log.stdout, /trace: 2 record\(s\) in/);
  } finally {
    cleanup(w.root);
  }
});

test("--log on a repo that never recorded a finish is NOT-EVALUATED, never 'no records' (hard rule 3b)", () => {
  const w = makeRepo("notrace");
  try {
    const log = run(["--log", "--root", w.root]);

    assert.equal(log.status, 2, `an absent trace is not 'ran with no records': ${log.stdout}${log.stderr}`);
    assert.match(log.stderr, /CAUSE=release-branch-trace-missing/);
    assert.equal(log.stdout.trim(), "", "the 'never ran' reading must not share an output shape with an empty-but-present trace");
  } finally {
    cleanup(w.root);
  }
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// (e) --cut: the cut's LANDING FACE (AC4). SPEC §4.1 ends with three steps — 合回 → 在合并点打
// tag → 删除. `--cut` performs all three in ONE invocation, so "this cut got all the way through"
// and "the branch is gone" are the same command's exit 0. That is the carrier: you cannot do the
// tag step without the finish step, because the finish step is a stage of the same command.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** A release branch carrying a version-bump commit develop has never seen. */
function makeReleaseBranchWithBump(root, branch, file, content) {
  assert.equal(git(root, "checkout", "-q", "-b", branch, "develop").status, 0);
  writeFileSync(join(root, file), content, "utf8");
  assert.equal(git(root, "add", "-A").status, 0);
  assert.equal(git(root, "commit", "-q", "-m", "bump").status, 0);
  const tip = git(root, "rev-parse", "HEAD").stdout.trim();
  assert.equal(git(root, "checkout", "-q", "develop").status, 0);
  return tip;
}

test("--cut lands the cut in ONE command: merge back → tag the merge point → finish", () => {
  const w = makeRepo("cut");
  try {
    const bumpTip = makeReleaseBranchWithBump(w.root, "release/v0.1.0", "version.txt", "0.1.0\n");

    const r = run(["release/v0.1.0", "--cut", "--tag", "v0.1.0", "--root", w.root, "--no-remote"]);

    assert.equal(r.status, 0, `--cut must land the whole cut: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /cut-merged: 'release\/v0\.1\.0' -> 'develop'/);
    assert.match(r.stdout, /cut-tagged: 'v0\.1\.0' at/);
    assert.match(r.stdout, /deleted-local: release\/v0\.1\.0 \(license: cut via tag v0\.1\.0\)/);
    assert.match(r.stdout, /finished: release\/v0\.1\.0/);

    // the cut's three effects, read back independently of its own stdout
    assert.deepEqual(releaseBranches(w.root), [], "the branch must be gone");
    assert.equal(git(w.root, "rev-parse", "v0.1.0^{commit}").stdout.trim(), git(w.root, "rev-parse", "develop").stdout.trim(), "the tag sits on the merge point");
    assert.equal(git(w.root, "merge-base", "--is-ancestor", bumpTip, "develop").status, 0, "the bump commit landed on develop");

    // and the record says a CUT happened, not merely a delete
    const log = run(["--log", "--root", w.root]);
    assert.equal(log.status, 0, log.stderr);
    assert.match(log.stdout, /form=cut/);
    assert.match(log.stdout, /tag=v0\.1\.0/);
    assert.match(log.stdout, /result=deleted-local/);
  } finally {
    cleanup(w.root);
  }
});

test("--cut preconditions fail closed: missing --tag / existing tag / HEAD not base — nothing mutates", () => {
  const w = makeRepo("cutpre");
  try {
    makeReleaseBranchWithBump(w.root, "release/v0.1.1", "v.txt", "0.1.1\n");
    const developBefore = git(w.root, "rev-parse", "develop").stdout.trim();
    const branchBefore = git(w.root, "rev-parse", "release/v0.1.1").stdout.trim();

    const noTag = run(["release/v0.1.1", "--cut", "--root", w.root, "--no-remote"]);
    assert.equal(noTag.status, 2);
    assert.match(noTag.stderr, /CAUSE=release-branch-cut-needs-tag/);

    // --tag without --cut is a usage error, never a silently-ignored flag
    const tagAlone = run(["release/v0.1.1", "--tag", "v0.1.1", "--root", w.root, "--no-remote"]);
    assert.equal(tagAlone.status, 2);
    assert.match(tagAlone.stderr, /--tag is only meaningful with --cut/);

    // an existing version tag is never re-pointed
    assert.equal(git(w.root, "tag", "v0.1.1", "develop").status, 0);
    const dup = run(["release/v0.1.1", "--cut", "--tag", "v0.1.1", "--root", w.root, "--no-remote"]);
    assert.equal(dup.status, 2);
    assert.match(dup.stderr, /CAUSE=release-branch-cut-tag-exists/);

    // HEAD must already be the merge target (the command never moves your checkout)
    assert.equal(git(w.root, "checkout", "-q", "release/v0.1.1").status, 0);
    const notBase = run(["release/v0.1.1", "--cut", "--tag", "v0.1.2", "--root", w.root, "--no-remote"]);
    assert.equal(notBase.status, 2);
    assert.match(notBase.stderr, /CAUSE=release-branch-cut-head-not-base/);
    assert.equal(git(w.root, "checkout", "-q", "develop").status, 0);

    // --cut --dry-run mutates nothing
    const before = git(w.root, "for-each-ref").stdout;
    const dry = run(["release/v0.1.1", "--cut", "--tag", "v0.1.3", "--root", w.root, "--no-remote", "--dry-run"]);
    assert.equal(dry.status, 0, `${dry.stdout}${dry.stderr}`);
    assert.match(dry.stdout, /would-cut: merge 'release\/v0\.1\.1' into 'develop'/);
    assert.match(dry.stdout, /no ref was touched/);
    assert.equal(git(w.root, "for-each-ref").stdout, before, "a cut dry-run must not touch any ref");

    assert.equal(git(w.root, "rev-parse", "develop").stdout.trim(), developBefore, "no refusal may move develop");
    assert.equal(git(w.root, "rev-parse", "release/v0.1.1").stdout.trim(), branchBefore, "no refusal may move the branch");
    assert.deepEqual(releaseBranches(w.root), ["release/v0.1.1"]);
  } finally {
    cleanup(w.root);
  }
});
