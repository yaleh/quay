// @test-group engine
// worktree-process-reaper.test.mjs — tasks/gap-worktree-remove-orphans-probes.
// 测试钉住 plugin/scripts/worktree-process-reaper.ts：
//   1. `--worktree <path>` 模式 — `git worktree remove` 前扫 worktree 路径下的活子进程（claude-probe
//      测试夹具 + 挂死 runner）并清理；**正常 claude 会话（argv[0]=claude）绝不杀**（AC2）。
//   2. `--orphans` 模式 — 回收「cwd 指向已删 worktree」的孤儿探针 + 持 full-suite.lock 的挂死进程
//      （同族扩展 2026-08-17）。
//   3. 纯函数判定（seam 注入 /proc 形状），kill 逻辑（真实进程端到端）。
//
// 安全信封（同 session-liveness-sweep 的 no_pkill_by_name_on_live 不变式）：reaper 按【孤儿状态】
// 杀（cwd 指向被删目录 = 无 owner），绝不按进程名批量杀活进程。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

import {
  splitCwd,
  isRealClaude,
  isProbe,
  cwdUnder,
  classifyForWorktree,
  classifyOrphans,
  fullSuiteLockFiles,
  killProcs,
  selfAndAncestors,
  enumerateProcsFromSeam,
} from "../scripts/worktree-process-reaper.ts";
import { suiteLockSlotCount } from "../scripts/suite-lock-slots.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const CLI = join(repoRoot, "plugin", "scripts", "worktree-process-reaper.ts");

function run(args, env = {}) {
  const res = spawnSync("node", ["--no-warnings", "--experimental-strip-types", CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), `wt-reaper-${prefix}-`));
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

/** Seam record: `<pid>\0<cwd>\0<argv0>\0<state>\0<ppid>\0<fds>` */
function seamLine(pid, cwd, argv0, state = "S", ppid = 1, fds = "") {
  return [String(pid), cwd, argv0, state, String(ppid), fds].join("\0");
}

function writeSeam(dir, lines) {
  const seam = join(dir, "ps.txt");
  writeFileSync(seam, lines.join("\n") + "\n");
  return seam;
}

// ── 纯函数：cwd / argv0 分类 ─────────────────────────────────────────────────────────

test("splitCwd — strips the ' (deleted)' suffix and flags it (the orphan signature)", () => {
  assert.deepEqual(splitCwd("/x/y"), { path: "/x/y", deleted: false });
  assert.deepEqual(splitCwd("/x/y (deleted)"), { path: "/x/y", deleted: true });
  assert.deepEqual(splitCwd(null), { path: null, deleted: false });
});

test("isRealClaude — basename exactly `claude` (AC2: normal sessions never reaped); claude-probe is NOT claude", () => {
  assert.equal(isRealClaude("claude"), true);
  assert.equal(isRealClaude("/usr/bin/claude"), true);
  assert.equal(isRealClaude("claude-probe"), false);
  assert.equal(isRealClaude("bash"), false);
  assert.equal(isRealClaude(null), false);
});

test("isProbe — basename containing `claude-probe` (the exec -a claude-probe sleep fixture)", () => {
  assert.equal(isProbe("claude-probe"), true);
  assert.equal(isProbe("claude"), false);
  assert.equal(isProbe("sleep"), false);
  assert.equal(isProbe(null), false);
});

test("cwdUnder — exact workspace or beneath it, never a sibling", () => {
  assert.equal(cwdUnder("/a/b", "/a/b"), true);
  assert.equal(cwdUnder("/a/b/c", "/a/b"), true);
  assert.equal(cwdUnder("/a/other", "/a/b"), false);
  assert.equal(cwdUnder(null, "/a/b"), false);
});

// ── 纯函数：classifyForWorktree（--worktree 判定）────────────────────────────────────

