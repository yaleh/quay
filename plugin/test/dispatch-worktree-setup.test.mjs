// @test-group engine
// dispatch-worktree-setup.test.mjs — tasks/gap-worktree-node-modules-inconsistent-self-verify
// (a dispatched task worktree's ability to self-verify was AGENT-REMEMBERING, not mechanism:
//  tasklist created the node_modules symlink and could self-verify, tokenwait didn't and fell back
//  to the shared checkout. dispatch-worktree-setup.sh is the MECHANISM — every dispatched
//  worktree gets node_modules (symlink-or-install) + config.yml, so `scripts/test.sh` in the
//  worktree never depends on the agent remembering.)
//
// Coverage map (task ACs):
//   AC1 — symlink path: <main>/node_modules → <worktree>/node_modules.
//   AC1 — install path: main has NO node_modules → `npm install` inside the worktree (a stub npm
//         in PATH proves the branch ran and produced node_modules; a stub that does NOT produce
//         node_modules proves the fail-closed exit 2).
//   AC2 — the script is what the dispatch prompt calls (wiring itself is the tick-doc change +
//         the run_static_checks wiring asserted by the checker half below); the script is
//         idempotent so re-running after a dispatch is a no-op.
//   AC3 — negative control premise: the script's reason-for-being is that scripts/test.sh's build
//         phase fails closed without node_modules. The symlink path tests prove the setup'd state;
//         the checker half below asserts the "task worktree without node_modules reports MISSING"
//         invariant, and the DoD exercises the REAL test.sh fail-closed on a fresh worktree.
//   AC4 — worktree-node-modules-check.sh: report-only (exit 0) on MISSING by default; --fail
//         exits 1; --json emits the machine-readable array. Wired into run_static_checks
//         (scripts/test.sh) — asserted by the checker-wiring test.
//   AC5 — this file uses node:test + `// @test-group engine`.
//
// AC-284 / GOAL-023 — step 0b, the fork-point self-check (a branch NAME check cannot see where the
// branch forked from; `git worktree add -b task/<id> <path>` silently forks from the invoking HEAD,
// so changing the GitHub default branch to master would silently base every worker worktree on
// master). Negative control (worktree cut from master ⇒ exit 2), positive control (cut from develop
// ⇒ exit 0), the two false-positive shapes that must NOT be refused (develop advanced after the
// fork / worktree has its own commits — 5/5 live worktrees have exactly these shapes), and
// NOT-EVALUATED as an independent value when there is no develop ref to judge against.
//
// Run:
//   scripts/test.sh plugin/test/dispatch-worktree-setup.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const SETUP = path.join(REPO_ROOT, "plugin/scripts/dispatch-worktree-setup.sh");
const CHECK = path.join(REPO_ROOT, "plugin/scripts/worktree-node-modules-check.sh");
const WI = path.join(REPO_ROOT, "scripts/worktree-include.sh");

function t(name, fn) {
  test(name, fn);
}

function bash(script, args, opts = {}) {
  const r = spawnSync("bash", [script, ...args], { encoding: "utf8", ...opts });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** Throwaway MAIN repo fixture: node_modules present by default; `withNodeModules:false` omits it. */
function tmpMainRepo(withNodeModules = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-main-"));
  fs.mkdirSync(path.join(dir, "node_modules"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".quay", "config.yml"), "fixture config\n");
  if (!withNodeModules) {
    fs.rmSync(path.join(dir, "node_modules"), { recursive: true, force: true });
  }
  return dir;
}

/** Throwaway WORKTREE dir (plain dir; worktree-include.sh absent in the fixture root → skipped). */
function tmpWorktree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-verify-"));
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  return dir;
}

/** A stub `npm` that CREATES node_modules in the cwd (proves the install branch ran). */
function makeNpmStub(createNodeModules) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-npmbin-"));
  const stub = path.join(bin, "npm");
  fs.writeFileSync(
    stub,
    `#!/usr/bin/env bash\n# stub npm — records invocation, optionally creates node_modules in cwd\nprintf 'stub-npm invoked in %s\\n' "$PWD" >&2\nif [ "${createNodeModules}" = "create" ]; then mkdir -p node_modules; fi\nexit 0\n`,
  );
  fs.chmodSync(stub, 0o755);
  return { bin, stub };
}

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

// ── --help contract ─────────────────────────────────────────────────────────────────────────────

t("--help exits 0, first line starts with the basename + description, no side effects", () => {
  const r = bash(SETUP, ["--help"]);
  assert.equal(r.status, 0, "--help must exit 0");
  assert.match(r.stdout.split("\n")[0], /^dispatch-worktree-setup\.sh —/);
  assert.match(r.stdout, /usage: bash plugin\/scripts\/dispatch-worktree-setup\.sh/);
});

// ── AC1 symlink path ────────────────────────────────────────────────────────────────────────────

t("AC1 symlink path — <main>/node_modules → <worktree>/node_modules", () => {
  const main = tmpMainRepo();
  const wt = tmpWorktree();
  try {
    const r = bash(SETUP, [wt, "--root", main]);
    assert.equal(r.status, 0, `script exited ${r.status}: ${r.stdout} ${r.stderr}`);
    assert.ok(fs.lstatSync(path.join(wt, "node_modules")).isSymbolicLink(), "node_modules is a symlink");
    assert.equal(fs.readlinkSync(path.join(wt, "node_modules")), path.join(main, "node_modules"));
    assert.match(r.stdout, /linked/);
  } finally {
    rmrf(wt);
    rmrf(main);
  }
});

