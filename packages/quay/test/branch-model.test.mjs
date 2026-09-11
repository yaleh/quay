// @test-group product
// branch-model.ts — the landing baseline is ESTABLISHED by `quay init`, never assumed
// (gap-fan-in-merge-target-hardcoded-develop-blocks-third-party-landing).
//
// FALSIFIABILITY (AC3): every test below fails when the fix is reverted. Reverting means (a)
// `packages/quay/src/branch-model.ts` is gone -> these tests cannot even import; or (b) `runInit`
// no longer calls `ensureBranchModel` -> the `[BLOCKED]`/`[CREATED]` assertions fail. The two
// SHAPES the task names are both covered:
//   ① quay's own shape (the default branch is an ancestor of `develop`) -> behavior unchanged;
//   ② a third-party shape (mainline `main`, a foreign forked `develop`) -> decided, not reused.
//
// Run: node --test packages/quay/test/branch-model.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LANDING_BASELINE_ROLE,
  DOC_BRANCH_ROLE,
  classifyBranch,
  detectDefaultBranch,
  ensureBranchModel,
  verifyBranchModel,
} from "../src/branch-model.ts";
import { runInit } from "../src/init.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUAY_CLI = path.join(__dirname, "..", "bin", "quay.ts");

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}
function commit(cwd, msg) {
  git(cwd, ["add", "-A"]);
  git(cwd, ["commit", "-q", "-m", msg]);
}
function newRepo(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `quay-bm-${tag}-`));
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.name", "bm-test"]);
  git(dir, ["config", "user.email", "bm@example.com"]);
  return dir;
}

/**
 * Shape ①: quay's own topology — the default branch IS an ancestor of `develop`
 * (measured on the real repo: master is 17197 commits behind develop and develop==author).
 */
function quayShapedRepo() {
  const dir = newRepo("quay-shape");
  fs.writeFileSync(path.join(dir, "a.txt"), "1\n");
  commit(dir, "base");
  git(dir, ["branch", "develop"]); // develop continues the default branch
  git(dir, ["checkout", "-q", "develop"]);
  fs.writeFileSync(path.join(dir, "b.txt"), "2\n");
  commit(dir, "verified work on develop");
  git(dir, ["branch", "author"]);
  git(dir, ["checkout", "-q", "main"]);
  return dir;
}

/**
 * Shape ②: the third-party topology that broke AC-239 — a `develop` forked 50 commits back and
 * never merged forward, while `main` is the real mainline.
 */
function thirdPartyShapedRepo() {
  const dir = newRepo("thirdparty-shape");
  for (let i = 1; i <= 60; i++) {
    fs.writeFileSync(path.join(dir, `m${i}.txt`), `${i}\n`);
    commit(dir, `mainline commit ${i}`);
  }
  git(dir, ["checkout", "-q", "-b", "develop", "main~50"]);
  fs.writeFileSync(path.join(dir, "legacy.txt"), "ancient\n");
  commit(dir, "ancient develop work (2025)");
  git(dir, ["checkout", "-q", "main"]);
  return dir;
}

// ── detectDefaultBranch ──────────────────────────────────────────────────────────────────────────

test("detectDefaultBranch: the conventional main/master pair resolves without a remote", () => {
  const dir = newRepo("detect-main");
  fs.writeFileSync(path.join(dir, "f"), "x\n");
  commit(dir, "base");
  assert.equal(detectDefaultBranch(dir), "main");
});

test("detectDefaultBranch: a clone's origin/HEAD declares the default branch authoritatively", () => {
  const origin = newRepo("detect-origin");
  fs.writeFileSync(path.join(origin, "f"), "x\n");
  commit(origin, "base");
  git(origin, ["branch", "-M", "master"]);
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), "quay-bm-clone-"));
  execFileSync("git", ["clone", "-q", origin, clone], { encoding: "utf8" });
  assert.equal(detectDefaultBranch(clone), "master");
});

test("detectDefaultBranch: allowCurrentBranch=false refuses the checked-out branch as a proxy", () => {
  // A task worktree's HEAD is `task/<id>` — never a default-branch proxy. Using it would invert
  // the compatibility predicate and misreport every healthy fan-in as a foreign fork.
  const dir = newRepo("detect-noworktree");
  git(dir, ["branch", "-M", "trunk"]); // no conventional main/master pair to fall back on
  fs.writeFileSync(path.join(dir, "f"), "x\n");
  commit(dir, "base");
  git(dir, ["checkout", "-q", "-b", "task/T-1"]);
  assert.equal(detectDefaultBranch(dir), "task/T-1", "last resort on a plain checkout");
  assert.equal(detectDefaultBranch(dir, { allowCurrentBranch: false }), null, "never inside a worktree");
});

