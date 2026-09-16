// @test-group engine
// precommit-guard.test.mjs — the mechanical gate of precommit-guard.ts (AC51 断言面拆分 ①:
// DOC-CLASS checks at commit time; AC64 retired ②).
//
// The guard has ONE surviving responsibility (AC64, gap-ac64-precommit-guard-clause2-retire):
//   ① runs the DOC-CLASS checks (AC51 断言面拆分 — doc consistency checks moved OUT of the full
//      suite into the pre-commit moment: `bash scripts/test.sh --static-checks-doc`, seconds-level
//      feedback instead of an 8-minute round, and editing docs no longer makes a running round red).
// ② rejecting "a suite round is running AND the commit touches assertion-surface files" was RETIRED
//    under AC64: the danger it protected disappeared with AC42 (per-task suites run in their own
//    worktree reading worktree file copies, so edits to the shared checkout's develop cannot affect
//    a running worktree suite). Retired body + three 立条教训 → archive#R27; the negative control
//    (a running round no longer blocks a commit) lives in
//    plugin/test/precommit-guard-retire-negative-control.test.mjs.
//
// Coverage map:
//   AC51/① — a failing doc check rejects the commit at pre-commit (reason=doc-check-failed, output
//            carried); a passing doc check allows; the rejection is NOT bypassable by any override
//            (there is no round-window override anymore — the doc gate is unconditional).
//   Hook mechanics — --install-hook wires the SHARED pre-commit (and pre-merge-commit) hook;
//            --uninstall-hook removes it; unrelated hooks are never clobbered.
//   AC63 — ff-only merge fires ZERO guard hooks (the AC62 fan-in convention): the doc check has no
//            hook trigger on the ff path, so the A6 无锁段 step 3's explicit
//            `bash scripts/test.sh --static-checks-doc` is required.
//
// Run: scripts/test.sh plugin/test/precommit-guard.test.mjs
// Scoped: scripts/test.sh --for-task gap-ac64-precommit-guard-clause2-retire

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// ④ (gap-closure-ratchet-stale-wire-into-precommit-guard). Both the TRIGGER SET and the guard's own
// exported helpers are imported, not restated: `LAYDOWN_SOURCES` is the checker's constant (so this
// test's fixture cannot drift from what the guard actually keys on — 硬规则 5b), and
// `stagedLaydownSources` is the guard's own trigger function.
import { stagedLaydownSources } from "../scripts/precommit-guard.ts";
import { LAYDOWN_SOURCES } from "../scripts/quay-init-closure-ratchet.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const GUARD = path.join(REPO_ROOT, "plugin", "scripts", "precommit-guard.ts");
const RATCHET_REL = path.join("plugin", "scripts", "quay-init-closure-ratchet.ts");
const BASELINE_REL = path.join("docs", "analysis", "quay-init-closure-ratchet.baseline.json");

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────────────

function run(cmd, args, cwd, env = {}) {
  return spawnSync(cmd, args, { cwd, encoding: "utf8", env: { ...process.env, ...env } });
}

function makeGitRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pcg-"));
  run("git", ["init", "-q", "-b", "main"], root);
  run("git", ["config", "user.email", "test@test"], root);
  run("git", ["config", "user.name", "test"], root);
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "README.md"), "hello\n", "utf8");
  fs.writeFileSync(path.join(root, "tasks", "existing.md"), "x\n", "utf8");
  const init = run("git", ["add", "."], root);
  assert.equal(init.status, 0, "git add init");
  const commit = run("git", ["commit", "-q", "-m", "init"], root);
  assert.equal(commit.status, 0, `git commit init: ${commit.stderr}`);
  return root;
}

function stage(root, rel, content = "new\n") {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
  const add = run("git", ["add", rel], root);
  assert.equal(add.status, 0, `git add ${rel}`);
}

function runGuard(root, args = [], env = {}) {
  return run("node", ["--no-warnings", "--experimental-strip-types", GUARD, "--root", root, "--json", ...args], root, env);
}

function cleanup(root) {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

// ── ① doc checks (AC51 断言面拆分): the doc-class checks run at the pre-commit moment ────────────────

// A quay-shaped fixture: scripts/test.sh with a run_doc_checks() that declares a doc-class checker
// (`@static-class doc` + `@static-object orchestration/manager-tick-core.md CLAUDE.md`) and shells
// to plugin/scripts/fake-doc-check.sh (exit 0 = doc checks pass, exit 1 = a doc check fails).
function makeQuayFixture(docExit = 0) {
  const root = makeGitRepo();
  const scriptsDir = path.join(root, "scripts");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.writeFileSync(
    path.join(scriptsDir, "test.sh"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"',
      "run_doc_checks() {",
      "  echo '== doc-class fixture =='",
      "  # @static-class doc",
      "  # @static-object orchestration/manager-tick-core.md CLAUDE.md",
      '  bash "${repo_root}/plugin/scripts/fake-doc-check.sh" "${repo_root}"',
      "}",
      'if [ "${1:-}" = "--static-checks-doc" ]; then',
      "  run_doc_checks",
      "  exit 0",
      "fi",
      "",
    ].join("\n"),
    "utf8",
  );
  const pkgDir = path.join(root, "plugin", "scripts");
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, "fake-doc-check.sh"), `#!/usr/bin/env bash\nexit ${docExit}\n`, "utf8");
  return root;
}

test("① — a failing doc check rejects the commit at pre-commit (reason doc-check-failed, output carried)", () => {
  const root = makeQuayFixture(1); // fake-doc-check exits 1 → doc check fails
  try {
    stage(root, "README.md", "changed\n");
    const res = runGuard(root);
    assert.equal(res.status, 1, `doc-check failure must reject, got ${res.status}: ${res.stdout}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.verdict, "reject");
    assert.equal(out.reason, "doc-check-failed");
    assert.ok(out.docCheckOutput && out.docCheckOutput.length > 0, "doc-check-failed must carry the checker output");
    assert.ok(out.message.includes("文档类检查失败"), "message names the doc-check failure");
  } finally {
    cleanup(root);
  }
});

test("① — a passing doc check allows the commit (verdict allow, reason doc-checks-pass)", () => {
  const root = makeQuayFixture(0); // doc checks pass
  try {
    stage(root, "tasks/new.md", "body\n");
    const res = runGuard(root);
    assert.equal(res.status, 0, `doc-checks-pass must allow, got ${res.status}: ${res.stdout}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.verdict, "allow");
    assert.equal(out.reason, "doc-checks-pass");
  } finally {
    cleanup(root);
  }
});

test("① — a doc edit whose checker FAILS is blocked (content error, not a round-risk thing)", () => {
  const root = makeQuayFixture(1);
  try {
    stage(root, "orchestration/manager-tick-core.md", "bad doc\n");
    const res = runGuard(root);
    assert.equal(res.status, 1, `a doc edit with a failing doc check must reject, got ${res.status}`);
    assert.equal(JSON.parse(res.stdout).reason, "doc-check-failed");
  } finally {
    cleanup(root);
  }
});