t("AC1 symlink path — root auto-derived from git worktree list when --root absent", () => {
  // Build a REAL throwaway git repo with a registered task worktree and NO --root: the script must
  // derive the main checkout from `git worktree list --porcelain` (first entry = main) and link the
  // main's node_modules into the worktree. The fixture main has no scripts/worktree-include.sh, so
  // the config.yml delegation is skipped (the same graceful path the plain-dir tests rely on).
  const main = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-gitmain-"));
  const git = (...args) => {
    const r = spawnSync("git", args, { cwd: main, encoding: "utf8" });
    assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr ?? ""}`);
    return r.stdout.trim();
  };
  git("init", "-q");
  git("config", "user.email", "t@test");
  git("config", "user.name", "t");
  fs.writeFileSync(path.join(main, "README.md"), "# repo\n");
  git("add", "-A");
  git("commit", "-q", "-m", "baseline");
  fs.mkdirSync(path.join(main, "node_modules"), { recursive: true });
  const wt = path.join(main, "wt");
  git("worktree", "add", "-q", "-b", "task/fixture", wt, "HEAD");
  try {
    const r = bash(SETUP, [wt]);
    assert.equal(r.status, 0, `script exited ${r.status}: ${r.stdout} ${r.stderr}`);
    assert.ok(fs.lstatSync(path.join(wt, "node_modules")).isSymbolicLink(), "node_modules is a symlink");
    assert.equal(
      fs.readlinkSync(path.join(wt, "node_modules")),
      path.join(main, "node_modules"),
      "derived root must be the git worktree-list main checkout",
    );
  } finally {
    rmrf(main);
  }
});

// ── branch self-check (gap-task-branch-prefix-assumption-scattered-read-sites-orphan-enumeration-blind) ──
// 写方唯一化并强制：任务 worktree 分支必须是 task/<id>。一个 develop 分支 worktree（2026-09-08 实测
// worker 把 worktree 建在 develop 上、提交直接落 develop 绕过 fan-in）必须被拒；task/<id> 仍成功。

/** A throwaway REAL git repo + a worktree on an arbitrary branch. Returns { root, wt }. */
function makeRepoWithBranchWorktree(branch) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-branch-"));
  const git = (...args) => {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr ?? ""}`);
    return r.stdout.trim();
  };
  git("init", "-q");
  git("config", "user.email", "t@test");
  git("config", "user.name", "t");
  fs.writeFileSync(path.join(root, "README.md"), "# repo\n");
  git("add", "-A");
  git("commit", "-q", "-m", "baseline");
  fs.mkdirSync(path.join(root, "node_modules"), { recursive: true });
  const wt = path.join(root, "wt");
  git("worktree", "add", "-q", "-b", branch, wt, "HEAD");
  return { root, wt };
}

t("branch self-check — a develop-branch worktree is refused (exit 2 + reported)", () => {
  const { root, wt } = makeRepoWithBranchWorktree("develop");
  try {
    const r = bash(SETUP, [wt, "--root", root]);
    assert.equal(r.status, 2, `develop-branch worktree must exit 2, got ${r.status}`);
    assert.match(r.stderr, /develop/, "the offending branch must be named in the failure");
    assert.match(r.stderr, /not task\/<id>/, "the refusal reason must name the task/<id> convention");
    assert.ok(!fs.existsSync(path.join(wt, "node_modules")), "nothing must be provisioned on refusal");
  } finally {
    rmrf(root);
  }
});

t("branch self-check — a task/<id>-branch worktree still provisions (negative control)", () => {
  const { root, wt } = makeRepoWithBranchWorktree("task/gap-setup-ok");
  try {
    const r = bash(SETUP, [wt, "--root", root]);
    assert.equal(r.status, 0, `task/<id>-branch worktree must exit 0, got ${r.status}: ${r.stdout} ${r.stderr}`);
    assert.ok(fs.lstatSync(path.join(wt, "node_modules")).isSymbolicLink(), "task/<id> branch must still get node_modules");
  } finally {
    rmrf(root);
  }
});

// ── 0b. fork-point self-check (AC-284 / GOAL-023) ───────────────────────────────────────────────
// 靶子：worker 从 **master**（发布/默认线）而不是 develop 分叉出的 worktree。派发 prompt 的第 1 步
// 逐字不指名 base ⇒ `git worktree add -b task/<id> <path>` 从调用方当时的 HEAD 分叉；默认分支一旦由
// develop 改成 master，worktree 就静默从更旧的 master 分叉，而步骤 0 只查分支名 ⇒ 放行。
//
// 夹具复现本仓库 2026-09-17 的实测形态：**master 是 develop 的祖先**（merge-base(master, develop) ==
// master tip、`--is-ancestor master develop` exit 0）——正是让「HEAD 落在 develop 历史上」这类弱谓词
// 全部失效的那一形态。默认分支显式钉成 master，⛔ 不让宿主的 init.defaultBranch 决定夹具形状。

/**
 * Throwaway REAL git repo in which `master` is a strict ANCESTOR of `develop`, plus a task worktree
 * on `branch` cut from `from` (`"master"`/`"develop"`, or `null` ⇒ NO start point, i.e. an implicit
 * fork from the invoking HEAD — the `git worktree add -b X <path>` form the dispatch prompt's step 1
 * literally describes). Returns { root, wt, git, wtGit }.
 */
function makeForkpointRepo({ branch, from }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-forkpoint-"));
  const run = (cwd) => (...args) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    assert.equal(r.status, 0, `git ${args.join(" ")} (cwd ${cwd}) failed: ${r.stderr ?? ""}`);
    return r.stdout.trim();
  };
  const git = run(root);
  git("init", "-q");
  git("symbolic-ref", "HEAD", "refs/heads/master"); // pin the default branch — host-independent
  git("config", "user.email", "t@test");
  git("config", "user.name", "t");
  fs.writeFileSync(path.join(root, "README.md"), "# repo\n");
  git("add", "README.md");
  git("commit", "-q", "-m", "baseline"); // master = baseline
  git("checkout", "-q", "-b", "develop");
  fs.writeFileSync(path.join(root, "d1.txt"), "d1\n");
  git("add", "d1.txt");
  git("commit", "-q", "-m", "d1"); // ⇒ develop is now strictly AHEAD of master
  git("checkout", "-q", "master");
  fs.mkdirSync(path.join(root, "node_modules"), { recursive: true });
  const wt = path.join(root, "wt");
  if (from === null) {
    git("worktree", "add", "-q", "-b", branch, wt); // no start point ⇒ forks from HEAD (= master here)
  } else {
    git("worktree", "add", "-q", "-b", branch, wt, from);
  }
  // Premise assertion (AC-284 constraint 1): master really is an ancestor of develop here, so HEAD
  // of a master-forked worktree IS a node of develop's own history — the shape that defeats
  // "merge-base HEAD develop is non-empty" / "--is-ancestor HEAD develop" / "develop..HEAD == 0".
  assert.equal(
    git("merge-base", "master", "develop"),
    git("rev-parse", "master"),
    "fixture premise: merge-base(master, develop) must equal master's tip",
  );
  return { root, wt, git, wtGit: run(wt) };
}