// ── classifyBranch: three (four) states, never two ───────────────────────────────────────────────

test("classifyBranch: absent / compatible / divergent / unreadable are distinct values", () => {
  const quayShaped = quayShapedRepo();
  assert.equal(classifyBranch(quayShaped, "nope", "main").state, "absent");
  assert.equal(classifyBranch(quayShaped, LANDING_BASELINE_ROLE, "main").state, "compatible");
  // a foreign line: the very topology that made AC-239's task structurally un-landable
  const thirdParty = thirdPartyShapedRepo();
  assert.equal(classifyBranch(thirdParty, LANDING_BASELINE_ROLE, "main").state, "divergent");
  // unreadable is its OWN state — a judge that cannot read its input must not return the value it
  // returns on approval (hard rule 3b). `develop` exists but the default branch is unresolvable.
  const unreadable = classifyBranch(quayShaped, LANDING_BASELINE_ROLE, null);
  assert.equal(unreadable.state, "unreadable");
  assert.equal(unreadable.reason, "default-branch-unresolvable");
});

test("classifyBranch: a non-git directory is unreadable, NOT compatible", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-bm-nogit-"));
  const c = classifyBranch(dir, LANDING_BASELINE_ROLE, null);
  assert.equal(c.state, "unreadable");
  assert.equal(c.reason, "not-a-git-worktree");
});

test("classifyBranch: an unborn repo reports no-commits, not a missing branch", () => {
  const dir = newRepo("unborn");
  const c = classifyBranch(dir, LANDING_BASELINE_ROLE, null);
  assert.equal(c.state, "unreadable");
  assert.equal(c.reason, "no-commits");
});

// ── SHAPE ①: quay's own topology ⇒ behavior unchanged (the regression arm) ───────────────────────

test("shape ①: a quay-shaped repo is REUSED untouched — nothing is created, moved or blocked", () => {
  const dir = quayShapedRepo();
  const before = {
    develop: git(dir, ["rev-parse", "develop"]),
    author: git(dir, ["rev-parse", "author"]),
    main: git(dir, ["rev-parse", "main"]),
  };
  const report = ensureBranchModel(dir);
  assert.equal(report.ok, true, "a compatible baseline must never block");
  assert.equal(report.defaultBranch, "main");
  assert.deepEqual(
    report.entries.map((e) => `${e.role}:${e.action}`),
    ["default:reused", "landing-baseline:reused", "doc-branch:reused"],
  );
  // 逐字不变: every ref is bit-identical after `quay init`.
  assert.equal(git(dir, ["rev-parse", "develop"]), before.develop);
  assert.equal(git(dir, ["rev-parse", "author"]), before.author);
  assert.equal(git(dir, ["rev-parse", "main"]), before.main);
});

// ── SHAPE ②: third-party topology ⇒ decided, never silently reused ───────────────────────────────