test("① — a workspace WITHOUT the doc-check split (plain test.sh) is not rejected (portability)", () => {
  const root = makeGitRepo(); // no scripts/test.sh at all → runDocChecks returns ok
  try {
    stage(root, "README.md", "changed\n");
    const res = runGuard(root);
    assert.equal(res.status, 0, `non-quay workspace must allow, got ${res.status}: ${res.stdout}`);
    assert.equal(JSON.parse(res.stdout).reason, "doc-checks-pass");
  } finally {
    cleanup(root);
  }
});

// ── Hook mechanics (AC3): the SHARED pre-commit hook covers ALL writers ──────────────────────────────

test("AC3 — --install-hook wires the SHARED pre-commit hook; --uninstall-hook removes it", () => {
  const root = makeGitRepo();
  try {
    const install = run("node", ["--no-warnings", "--experimental-strip-types", GUARD, "--root", root, "--install-hook"], root);
    assert.equal(install.status, 0, `install-hook: ${install.stderr}`);
    const hookPath = path.join(root, ".git", "hooks", "pre-commit");
    assert.ok(fs.existsSync(hookPath), "hook file written");
    const shim = fs.readFileSync(hookPath, "utf8");
    assert.ok(shim.includes("precommit-guard.ts"), "shim invokes the guard");
    assert.ok(!shim.includes("precommit-guard.ts.ts"), "shim must not double the extension (.ts.ts)");
    assert.ok(shim.includes("pre-commit guard"), "shim documents its purpose");
    const mode = fs.statSync(hookPath).mode & 0o111;
    assert.notEqual(mode, 0, "hook is executable");

    const uninstall = run("node", ["--no-warnings", "--experimental-strip-types", GUARD, "--root", root, "--uninstall-hook"], root);
    assert.equal(uninstall.status, 0, `uninstall-hook: ${uninstall.stderr}`);
    assert.ok(!fs.existsSync(hookPath), "hook removed");
  } finally {
    cleanup(root);
  }
});

test("AC3b — install-hook refuses to overwrite an unrelated pre-existing hook", () => {
  const root = makeGitRepo();
  try {
    const hookPath = path.join(root, ".git", "hooks", "pre-commit");
    fs.writeFileSync(hookPath, "#!/usr/bin/env bash\necho unrelated\n", { mode: 0o755 });
    const install = run("node", ["--no-warnings", "--experimental-strip-types", GUARD, "--root", root, "--install-hook"], root);
    assert.equal(install.status, 2, "refuses to clobber an unrelated hook (usage/env error)");
    assert.ok(fs.readFileSync(hookPath, "utf8").includes("unrelated"), "original hook untouched");
  } finally {
    cleanup(root);
  }
});

// ── gap-precommit-guard-merge-bypass: pre-merge-commit hook (merge-path coverage for ①) ──────────
// `git merge --no-ff` does NOT fire pre-commit (git runs pre-commit only from git-commit(1)); the
// pre-merge-commit hook (also wired by --install-hook) runs the same doc-check gate on the --no-ff
// merge write path. (AC64 kept this for ① — the guard is doc-check-only but still needs merge-path
// coverage so a --no-ff merge cannot bypass the doc gate.)

test("gap-merge-bypass AC1 — --install-hook wires BOTH pre-commit and pre-merge-commit; --uninstall-hook removes both", () => {
  const root = makeGitRepo();
  try {
    const install = run("node", ["--no-warnings", "--experimental-strip-types", GUARD, "--root", root, "--install-hook"], root);
    assert.equal(install.status, 0, `install-hook: ${install.stderr}`);
    const preCommit = path.join(root, ".git", "hooks", "pre-commit");
    const preMerge = path.join(root, ".git", "hooks", "pre-merge-commit");
    assert.ok(fs.existsSync(preCommit), "pre-commit hook written");
    assert.ok(fs.existsSync(preMerge), "pre-merge-commit hook written");
    const mergeShim = fs.readFileSync(preMerge, "utf8");
    assert.ok(mergeShim.includes("precommit-guard.ts"), "merge shim invokes the guard");
    assert.ok(mergeShim.includes("--merge"), "merge shim passes --merge");
    assert.ok(!mergeShim.includes("precommit-guard.ts.ts"), "merge shim must not double the extension");
    assert.ok((fs.statSync(preMerge).mode & 0o111) !== 0, "merge hook is executable");

    const uninstall = run("node", ["--no-warnings", "--experimental-strip-types", GUARD, "--root", root, "--uninstall-hook"], root);
    assert.equal(uninstall.status, 0, `uninstall-hook: ${uninstall.stderr}`);
    assert.ok(!fs.existsSync(preCommit), "pre-commit hook removed");
    assert.ok(!fs.existsSync(preMerge), "pre-merge-commit hook removed");
  } finally {
    cleanup(root);
  }
});

test("gap-merge-bypass AC1b — install refuses to overwrite an unrelated pre-existing pre-merge-commit hook", () => {
  const root = makeGitRepo();
  try {
    const mergeHook = path.join(root, ".git", "hooks", "pre-merge-commit");
    fs.writeFileSync(mergeHook, "#!/usr/bin/env bash\necho unrelated merge hook\n", { mode: 0o755 });
    const install = run("node", ["--no-warnings", "--experimental-strip-types", GUARD, "--root", root, "--install-hook"], root);
    assert.equal(install.status, 2, "refuses to clobber an unrelated pre-merge-commit hook");
    assert.ok(fs.readFileSync(mergeHook, "utf8").includes("unrelated merge hook"), "original hook untouched");
  } finally {
    cleanup(root);
  }
});

// ── AC63 (gap-ac63-ff-explicit-doc-check-before-merge): ff-only fires ZERO hooks ─────────────────────
// The fan-in convention is now ff-only (AC62). The AC63 load-bearing premise: `git merge --ff-only`
// creates no merge commit, so git fires NEITHER pre-commit (git-commit-only) NOR pre-merge-commit
// (--no-ff-only) — the DOC check has NO hook trigger on the ff path. A doc check that relies on hooks
// therefore NEVER runs for an ff fan-in: the A6 无锁段 step 3 must EXPLICITLY run
// `bash scripts/test.sh --static-checks-doc` (twice total — commit-time + pre-ff — deliberately NOT
// deduplicated: the first covers the author's own changes, the second covers post-merge-develop content).
// This NEGATIVE CONTROL pins that premise: with BOTH guard hooks installed, an ff-only merge must fire
// ZERO hooks (and a control commit must fire pre-commit — proving the counter would catch a fire).