t("AC-284 AC2 — a worktree cut from master (master is an ancestor of develop) is REFUSED (exit 2)", () => {
  const { root, wt } = makeForkpointRepo({ branch: "task/gap-ac284-from-master", from: "master" });
  try {
    const r = bash(SETUP, [wt, "--root", root]);
    assert.equal(r.status, 2, `a master-forked worktree must exit 2, got ${r.status}: ${r.stdout} ${r.stderr}`);
    assert.match(r.stderr, /fork-point REFUSED/, "the refusal must come from the fork-point check, not the branch-name check");
    assert.match(r.stderr, /from 'master'/, "the wrong base must be named");
    assert.match(r.stderr, /behind develop/, "the reason must name develop as the base it is behind");
    assert.ok(!fs.existsSync(path.join(wt, "node_modules")), "nothing must be provisioned on refusal");
  } finally {
    rmrf(root);
  }
});

t("AC-284 AC2b — an IMPLICIT fork (no start point) while HEAD is master is refused too", () => {
  // The implicit form is what the dispatch prompt's step 1 literally says (`create an isolated git
  // worktree`, no base). Its creation record reads `Created from HEAD`, which names no base — so the
  // refusal here can only come from the STRUCTURAL half (fork point == a candidate line's tip),
  // never from a name match.
  const { root, wt } = makeForkpointRepo({ branch: "task/gap-ac284-implicit", from: null });
  try {
    const rec = spawnSync("git", ["-C", wt, "reflog", "show", "--format=%gs", "task/gap-ac284-implicit"], {
      encoding: "utf8",
    }).stdout.trim();
    assert.match(rec, /branch: Created from HEAD/, `fixture premise: implicit fork records HEAD, got '${rec}'`);
    const r = bash(SETUP, [wt, "--root", root]);
    assert.equal(r.status, 2, `an implicit master fork must exit 2, got ${r.status}: ${r.stdout} ${r.stderr}`);
    assert.match(r.stderr, /fork-point REFUSED/);
    assert.match(r.stderr, /exactly the tip of 'master'/, "the structural half must name the line it recognised");
  } finally {
    rmrf(root);
  }
});

t("AC-284 AC3 — the SAME fixture cut from develop still provisions (exit 0 + node_modules)", () => {
  const { root, wt } = makeForkpointRepo({ branch: "task/gap-ac284-from-develop", from: "develop" });
  try {
    const r = bash(SETUP, [wt, "--root", root]);
    assert.equal(r.status, 0, `a develop-forked worktree must exit 0, got ${r.status}: ${r.stdout} ${r.stderr}`);
    assert.match(r.stdout, /fork-point PASS/);
    assert.ok(fs.lstatSync(path.join(wt, "node_modules")).isSymbolicLink(), "develop-forked worktree must be provisioned");
  } finally {
    rmrf(root);
  }
});

t("AC-284 AC4a — cut from develop, then develop ADVANCES ⇒ not refused (the false-positive shape)", () => {
  const { root, wt, git } = makeForkpointRepo({ branch: "task/gap-ac284-advanced", from: "develop" });
  try {
    git("checkout", "-q", "develop");
    fs.writeFileSync(path.join(root, "d2.txt"), "d2\n");
    git("add", "d2.txt");
    git("commit", "-q", "-m", "d2");
    git("checkout", "-q", "master");
    const lr = spawnSync("git", ["-C", wt, "rev-list", "--left-right", "--count", "develop...HEAD"], {
      encoding: "utf8",
    }).stdout.trim();
    assert.match(lr, /^1\t0$/, `fixture premise: develop must be 1 ahead of HEAD (got '${lr}')`);
    const r = bash(SETUP, [wt, "--root", root]);
    assert.equal(r.status, 0, `a legitimately stale develop fork must NOT be refused, got ${r.status}: ${r.stdout} ${r.stderr}`);
    assert.match(r.stdout, /fork-point PASS/);
    assert.doesNotMatch(r.stderr, /REFUSED/);
  } finally {
    rmrf(root);
  }
});

t("AC-284 AC4b — cut from develop, the worktree has its OWN commits ⇒ not refused", () => {
  const { root, wt, wtGit } = makeForkpointRepo({ branch: "task/gap-ac284-owncommits", from: "develop" });
  try {
    fs.writeFileSync(path.join(wt, "mine.txt"), "mine\n");
    wtGit("add", "mine.txt");
    wtGit("commit", "-q", "-m", "mine");
    const lr = spawnSync("git", ["-C", wt, "rev-list", "--left-right", "--count", "develop...HEAD"], {
      encoding: "utf8",
    }).stdout.trim();
    assert.match(lr, /^0\t1$/, `fixture premise: HEAD must carry 1 commit develop lacks (got '${lr}')`);
    const r = bash(SETUP, [wt, "--root", root]);
    assert.equal(r.status, 0, `a develop fork with its own commits must NOT be refused, got ${r.status}: ${r.stdout} ${r.stderr}`);
    assert.match(r.stdout, /fork-point PASS/);
    assert.doesNotMatch(r.stderr, /REFUSED/);
  } finally {
    rmrf(root);
  }
});

