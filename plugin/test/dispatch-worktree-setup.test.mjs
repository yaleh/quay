// @test-group governance
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
//   AC5 — this file uses node:test + `// @test-group governance`.
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

// Governance self-skip (AC7 @test-group governance, ADR-019 decision #1): in a DEFAULT
// (product,engine) run this file reports `skipped`, not absent — QUAY_TEST_GROUPS is set to
// product,engine on the default path, so the real tests run only with `--group governance`
// or in the explicit-file form (QUAY_TEST_GROUPS unset).
const GOV_SKIP_REASON =
  process.env.QUAY_TEST_GROUPS && !process.env.QUAY_TEST_GROUPS.split(",").includes("governance")
    ? "set QUAY_TEST_GROUPS=governance to run"
    : false;
function t(name, fn) {
  test(name, GOV_SKIP_REASON ? { skip: GOV_SKIP_REASON } : {}, fn);
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

// ── AC4 wiring: the checker must be wired into scripts/test.sh's run_static_checks ─────────────

t("AC4 wiring — worktree-node-modules-check is invoked by run_static_checks (scripts/test.sh)", () => {
  const testSh = fs.readFileSync(path.join(REPO_ROOT, "scripts/test.sh"), "utf8");
  const checkName = "worktree-node-modules-check";
  assert.match(testSh, /run_checker\s+"worktree-node-modules-check"/, `run_static_checks must run ${checkName}`);
  assert.match(testSh, /@static-tier full/, "the checker must be a full-tier whole-store check (deferred in scoped runs)");
});

// ── AC2 wiring: the dispatch prompt template must mandate the setup after worktree add ─────────

t("AC2 wiring — the dispatch tick doc mandates dispatch-worktree-setup.sh after git worktree add", () => {
  const tick = fs.readFileSync(path.join(REPO_ROOT, "plugin/loop/fast-mode-loop-tick.md"), "utf8");
  assert.match(tick, /dispatch-worktree-setup\.sh/, "the dispatch prompt template must call the setup script");
  assert.match(
    tick,
    /git -C "\$REPO_ROOT" worktree add/,
    "the worktree-add command must still be present next to the setup step",
  );
});