test("classifyForWorktree — cwd-under, excludes real claude and the caller's own tree", () => {
  const exclude = new Set([999]);
  const procs = [
    { pid: 1, cwd: "/wt", cwdDeleted: false, argv0: "claude-probe", state: "S", ppid: 1, openFiles: [] },
    { pid: 2, cwd: "/wt/scripts", cwdDeleted: false, argv0: "bash", state: "S", ppid: 1, openFiles: [] },   // hung runner shape
    { pid: 3, cwd: "/wt", cwdDeleted: false, argv0: "claude", state: "S", ppid: 1, openFiles: [] },          // real claude → EXCLUDED (AC2)
    { pid: 999, cwd: "/wt", cwdDeleted: false, argv0: "sleep", state: "S", ppid: 1, openFiles: [] },         // the caller's own pid → EXCLUDED
    { pid: 5, cwd: "/elsewhere", cwdDeleted: false, argv0: "claude-probe", state: "S", ppid: 1, openFiles: [] }, // sibling → NOT matched
    { pid: 6, cwd: "/wt", cwdDeleted: true, argv0: "claude-probe", state: "S", ppid: 1, openFiles: [] },     // deleted cwd under wt → matched
  ];
  const hit = classifyForWorktree(procs, "/wt", exclude);
  const pids = hit.map((p) => p.pid).sort((a, b) => a - b);
  assert.deepEqual(pids, [1, 2, 6]);
});

// ── 纯函数：classifyOrphans（--orphans 判定）─────────────────────────────────────────

test("classifyOrphans — orphan probes (cwd deleted + claude-probe) + stale lock holders (cwd deleted + holds full-suite.lock)", () => {
  const lockFiles = ["/repo/.git/full-suite.lock.0", "/repo/.git/full-suite.lock.1"];
  const procs = [
    // orphan probe: cwd deleted + claude-probe argv0
    { pid: 1, cwd: "/wt", cwdDeleted: true, argv0: "claude-probe", state: "S", ppid: 1, openFiles: [] },
    // stale lock holder: cwd deleted + holds lock file open
    { pid: 2, cwd: "/wt", cwdDeleted: true, argv0: "bash", state: "S", ppid: 1, openFiles: ["/repo/.git/full-suite.lock.0"] },
    // REAL claude with deleted cwd holding the lock → EXCLUDED (AC2 — normal sessions are orphan-session-check's job)
    { pid: 3, cwd: "/wt", cwdDeleted: true, argv0: "claude", state: "S", ppid: 1, openFiles: ["/repo/.git/full-suite.lock.1"] },
    // deleted cwd but NOT a probe and NOT holding a lock → not matched
    { pid: 4, cwd: "/wt", cwdDeleted: true, argv0: "node", state: "S", ppid: 1, openFiles: [] },
    // LIVE cwd + holding the lock = a legitimately running suite → NEVER matched (live cwd has an owner)
    { pid: 5, cwd: "/wt", cwdDeleted: false, argv0: "bash", state: "S", ppid: 1, openFiles: ["/repo/.git/full-suite.lock.0"] },
    // the caller's own tree → excluded (own pid in the exclusion set)
    { pid: 999, cwd: "/wt", cwdDeleted: true, argv0: "claude-probe", state: "S", ppid: 1, openFiles: [] },
  ];
  const cls = classifyOrphans(procs, lockFiles, new Set([999]));
  assert.deepEqual(cls.probes.map((p) => p.pid), [1]);
  assert.deepEqual(cls.staleLockHolders.map((p) => p.pid), [2]);
});