test("shape ②: a foreign `develop` BLOCKS by default and leaves every ref untouched", () => {
  const dir = thirdPartyShapedRepo();
  const before = git(dir, ["rev-parse", "develop"]);
  const report = ensureBranchModel(dir);
  assert.equal(report.ok, false, "a foreign landing baseline must not be reused silently");
  const bl = report.entries.find((e) => e.role === "landing-baseline");
  assert.equal(bl.action, "blocked");
  assert.match(bl.detail, /NOT a continuation of the project's default branch/);
  // fail-closed means fail-CLEAN: blocking must not have moved anything.
  assert.equal(git(dir, ["rev-parse", "develop"]), before);
  assert.equal(git(dir, ["branch", "--list", "develop-pre-quay-init-*"]), "", "no backup on the non-adopt path");
  assert.match(report.remedy, /adopt-branch-model/);
});

test("shape ②: adoption preserves the old tip as a backup ref and re-points `develop`", () => {
  const dir = thirdPartyShapedRepo();
  const oldDevelop = git(dir, ["rev-parse", "develop"]);
  const main = git(dir, ["rev-parse", "main"]);
  const report = ensureBranchModel(dir, { adopt: true });
  assert.equal(report.ok, true);
  const bl = report.entries.find((e) => e.role === "landing-baseline");
  assert.equal(bl.action, "adopted");
  assert.equal(git(dir, ["rev-parse", "develop"]), main, "develop now continues the mainline");
  assert.equal(git(dir, ["rev-parse", bl.backupRef]), oldDevelop, "the pre-quay tip is preserved, not destroyed");
  // and the result satisfies the predicate that makes the mechanism meaningful
  assert.equal(classifyBranch(dir, LANDING_BASELINE_ROLE, "main").state, "compatible");
});

test("shape ②: `author` is created at the default tip when absent (never blocked)", () => {
  const dir = thirdPartyShapedRepo();
  const report = ensureBranchModel(dir, { adopt: true });
  const doc = report.entries.find((e) => e.role === "doc-branch");
  assert.equal(doc.action, "created");
  assert.equal(doc.ref, DOC_BRANCH_ROLE);
  assert.equal(git(dir, ["rev-parse", DOC_BRANCH_ROLE]), git(dir, ["rev-parse", "main"]));
});

test("shape ②: a divergent `author` is NOT a provisioning block (doc divergence is a synced state)", () => {
  const dir = thirdPartyShapedRepo();
  const foreignDevelop = git(dir, ["rev-parse", "develop"]);
  git(dir, ["branch", "author", "develop"]); // doc branch parked on the foreign line
  const report = ensureBranchModel(dir, { adopt: true });
  assert.equal(report.entries.find((e) => e.role === "doc-branch").action, "reused");
  assert.equal(git(dir, ["rev-parse", "author"]), foreignDevelop, "left alone — never blocked, never moved");
});

test("dryRun: reports the plan and mutates nothing", () => {
  const dir = thirdPartyShapedRepo();
  const before = git(dir, ["rev-parse", "develop"]);
  const report = ensureBranchModel(dir, { adopt: true, dryRun: true });
  assert.equal(report.entries.find((e) => e.role === "landing-baseline").action, "adopted");
  assert.equal(git(dir, ["rev-parse", "develop"]), before, "dry run writes nothing");
  assert.equal(git(dir, ["branch", "--list", "author"]), "", "dry run creates nothing");
});

// ── the wiring: `quay init` is where this happens ────────────────────────────────────────────────

test("runInit: a foreign landing baseline blocks init and writes NOTHING", () => {
  const dir = thirdPartyShapedRepo();
  const result = runInit({ root: dir, force: true, dryRun: false });
  assert.equal(result.outcome, "branch-model-blocked");
  assert.equal(fs.existsSync(path.join(dir, ".quay", "config.yml")), false, "a blocked init must not half-initialize");
});

test("runInit: --adopt-branch-model initializes a third-party project onto a usable baseline", () => {
  const dir = thirdPartyShapedRepo();
  const result = runInit({ root: dir, force: true, dryRun: false, adoptBranchModel: true });
  assert.equal(result.outcome, "written");
  assert.equal(fs.existsSync(path.join(dir, ".quay", "config.yml")), true);
  assert.equal(classifyBranch(dir, LANDING_BASELINE_ROLE, "main").state, "compatible");
});

test("runInit: on a quay-shaped repo the branch model is a no-op (逐字不变 regression)", () => {
  const dir = quayShapedRepo();
  const before = git(dir, ["rev-parse", "develop"]);
  const result = runInit({ root: dir, force: true, dryRun: false });
  assert.equal(result.outcome, "written");
  assert.equal(git(dir, ["rev-parse", "develop"]), before);
  assert.equal(result.branchModel.entries.every((e) => e.action === "reused"), true);
});

// ── the shipped surface: the CLI actually blocks and actually adopts ──────────────────────────────

function runQuayInit(args, cwd) {
  try {
    return { stdout: execFileSync("node", [QUAY_CLI, ...args], { encoding: "utf8", cwd }), exitCode: 0, stderr: "" };
  } catch (err) {
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", exitCode: err.status ?? 1 };
  }
}

test("CLI: `quay init` on a third-party shape exits 1 and names the remedy", () => {
  const dir = thirdPartyShapedRepo();
  const r = runQuayInit(["init", "--root", dir], dir);
  assert.equal(r.exitCode, 1);
  assert.match(r.stderr, /landing baseline is not a continuation/);
  assert.match(r.stderr, /adopt-branch-model/);
  assert.equal(fs.existsSync(path.join(dir, ".quay", "config.yml")), false);
});

test("CLI: `quay init --adopt-branch-model` exits 0 and creates the branch model", () => {
  const dir = thirdPartyShapedRepo();
  const r = runQuayInit(["init", "--adopt-branch-model", "--root", dir], dir);
  assert.equal(r.exitCode, 0, r.stderr);
  assert.match(r.stdout, /\[ADOPTED\] landing-baseline -> develop/);
  assert.match(r.stdout, /\[CREATED\] doc-branch -> author/);
  assert.equal(git(dir, ["rev-parse", "develop"]), git(dir, ["rev-parse", "main"]));
});

test("verifyBranchModel: the read-only verdict agrees with the mutating one", () => {
  const dir = thirdPartyShapedRepo();
  const v = verifyBranchModel(dir);
  assert.equal(v.defaultBranch, "main");
  assert.equal(v.baseline.state, "divergent");
});