test("AC63 — ff-only merge fires ZERO guard hooks (no pre-commit, no pre-merge-commit): the doc check has no hook trigger on the ff fan-in path ⇒ step 3's explicit run is required", () => {
  const root = makeGitRepo();
  try {
    // task branch adds a doc-file change (the AC63 fan-in shape).
    run("git", ["checkout", "-q", "-b", "task/feature"], root);
    stage(root, "docs/proposal.md", "new doc\n");
    const commit = run("git", ["commit", "-q", "-m", "add doc"], root);
    assert.equal(commit.status, 0, `task commit: ${commit.stderr}`);
    const back = run("git", ["checkout", "-q", "main"], root);
    assert.equal(back.status, 0, "back to main");

    // Counting shims for BOTH guard hooks (the --install-hook shim cannot resolve the real guard in a
    // scratch repo — a counting shim isolates the question "does git fire the hook at all?").
    const hooksDir = path.join(root, ".git", "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    const counter = path.join(root, ".quay", "hook-fires.log");
    for (const name of ["pre-commit", "pre-merge-commit"]) {
      fs.writeFileSync(
        path.join(hooksDir, name),
        `#!/usr/bin/env bash\necho "${name}" >> "${counter}"\n`,
        { mode: 0o755 },
      );
    }

    // ff-only merge — the AC62 fan-in convention. git fires NO pre-merge-commit (no merge commit is
    // created) and NO pre-commit (merge is not git-commit) ⇒ the counter file must NOT be created.
    const merge = run("git", ["merge", "--ff-only", "task/feature"], root);
    assert.equal(merge.status, 0, `ff must succeed, got ${merge.status}: ${merge.stdout} ${merge.stderr}`);
    assert.ok(
      !fs.existsSync(counter),
      "ff-only merge fires ZERO guard hooks — the doc check never runs via a hook on the ff path",
    );

    // Control: a normal git commit DOES fire pre-commit (and only pre-commit) — proves the counter
    // would catch a fire, so the zero above is a real zero, not a broken counter.
    stage(root, "docs/control.md", "control\n");
    const commit2 = run("git", ["commit", "-q", "-m", "control"], root);
    assert.equal(commit2.status, 0, `control commit: ${commit2.stderr}`);
    assert.ok(fs.existsSync(counter), "control commit fired a hook (counter created)");
    const fires = fs.readFileSync(counter, "utf8").trim().split("\n");
    assert.ok(fires.includes("pre-commit"), "control commit fires pre-commit");
    assert.ok(!fires.includes("pre-merge-commit"), "control commit does NOT fire pre-merge-commit");
  } finally {
    cleanup(root);
  }
});

// ── Touches「一条目一路径」detector at the commit moment (gap-touches-one-entry-detector-not-enforcer) ──
// The static checker (touches-one-entry-one-path-check.ts) already reds multi-path Touches bullets at
// the suite's static layer — but that's the LATEST layer (each occurrence costs a fork→in-flight→
// static-red→re-run cycle). This detector runs the SAME judgment on STAGED tasks/*.md at the commit
// moment, so a new task's Touches error reds where it is written. Judgment reuses
// checkTaskOneEntryOnePath + the shrink-only grandfather baseline — no second Touches parser.

const GUARD_REL = path.join("plugin", "scripts", "precommit-guard.ts");
const REL_IMPORT_RE = /(?:from\s*|import\s*\(\s*)(["'])(\.{1,2}\/[^"']+)\1/g;

/**
 * The guard's transitive RELATIVE-import closure, derived from the source rather than hand-listed.
 *
 * 硬规则 5b: a hand-listed closure is a SECOND copy of a set the imports already define, so it
 * drifts the moment a new dep is added — and it drifts INVISIBLY, because a short closure still
 * installs a hook; it only dies later, at HOOK-EXECUTION time, as a bare
 * `ERR_MODULE_NOT_FOUND … node:internal/modules/esm/resolve` inside the commit under test.
 * tasks/gap-quay-init-gitignore-misses-quay-runtime-artifacts-outside-dot-quay hit exactly that:
 * wiring-coverage-check.ts → touches-orthogonality-check.ts gained an import of
 * `packages/quay/src/runtime-artifacts.ts` (a path OUTSIDE plugin/scripts/, which the old list could
 * not express even in principle) and both AC1/AC4 e2e reds read `install-hook: …esm/resolve:271`.
 *
 * An unresolvable relative import THROWS instead of being skipped (硬规则 3b): a silently-short
 * closure is indistinguishable from a complete one until the hook runs.
 */
function guardClosure() {
  const seen = new Set();
  const queue = [GUARD_REL];
  while (queue.length > 0) {
    const rel = path.normalize(queue.shift());
    if (seen.has(rel)) continue;
    seen.add(rel);
    const abs = path.join(REPO_ROOT, rel);
    const src = fs.readFileSync(abs, "utf8"); // a listed dep that does not exist is a hard error
    for (const m of src.matchAll(REL_IMPORT_RE)) {
      let dep = path.normalize(path.join(path.dirname(rel), m[2]));
      if (!fs.existsSync(path.join(REPO_ROOT, dep))) {
        if (fs.existsSync(path.join(REPO_ROOT, dep + ".ts"))) dep += ".ts";
        else if (fs.existsSync(path.join(REPO_ROOT, dep, "index.ts"))) dep = path.join(dep, "index.ts");
        else throw new Error(`${rel} imports "${m[2]}" which does not resolve under ${REPO_ROOT}`);
      }
      queue.push(dep);
    }
  }
  return [...seen];
}

/** Copy the guard + its transitive deps into a scratch repo so --install-hook's shim resolves. */
function copyGuardScripts(root) {
  const files = guardClosure();
  // A closure of size 1 means the walker itself broke (not that the guard lost its deps) — the same
  // 仪器故障 shape as a zero-count reading (硬规则 4 推论二).
  assert.ok(files.length > 1, `guard closure walker found ${files.length} file(s) — walker is broken`);
  for (const rel of files) {
    const dst = path.join(root, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true }); // deps may live outside plugin/scripts/
    fs.copyFileSync(path.join(REPO_ROOT, rel), dst);
  }
  // task-schema.ts imports the external `yaml` package — the same node_modules symlink
  // dispatch-worktree-setup.sh / driver-cli.test.mjs lay down, so the bare specifier resolves from
  // the scratch root upward.
  const nm = path.join(root, "node_modules");
  try { fs.symlinkSync(path.join(REPO_ROOT, "node_modules"), nm, "dir"); } catch (_) { /* exists */ }
}

/**
 * Install the hook from the SCRATCH COPY of the guard — NOT from REPO_ROOT's.
 * `--install-hook` bakes the guard path into the shim via `mainCheckoutRoot(own dir)`: invoked from a
 * linked worktree that resolves to the MAIN checkout's copy (a deliberate AC139-4 redirection), so a
 * `node <REPO_ROOT>/precommit-guard.ts --install-hook` in a scratch repo installs a hook pointing at
 * the main checkout — which is NOT the code under test (a green there proves the main checkout's code,
 * 硬规则 4b). Invoking the scratch copy instead makes `mainCheckoutRoot` resolve to the scratch root,
 * so the shim runs exactly the files `copyGuardScripts` just laid down.
 */
function installHookFromScratch(root) {
  const scratchGuard = path.join(root, "plugin", "scripts", "precommit-guard.ts");
  assert.ok(fs.existsSync(scratchGuard), "copyGuardScripts must run before installing the hook");
  return run("node", ["--no-warnings", "--experimental-strip-types", scratchGuard, "--root", root, "--install-hook"], root);
}

test("AC1 — a staged task with a multi-path Touches bullet is rejected (reason touches-multi-path-bullet)", () => {
  const root = makeGitRepo(); // no scripts/test.sh → doc check passes; only the Touches detector judges
  try {
    stage(root, "tasks/new.md", "---\nid: new\ntitle: t\nstatus: todo\n---\n\n## Touches\n\n- plugin/scripts/a.ts + plugin/scripts/b.ts\n");
    const res = runGuard(root);
    assert.equal(res.status, 1, `multi-path must reject, got ${res.status}: ${res.stdout} ${res.stderr}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.verdict, "reject");
    assert.equal(out.reason, "touches-multi-path-bullet");
    assert.ok(out.touchesCheckOutput && out.touchesCheckOutput.includes("plugin/scripts/a.ts + plugin/scripts/b.ts"), "touchesCheckOutput names the multi-path bullet");
  } finally {
    cleanup(root);
  }
});

test("AC1 negative — a staged task with single-path Touches is allowed", () => {
  const root = makeGitRepo();
  try {
    stage(root, "tasks/ok.md", "---\nid: ok\ntitle: t\nstatus: todo\n---\n\n## Touches\n\n- plugin/scripts/a.ts\n");
    const res = runGuard(root);
    assert.equal(res.status, 0, `single-path must allow, got ${res.status}: ${res.stdout}`);
    assert.equal(JSON.parse(res.stdout).verdict, "allow");
  } finally {
    cleanup(root);
  }
});

test("AC1 negative — a staged non-task file is not Touches-rejected (scope = staged tasks/*.md)", () => {
  const root = makeGitRepo();
  try {
    stage(root, "README.md", "changed\n");
    const res = runGuard(root);
    assert.equal(res.status, 0, `non-task must allow, got ${res.status}: ${res.stdout}`);
    assert.equal(JSON.parse(res.stdout).verdict, "allow");
  } finally {
    cleanup(root);
  }
});

test("AC1 — a grandfathered task's existing multi-path bullet is allowed (shrink-only baseline respected)", () => {
  const root = makeGitRepo();
  try {
    fs.mkdirSync(path.join(root, "docs", "analysis"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "docs", "analysis", "touches-one-entry-one-path-baseline.md"),
      "# baseline-count: 1\ntasks/historical.md\n",
      "utf8",
    );
    stage(root, "tasks/historical.md", "---\nid: h\ntitle: t\nstatus: done\n---\n\n## Touches\n\n- a.md / b.md\n");
    const res = runGuard(root);
    assert.equal(res.status, 0, `grandfathered multi-path must allow, got ${res.status}: ${res.stdout}`);
    assert.equal(JSON.parse(res.stdout).verdict, "allow");
  } finally {
    cleanup(root);
  }
});

test("AC2 — a NEW task's Touches error reds at the commit moment (the fork→in-flight→static-red loop is cut)", () => {
  // AC2's criterion is forward-looking (new-task Touches errors red BEFORE the suite). The e2e hook test
  // below proves a real commit is rejected at the pre-commit step; this test pins the judgment the hook
  // runs — the same staged fresh-task shape reds in the guard's judgment core.
  const root = makeGitRepo();
  try {
    stage(root, "tasks/gap-fresh.md", "---\nid: gap-fresh\ntitle: t\nstatus: todo\n---\n\n## Touches\n\n- orchestration/a.md / orchestration/b.md\n");
    const res = runGuard(root);
    assert.equal(res.status, 1, `new-task multi-path must red at the commit moment, got ${res.status}`);
    assert.equal(JSON.parse(res.stdout).reason, "touches-multi-path-bullet");
  } finally {
    cleanup(root);
  }
});

test("AC1 e2e — a real `git commit` of a multi-path Touches task is REJECTED by the installed pre-commit hook; a single-path task commits (AC2/AC3)", () => {
  const root = makeGitRepo();
  try {
    copyGuardScripts(root);
    const install = installHookFromScratch(root);
    assert.equal(install.status, 0, `install-hook: ${install.stderr}`);
    assert.ok(fs.existsSync(path.join(root, ".git", "hooks", "pre-commit")), "hook installed");

    // AC1/AC2 — bad: a multi-path Touches task must be rejected BEFORE the commit happens.
    stage(root, "tasks/bad.md", "---\nid: bad\ntitle: t\nstatus: todo\n---\n\n## Touches\n\n- a.ts / b.ts\n");
    const badCommit = run("git", ["commit", "-m", "bad touches"], root);
    assert.notEqual(badCommit.status, 0, `multi-path Touches commit must be REJECTED, got ${badCommit.status}`);
    assert.match(badCommit.stdout + badCommit.stderr, /Touches 多路径|touches-multi-path-bullet/, "rejection output names the Touches violation");
    assert.equal(run("git", ["log", "--oneline"], root).stdout.trim().split("\n").length, 1, "bad commit was NOT created");

    // control (AC1 negative / AC3 guard still functional): a single-path task commits fine.
    run("git", ["reset", "-q", "--", "tasks/bad.md"], root); // unstage bad.md (now untracked)
    stage(root, "tasks/good.md", "---\nid: good\ntitle: t\nstatus: todo\n---\n\n## Touches\n\n- a.ts\n");
    const goodCommit = run("git", ["commit", "-m", "good touches"], root);
    assert.equal(goodCommit.status, 0, `single-path commit must succeed, got ${goodCommit.status}: ${goodCommit.stdout} ${goodCommit.stderr}`);
    assert.match(goodCommit.stdout + goodCommit.stderr, /Touches 单路径/, "control commit passes the Touches check");
  } finally {
    cleanup(root);
  }
});

test("AC3 — resolveHooksDir matches `git rev-parse --git-path hooks` (worktree-safe install path)", () => {
  const root = makeGitRepo();
  try {
    const gitHooks = run("git", ["rev-parse", "--git-path", "hooks"], root).stdout.trim();
    assert.ok(gitHooks, "git resolves a hooks path");
    const resolve = run(
      "node",
      ["--no-warnings", "--experimental-strip-types", "-e",
        `import('${path.join(REPO_ROOT, "plugin", "scripts", "precommit-guard.ts").replace(/'/g, "\\'")}').then(m => console.log(m.resolveHooksDir('${root}')));`],
      root,
    );
    assert.equal(resolve.status, 0, `resolveHooksDir must not crash: ${resolve.stderr}`);
    assert.equal(resolve.stdout.trim(), path.resolve(root, gitHooks), "resolveHooksDir must match git's own hooks-path resolution (the dir git actually reads — the shared common dir in a worktree)");
  } finally {
    cleanup(root);
  }
});

// ── ③ goal_ac 写入面判定 (gap-ac190-goal-ac-rule-not-enforced-at-filing) ──────────────────────────────
// AC-190's rule (goals/AC-190-task-ac.md) lived ONLY in the goal layer as a per-round, POST-HOC report:
// it can SEE a violation but has no power to stop one — the 1st delivery-critical task filed after the
// activation line went in through this repo's own filing path + mechanical promotion with no step ever
// asking for goal_ac. This judgment runs the SAME rule at the commit moment, on the STAGED
// tasks/*.md, rejecting (delivery-critical ∧ post-activation-line ∧ no goal_ac) where it is written.
//
// The judgment functions, the activation line and the grandfather semantics are the detector's own
// exports (see the AC6 test in long-term-guarantee-goal-backed-check.test.mjs) — one judgment, two
// moments. Every case below drives BOTH values of its own axis (硬规则④): the violation is rejected
// AND the same file with the field filled in is allowed; the pre-cutoff stock is allowed BY THE
// JUDGMENT (in scope, judged, grandfathered) — not by being filtered out of scope.

/** A minimal task body carrying `delivery-critical` (+ the label set a real filing has). */
function dcTaskBody(id, { goalAc = null, nested = false } = {}) {
  const fm = [`id: ${id}`, "title: t", "status: todo"];
  if (goalAc && !nested) fm.push(`goal_ac: ${goalAc}`);
  fm.push("labels:", "  - gap", "  - delivery-critical");
  if (goalAc && nested) fm.push("extra:", `  goal_ac: ${goalAc}`);
  return `---\n${fm.join("\n")}\n---\n\n## Proposal\n\ntext\n`;
}

function commitBackdated(root, rel, content, iso) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
  const add = run("git", ["add", rel], root);
  assert.equal(add.status, 0, `git add ${rel}`);
  const commit = run("git", ["commit", "-q", "-m", `backdated ${rel}`], root, {
    GIT_COMMITTER_DATE: iso,
    GIT_AUTHOR_DATE: iso,
  });
  assert.equal(commit.status, 0, `backdated commit: ${commit.stderr}`);
}

test("AC4 negative — a staged NEW delivery-critical task without goal_ac is REJECTED (reason delivery-critical-without-goal-ac)", () => {
  const root = makeGitRepo(); // no scripts/test.sh → doc check passes; only the ②/③ detectors judge
  try {
    stage(root, "tasks/gap-new-dc.md", dcTaskBody("gap-new-dc"));
    const res = runGuard(root);
    assert.equal(res.status, 1, `delivery-critical without goal_ac must reject, got ${res.status}: ${res.stdout} ${res.stderr}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.verdict, "reject");
    assert.equal(out.reason, "delivery-critical-without-goal-ac");
    assert.ok(
      out.goalAcCheckOutput && out.goalAcCheckOutput.includes("tasks/gap-new-dc.md"),
      `goalAcCheckOutput names the remediation path (= file), got ${out.goalAcCheckOutput}`,
    );
    assert.ok(out.message.includes("goal_ac"), "message says what to add");
  } finally {
    cleanup(root);
  }
});

test("AC4 reverse control — the SAME task with a top-level goal_ac is ALLOWED (the judgment can take the value false)", () => {
  const root = makeGitRepo();
  try {
    stage(root, "tasks/gap-new-dc.md", dcTaskBody("gap-new-dc", { goalAc: "AC-232" }));
    const res = runGuard(root);
    assert.equal(res.status, 0, `with goal_ac must allow, got ${res.status}: ${res.stdout}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.verdict, "allow");
    assert.equal(out.goalAcCheckOutput, null, "no goal_ac output on the allow path");
  } finally {
    cleanup(root);
  }
});

test("AC4 — goal_ac NESTED under extra does NOT satisfy the rule (the field is top-level by design)", () => {
  // AC-178 / frontmatterGoalAc: `goal_ac` is a TOP-LEVEL scalar; the extra-nested form is the
  // depends_on legacy home and must not be read as a declaration (same judgment as the detector's).
  const root = makeGitRepo();
  try {
    stage(root, "tasks/gap-new-dc.md", dcTaskBody("gap-new-dc", { goalAc: "AC-232", nested: true }));
    const res = runGuard(root);
    assert.equal(res.status, 1, `extra-nested goal_ac must NOT satisfy the rule, got ${res.status}: ${res.stdout}`);
    assert.equal(JSON.parse(res.stdout).reason, "delivery-critical-without-goal-ac");
  } finally {
    cleanup(root);
  }
});

test("AC5 — a PRE-activation-line delivery-critical task without goal_ac is ALLOWED through the same judgment (grandfathered, NOT out of scope)", () => {
  // The 115-task pre-cutoff stock must not be turned red by this judgment (that would block every
  // writer — the zombie lesson). The allow must come from the judgment's grandfather branch, so the
  // file IS in scope and IS judged: a within-test negative control proves the judgment was live.
  const root = makeGitRepo();
  try {
    commitBackdated(root, "tasks/gap-old-dc.md", dcTaskBody("gap-old-dc"), "2026-08-01T00:00:00Z");
    // modify + stage it: the file is now a staged tasks/*.md candidate (in scope)
    fs.appendFileSync(path.join(root, "tasks", "gap-old-dc.md"), "\n<!-- touched -->\n", "utf8");
    const add = run("git", ["add", "tasks/gap-old-dc.md"], root);
    assert.equal(add.status, 0, `git add old: ${add.stderr}`);
    const res = runGuard(root);
    assert.equal(res.status, 0, `pre-cutoff stock must be grandfathered, got ${res.status}: ${res.stdout}`);

    // ── negative control INSIDE the test: the same shape filed NOW is rejected. Without it, the
    //    allow above could equally have come from a dead judgment (硬规则 4b).
    stage(root, "tasks/gap-new-dc.md", dcTaskBody("gap-new-dc"));
    const res2 = runGuard(root);
    assert.equal(res2.status, 1, "the same shape filed now must be rejected — else the allow above proved nothing");
    assert.equal(JSON.parse(res2.stdout).reason, "delivery-critical-without-goal-ac");
  } finally {
    cleanup(root);
  }
});

test("AC5 — a staged NEW task WITHOUT the label is allowed; a non-tasks path never triggers", () => {
  const root = makeGitRepo();
  try {
    stage(root, "tasks/gap-plain.md", "---\nid: gap-plain\nstatus: todo\nlabels:\n  - gap\n---\n\n## Proposal\n\ntext\n");
    let res = runGuard(root);
    assert.equal(res.status, 0, `unlabelled task must allow, got ${res.status}: ${res.stdout}`);

    stage(root, "docs/notes.md", "no frontmatter\n");
    stage(root, "README.md", "changed\n");
    res = runGuard(root);
    assert.equal(res.status, 0, `non-tasks paths must not trigger, got ${res.status}: ${res.stdout}`);
  } finally {
    cleanup(root);
  }
});

test("AC5 — a staged task file with NO frontmatter is not reported as a violation (out of this judgment's population)", () => {
  // 硬规则 3b's mirror: an unreadable frontmatter cannot carry the label, so it must not be reported
  // either as a violation or as a pass of the goal_ac rule — it is simply not in the population
  // (task-contract-check / the task-file-violation-ledger judge that shape).
  const root = makeGitRepo();
  try {
    stage(root, "tasks/gap-no-frontmatter.md", "just a body\n");
    const res = runGuard(root);
    assert.equal(res.status, 0, `no-frontmatter task must not be goal_ac-rejected, got ${res.status}: ${res.stdout}`);
    assert.equal(JSON.parse(res.stdout).reason, "doc-checks-pass");
  } finally {
    cleanup(root);
  }
});

test("AC5 — a staged DELETION of a delivery-critical task without goal_ac does not trigger (deletes are not filings)", () => {
  const root = makeGitRepo();
  try {
    // a post-cutoff delivery-critical task WITHOUT goal_ac (the violating shape) — then DELETE it.
    stage(root, "tasks/gap-doomed-dc.md", dcTaskBody("gap-doomed-dc"));
    let res = runGuard(root);
    assert.equal(res.status, 1, "precondition: the file itself is the violating shape");
    const commit = run("git", ["commit", "-q", "-m", "add doomed"], root);
    assert.equal(commit.status, 0, `precondition commit: ${commit.stderr}`);
    fs.rmSync(path.join(root, "tasks", "gap-doomed-dc.md"));
    const rm = run("git", ["add", "-A", "tasks/gap-doomed-dc.md"], root);
    assert.equal(rm.status, 0, `git add -A: ${rm.stderr}`);
    res = runGuard(root);
    assert.equal(res.status, 0, `a deletion must not trigger, got ${res.status}: ${res.stdout}`);
  } finally {
    cleanup(root);
  }
});

test("AC4 e2e — a real `git commit` of a delivery-critical task without goal_ac is REJECTED by the installed pre-commit hook; the goal_ac control commits", () => {
  const root = makeGitRepo();
  try {
    copyGuardScripts(root);
    const install = installHookFromScratch(root);
    assert.equal(install.status, 0, `install-hook: ${install.stderr}`);

    // the violation must never reach the repository
    stage(root, "tasks/gap-bad-dc.md", dcTaskBody("gap-bad-dc"));
    const badCommit = run("git", ["commit", "-m", "dc without goal_ac"], root);
    assert.notEqual(badCommit.status, 0, `commit must be REJECTED, got ${badCommit.status}`);
    assert.match(
      badCommit.stdout + badCommit.stderr,
      /goal_ac|delivery-critical-without-goal-ac/,
      "rejection output names the goal_ac violation",
    );
    assert.equal(run("git", ["log", "--oneline"], root).stdout.trim().split("\n").length, 1, "bad commit was NOT created");

    // control: the same task WITH goal_ac commits (the hook is not simply rejecting everything)
    run("git", ["reset", "-q", "--", "tasks/gap-bad-dc.md"], root);
    stage(root, "tasks/gap-good-dc.md", dcTaskBody("gap-good-dc", { goalAc: "AC-232" }));
    const goodCommit = run("git", ["commit", "-m", "dc with goal_ac"], root);
    assert.equal(goodCommit.status, 0, `control commit must succeed, got ${goodCommit.status}: ${goodCommit.stdout} ${goodCommit.stderr}`);
  } finally {
    cleanup(root);
  }
});

// ── Real-repo smoke: the guard runs against THIS repo without crashing ───────────────────────────────

test("real-repo smoke — guard runs against the real repo (no crash, readable verdict)", () => {
  // AC64: ② retired ⇒ no state-file read, no fail-loud. The guard only runs the doc checks (①);
  // against the real repo the doc checks pass ⇒ verdict allow, exit 0. We assert no internal error
  // (exit not 2) and a JSON verdict.
  const res = runGuard(REPO_ROOT);
  assert.notEqual(res.status, 2, `guard must not crash on the real repo: ${res.stderr} ${res.stdout}`);
  const out = JSON.parse(res.stdout);
  assert.ok(["allow", "reject"].includes(out.verdict), "verdict is allow or reject");
});

// ── ④ quay-init closure-ratchet freshness at the commit moment ────────────────────────────────────────
// gap-closure-ratchet-stale-wire-into-precommit-guard. The judgment itself already existed and was
// correct (`--check-stale`, gap-quay-init-closure-ratchet-manual-reanchor-recurs) — it lived ONLY in
// the suite's @static-tier change layer, so the 2026-09-16 v0.8.0 release cut changed a laydown source
// (plugin.json) twice, committed + pushed cleanly, and two CI runs died ~1-2 min later on
// `STATIC_CHECK_FAILED: quay-init-closure-ratchet-stale`. ④ moves the SAME judgment to the write face.
//
// Every e2e below drives a REAL `git commit` through the INSTALLED pre-commit hook (the DoD's demand:
// a unit assertion on judge() would repeat the旧 task's acceptance shape and prove nothing about the
// write face). The fixture's laydown is controllable but REAL in every load-bearing sense: the baseline
// is produced by the checker's own `--reanchor`, and the growth/its classification are measured by the
// checker's own `runLaydown`.

/** A fake quay-init.sh laying down `layFiles` files × 10 bytes into the `--root` target (the shape
 *  plugin/test/quay-init-closure-ratchet.test.mjs's AC4 negative control uses), with one addition: it
 *  appends a line to `sentinel` on every RUN. The sentinel is the AC3 instrument — a DIRECT reading of
 *  "did a real laydown run for this commit?", not a wall-clock proxy (硬规则 4b: prefer the direct
 *  quantity). ⛔ A never-firing probe is an instrument failure, not a pass (硬规则 4 推论二), so every
 *  test that asserts ABSENCE also has a case where the sentinel MUST have fired. */
function fakeQuayInit(layFiles, sentinel) {
  return `#!/usr/bin/env bash
_root=""
while [ $# -gt 0 ]; do
  case "$1" in
    --root) _root="$2"; shift 2 ;;
    *) shift ;;
  esac
done
echo "run" >> "${sentinel}"
mkdir -p "$_root/laydown"
_i=1
while [ "$_i" -le ${layFiles} ]; do
  printf '0123456789' > "$_root/laydown/f$_i.txt"
  _i=$((_i + 1))
done
exit 0
`;
}

function commitCount(root) {
  return Number(run("git", ["rev-list", "--count", "HEAD"], root).stdout.trim());
}

/**
 * A scratch repo carrying the checker's OWN LAYDOWN_SOURCES (imported above, never re-listed) plus a
 * controllable fake laydown, and an HONEST baseline written by the checker's own `--reanchor` CLI —
 * not a hand-written JSON (a hand-written baseline would let a broken `runLaydown` still look right).
 * The guard hook is deliberately installed by the CALLER, after the setup commits: the setup stages
 * laydown sources while no baseline exists yet.
 */
function makeLaydownFixture({ layFiles = 2 } = {}) {
  const root = makeGitRepo();
  const sentinel = path.join(root, ".quay", "laydown-runs.log");
  for (const rel of LAYDOWN_SOURCES) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    // quay-init.sh is the controllable fake; the other three are inert content (the checker
    // fingerprints their BYTES, and the fake laydown ignores them).
    if (rel === `plugin/scripts/quay-init.sh`) fs.writeFileSync(abs, fakeQuayInit(layFiles, sentinel), { mode: 0o755 });
    else fs.writeFileSync(abs, `# inert fixture stand-in for ${rel}\n`, "utf8");
  }
  copyGuardScripts(root); // source-derived closure ⇒ the new ④ dep (quay-init-closure-ratchet.ts) is included
  assert.equal(run("git", ["add", "-A"], root).status, 0, "git add setup");
  assert.equal(run("git", ["commit", "-q", "-m", "setup"], root).status, 0, "setup commit");

  const anchor = run(
    "node",
    ["--no-warnings", "--experimental-strip-types", path.join(root, RATCHET_REL), "--reanchor", "--root", root],
    root,
  );
  assert.equal(anchor.status, 0, `--reanchor must succeed on the fixture: ${anchor.stdout}${anchor.stderr}`);
  const baseline = JSON.parse(fs.readFileSync(path.join(root, BASELINE_REL), "utf8"));
  // The baseline is the HONEST measurement of the fake laydown (AC2's "真实膨胀" is only real growth
  // relative to a measured baseline — a hand-set number would prove nothing).
  assert.equal(baseline.files, layFiles, "the baseline must be the measured laydown file count");
  assert.equal(baseline.bytes, layFiles * 10, "the baseline must be the measured laydown byte count");
  assert.equal(run("git", ["add", BASELINE_REL], root).status, 0, "git add baseline");
  assert.equal(run("git", ["commit", "-q", "-m", "baseline"], root).status, 0, "baseline commit");
  return { root, sentinel };
}

