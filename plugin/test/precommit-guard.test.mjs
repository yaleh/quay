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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const GUARD = path.join(REPO_ROOT, "plugin", "scripts", "precommit-guard.ts");

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

/** Copy the guard + its Touches-parser deps into a scratch repo so --install-hook's shim resolves. */
function copyGuardScripts(root) {
  for (const f of ["precommit-guard.ts", "touches-one-entry-one-path-check.ts", "touches-parser.ts", "gate-script-base.ts"]) {
    fs.copyFileSync(path.join(REPO_ROOT, "plugin", "scripts", f), path.join(root, "plugin", "scripts", f));
  }
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
    const install = run("node", ["--no-warnings", "--experimental-strip-types", GUARD, "--root", root, "--install-hook"], root);
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