t("AC-284 AC5 — no develop ref ⇒ fork-point NOT-EVALUATED (a distinct value), provisioning still exits 0", () => {
  // 第三方 quay-init workspace / plain fixtures have no develop ref at all: the check must give an
  // INDEPENDENT value and must not block (hard rule 3b — "cannot evaluate" must not be shaped like
  // "checked and fine", and must not be shaped like a refusal either).
  const { root, wt } = makeRepoWithBranchWorktree("task/gap-ac284-nodevelop");
  try {
    const r = bash(SETUP, [wt, "--root", root]);
    assert.equal(r.status, 0, `a repo with no develop ref must not be blocked, got ${r.status}: ${r.stdout} ${r.stderr}`);
    assert.match(r.stdout, /fork-point NOT-EVALUATED/, "the independent value must be grep-able");
    assert.doesNotMatch(r.stdout, /fork-point PASS/, "NOT-EVALUATED must not be shaped like PASS");
    assert.doesNotMatch(r.stderr, /REFUSED/, "NOT-EVALUATED must not be shaped like a refusal");
    assert.ok(fs.lstatSync(path.join(wt, "node_modules")).isSymbolicLink(), "NOT-EVALUATED must not block provisioning");
  } finally {
    rmrf(root);
  }
});

// ── 0b′. goal-branch base（SPEC-goal-branch-2026-10-03 §4.3）────────────────────────────────────
// 一个 branch-mode goal 的任务其 worktree 必须从 `goal/<GOAL-NNN>` 分叉，故派发 prompt 把解析出的
// mergeTarget 作为 `--base` 传给本脚本。此处钉住：`--base goal/GOAL-901` 下，从 goal 分支分叉的
// worktree 自检 **PASS** 并正常 provisioning（⛔ 不是 NOT-EVALUATED——base ref 必须可解析）。
t("goal-branch base — a worktree cut from goal/GOAL-901 passes `--base goal/GOAL-901` (exit 0 + fork-point PASS)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-goalbase-"));
  const git = (...args) => {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr ?? ""}`);
    return r.stdout.trim();
  };
  try {
    git("init", "-q");
    git("config", "user.email", "t@test");
    git("config", "user.name", "t");
    git("symbolic-ref", "HEAD", "refs/heads/develop"); // 钉默认分支，宿主无关
    fs.writeFileSync(path.join(root, "README.md"), "# repo\n");
    git("add", "-A");
    git("commit", "-q", "-m", "baseline");
    git("branch", "goal/GOAL-901", "develop"); // branch-mode goal 的派生分支
    fs.mkdirSync(path.join(root, "node_modules"), { recursive: true });
    const wt = path.join(root, "wt");
    git("worktree", "add", "-q", "-b", "task/gap-goalbase", wt, "goal/GOAL-901");
    const r = bash(SETUP, [wt, "--root", root, "--base", "goal/GOAL-901"]);
    assert.equal(r.status, 0, `a goal-branch fork under --base goal/GOAL-901 must exit 0, got ${r.status}: ${r.stdout} ${r.stderr}`);
    assert.match(r.stdout, /fork-point PASS/, "goal-branch fork must PASS its own base check");
    assert.doesNotMatch(r.stderr, /REFUSED/);
    assert.ok(fs.lstatSync(path.join(wt, "node_modules")).isSymbolicLink(), "must provision");
  } finally {
    rmrf(root);
  }
});

// ── AC1 install path ────────────────────────────────────────────────────────────────────────────

t("AC1 install path — main has NO node_modules ⇒ npm install inside the worktree (stub npm)", () => {
  const main = tmpMainRepo(false); // bare clone: no node_modules
  const wt = tmpWorktree();
  const npmStub = makeNpmStub("create"); // stub creates node_modules in cwd
  const env = { ...process.env, PATH: `${npmStub.bin}:${process.env.PATH}` };
  try {
    const r = bash(SETUP, [wt, "--root", main], { env });
    assert.equal(r.status, 0, `script exited ${r.status}: ${r.stdout} ${r.stderr}`);
    assert.match(r.stdout, /npm install/, "install branch must run when main has no node_modules");
    assert.match(r.stderr, /stub-npm invoked in/, "the stub npm must have been the one invoked");
    assert.ok(fs.statSync(path.join(wt, "node_modules")).isDirectory(), "node_modules created by install");
  } finally {
    rmrf(wt);
    rmrf(main);
    rmrf(npmStub.bin);
  }
});

t("AC1 install path — install that does NOT produce node_modules fails closed (exit 2)", () => {
  const main = tmpMainRepo(false);
  const wt = tmpWorktree();
  const npmStub = makeNpmStub("none"); // stub does NOT create node_modules
  const env = { ...process.env, PATH: `${npmStub.bin}:${process.env.PATH}` };
  try {
    const r = bash(SETUP, [wt, "--root", main], { env });
    assert.equal(r.status, 2, "install with no product must exit 2");
    assert.match(r.stderr, /did not produce/);
  } finally {
    rmrf(wt);
    rmrf(main);
    rmrf(npmStub.bin);
  }
});

// ── AC1 package-manager path (pnpm) ─────────────────────────────────────────────────────────────
// gap-dispatch-worktree-setup-links-node-modules-for-pnpm-projects: a pnpm project refuses a
// symlinked node_modules, so the OLD behavior (symlink when the main has node_modules) made every
// dispatched worktree's suite step die in milliseconds. The fix installs INSIDE the worktree when the
// project declares a command (`.quay/config.yml` loop.worktree_deps_install) or is detected as pnpm
// (pnpm-lock.yaml). The judgment is ONE implementation in packages/quay/src/worktree-deps.ts.

/** A stub package-manager binary named `name` that prints its cwd and optionally creates node_modules
 *  / fails. Used to prove the INSTALL branch ran in the worktree (⛔ not real pnpm). */
function makePmStub(name, { create = false, fail = false } = {}) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-pmbin-"));
  const stub = path.join(bin, name);
  fs.writeFileSync(
    stub,
    `#!/usr/bin/env bash\n` +
      `printf 'stub-${name} invoked in %s\\n' "$PWD" >&2\n` +
      (create ? `mkdir -p node_modules\n` : "") +
      (fail ? `exit 2\n` : `exit 0\n`),
  );
  fs.chmodSync(stub, 0o755);
  return { bin, stub };
}