test("④ AC3 — an ordinary commit (no laydown source staged) never runs a laydown; a laydown-source commit does", () => {
  const { root, sentinel } = makeLaydownFixture();
  try {
    const install = installHookFromScratch(root);
    assert.equal(install.status, 0, `install-hook: ${install.stderr}`);
    // Instrument liveness BEFORE the absence assertion: the fixture's own --reanchor ran the fake
    // laydown, so the sentinel must exist. Without this, "no sentinel" below could just be a dead probe.
    assert.ok(fs.existsSync(sentinel), "the fixture's --reanchor must have fired the sentinel (else the probe is dead)");
    fs.rmSync(sentinel, { force: true });

    // (a) ORDINARY commit — nothing in the laydown source set is staged.
    stage(root, "README.md", "changed\n");
    assert.deepEqual(stagedLaydownSources(root), [], "an ordinary commit stages no laydown source");
    const t0 = Date.now();
    const res = runGuard(root);
    const tOrdinaryMs = Date.now() - t0;
    assert.equal(res.status, 0, `ordinary commit must be allowed, got ${res.status}: ${res.stdout}`);
    assert.equal(
      JSON.parse(res.stdout).closureRatchetCheckOutput,
      null,
      "the ④ check must produce no output at all for an ordinary commit (nothing was judged)",
    );
    assert.ok(
      !fs.existsSync(sentinel),
      "静默 = 真静默: the ordinary commit must not spawn quay-init.sh at all — no full laydown per commit",
    );
    assert.equal(run("git", ["commit", "-q", "-m", "ordinary"], root).status, 0, "ordinary commit goes through the hook");
    assert.ok(!fs.existsSync(sentinel), "…and it still did not run a laydown");

    // (b) CONTROL — a commit that DOES stage a laydown source must light the sentinel up, otherwise
    //     (a)'s silence proved nothing (硬规则 4 推论二: 恒零/恒真的读数携带零信息).
    stage(root, LAYDOWN_SOURCES[0], `${fs.readFileSync(path.join(root, LAYDOWN_SOURCES[0]), "utf8")}\n# touch\n`);
    const t1 = Date.now();
    runGuard(root); // rejected (stale) — the verdict is asserted in the AC1 test; here we only need the cost
    const tLaydownMs = Date.now() - t1;
    assert.ok(fs.existsSync(sentinel), "a laydown-source commit must run the real laydown (classification)");

    // AC3's "附前后耗时读数" — recorded, deliberately NOT asserted: the wall clock here is dominated by
    // process spawn and is load-correlated (硬规则 4 推论: 别把判据钉在一个依赖宿主的量上). The
    // load-independent statement of the same fact is the sentinel above.
    console.log(
      `[④ AC3 readings] ordinary commit judge() ≈ ${tOrdinaryMs} ms; laydown-source commit judge() ≈ ${tLaydownMs} ms ` +
      `(sentinel: ${fs.readFileSync(sentinel, "utf8").trim().split("\n").length} laydown run(s) — 0 for the ordinary commit)`,
    );
  } finally {
    cleanup(root);
  }
});

