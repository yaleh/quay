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

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LANDING_BASELINE_ROLE,
  classifyBranch,
  detectDefaultBranch,
  ensureBranchModel,
  resolveDocBranchRole,
  verifyBranchModel,
} from "../src/branch-model.ts";
import { runInit } from "../src/init.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUAY_CLI = path.join(__dirname, "..", "bin", "quay.ts");

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────

// Every mkdtemp is carried so a single teardown removes the whole tree (R6 mkdtemp-no-cleanup:
// a per-run tmpdir leak is a violation the ratchet must not have to absorb).
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
function newRepo(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `quay-bm-${tag}-`));
  TMP_DIRS.push(dir);
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
  TMP_DIRS.push(clone);
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
  TMP_DIRS.push(dir);
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
    ["default:reused", "doc-branch:reused", "landing-baseline:reused"],
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

test("the doc-branch role is DERIVED from the checkout — never a literal, never created", () => {
  // ⛔ Hardcoding a doc-branch NAME here would re-introduce exactly what
  // gap-doc-branch-hardcoded-author-breaks-third-party-develop-sync removed: `author` is quay's own
  // convention, and target-identity-literal-check.ts fails RED on it. The shipped mechanism derives
  // the doc branch at runtime (driver-filters.ts resolveDocBranch = the checked-out branch), so
  // creating a named branch would produce a dead artifact the mechanism never returns.
  const dir = thirdPartyShapedRepo();
  assert.equal(resolveDocBranchRole(dir), "main", "the role is the checked-out branch");
  const report = ensureBranchModel(dir, { adopt: true });
  const doc = report.entries.find((e) => e.role === "doc-branch");
  assert.equal(doc.action, "reused");
  assert.equal(doc.ref, "main");
  assert.equal(git(dir, ["branch", "--list", "author"]), "", "no doc branch is invented");
});

test("shape ②: a doc branch parked on a foreign line is NOT a provisioning block", () => {
  // doc divergence from develop is a normal synced state (driver-filters.ts syncs it both ways) —
  // and here the role is not even provisioned, so nothing can block on it.
  const dir = thirdPartyShapedRepo();
  git(dir, ["branch", "author", "develop"]); // an unrelated same-name branch: still not ours to touch
  const foreignDevelop = git(dir, ["rev-parse", "author"]);
  const report = ensureBranchModel(dir, { adopt: true });
  assert.equal(report.ok, true);
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
  assert.equal(git(dir, ["rev-parse", "develop"]), git(dir, ["rev-parse", "main"]));
});

test("shape ②b (AC6 second case): a project with NO develop gets one CREATED at the default tip", () => {
  const dir = newRepo("no-develop");
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "app.txt"), "x\n");
  commit(dir, "base");
  assert.equal(git(dir, ["branch", "--list", "develop"]), "", "premise: no develop exists");

  const report = ensureBranchModel(dir);
  assert.equal(report.ok, true);
  const bl = report.entries.find((e) => e.role === "landing-baseline");
  assert.equal(bl.action, "created");
  assert.equal(git(dir, ["rev-parse", "develop"]), git(dir, ["rev-parse", "main"]));
  // and the mechanism can now diff against it
  assert.equal(classifyBranch(dir, LANDING_BASELINE_ROLE, "main").state, "compatible");
});

test("verifyBranchModel: the read-only verdict agrees with the mutating one", () => {
  const dir = thirdPartyShapedRepo();
  const v = verifyBranchModel(dir);
  assert.equal(v.defaultBranch, "main");
  assert.equal(v.baseline.state, "divergent");
});

// ── the CONFIG-FREE entry: `quay init --branch-model-only` ───────────────────────────────────────
// (gap-upgrade-entry-never-establishes-branch-model)
//
// The shipped upgrade entry (plugin/scripts/quay-init.sh — what a real user runs, and what
// /quay:init runs) works on projects that ALREADY have a `.quay/config.yml`. The full `quay init`
// cannot serve them: it REWRITES the config surface (`generateConfigContent`), so the only remedy
// `ensureBranchModel`'s `branch-model-blocked` message pointed at also destroyed the user's
// `gates:` / `loop:` / `routines:`. These tests pin the entry that makes the remedy reachable
// WITHOUT that write — and pin the write-side negative control (config sha256 unchanged).

