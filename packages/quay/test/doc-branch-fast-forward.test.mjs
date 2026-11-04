// @test-group product
// doc-branch-fast-forward — a STRICT-ANCESTOR doc branch (no unique commits) that is BEHIND the
// landing baseline must be fast-forwarded onto the baseline before the main checkout moves onto it
// (gap-quay-init-doc-branch-strict-ancestor-fast-forward). A real fork (the doc branch has unique
// commits) keeps its existing behavior: switched to as-is, never merged, never re-pointed, and the
// report says "diverged".
//
// Run: node --test packages/quay/test/doc-branch-fast-forward.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDocBranch, formatDocBranchReport } from "../src/core/branch-model.ts";

const TMP_DIRS = [];
after(() => {
  for (const d of TMP_DIRS) fs.rmSync(d, { recursive: true, force: true });
});

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}
function commit(cwd, msg) {
  git(cwd, ["add", "-A"]);
  git(cwd, ["commit", "-q", "-m", msg]);
}

/** A quay-shaped repo whose main checkout is on `develop` and whose doc branch `author` is a STRICT
 *  ancestor N commits behind (`git rev-list --count author..develop === N`). */
function behindRepo(tag, N = 3) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `quay-ff-behind-${tag}-`));
  TMP_DIRS.push(dir);
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.name", "ff-test"]);
  git(dir, ["config", "user.email", "ff@example.com"]);
  fs.writeFileSync(path.join(dir, "base.txt"), "base\n");
  commit(dir, "base");
  git(dir, ["branch", "develop"]);
  git(dir, ["checkout", "-q", "develop"]);
  for (let i = 1; i <= N + 1; i++) {
    fs.writeFileSync(path.join(dir, `dev${i}.txt`), `${i}\n`);
    commit(dir, `dev ${i}`);
  }
  git(dir, ["branch", "author", `develop~${N}`]);
  git(dir, ["checkout", "-q", "develop"]);
  return dir;
}

/** A quay-shaped repo whose main checkout is on `develop` and whose doc branch `author` is AHEAD of
 *  `develop` (it has unique commits the baseline does not contain) — the real-fork negative control. */
function aheadRepo(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `quay-ff-ahead-${tag}-`));
  TMP_DIRS.push(dir);
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.name", "ff-test"]);
  git(dir, ["config", "user.email", "ff@example.com"]);
  fs.writeFileSync(path.join(dir, "base.txt"), "base\n");
  commit(dir, "base");
  git(dir, ["branch", "develop"]);
  git(dir, ["checkout", "-q", "develop"]);
  fs.writeFileSync(path.join(dir, "dev.txt"), "dev\n");
  commit(dir, "develop work");
  git(dir, ["checkout", "-q", "-b", "author"]);
  fs.writeFileSync(path.join(dir, "doc.txt"), "doc work\n");
  commit(dir, "a unique doc commit");
  git(dir, ["checkout", "-q", "develop"]);
  return dir;
}

// ── AC1: a strict ancestor behind N is fast-forwarded onto the baseline (lossless) ────────────────

test("AC1: a strict-ancestor doc branch behind N is fast-forwarded onto develop", () => {
  const dir = behindRepo("ac1", 3);
  const developSha = git(dir, ["rev-parse", "develop"]);

  const r = ensureDocBranch(dir, { name: "author" });

  assert.equal(r.behindBaseline, 3, "the lag is carried on the report as a measured number");
  assert.equal(r.state, "behind", "the classification is still behind; the action is the ff");
  assert.equal(r.action, "fast-forwarded", "the strict ancestor gets its own action value");
  assert.equal(r.ok, true);
  assert.equal(r.sha, developSha, "the report's post-op sha is the baseline tip");
  assert.equal(git(dir, ["rev-parse", "author"]), developSha, "the doc branch IS develop's tip");
  assert.equal(git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]), "author", "the main checkout moved onto the doc branch");
  assert.equal(git(dir, ["log", "--oneline", "author..develop"]), "", "no commits left behind — nothing lost");
  assert.match(formatDocBranchReport(r), /\[FAST-FORWARDED\] doc-branch -> author/);
  assert.match(formatDocBranchReport(r), /3 commit\(s\) BEHIND the landing baseline 'develop'/);
});

