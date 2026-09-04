// @test-group engine
// @load-sensitive real-install
// @load-sensitive-entry 2026-08-09 real-install e2e (quay-init --loop); install family flake rotation
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — real-install e2e:
// each test spawns a real quay-init.sh --loop subprocess tree. The install/quay-init family rotated
// flakes across groups under full-suite load, so the whole family is consolidated into the
// concurrency-1 serial phase (gap-install-family-tests-rotate-flakes-under-full-suite).
// quay-init-loop.test.mjs — gap-quay-init-never-commits-broken-committed-state (AC1-AC3).
//
// quay-init 铺文件但从不 commit ⇒ consumer 仓库的机制默认活在未提交工作树里，committed 态是否自洽纯属
// 运气（archguard 实测：提交了 ready-pool-check 却没提交它的三个 helper ⇒ fresh-clone broken）。本文件
// 断言修复后的交付契约：铺完机制自动 commit（`chore(quay-init):` 前缀，AC1）；fresh-clone + quay-init
// ⇒ 机制完整（ready-pool-check 依赖齐全，无 broken committed 态，AC2）；已有未提交改动时不静默覆盖
// （检测 + 提示 + 待确认，AC3）。
//
// NOTE (2026-08-08): this file reuses the NAME of the pre-split quay-init-loop.test.mjs (54 tests,
// split 2026-08-07 into quay-init-loop-{core,runtime,vendor,driver}.test.mjs under the shared
// quay-init-loop-helpers.mjs). The old file was deleted; this is a NEW, small file (well under the
// node:test worker event-loop exhaustion threshold) scoped to the auto-commit ACs. Shared helpers
// come from quay-init-loop-helpers.mjs (same single quay-init surface).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { makeTmp, cleanup, runInit, laydownWorkspace } from "./quay-init-loop-helpers.mjs";

// ── local helpers ────────────────────────────────────────────────────────────────────────────────────

// git <cwd> <args...>: run a git command and return trimmed stdout (empty string on failure).
function git(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return r.status === 0 ? (r.stdout || "").trim() : "";
}

// gitWorkspace(): a fresh temp git repo with one initial commit (so the consumer repo has a HEAD and
// a clean tree — the "fresh-clone" baseline). Sets a local identity so `git commit` works anywhere.
function gitWorkspace() {
  const ws = makeTmp("quay-init-git-");
  const init = spawnSync("git", ["init", "-q"], { cwd: ws, encoding: "utf8" });
  if (init.status !== 0) {
    cleanup(ws);
    throw new Error(`git init failed in ${ws}: ${init.stderr}`);
  }
  spawnSync("git", ["config", "user.name", "quay-init test"], { cwd: ws, encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "quay-init-test@example.com"], { cwd: ws, encoding: "utf8" });
  fs.writeFileSync(path.join(ws, "README.md"), "# fixture\n");
  fs.writeFileSync(path.join(ws, "app.txt"), "v1\n");
  spawnSync("git", ["add", "README.md", "app.txt"], { cwd: ws, encoding: "utf8" });
  const cm = spawnSync("git", ["commit", "-qm", "initial"], { cwd: ws, encoding: "utf8" });
  if (cm.status !== 0) {
    cleanup(ws);
    throw new Error(`initial commit failed in ${ws}: ${cm.stderr}`);
  }
  return ws;
}

const INIT_ARGS = (ws) => [
  "--loop", "--root", ws, "--project", "proj",
  "--test-command", "node --test", "--tmux-session", "proj-0:0.0",
];

// cloneOf(ws): a sibling temp dir that is a `git clone` of ws — a FRESH CLONE of the committed state.
// Returns the clone dir (caller must cleanup).
function cloneOf(ws) {
  const dst = makeTmp("quay-init-clone-");
  fs.rmSync(dst, { recursive: true, force: true });
  const cl = spawnSync("git", ["clone", "-q", ws, dst], { encoding: "utf8" });
  if (cl.status !== 0) {
    cleanup(dst);
    throw new Error(`git clone of ${ws} failed: ${cl.stderr}`);
  }
  return dst;
}

// ready-pool-check.ts + its three named helper modules (the archguard story: the consumer was
// committed but its helpers were not → broken fresh-clone). AC2 asserts all four are committed.
const READY_POOL_CLOSURE = [
  "plugin/scripts/ready-pool-check.ts",
  "plugin/scripts/task-status-drift-check.ts",      // taskWorkLanded
  "plugin/scripts/touches-orthogonality-check.ts",  // checkTaskTouchesResolve
  "plugin/scripts/concurrent-batch-scheduler.ts",   // expandDeclaredTouches
];