/** sha256 of a file — the byte-identity witness for the "config untouched" negative control. */
function sha256(p) {
  return execFileSync("sha256sum", [p], { encoding: "utf8" }).split(" ")[0];
}

/** An ALREADY-initialized project (the shipped upgrade entry's normal input). */
function initializedRepo(tag) {
  const dir = thirdPartyShapedRepo();
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".quay", "config.yml"),
    "providers:\n  native:\n    enabled: true\ngates:\n  custom-user-gate:\n    - name: mine\nloop:\n  routines:\n    - user-owned\n",
  );
  return dir;
}

test("--branch-model-only: a divergent baseline is REPORTED and refused, config sha256 unchanged", () => {
  const dir = initializedRepo("bmo-divergent");
  const cfg = path.join(dir, ".quay", "config.yml");
  const beforeSha = sha256(cfg);
  const beforeDevelop = git(dir, ["rev-parse", "develop"]);

  const result = runInit({ root: dir, force: false, dryRun: false, branchModelOnly: true });
  assert.equal(result.outcome, "branch-model-only");
  assert.equal(result.branchModel.ok, false, "a divergent baseline must not read as ok");
  assert.match(result.branchModelReport, /\[BLOCKED\] landing-baseline -> develop/);
  assert.match(result.branchModelReport, /remedy:.*adopt-branch-model/s);
  // ⛔ THE POINT OF THE ENTRY: an existing config is the normal input, and it is not written.
  assert.equal(sha256(cfg), beforeSha, "config must survive byte-for-byte");
  assert.equal(git(dir, ["rev-parse", "develop"]), beforeDevelop, "the refusal must move nothing");
});

test("--branch-model-only: adoption repairs the baseline and STILL leaves config byte-identical", () => {
  const dir = initializedRepo("bmo-adopt");
  const cfg = path.join(dir, ".quay", "config.yml");
  const beforeSha = sha256(cfg);
  const oldDevelop = git(dir, ["rev-parse", "develop"]);
  const main = git(dir, ["rev-parse", "main"]);

  const result = runInit({ root: dir, force: false, dryRun: false, branchModelOnly: true, adoptBranchModel: true });
  assert.equal(result.outcome, "branch-model-only");
  assert.equal(result.branchModel.ok, true);
  const bl = result.branchModel.entries.find((e) => e.role === "landing-baseline");
  assert.equal(bl.action, "adopted");
  assert.equal(git(dir, ["rev-parse", "develop"]), main, "develop now continues the mainline");
  assert.equal(git(dir, ["rev-parse", bl.backupRef]), oldDevelop, "the foreign tip is preserved, not destroyed");
  assert.equal(classifyBranch(dir, LANDING_BASELINE_ROLE, "main").state, "compatible");
  assert.equal(sha256(cfg), beforeSha, "the repair must not touch the config surface");
  // no other file of the full init was laid down either: this entry establishes a branch model only.
  assert.equal(fs.existsSync(path.join(dir, ".quay", "profiles.yml")), false, "no profiles lay-down");
  assert.equal(fs.existsSync(path.join(dir, ".claude", "launch.settings.json")), false, "no launch-settings lay-down");
  assert.equal(fs.existsSync(path.join(dir, "tasks")), false, "no tasks/ mkdir");
});

test("--branch-model-only: a compatible baseline is a no-op (the AC4 negative control)", () => {
  const dir = initializedRepo("bmo-compatible");
  // Re-point develop onto the mainline first: a compatible project, still already-initialized.
  git(dir, ["branch", "-f", "develop", "main"]);
  const cfg = path.join(dir, ".quay", "config.yml");
  const beforeSha = sha256(cfg);
  const beforeDevelop = git(dir, ["rev-parse", "develop"]);
  const beforeMain = git(dir, ["rev-parse", "main"]);

  const result = runInit({ root: dir, force: false, dryRun: false, branchModelOnly: true });
  assert.equal(result.branchModel.ok, true);
  assert.match(result.branchModelReport, /\[REUSED\] landing-baseline -> develop/);
  // 逐字不变 in BOTH directions: not refused, and not moved.
  assert.equal(git(dir, ["rev-parse", "develop"]), beforeDevelop);
  assert.equal(git(dir, ["rev-parse", "main"]), beforeMain);
  assert.equal(sha256(cfg), beforeSha);
});