test("④ AC1/AC4 e2e — a real `git commit` of a changed laydown source with a stale baseline is REJECTED, and the rejection names the --reanchor remedy", () => {
  const { root, sentinel } = makeLaydownFixture();
  try {
    const install = installHookFromScratch(root);
    assert.equal(install.status, 0, `install-hook: ${install.stderr}`);
    fs.rmSync(sentinel, { force: true });

    // INJECT: change a laydown source. Content changes ⇒ the fingerprint goes stale; the fake
    // laydown's OUTPUT does not change ⇒ this is the shrink-only case (the v0.8.0 release-cut shape).
    // ⛔ No `--reanchor` — that omission is the defect being closed.
    const initRel = LAYDOWN_SOURCES[0];
    stage(root, initRel, `${fs.readFileSync(path.join(root, initRel), "utf8")}\n# cosmetic: content changed, laydown output identical\n`);

    const before = commitCount(root);
    const bad = run("git", ["commit", "-m", "laydown source changed without a re-anchor"], root);
    assert.notEqual(bad.status, 0, `the commit MUST be rejected at the commit moment, got ${bad.status}`);
    const out = bad.stdout + bad.stderr;
    assert.match(out, /closure-ratchet|closure-ratchet-stale/, "the rejection names the closure-ratchet violation");
    assert.match(out, /shrink-only|指纹已陈旧/, "the rejection says WHICH failure this is (not just 'something is stale')");
    // AC4 (reject variant): the remedy must be the FULL invocation form, not a hint.
    assert.ok(
      out.includes("node --experimental-strip-types plugin/scripts/quay-init-closure-ratchet.ts --reanchor"),
      `the rejection must carry the executable remedy command, got:\n${out}`,
    );
    assert.equal(commitCount(root), before, "the rejected commit was NOT created");
    assert.ok(fs.existsSync(sentinel), "the shrink-only classification came from a REAL laydown run, not an assumption");

    // CONTROL (falsifiability): run the named remedy, then commit the SAME content — it must go
    // through. Without this the rejection above could equally have come from a check that rejects
    // everything (硬规则 4b).
    const anchored = run(
      "node",
      ["--no-warnings", "--experimental-strip-types", path.join(root, RATCHET_REL), "--reanchor", "--root", root],
      root,
    );
    assert.equal(anchored.status, 0, `the named remedy must work: ${anchored.stdout}${anchored.stderr}`);
    assert.equal(run("git", ["add", BASELINE_REL], root).status, 0, "stage the re-anchored baseline");
    const good = run("git", ["commit", "-m", "laydown source + re-anchored baseline"], root);
    assert.equal(good.status, 0, `after the remedy the same commit must be allowed, got ${good.status}: ${good.stdout}${good.stderr}`);
    assert.equal(commitCount(root), before + 1, "the remedy commit landed");
  } finally {
    cleanup(root);
  }
});