test("fullSuiteLockFiles — derives <git-common-dir>/full-suite.lock.0..S-1 from a real git repo (S = configured slot count)", () => {
  const dir = tmp("git");
  try {
    const git = (args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    git(["init", "-q", "-b", "master"]);
    git(["config", "user.email", "t@t"]);
    git(["config", "user.name", "t"]);
    writeFileSync(join(dir, "a.txt"), "x\n");
    git(["add", "-A"]);
    git(["commit", "-qm", "x"]);
    const lockFiles = fullSuiteLockFiles(dir);
    // Adaptive to the configured slot count (gap-suite-lock-slot-seam-asymmetry AC2): S=1 ⇒ [.0] only,
    // S=2 ⇒ [.0,.1], S=3 ⇒ [.0,.1,.2] — no hardcoded 2-file assumption.
    assert.equal(lockFiles.length, suiteLockSlotCount(), `fullSuiteLockFiles derives S slot paths (S=${suiteLockSlotCount()}), got ${JSON.stringify(lockFiles)}`);
    lockFiles.forEach((f, i) => {
      assert.ok(f.endsWith(`/full-suite.lock.${i}`), `slot ${i} ends with /full-suite.lock.${i}, got ${f}`);
    });
  } finally {
    cleanup(dir);
  }
});

test("selfAndAncestors — includes the current pid and its ancestors (the reaper never kills its own tree)", () => {
  const set = selfAndAncestors();
  assert.ok(set.has(process.pid), "the reaper's own pid must be in the exclusion set");
});

// ── killProcs（fail-open，同 orphan-session-check 契约）───────────────────────────────

test("killProcs — already-exited pid counts as killed (fail-open); empty list is a no-op", () => {
  const res = killProcs([999999, 999998], 50);
  assert.equal(res.killed, 2);
  assert.equal(res.failed, 0);
  assert.deepEqual(killProcs([]), { killed: 0, sigkilled: 0, failed: 0 });
});

// ── CLI --worktree --list（seam：验证判定，真不杀）────────────────────────────────────

test("CLI --worktree --list — dry-run reports cwd-under targets, kills nothing (seam)", () => {
  const dir = tmp("list");
  try {
    const seam = writeSeam(dir, [
      seamLine(900001, "/wt", "claude-probe"),
      seamLine(900002, "/wt/sub", "bash"),
      seamLine(900003, "/wt", "claude"),            // real claude → excluded
      seamLine(900004, "/elsewhere", "claude-probe"), // sibling → excluded
    ]);
    const r = run(["--worktree", "/wt", "--list", "--json"], { WORKTREE_PROCESS_REAPER_PS_SOURCE: seam });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.mode, "worktree");
    assert.equal(out.dryRun, true);
    assert.equal(out.killed, 0); // 绝不真杀
    assert.deepEqual(out.pids.sort(), [900001, 900002]);
  } finally {
    cleanup(dir);
  }
});

test("CLI --orphans --list — dry-run reports orphan probes + stale lock holders, kills nothing (seam)", () => {
  const dir = tmp("orphlist");
  try {
    const gitDir = join(dir, "repo");
    mkdirSync(join(gitDir, ".git"), { recursive: true });
    const lock0 = join(gitDir, ".git", "full-suite.lock.0");
    const seam = writeSeam(dir, [
      seamLine(910001, "/deleted-wt (deleted)", "claude-probe"),
      seamLine(910002, "/deleted-wt (deleted)", "bash", "S", 1, lock0),  // stale lock holder
      seamLine(910003, "/deleted-wt (deleted)", "claude", "S", 1, lock0), // real claude → excluded
      seamLine(910004, "/live-wt", "claude-probe"),                        // live cwd → not orphaned
    ]);
    const r = run(["--orphans", "--root", gitDir, "--list", "--json"], { WORKTREE_PROCESS_REAPER_PS_SOURCE: seam });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.mode, "orphans");
    assert.equal(out.dryRun, true);
    assert.equal(out.killed, 0);
    assert.deepEqual(out.pids.sort(), [910001, 910002]);
    assert.deepEqual(out.probes.map((p) => p.pid), [910001]);
    assert.deepEqual(out.staleLockHolders.map((p) => p.pid), [910002]);
  } finally {
    cleanup(dir);
  }
});

test("CLI --orphans --stale-lock-holders-only — reclaims ONLY this root's stale lock holders, skips the global claude-probe sweep (fan-in-ff-merge scope, 2026-08-17)", () => {
  const dir = tmp("staleonly");
  try {
    const gitDir = join(dir, "repo");
    mkdirSync(join(gitDir, ".git"), { recursive: true });
    const lock0 = join(gitDir, ".git", "full-suite.lock.0");
    const seam = writeSeam(dir, [
      seamLine(920001, "/deleted-wt (deleted)", "claude-probe"),   // orphan probe → SKIPPED
      seamLine(920002, "/deleted-wt (deleted)", "bash", "S", 1, lock0), // stale lock holder → reclaimed
      seamLine(920003, "/deleted-wt (deleted)", "claude", "S", 1, lock0), // real claude → excluded
    ]);
    const r = run(["--orphans", "--stale-lock-holders-only", "--root", gitDir, "--json"], { WORKTREE_PROCESS_REAPER_PS_SOURCE: seam });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.mode, "orphans");
    assert.equal(out.dryRun, false);
    assert.deepEqual(out.pids, [920002], "only the stale lock holder is targeted, never an unrelated orphan probe");
    assert.deepEqual(out.probes.map((p) => p.pid), []);
    assert.deepEqual(out.staleLockHolders.map((p) => p.pid), [920002]);
  } finally {
    cleanup(dir);
  }
});