/** A minimal VALID `.quay/config.yml` whose loop section declares loop.worktree_deps_install. */
function configWithWorktreeDepsInstall(cmd) {
  return `loop:\n  board: native\n  gates: [acceptance]\n  worktree_deps_install: ${JSON.stringify(cmd)}\n`;
}

t("AC1 pnpm ① — no package-manager marker ⇒ unchanged symlink behavior", () => {
  const main = tmpMainRepo(); // node_modules present, NO pnpm-lock.yaml
  const wt = tmpWorktree();
  try {
    assert.ok(!fs.existsSync(path.join(main, "pnpm-lock.yaml")), "fixture premise: no pnpm marker");
    const r = bash(SETUP, [wt, "--root", main]);
    assert.equal(r.status, 0, `script exited ${r.status}: ${r.stdout} ${r.stderr}`);
    assert.ok(fs.lstatSync(path.join(wt, "node_modules")).isSymbolicLink(), "no marker ⇒ still a symlink (behavior unchanged)");
    assert.equal(fs.readlinkSync(path.join(wt, "node_modules")), path.join(main, "node_modules"));
  } finally {
    rmrf(wt);
    rmrf(main);
  }
});

t("AC1 pnpm ② — pnpm-lock.yaml ⇒ NO symlink; the pnpm install command runs with cwd = the worktree", () => {
  const main = tmpMainRepo();
  fs.writeFileSync(path.join(main, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  const wt = tmpWorktree();
  const pnpmStub = makePmStub("pnpm", { create: true }); // records its cwd, creates node_modules
  const env = { ...process.env, PATH: `${pnpmStub.bin}:${process.env.PATH}` };
  try {
    const r = bash(SETUP, [wt, "--root", main], { env });
    assert.equal(r.status, 0, `script exited ${r.status}: ${r.stdout} ${r.stderr}`);
    assert.ok(r.stderr.includes(`stub-pnpm invoked in ${wt}`), `the pnpm command must run with cwd = the worktree; stderr=${r.stderr}`);
    assert.ok(!fs.lstatSync(path.join(wt, "node_modules")).isSymbolicLink(), "⛔ must NOT be a symlink to the main checkout");
    assert.ok(fs.statSync(path.join(wt, "node_modules")).isDirectory(), "the install produced a REAL node_modules directory");
  } finally {
    rmrf(wt);
    rmrf(main);
    rmrf(pnpmStub.bin);
  }
});

t("AC1 pnpm ②b — a declared loop.worktree_deps_install command runs (in the worktree)", () => {
  const main = tmpMainRepo();
  const stub = makePmStub("declared-install", { create: true });
  fs.writeFileSync(path.join(main, ".quay", "config.yml"), configWithWorktreeDepsInstall(stub.stub));
  const wt = tmpWorktree();
  try {
    const r = bash(SETUP, [wt, "--root", main]);
    assert.equal(r.status, 0, `script exited ${r.status}: ${r.stdout} ${r.stderr}`);
    assert.ok(r.stderr.includes(`stub-declared-install invoked in ${wt}`), `the declared command must run with cwd = the worktree; stderr=${r.stderr}`);
    assert.ok(!fs.lstatSync(path.join(wt, "node_modules")).isSymbolicLink(), "⛔ must NOT be a symlink");
    assert.ok(fs.statSync(path.join(wt, "node_modules")).isDirectory(), "the declared install produced node_modules");
  } finally {
    rmrf(wt);
    rmrf(main);
    rmrf(stub.bin);
  }
});

t("AC1 pnpm ③ — a failing install command exits 2 and leaves NO symlink (fail-closed)", () => {
  const main = tmpMainRepo();
  fs.writeFileSync(path.join(main, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  const wt = tmpWorktree();
  const pnpmStub = makePmStub("pnpm", { create: false, fail: true }); // exits 2, produces nothing
  const env = { ...process.env, PATH: `${pnpmStub.bin}:${process.env.PATH}` };
  try {
    const r = bash(SETUP, [wt, "--root", main], { env });
    assert.equal(r.status, 2, `a failing install must exit 2, got ${r.status}: ${r.stdout} ${r.stderr}`);
    assert.ok(!fs.existsSync(path.join(wt, "node_modules")), "⛔ NO symlink fallback — the suite must not silently die in milliseconds");
  } finally {
    rmrf(wt);
    rmrf(main);
    rmrf(pnpmStub.bin);
  }
});

// ── idempotency / dry-run / usage ───────────────────────────────────────────────────────────────

t("idempotent — re-run keeps the symlink, no error", () => {
  const main = tmpMainRepo();
  const wt = tmpWorktree();
  try {
    const r1 = bash(SETUP, [wt, "--root", main]);
    assert.equal(r1.status, 0);
    const r2 = bash(SETUP, [wt, "--root", main]);
    assert.equal(r2.status, 0, `re-run failed: ${r2.stdout} ${r2.stderr}`);
    assert.match(r2.stdout, /already present|linked/);
    assert.equal(fs.readlinkSync(path.join(wt, "node_modules")), path.join(main, "node_modules"));
  } finally {
    rmrf(wt);
    rmrf(main);
  }
});

t("dry-run prints, changes nothing", () => {
  const main = tmpMainRepo();
  const wt = tmpWorktree();
  try {
    const r = bash(SETUP, [wt, "--root", main, "--dry-run"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /dry-run/);
    assert.ok(!fs.existsSync(path.join(wt, "node_modules")), "dry-run must not create node_modules");
  } finally {
    rmrf(wt);
    rmrf(main);
  }
});

t("fail-closed usage — missing worktree path, non-dir worktree, unknown arg exit 2", () => {
  const main = tmpMainRepo();
  try {
    const r1 = bash(SETUP, ["--root", main]);
    assert.equal(r1.status, 2, "missing worktree must exit 2");

    const r2 = bash(SETUP, ["/no/such/dir", "--root", main]);
    assert.equal(r2.status, 2, "non-dir worktree must exit 2");

    const r3 = bash(SETUP, [path.join(os.tmpdir(), "nope"), "--bogus", "--root", main]);
    assert.equal(r3.status, 2, "unknown arg must exit 2");
  } finally {
    rmrf(main);
  }
});

// ── AC4 checker: worktree-node-modules-check.sh ────────────────────────────────────────────────

/**
 * Build a throwaway git REPO with two registered task worktrees:
 *   task/missing — node_modules ABSENT (the invariant violation)
 *   task/ok      — node_modules present as a real dir
 * Returns { root, worktrees }. Removed by the caller via rmrf.
 */
function makeRepoWithTaskWorktrees() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wtcheck-repo-"));
  const git = (...args) => {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr ?? ""}`);
    return r.stdout.trim();
  };
  git("init", "-q");
  git("config", "user.email", "t@test");
  git("config", "user.name", "t");
  fs.writeFileSync(path.join(root, "README.md"), "# repo\n");
  git("add", "-A");
  git("commit", "-q", "-m", "baseline");

  const wtMissing = path.join(root, "wt-missing");
  const wtOk = path.join(root, "wt-ok");
  git("worktree", "add", "-q", "-b", "task/missing", wtMissing, "HEAD");
  git("worktree", "add", "-q", "-b", "task/ok", wtOk, "HEAD");
  fs.mkdirSync(path.join(wtOk, "node_modules"), { recursive: true });
  return { root, wtMissing, wtOk };
}

t("AC4 — checker: task worktree without node_modules reports MISSING (report-only exit 0)", () => {
  const repo = makeRepoWithTaskWorktrees();
  try {
    const r = bash(CHECK, ["--root", repo.root]);
    assert.equal(r.status, 0, "report-only must exit 0 even with a MISSING worktree");
    assert.match(r.stdout, /1 MISSING node_modules/);
    assert.match(r.stdout, new RegExp(`MISSING.*${repo.wtMissing.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(r.stdout, /OK dir/);
  } finally {
    rmrf(repo.root);
  }
});

t("AC4 — checker: --fail flips to fail-closed (exit 1 on MISSING)", () => {
  const repo = makeRepoWithTaskWorktrees();
  try {
    const r = bash(CHECK, ["--root", repo.root, "--fail"]);
    assert.equal(r.status, 1, "--fail with MISSING must exit 1");
    assert.match(r.stderr, /--fail set/);
  } finally {
    rmrf(repo.root);
  }
});

t("AC4 — checker: --json emits a machine-readable array naming the missing worktree", () => {
  const repo = makeRepoWithTaskWorktrees();
  try {
    const r = bash(CHECK, ["--root", repo.root, "--json"]);
    assert.equal(r.status, 0);
    const j = JSON.parse(r.stdout);
    assert.equal(j.length, 2, "both task worktrees must be listed");
    const missing = j.find((e) => e.branch === "task/missing");
    assert.ok(missing, "task/missing must be present");
    assert.match(missing.node_modules, /MISSING/);
    const ok = j.find((e) => e.branch === "task/ok");
    assert.ok(ok, "task/ok must be present");
    assert.match(ok.node_modules, /OK dir/);
  } finally {
    rmrf(repo.root);
  }
});

t("AC4 — checker: clean repo (all task worktrees present) exits 0 and --fail stays 0", () => {
  const repo = makeRepoWithTaskWorktrees();
  try {
    // give task/missing its node_modules → both present
    fs.mkdirSync(path.join(repo.wtMissing, "node_modules"), { recursive: true });
    const r = bash(CHECK, ["--root", repo.root, "--fail"]);
    assert.equal(r.status, 0, "--fail with all present must exit 0");
    assert.match(r.stdout, /0 MISSING node_modules/);
  } finally {
    rmrf(repo.root);
  }
});

// ── AC4 wiring: the checker must be wired into run_static_checks (runner-static-gate.ts) ────────

t("AC4 wiring — worktree-node-modules-check is invoked by run_static_checks (runner-static-gate.ts)", () => {
  const testSh = fs.readFileSync(path.join(REPO_ROOT, "plugin/scripts/runner-static-gate.ts"), "utf8");
  const checkName = "worktree-node-modules-check";
  assert.match(testSh, /run_checker\s+"worktree-node-modules-check"/, `run_static_checks must run ${checkName}`);
  assert.match(testSh, /@static-tier full/, "the checker must be a full-tier whole-store check (deferred in scoped runs)");
});

// ── AC2 wiring: the dispatch prompt template must mandate the setup after worktree add ─────────
// gap-dispatch-worktree-setup-zero-production-callers: the wiring's ONLY prior caller was the RETIRED
// fast-mode-loop-tick.md:1033 (经典/fast-mode 循环文档), NOT the live dispatch path worker-driver.ts
// (which had ZERO provisioning — buildWorkerPrompt/buildContinueWorkerPrompt only said "create a
// worktree"). The wiring test now asserts the LIVE path (worker-driver.ts) carries the setup call;
// asserting the retired doc would be a false guarantee (a check that can only ever be satisfied by a
// dead doc — hard rule 3b).

t("AC2 wiring — worker-driver.ts (the LIVE dispatch path) wires dispatch-worktree-setup.sh into BOTH prompts (create + continue)", () => {
  const workerDriver = fs.readFileSync(path.join(REPO_ROOT, "plugin/scripts/worker-driver.ts"), "utf8");
  assert.match(workerDriver, /dispatch-worktree-setup\.sh/, "worker-driver.ts must reference the setup script");
  // 接线经单一 helper dispatchSetupSignature，且【两个】prompt 构建器都调用它（不是只有 helper 定义在文件里）。
  // 位置在 worktree 创建之后这一结构针在 worker-driver.test.mjs 对运行时 prompt 串逐字断言（源码里 helper
  // 定义在 buildWorkerPrompt 之前，源码级 indexOf 顺序不是该语义的正确载体）。
  assert.match(workerDriver, /dispatchSetupSignature\(root, "<the worktree path/, "create prompt calls the setup helper (step-1 placeholder)");
  // gap-goal-branch-dispatch-wiring-and-task-fan-in：两个调用点现把解析出的 mergeTarget 作为 base 传入
  // （branch-mode goal 的任务从 goal/<id> 分叉）。断言放宽为「helper 被调用 + 传了 base」的形状。
  assert.match(workerDriver, /dispatchSetupSignature\(root, wt, resolveTaskMergeTarget\(task, root\)\)/, "continue prompt calls the setup helper with the concrete worktree path + resolved base");
});

// ── worktree-include.sh: SIGPIPE-141 primary resolution + the failure face ──────────────────────
// gap-worktree-include-pipefail-sigpipe-141-blocks-fresh-worktree-provisioning. The defect: the
// primary checkout was resolved as
//   git worktree list --porcelain | awk '/^worktree /{print $2; exit}'
// The early-exiting awk closes the read end while git still has output to write ⇒ git takes EPIPE
// and dies 141 ⇒ under `set -euo pipefail` the ASSIGNMENT kills the whole script: 0 bytes printed,
// 0 files copied. Combined with dispatch-worktree-setup.sh's one-line "failed", a FRESH task
// worktree ended up with node_modules linked but no .quay/config.yml — mechanism claiming to have
// provisioned, having copied nothing.
//
// The trigger is output VOLUME (worktree count) and it is a RACE — measured 4/5 runs dead on the
// 45-worktree primary, 3/3 immediately before the fix. A race is not pinnable by re-running it, so
// these tests pin the INVARIANT instead: primary resolution must not DEPEND on a successful
// `git worktree list`. The stub-git fixture below makes that dependency fail deterministically —
// red against the old implementation (exit 141, nothing copied), green against the fixed one.

/** The real git, captured before any stub can shadow it on PATH. */
const REAL_GIT = spawnSync("bash", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();

/**
 * Fixture: a real git repo whose .worktreeinclude declares ONE gitignored file, plus a second
 * gitignored file that is NOT declared (the negative control), plus a registered task worktree.
 * `.quay/` must be gitignored for the declared file to qualify — the copy rule is
 * declared ∩ gitignored, so a declared-but-tracked file is deliberately never copied.
 */
function makeIncludeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wi-include-"));
  const git = (...args) => {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr ?? ""}`);
    return r.stdout.trim();
  };
  git("init", "-q");
  git("config", "user.email", "t@test");
  git("config", "user.name", "t");
  fs.writeFileSync(path.join(root, ".worktreeinclude"), "/.quay/secret.yml\n");
  fs.writeFileSync(path.join(root, ".gitignore"), ".quay/\nignored-dir/\n");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "ignored-dir"), { recursive: true });
  fs.writeFileSync(path.join(root, ".quay", "secret.yml"), "declared-payload\n");
  fs.writeFileSync(path.join(root, "ignored-dir", "other.txt"), "not-declared\n");
  fs.mkdirSync(path.join(root, "node_modules"), { recursive: true }); // step 1 must be a no-op
  git("add", ".worktreeinclude", ".gitignore");
  git("commit", "-q", "-m", "baseline");
  const wt = path.join(root, "wt");
  git("worktree", "add", "-q", "-b", "task/fx", wt, "HEAD");
  return { root, wt };
}

/**
 * Give a fixture root the two files the dispatcher's step 2 composes — the REAL
 * scripts/worktree-include.sh plus the plugin/scripts/repo-root.sh it sources — so the fixture
 * matches a real checkout's layout instead of testing a script in an impossible environment.
 */
function installWorktreeIncludeInto(root) {
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
  fs.copyFileSync(WI, path.join(root, "scripts", "worktree-include.sh"));
  fs.copyFileSync(
    path.join(REPO_ROOT, "plugin/scripts/repo-root.sh"),
    path.join(root, "plugin", "scripts", "repo-root.sh"),
  );
}

/** A `git` that dies (141, no output) on `worktree list` and forwards everything else to the real git. */
function makeNoWorktreeListGitStub() {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "wi-stubgit-"));
  fs.writeFileSync(
    path.join(bin, "git"),
    `#!/usr/bin/env bash\n` +
      `a=("$@")\n` +
      `if [ "\${1:-}" = "-C" ]; then a=("\${a[@]:2}"); fi\n` +
      `if [ "\${a[0]:-}" = "worktree" ] && [ "\${a[1]:-}" = "list" ]; then exit 141; fi\n` +
      `exec "${REAL_GIT}" "$@"\n`,
  );
  fs.chmodSync(path.join(bin, "git"), 0o755);
  return bin;
}

t("worktree-include — copies declared ∩ gitignored into a fresh worktree, never an undeclared file", () => {
  const { root, wt } = makeIncludeRepo();
  try {
    const r = bash(WI, [wt]);
    assert.equal(r.status, 0, `copy must exit 0: ${r.stdout} ${r.stderr}`);
    assert.equal(
      fs.readFileSync(path.join(wt, ".quay", "secret.yml"), "utf8"),
      "declared-payload\n",
      "the declared gitignored file must land in the worktree",
    );
    assert.ok(
      !fs.existsSync(path.join(wt, "ignored-dir", "other.txt")),
      "negative control: gitignored-but-UNDECLARED is never copied",
    );
  } finally {
    rmrf(root);
  }
});

t("worktree-include — primary resolution does not depend on `git worktree list` (SIGPIPE-141 guard)", () => {
  const { root, wt } = makeIncludeRepo();
  const stubBin = makeNoWorktreeListGitStub();
  const env = { ...process.env, PATH: `${stubBin}:${process.env.PATH}` };
  try {
    // Premise check: under the stub the deprecated read really is dead (141), so a failure below
    // is the script's dependency, not a fixture that failed to inject the fault.
    const probe = spawnSync("git", ["-C", wt, "worktree", "list", "--porcelain"], { encoding: "utf8", env });
    assert.equal(probe.status, 141, "fixture premise: `git worktree list` must die 141 under the stub");

    const r = bash(WI, [wt], { env });
    assert.equal(
      r.status,
      0,
      `primary resolution must survive a dead \`git worktree list\` (exit ${r.status}): ${r.stdout} ${r.stderr}`,
    );
    assert.equal(
      fs.readFileSync(path.join(wt, ".quay", "secret.yml"), "utf8"),
      "declared-payload\n",
      "the declared file must still be copied when `git worktree list` cannot run",
    );
  } finally {
    rmrf(stubBin);
    rmrf(root);
  }
});

t("worktree-include --verify — exits 0 + names every file; exits 1 and names the absent one", () => {
  const { root, wt } = makeIncludeRepo();
  try {
    bash(WI, [wt]); // populate first
    const ok = bash(WI, ["--verify", wt]);
    assert.equal(ok.status, 0, `verify on a populated worktree must exit 0: ${ok.stdout} ${ok.stderr}`);
    assert.match(ok.stdout, /verify OK — all 1 declared file\(s\) present/);

    fs.rmSync(path.join(wt, ".quay", "secret.yml"));
    const bad = bash(WI, ["--verify", wt]);
    assert.equal(bad.status, 1, "verify must be fail-closed (exit 1) when a declared file is absent");
    assert.match(bad.stderr, /MISSING \.quay\/secret\.yml/, "the ABSENT file must be named, not merely counted");
    assert.match(bad.stderr, /verify FAILED — 1 of 1 declared file\(s\) absent/);
  } finally {
    rmrf(root);
  }
});

t("worktree-include — a copy that cannot land exits non-zero instead of reporting done", () => {
  const { root, wt } = makeIncludeRepo();
  try {
    // A regular FILE where the target DIRECTORY must be: `mkdir -p` fails for any uid (a chmod
    // fixture would pass vacuously when the suite runs as root).
    fs.writeFileSync(path.join(wt, ".quay"), "not-a-directory\n");
    const r = bash(WI, [wt]);
    assert.notEqual(r.status, 0, `an unlandable copy must not report success: ${r.stdout} ${r.stderr}`);
    assert.match(r.stderr, /FAILED to create .*needed for \.quay\/secret\.yml/, "the failure must name the file it could not land");
    assert.match(r.stderr, /1 copy failure\(s\), 1 expected file\(s\) absent/, "both counts must be enumerated, not boolean");
    assert.ok(!fs.statSync(path.join(wt, ".quay")).isDirectory(), "negative control: the fixture really did block the copy");
  } finally {
    rmrf(root);
  }
});

t("dispatch-worktree-setup — a failed copy exits 2 and NAMES the absent declared file (not a bare 'failed')", () => {
  const { root, wt } = makeIncludeRepo();
  try {
    // The dispatcher runs <root>/scripts/worktree-include.sh; give the fixture the REAL one.
    installWorktreeIncludeInto(root);
    fs.writeFileSync(path.join(wt, ".quay"), "not-a-directory\n"); // block the copy, any uid
    const r = bash(SETUP, [wt, "--root", root]);
    assert.equal(r.status, 2, `incomplete provisioning must exit 2: ${r.stdout} ${r.stderr}`);
    assert.match(r.stderr, /provisioning INCOMPLETE/);
    assert.match(r.stderr, /declared files ABSENT/);
    assert.match(r.stderr, /MISSING \.quay\/secret\.yml/, "the absent file must be named");
    assert.ok(fs.lstatSync(path.join(wt, "node_modules")).isSymbolicLink(), "premise: step 1 DID succeed — this is the half-success shape the message must disambiguate");
  } finally {
    rmrf(root);
  }
});

t("dispatch-worktree-setup — a verifier that cannot evaluate is reported as such, not as a file list", () => {
  const { root, wt } = makeIncludeRepo();
  try {
    // A worktree-include.sh that fails AND does not support --verify: the dispatcher must say the
    // declaration could not be evaluated. "Could not check" must never print the same shape as a
    // file list, nor as "checked, all fine" (hard rule 3b).
    installWorktreeIncludeInto(root);
    fs.writeFileSync(path.join(root, "scripts", "worktree-include.sh"), "#!/usr/bin/env bash\nexit 2\n");
    const r = bash(SETUP, [wt, "--root", root]);
    assert.equal(r.status, 2, `must still be fail-closed: ${r.stdout} ${r.stderr}`);
    assert.match(r.stderr, /could not evaluate the declaration \(this is not a file list\)/);
    assert.doesNotMatch(r.stderr, /declared files ABSENT/, "an unevaluated declaration is not a file list");
  } finally {
    rmrf(root);
  }
});

t("dispatch-worktree-setup — .worktreeinclude without any worktree-include.sh is refused (not a warning)", () => {
  const { root, wt } = makeIncludeRepo();
  try {
    const r = bash(SETUP, [wt, "--root", root]); // no <root>/scripts/worktree-include.sh
    assert.equal(r.status, 2, `a declarable-but-unprovidable worktree must not exit 0: ${r.stdout} ${r.stderr}`);
    assert.match(r.stderr, /\.worktreeinclude declares gitignored files — cannot provision/);
  } finally {
    rmrf(root);
  }
});