test("④ AC2 e2e — a REAL growth past the baseline is still REJECTED (the ratchet is not relaxed to constant-true)", () => {
  const { root, sentinel } = makeLaydownFixture({ layFiles: 2 });
  try {
    const install = installHookFromScratch(root);
    assert.equal(install.status, 0, `install-hook: ${install.stderr}`);
    fs.rmSync(sentinel, { force: true });

    // GROWTH: the laydown now produces 3 files where the committed (measured) baseline allows 2.
    // This is the direction the ratchet exists to block — 只许降不许升.
    fs.writeFileSync(path.join(root, LAYDOWN_SOURCES[0]), fakeQuayInit(3, sentinel), { mode: 0o755 });
    assert.equal(run("git", ["add", LAYDOWN_SOURCES[0]], root).status, 0, "stage the grown laydown");

    const before = commitCount(root);
    const bad = run("git", ["commit", "-m", "laydown grew"], root);
    assert.notEqual(bad.status, 0, "a real growth MUST still be rejected — never auto-allowed");
    const out = bad.stdout + bad.stderr;
    assert.match(out, /closure-ratchet-grown|GREW past/, "the rejection names the GROWTH, not mere staleness");
    assert.match(out, /3 files \(baseline 2\)/, `the growth numbers must be named (files/bytes), got:\n${out}`);
    assert.equal(commitCount(root), before, "the grown commit was NOT created");
    // The growth verdict must come from a real measurement — a fixture/injected number would make this
    // an echo (硬规则 4 推论三: 只能被 fixture 满足的判据不是测量).
    const runs = fs.readFileSync(sentinel, "utf8").trim().split("\n").length;
    assert.ok(runs >= 1, `the growth was measured by a real laydown run (sentinel=${runs})`);

    // CONTROL: the hook is not stuck in reject-everything — revert, and an ordinary commit passes.
    run("git", ["reset", "-q", "--", LAYDOWN_SOURCES[0]], root);
    run("git", ["checkout", "--", LAYDOWN_SOURCES[0]], root);
    stage(root, "README.md", "control\n");
    const ok = run("git", ["commit", "-q", "-m", "control"], root);
    assert.equal(ok.status, 0, `control commit must pass, got ${ok.status}: ${ok.stdout}${ok.stderr}`);
  } finally {
    cleanup(root);
  }
});