test("CLI — --stale-lock-holders-only without --orphans exits 2 (usage)", () => {
  const r = run(["--stale-lock-holders-only", "--root", "/x"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /requires --orphans/);
});

// ── CLI --worktree 真实 kill（端到端：claude-probe 杀、真实 claude 不杀 = AC2）──────────

test("CLI --worktree — real reaps a claude-probe fixture under the worktree, keeps a real claude session (AC2)", async () => {
  const dir = tmp("realkill");
  const wt = join(dir, "wt");
  mkdirSync(wt, { recursive: true });
  // claude-probe fixture with cwd under the worktree — should be reaped
  const probe = spawn("bash", ["-c", 'exec -a claude-probe sleep 10000'], { cwd: wt, stdio: "ignore", detached: false });
  // real claude session with cwd under the worktree — must NOT be reaped (AC2)
  const real = spawn("bash", ["-c", 'exec -a claude sleep 10000'], { cwd: wt, stdio: "ignore", detached: false });
  try {
    await sleep(300);
    assert.equal(probe.exitCode, null, "probe should still be running before the reaper");
    assert.equal(real.exitCode, null, "real claude should still be running before the reaper");
    const r = run(["--worktree", wt, "--json"]);
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.ok(out.killed >= 1, `must have killed the probe: ${r.stdout}`);
    await sleep(200);
    assert.ok(probe.exitCode !== null || probe.signalCode !== null, "claude-probe fixture must be dead after the reaper");
    assert.equal(real.exitCode, null, "real claude session must survive (AC2)");
  } finally {
    try { probe.kill("SIGKILL"); } catch (_) { /* best-effort */ }
    try { real.kill("SIGKILL"); } catch (_) { /* best-effort */ }
    cleanup(dir);
  }
});

// ── CLI --orphans 真实 kill（端到端：cwd 已删的孤儿探针被回收）────────────────────────

test("CLI --orphans — real reaps a probe whose cwd dir was deleted (the orphan signature)", async () => {
  const dir = tmp("realorph");
  const orphanDir = join(dir, "orphan-wt");
  mkdirSync(orphanDir, { recursive: true });
  // probe with cwd = orphanDir, then DELETE the dir → cwd becomes "<orphanDir> (deleted)"
  const probe = spawn("bash", ["-c", 'exec -a claude-probe sleep 10000'], { cwd: orphanDir, stdio: "ignore", detached: false });
  try {
    await sleep(300);
    rmSync(orphanDir, { recursive: true, force: true });
    await sleep(200);
    // confirm the cwd now carries the deleted suffix
    const cwdCheck = spawnSync("readlink", [`/proc/${probe.pid}/cwd`], { encoding: "utf8" });
    assert.ok((cwdCheck.stdout ?? "").includes("(deleted)"), `probe cwd should be deleted: ${cwdCheck.stdout}`);
    const r = run(["--orphans", "--root", dir, "--json"]);
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.ok(out.killed >= 1, `must have killed the orphan probe: ${r.stdout}`);
    await sleep(200);
    assert.ok(probe.exitCode !== null || probe.signalCode !== null, "orphan probe must be dead after the reaper");
  } finally {
    try { probe.kill("SIGKILL"); } catch (_) { /* best-effort */ }
    cleanup(dir);
  }
});

test("CLI — mutual exclusion of --orphans and --worktree exits 2 (usage)", () => {
  const r = run(["--orphans", "--worktree", "/x"]);
  assert.equal(r.status, 2);
});

test("enumerateProcsFromSeam — parses the NUL-separated seam records (cwd deleted flag + open fds)", () => {
  const dir = tmp("seam");
  try {
    const lock0 = "/repo/.git/full-suite.lock.0";
    const seam = writeSeam(dir, [
      seamLine(1, "/wt (deleted)", "claude-probe", "S", 1, ""),
      seamLine(2, "/wt", "bash", "S", 1, lock0),
    ]);
    const procs = enumerateProcsFromSeam(seam);
    assert.equal(procs.length, 2);
    assert.equal(procs[0].cwd, "/wt");
    assert.equal(procs[0].cwdDeleted, true);
    assert.equal(procs[1].cwdDeleted, false);
    assert.deepEqual(procs[1].openFiles, [lock0]);
  } finally {
    cleanup(dir);
  }
});