// precommit-guard.ts's ESM `./` import — the delta-scope unverified-landing defect
// (gap-quay-init-laydown-missing-touches-checker): the guard is laid down AND its hook installed,
// but the imported checker was absent from the --loop laydown set until this fix. The
// ${SCRIPT_DIR} dependency-closure scan cannot see ESM relative imports, so the checker is an
// EXPLICIT derive_loop_scripts addition — and must be present in the committed consumer tree.
const PRECOMMIT_GUARD_CLOSURE = [
  "plugin/scripts/precommit-guard.ts",
  "plugin/scripts/touches-one-entry-one-path-check.ts",  // imported by precommit-guard.ts:65
];

// ── AC1: auto-commit with a `chore(quay-init):` prefix ──────────────────────────────────────────────
test('AC1 — quay-init --loop auto-commits the laid-down mechanisms with a chore(quay-init): prefix', () => {
  const ws = gitWorkspace();
  try {
    const r = runInit(ws, INIT_ARGS(ws));
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    assert.match(r.stdout, /auto-commit: committed/, 'must report the auto-commit');
    // The measure: `git log --oneline -3 | grep -c 'chore(quay-init)'` ≥ 1.
    const log = git(ws, ["log", "--oneline", "-3"]);
    assert.match(log, /chore\(quay-init\)/, 'the auto-commit must use the chore(quay-init): prefix');
    // The committed tree carries the mechanism files — a fresh clone after this commit is complete.
    const tracked = git(ws, ["ls-files"]);
    assert.ok(tracked.includes("plugin/scripts/resource-gate.sh"), 'mechanism script must be committed');
    assert.ok(tracked.includes("orchestration/orchestrator-loop-tick.md"), 'outer tick doc must be committed');
    assert.ok(tracked.includes("docs/analysis/fast-mode-loop-tick.md"), 'inner tick doc must be committed');
    assert.ok(tracked.includes(".quay/config.yml"), 'the provider config must be committed');
    // The pre-commit guard's own ESM import must ship too — the hook install below runs
    // precommit-guard.ts --install-hook which imports ./touches-one-entry-one-path-check.ts; a
    // consumer committed state WITHOUT the imported checker is exactly the ERR_MODULE_NOT_FOUND
    // defect (gap-quay-init-laydown-missing-touches-checker).
    assert.ok(tracked.includes("plugin/scripts/touches-one-entry-one-path-check.ts"),
      'precommit-guard.ts\'s imported checker must be committed');
    // The gitignored runtime bundles are NOT committed (AC10) — a committed state without 1.3MB bundles.
    assert.ok(!/quay\/runtime\//.test(tracked), 'runtime bundles must not be committed (gitignored, AC10)');
  } finally { cleanup(ws); }
});

// ── AC2: fresh-clone + quay-init ⇒ complete mechanism, no broken committed state ─────────────────────
test('AC2 — a fresh clone of the committed state carries the FULL mechanism set (ready-pool-check and its helper modules together)', () => {
  const ws = gitWorkspace();
  try {
    const r = runInit(ws, INIT_ARGS(ws));
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    // Fresh-clone observer: clone the repo's committed state and read the committed tree.
    const clone = cloneOf(ws);
    try {
      const committed = git(clone, ["ls-files"]);
      for (const f of READY_POOL_CLOSURE) {
        assert.ok(committed.includes(f), `fresh-clone committed tree must carry ${f} (broken-committed-state guard)`);
      }
      for (const f of PRECOMMIT_GUARD_CLOSURE) {
        assert.ok(committed.includes(f), `fresh-clone committed tree must carry ${f} (precommit-guard ESM import closure)`);
      }
      // A fresh clone's worktree is clean at HEAD — nothing is left half-committed.
      assert.equal(git(clone, ["status", "--porcelain"]), "", 'fresh clone working tree must be clean');
    } finally { cleanup(clone); }
  } finally { cleanup(ws); }
});

// ── AC3: pre-existing uncommitted changes are NOT silently swept ─────────────────────────────────────
test('AC3 — pre-existing uncommitted changes: quay-init detects + prompts; non-interactive declines, --auto-commit-confirm commits ONLY its own laid-down files', () => {
  const ws = gitWorkspace();
  try {
    // Pre-existing uncommitted consumer work (the meta-cc 46-changes shape): an untracked file and a
    // modified tracked file, both unrelated to quay-init.
    fs.writeFileSync(path.join(ws, "notes.txt"), "user note\n");
    fs.writeFileSync(path.join(ws, "app.txt"), "v2\n");
    const pre = git(ws, ["status", "--porcelain"]);
    assert.match(pre, /notes\.txt/, 'fixture: notes.txt is an uncommitted untracked file');
    assert.match(pre, /app\.txt/, 'fixture: app.txt has an uncommitted tracked edit');

    // Run 1 — non-interactive, no confirm flag: must DETECT + DECLINE, never silently sweep.
    const r1 = runInit(ws, INIT_ARGS(ws));
    assert.equal(r1.status, 0, `declined run must still exit 0 (laydown succeeded):\n${r1.stderr}`);
    assert.match(r1.stderr, /already had uncommitted change/, 'must detect pre-existing uncommitted changes');
    assert.match(r1.stderr, /DECLINED \(non-interactive/, 'non-interactive without confirm must decline the auto-commit');
    assert.ok(!/chore\(quay-init\)/.test(git(ws, ["log", "--oneline", "-3"])), 'must NOT commit without confirmation');
    assert.equal(fs.readFileSync(path.join(ws, "notes.txt"), "utf8"), "user note\n", 'pre-existing untracked file survives');
    assert.equal(fs.readFileSync(path.join(ws, "app.txt"), "utf8"), "v2\n", 'pre-existing tracked edit survives');

    // Run 2 — explicit confirmation: commits ONLY quay-init's laid-down paths; pre-existing stays out.
    const r2 = runInit(ws, [...INIT_ARGS(ws), "--auto-commit-confirm"]);
    assert.equal(r2.status, 0, `confirmed run must exit 0:\n${r2.stderr}`);
    assert.match(r2.stdout, /auto-commit: committed/, 'confirmed run must commit');
    assert.match(git(ws, ["log", "--oneline", "-3"]), /chore\(quay-init\)/, 'chore(quay-init) commit must exist after confirmation');
    const status = git(ws, ["status", "--porcelain"]);
    assert.match(status, /notes\.txt/, 'notes.txt must stay uncommitted (not swept into the quay-init commit)');
    assert.match(status, /app\.txt/, 'app.txt must stay uncommitted (not swept into the quay-init commit)');
  } finally { cleanup(ws); }
});

// ── non-git workspace: auto-commit is a no-op; the laydown still succeeds ────────────────────────────
// (gap-slow-test-shared-fixture-and-group-recheck AC2): this is the ONE test in the file that is
// install-as-setup (a non-git laydown whose captured output + laid-down tree are reusable), so it now
// copies from the SHARED prebuilt fixture (laydownWorkspace) instead of running a fresh install. The
// auto-commit tests above/below are install-as-behavior (the git auto-commit is the object under test)
// and keep their real installs on fresh git workspaces — the non-git fixture cannot serve them.
test('AC1/control — a non-git workspace skips auto-commit but still lays the mechanisms down (exit 0)', () => {
  const { ws, install: r } = laydownWorkspace();
  try {
    assert.equal(r.status, 0, `non-git laydown must still exit 0:\n${r.stderr}`);
    assert.match(r.stdout, /auto-commit: SKIP \(not a git repository/, 'must skip auto-commit in a non-git workspace');
    assert.ok(fs.existsSync(path.join(ws, "plugin", "scripts", "resource-gate.sh")), 'mechanism files are still laid down');
  } finally { cleanup(ws); }
});

// ── --dry-run: never commits (nothing was written) ───────────────────────────────────────────────────
test('AC1/control — --dry-run never auto-commits', () => {
  const ws = gitWorkspace();
  try {
    const r = runInit(ws, [...INIT_ARGS(ws), "--dry-run"]);
    assert.equal(r.status, 0, `dry-run must exit 0:\n${r.stderr}`);
    assert.match(r.stdout, /auto-commit: SKIP \(--dry-run/, 'dry-run must skip auto-commit');
    assert.ok(!/chore\(quay-init\)/.test(git(ws, ["log", "--oneline", "-3"])), 'dry-run must not create any commit');
  } finally { cleanup(ws); }
});