// ── AC2: the real-fork negative control — diverged, switched as-is, never re-pointed ──────────────

test("AC2: a doc branch with unique commits is reported diverged and NOT fast-forwarded", () => {
  const dir = aheadRepo("ac2");
  const developSha = git(dir, ["rev-parse", "develop"]);
  const beforeAuthor = git(dir, ["rev-parse", "author"]);

  const r = ensureDocBranch(dir, { name: "author" });

  assert.equal(r.state, "reusable", "the related branch is still classified reusable (the ref is used as-is)");
  assert.equal(r.action, "switched", "behavior is unchanged: switch only, never re-point");
  assert.equal(r.ok, true);
  assert.equal(git(dir, ["rev-parse", "author"]), beforeAuthor, "the diverged ref is byte-identical — no ff");
  assert.equal(git(dir, ["rev-parse", "develop"]), developSha, "and the baseline did not move");
  assert.equal(git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]), "author");
  assert.match(r.detail, /diverged/, "the report explicitly says diverged");
  assert.doesNotMatch(formatDocBranchReport(r), /\[FAST-FORWARDED\]/, "no fast-forward marker on the diverged arm");
});

// ── AC3: --dry-run reports the plan and moves no ref ──────────────────────────────────────────────

test("AC3: --dry-run on a behind strict ancestor reports would fast-forward and moves no ref", () => {
  const dir = behindRepo("ac3", 2);
  const beforeAuthor = git(dir, ["rev-parse", "author"]);
  const beforeDevelop = git(dir, ["rev-parse", "develop"]);

  const r = ensureDocBranch(dir, { name: "author", dryRun: true });

  assert.equal(r.dryRun, true);
  assert.equal(r.action, "fast-forwarded", "the plan names the action");
  assert.equal(r.ok, true);
  assert.match(r.detail, /would fast-forward/, "the plan says would fast-forward");
  assert.equal(git(dir, ["rev-parse", "author"]), beforeAuthor, "dry-run must not move the doc branch");
  assert.equal(git(dir, ["rev-parse", "develop"]), beforeDevelop, "dry-run must not move the baseline");
  assert.equal(git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]), "develop", "dry-run must not move the checkout");
  assert.match(formatDocBranchReport(r), /WOULD MOVE/, "the report marks the checkout move as a plan");
});

// ── AC4: the ff introduces no divergence and no new unreachable commits ───────────────────────────

test("AC4: the fast-forward leaves develop..author at 0 and adds no unreachable objects", () => {
  const dir = behindRepo("ac4", 4);
  const fsckBefore = git(dir, ["fsck", "--no-dangling"]);

  const r = ensureDocBranch(dir, { name: "author" });

  assert.equal(r.action, "fast-forwarded");
  assert.equal(git(dir, ["rev-list", "--count", "develop..author"]), "0", "author is not ahead of develop after ff");
  assert.equal(git(dir, ["rev-list", "--count", "author..develop"]), "0", "and it is not behind either — it IS the tip");
  const fsckAfter = git(dir, ["fsck", "--no-dangling"]);
  assert.equal(fsckAfter, fsckBefore, "git fsck output is unchanged — no new unreachable objects");
});

// ── AC5: idempotent — the second run moves nothing and is no longer a fast-forward ────────────────

test("AC5: a second run after the ff is a no-op (ref no longer moves, no fast-forwarded)", () => {
  const dir = behindRepo("ac5", 5);
  const first = ensureDocBranch(dir, { name: "author" });
  assert.equal(first.action, "fast-forwarded");
  const afterFirstAuthor = git(dir, ["rev-parse", "author"]);
  const afterFirstHead = git(dir, ["rev-parse", "HEAD"]);

  const second = ensureDocBranch(dir, { name: "author" });

  assert.equal(second.state, "independent", "the checkout is now off develop, so the invariant already holds");
  assert.equal(second.action, "noop");
  assert.notEqual(second.action, "fast-forwarded", "the second run must not report a fast-forward");
  assert.equal(git(dir, ["rev-parse", "author"]), afterFirstAuthor, "the ref no longer moves");
  assert.equal(git(dir, ["rev-parse", "HEAD"]), afterFirstHead, "and neither does HEAD");
});