test("④ hard rule 3b — a changed laydown source with NO committed baseline is REJECTED as not-evaluated (never conflated with 合格)", () => {
  const root = makeGitRepo();
  try {
    for (const rel of LAYDOWN_SOURCES) stage(root, rel, "stand-in content\n");
    const res = runGuard(root);
    assert.equal(res.status, 1, `an unreadable baseline must fail closed, got ${res.status}: ${res.stdout}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.reason, "closure-ratchet-not-evaluated", "读不懂输入 has its OWN reason word (硬规则 3b)");
    assert.ok(
      out.closureRatchetCheckOutput.includes("baseline MISSING"),
      `the output must say the baseline is missing, got: ${out.closureRatchetCheckOutput}`,
    );
    // Negative control: the same repo with nothing in the laydown source set staged ⇒ allowed. The
    // rejection above therefore comes from the trigger, not from a broken guard.
    assert.equal(run("git", ["reset", "-q"], root).status, 0, "reset the index");
    stage(root, "README.md", "ordinary\n");
    const ok = runGuard(root);
    assert.equal(ok.status, 0, `an ordinary commit must still be allowed, got ${ok.status}: ${ok.stdout}`);
  } finally {
    cleanup(root);
  }
});

test("④ AC5 — the trigger set is the checker's own exported LAYDOWN_SOURCES (import, not a second hand-copied list)", () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, GUARD_REL), "utf8");
  assert.match(
    src,
    /import\s*\{[^}]*\bLAYDOWN_SOURCES\b[^}]*\}\s*from\s*["']\.\/quay-init-closure-ratchet\.ts["']/s,
    "precommit-guard.ts must IMPORT LAYDOWN_SOURCES from the checker (硬规则 5b: a second hand-copied list drifts and one side stops checking)",
  );

  // …and behaviourally: the guard's trigger set IS that constant (not an equal-looking literal).
  const root = makeGitRepo();
  try {
    const [first, ...rest] = LAYDOWN_SOURCES;
    stage(root, first, "x\n");
    assert.deepEqual(stagedLaydownSources(root), [first], "a staged laydown source triggers");
    stage(root, "plugin/scripts/not-a-laydown-source.ts", "x\n");
    assert.deepEqual(stagedLaydownSources(root), [first], "a staged non-source path never triggers");
    assert.equal(
      rest.some((r) => stagedLaydownSources(root).includes(r)),
      false,
      "unstaged members of LAYDOWN_SOURCES are not reported (the trigger is the STAGED intersection)",
    );
  } finally {
    cleanup(root);
  }
});