test("--branch-model-only: a non-git directory is SKIPPED, not failed (could-not-evaluate ≠ verdict)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-bm-bmo-nogit-"));
  TMP_DIRS.push(dir);
  const result = runInit({ root: dir, force: false, dryRun: false, branchModelOnly: true });
  assert.equal(result.outcome, "branch-model-only");
  assert.equal(result.branchModel.skipped, true, "unreadable input must not be turned into a block");
  assert.equal(result.branchModel.ok, true, "and must not be turned into a pass with a verdict shape either");
  assert.match(result.branchModelReport, /SKIPPED/);
});

test("CLI: `quay init --branch-model-only` on a divergent baseline exits 1 and prints the remedy", () => {
  const dir = initializedRepo("bmo-cli-divergent");
  const cfg = path.join(dir, ".quay", "config.yml");
  const beforeSha = sha256(cfg);
  const r = runQuayInit(["init", "--branch-model-only", "--root", dir], dir);
  assert.equal(r.exitCode, 1, `expected exit 1, got ${r.exitCode}: ${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /\[BLOCKED\] landing-baseline -> develop/);
  assert.match(r.stdout, /adopt-branch-model/, "the remedy must reach the operator verbatim");
  assert.equal(sha256(cfg), beforeSha, "the refusal must leave config byte-identical");
});

test("CLI: `quay init --branch-model-only --adopt-branch-model` exits 0 and repairs the baseline", () => {
  const dir = initializedRepo("bmo-cli-adopt");
  const cfg = path.join(dir, ".quay", "config.yml");
  const beforeSha = sha256(cfg);
  const r = runQuayInit(["init", "--branch-model-only", "--adopt-branch-model", "--root", dir], dir);
  assert.equal(r.exitCode, 0, r.stderr);
  assert.match(r.stdout, /\[ADOPTED\] landing-baseline -> develop/);
  assert.equal(git(dir, ["rev-parse", "develop"]), git(dir, ["rev-parse", "main"]));
  assert.equal(sha256(cfg), beforeSha);
});

test("CLI: `--branch-model-only --dry-run` reports the block but does not fail (a plan is not a refusal)", () => {
  const dir = initializedRepo("bmo-cli-dryrun");
  const beforeDevelop = git(dir, ["rev-parse", "develop"]);
  const r = runQuayInit(["init", "--branch-model-only", "--dry-run", "--root", dir], dir);
  assert.equal(r.exitCode, 0, `a dry run plans, it does not refuse: ${r.stderr}`);
  assert.match(r.stdout, /\[BLOCKED\] landing-baseline -> develop/);
  assert.equal(git(dir, ["rev-parse", "develop"]), beforeDevelop, "--dry-run mutates nothing");
});

test("CLI: the config-free entry supersedes the config-exists refusal it shares a command with", () => {
  // Regression arm for the ordering: `quay init` alone on an initialized project exits 1 with
  // "already exists"; the branch-model entry must NOT be caught by that guard — an existing config
  // is its normal input. Falsifiable: move the `branchModelOnly` block after the `configExists`
  // check in runInit and this test goes red.
  const dir = initializedRepo("bmo-supersede");
  const plain = runQuayInit(["init", "--root", dir], dir);
  assert.equal(plain.exitCode, 1);
  assert.match(plain.stderr, /already exists/);
  const bmo = runQuayInit(["init", "--branch-model-only", "--root", dir], dir);
  assert.match(bmo.stdout, /landing-baseline/, "the entry must still have run its judgment");
  assert.doesNotMatch(bmo.stderr, /already exists/);
});

// ── the SHIPPED entry: plugin/scripts/quay-init.sh must JUDGE the baseline, never assume it ──────
// (gap-upgrade-entry-never-establishes-branch-model)
//
// This is the entry a REAL USER upgrades an already-initialized project with (SPEC §5; the
// /quay:init skill runs it too) — and it is NOT the TS `quay init` every test above drives. Before
// this task it wrote `fork_baseline: develop` into the target config while never judging or
// establishing that ref, so an upgraded project whose own `develop` was an ancient foreign fork
// stayed structurally un-landable, with the remedy unreachable (the one CLI面 that could repair it
// also rewrote — i.e. destroyed — the user's `gates:` / `loop:` / `routines:`).
//
// The shell is a thin DELEGATOR (the judgment stays in `ensureBranchModel`), so what this test pins
// is the delegation: drop the `ensure_target_branch_model` call site and the shipped entry goes back
// to exiting 0 on a foreign baseline — silently.
//
// The refusal happens BEFORE the closed-set write, so this run is cheap and mutation-free.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const SHIPPED_INIT = path.join(REPO_ROOT, "plugin", "scripts", "quay-init.sh");
const VENDORED_CLI = path.join(REPO_ROOT, "plugin", "vendor", "quay", "dist", "quay.js");

test("shipped quay-init.sh: a foreign landing baseline REFUSES the upgrade, config byte-identical", () => {
  // Without the built bundle the shipped entry has NO judgment available (the vendored dist is a
  // gitignored generated artifact; scripts/test.sh's build_dist_once produces it) — that is the
  // script's own can't-evaluate path (exit 3), a DIFFERENT reading. Assert nothing about it rather
  // than reporting a pass this test did not measure (hard rule 3b).
  if (!fs.existsSync(VENDORED_CLI)) return;

  const dir = initializedRepo("shipped-refusal");
  // The shipped entry detects the target's test command BEFORE the branch-model step and fails
  // closed without one — give it one so this test measures the branch-model step, not that guard.
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "scripts", "test.sh"), "#!/usr/bin/env bash\nexit 0\n");
  const cfg = path.join(dir, ".quay", "config.yml");
  const beforeSha = sha256(cfg);
  const beforeDevelop = git(dir, ["rev-parse", "develop"]);

  let r;
  try {
    r = {
      stdout: execFileSync(
        "bash",
        [SHIPPED_INIT, "--root", dir, "--repo-root", dir, "--worktree-root", `${dir}-worktrees`, "--auto-commit-skip"],
        { encoding: "utf8", cwd: dir },
      ),
      stderr: "",
      exitCode: 0,
    };
  } catch (err) {
    r = { stdout: err.stdout ?? "", stderr: err.stderr ?? "", exitCode: err.status ?? 1 };
  }

  assert.equal(r.exitCode, 1, `the shipped upgrade entry must refuse a foreign baseline; got exit ${r.exitCode}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`);
  assert.match(r.stdout, /\[BLOCKED\] landing-baseline -> develop/, "the judgment must be the delivered CLI's own verdict");
  assert.match(r.stderr, /REFUSES to upgrade/, "the operator must be told the upgrade was refused");
  assert.match(r.stderr, /--adopt-branch-model/, "and handed the remedy verbatim");
  assert.equal(sha256(cfg), beforeSha, "the refusal must leave the user's config byte-for-byte unchanged");
  assert.equal(git(dir, ["rev-parse", "develop"]), beforeDevelop, "and move no ref");
});

test("shipped quay-init.sh: a compatible baseline is NOT refused (the AC4 arm of the shipped entry)", () => {
  if (!fs.existsSync(VENDORED_CLI)) return;
  const dir = initializedRepo("shipped-compatible");
  git(dir, ["branch", "-f", "develop", "main"]); // main is now an ancestor of develop
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "scripts", "test.sh"), "#!/usr/bin/env bash\nexit 0\n");
  const beforeDevelop = git(dir, ["rev-parse", "develop"]);

  let r;
  try {
    r = {
      stdout: execFileSync(
        "bash",
        [SHIPPED_INIT, "--root", dir, "--repo-root", dir, "--worktree-root", `${dir}-worktrees`, "--auto-commit-skip"],
        { encoding: "utf8", cwd: dir },
      ),
      stderr: "",
      exitCode: 0,
    };
  } catch (err) {
    r = { stdout: err.stdout ?? "", stderr: err.stderr ?? "", exitCode: err.status ?? 1 };
  }

  assert.doesNotMatch(r.stderr, /REFUSES to upgrade/, "a compatible baseline must never be refused");
  assert.match(r.stdout, /\[REUSED\] landing-baseline -> develop/);
  assert.equal(git(dir, ["rev-parse", "develop"]), beforeDevelop, "and no branch is moved");
});
