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
  isQuayServe,
  readServeRegistration,
  classifyOrphanServes,
  isSelfRegisteredServe,
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

/** Seam record with the OPTIONAL 7th field (full argv as JSON) that `--orphan-serves` needs —
 *  argv0 alone is just the node binary, so it cannot identify a `quay … serve` host. */
function seamLineCmd(pid, cwd, argv0, state, ppid, fds, cmdline) {
  return [...seamLine(pid, cwd, argv0, state, ppid, fds).split("\0"), JSON.stringify(cmdline)].join("\0");
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
  const prevLock = process.env.FULL_SUITE_LOCK_FILE;
  const prevSeam = process.env.RESOURCE_GATE_CONCURRENT_SUITES;
  const prevKnob = process.env.QUAY_MAX_CONCURRENT_SUITES;
  try {
    const git = (args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    git(["init", "-q", "-b", "master"]);
    git(["config", "user.email", "t@t"]);
    git(["config", "user.name", "t"]);
    writeFileSync(join(dir, "a.txt"), "x\n");
    git(["add", "-A"]);
    git(["commit", "-qm", "x"]);
    // Hermetic against the PRODUCTION `.concurrency` scalar (gap-suite-slot-ssot-i5-false-positive):
    // suiteLockSlotCount() in the assertion resolves from the TEST process cwd (the worktree) and would
    // read the production <suiteLockBase>.concurrency (a live-suite S=1 file), shadowing the knob and
    // drifting from fullSuiteLockFiles(dir) (which resolves from the temp git repo). Pin the base to
    // THIS repo's common-dir and carry S=2 there so both sides deterministically read S=2.
    process.env.FULL_SUITE_LOCK_FILE = join(dir, ".git", "full-suite.lock");
    writeFileSync(join(dir, ".git", "full-suite.lock.concurrency"), "2", "utf8");
    delete process.env.RESOURCE_GATE_CONCURRENT_SUITES;
    process.env.QUAY_MAX_CONCURRENT_SUITES = "2";
    const lockFiles = fullSuiteLockFiles(dir);
    // Adaptive to the configured slot count (gap-suite-lock-slot-seam-asymmetry AC2): S=1 ⇒ [.0] only,
    // S=2 ⇒ [.0,.1], S=3 ⇒ [.0,.1,.2] — no hardcoded 2-file assumption.
    assert.equal(lockFiles.length, suiteLockSlotCount(), `fullSuiteLockFiles derives S slot paths (S=${suiteLockSlotCount()}), got ${JSON.stringify(lockFiles)}`);
    lockFiles.forEach((f, i) => {
      assert.ok(f.endsWith(`/full-suite.lock.${i}`), `slot ${i} ends with /full-suite.lock.${i}, got ${f}`);
    });
  } finally {
    if (prevLock === undefined) delete process.env.FULL_SUITE_LOCK_FILE;
    else process.env.FULL_SUITE_LOCK_FILE = prevLock;
    if (prevSeam === undefined) delete process.env.RESOURCE_GATE_CONCURRENT_SUITES;
    else process.env.RESOURCE_GATE_CONCURRENT_SUITES = prevSeam;
    if (prevKnob === undefined) delete process.env.QUAY_MAX_CONCURRENT_SUITES;
    else process.env.QUAY_MAX_CONCURRENT_SUITES = prevKnob;
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

// ── --orphan-serves：泄漏的 quay serve host（2026-09-17 全局 OOM 善后）────────────────
//
// 每个泄漏的 host 约占 0.65–1.7 GB RSS，几个就能把 16 GB 机器压进全局 OOM（实测：内核杀了
// dbus-daemon/systemd 与一批无关的 chrome）。根因（`bin/quay.js` shim 阻塞在 `spawnSync`，
// 因而永远无法转发那个杀掉它自己的信号）已在 shim 侧修掉；本模式是对其它来源的残留做防御性清扫。

test("isQuayServe — 认两个 serve 入口（quay.ts / quay.js），拒绝其它 node 程序与 null cmdline", () => {
  const entry = "/x/packages/quay/bin/quay.ts";
  assert.equal(isQuayServe(["node", "--experimental-strip-types", entry, "serve", "--port", "4173"]), true);
  assert.equal(isQuayServe(["node", "/x/packages/quay/bin/quay.js", "serve", "--port", "1"]), true);
  // serve 不是该入口的子命令 ⇒ 不是 host
  assert.equal(isQuayServe(["node", entry, "task", "list"]), false);
  // 有 serve 参数但入口不是 quay.{ts,js}
  assert.equal(isQuayServe(["node", "/x/other.js", "serve"]), false);
  // 读不到 argv 是「无法判断」——调用方必须给它独立取值，⛔ 不得折叠进这里的 false
  assert.equal(isQuayServe(null), false);
  assert.equal(isQuayServe([]), false);
});

test("readServeRegistration — 三态；载体指向已死的 pid 是 present 但 !alive", async () => {
  const dir = tmp("serve-reg");
  try {
    assert.equal(readServeRegistration(dir).state, "absent", "无载体 = absent");

    mkdirSync(join(dir, ".quay"), { recursive: true });
    writeFileSync(join(dir, ".quay", "server.json"), "{ not json");
    assert.equal(readServeRegistration(dir).state, "unreadable", "解析不了 = unreadable，⛔ 不是 absent");

    writeFileSync(join(dir, ".quay", "server.json"), JSON.stringify({ pid: process.pid }));
    const live = readServeRegistration(dir);
    assert.equal(live.state, "present");
    assert.equal(live.alive, true, "自己的 pid 必然存活");

    // 用一个【真实死掉】的 pid，而不是编一个大概率不存在的数字
    const child = spawn("sleep", ["0.05"]);
    const deadPid = child.pid;
    await sleep(400);
    writeFileSync(join(dir, ".quay", "server.json"), JSON.stringify({ pid: deadPid }));
    const dead = readServeRegistration(dir);
    assert.equal(dead.state, "present");
    assert.equal(dead.alive, false, "载体在、pid 死了 —— 这正是被瞬时 host 顶掉后的状态");
  } finally {
    cleanup(dir);
  }
});

test("classifyOrphanServes — 只回收【本仓库】的孤儿；登记不能担保时一律拒判", () => {
  const root = "/repo";
  const serve = ["node", "/repo/packages/quay/bin/quay.ts", "serve", "--host", "127.0.0.1", "--port", "37145"];
  const mk = (pid, cwd, ppid, cmdline) => ({
    pid, cwd, cwdDeleted: false, argv0: "node", state: "R", ppid, openFiles: [], cmdline,
  });
  const procs = [
    mk(100, root, 1, serve),                  // 登记在案的 host
    mk(101, root, 1, serve),                  // 本仓库孤儿            → 回收
    mk(102, "/other/repo", 1, serve),         // ⭐ 其它仓库的合法 serve → 绝不回收
    mk(103, root, 1, ["node", "/x/o.js"]),    // 不是 serve            → 不回收
    mk(104, root, 5, serve),                  // 父进程尚在（非孤儿）  → 不回收
  ];

  const ok = classifyOrphanServes(procs, { state: "present", pid: 100, alive: true }, new Set(), root);
  assert.equal(ok.notEvaluated, false);
  assert.deepEqual(
    ok.serves.map((p) => p.pid),
    [101],
    "只有同仓库的孤儿；102 是回归守卫 —— 它的缺席曾导致本工具杀掉线上 Web UI",
  );

  // 登记不能担保的三种形态：一律拒判 + 零目标（⛔ 与「判过且干净」不同形）
  for (const reg of [
    { state: "absent", pid: null, alive: false },
    { state: "unreadable", pid: null, alive: false },
    { state: "present", pid: 100, alive: false },
  ]) {
    const r = classifyOrphanServes(procs, reg, new Set(), root);
    assert.equal(r.notEvaluated, true, `${reg.state}/alive=${reg.alive} 必须拒判`);
    assert.deepEqual(r.serves, []);
    assert.ok(r.reason && r.reason.length > 0, "拒判必须给出可读原因");
  }
});

// ── 预览实例（goal preview，SPEC-goal-branch §4.10）：后台 serve 以【自身 root】的登记自证 ────────
//
// 预览 serve 与泄漏 host 在 /proc 里同形：都是 ppid === 1 的 `quay … serve`。分开二者的是
// 【它自己那个 root 的 .quay/server.json 有没有登记它】——`--root` 的登记担保不了别的 root。

test("isSelfRegisteredServe — 只认「自身 cwd 下 .quay/server.json 登记的正是这个 pid」", () => {
  const dir = tmp("selfreg");
  try {
    const p = (pid, cwd) => ({ pid, cwd, cwdDeleted: false, argv0: "node", state: "R", ppid: 1, openFiles: [], cmdline: null });
    // 无 carrier ⇒ 不担保
    assert.equal(isSelfRegisteredServe(p(201, dir)), false, "无 carrier 担保不了任何 pid");
    mkdirSync(join(dir, ".quay"), { recursive: true });
    writeFileSync(join(dir, ".quay", "server.json"), JSON.stringify({ pid: 201 }));
    assert.equal(isSelfRegisteredServe(p(201, dir)), true, "登记的就是它 ⇒ 自证");
    assert.equal(isSelfRegisteredServe(p(202, dir)), false, "登记的是别的 pid ⇒ 担保不了");
    assert.equal(isSelfRegisteredServe(p(201, null)), false, "cwd 读不到 ⇒ 无法担保");
  } finally {
    cleanup(dir);
  }
});

test("classifyOrphanServes — 预览 serve：①登记一致⇒豁免 ②pid 不一致⇒回收 ③无 carrier⇒回收 ④主 root 既有判定不变", () => {
  const dir = tmp("serve-preview");
  try {
    const root = join(dir, "main");
    const preview = join(root, "goal-preview-wt"); // 预览 worktree = root 下的另一个 workspace root
    mkdirSync(join(preview, ".quay"), { recursive: true });
    const carrier = join(preview, ".quay", "server.json");
    const serve = ["node", join(preview, "packages", "quay", "bin", "quay.ts"), "serve", "--port", "4180"];
    const mk = (pid, cwd) => ({ pid, cwd, cwdDeleted: false, argv0: "node", state: "R", ppid: 1, openFiles: [], cmdline: serve });
    const reg = { state: "present", pid: 100, alive: true };

    // ① 它自己 root 的 carrier 登记的就是它 ⇒ 不在回收集，且被【正面识别】
    writeFileSync(carrier, JSON.stringify({ pid: 201 }));
    let r = classifyOrphanServes([mk(201, preview)], reg, new Set(), root);
    assert.equal(r.notEvaluated, false);
    assert.deepEqual(r.serves.map((p) => p.pid), [], "自证的预览 host 不得被回收");
    assert.deepEqual(r.recognizedServes.map((p) => p.pid), [201], "豁免必须是【被识别】而非「够不着」（硬规则 3b）");

    // ② carrier 登记的是【别的】pid ⇒ 按泄漏回收
    writeFileSync(carrier, JSON.stringify({ pid: 999 }));
    r = classifyOrphanServes([mk(201, preview)], reg, new Set(), root);
    assert.deepEqual(r.serves.map((p) => p.pid), [201], "登记的不是它 ⇒ 按泄漏回收");
    assert.deepEqual(r.recognizedServes, []);

    // ③ 该目录没有 carrier ⇒ 无人担保 ⇒ 回收
    rmSync(carrier);
    r = classifyOrphanServes([mk(201, preview)], reg, new Set(), root);
    assert.deepEqual(r.serves.map((p) => p.pid), [201], "无 carrier 的 ppid-1 serve = 无主 ⇒ 回收");

    // ④ 主 root 登记宿主不回收、本 root 下无担保的孤儿回收 —— 既有判定不变
    const r4 = classifyOrphanServes([mk(100, root), mk(101, root)], reg, new Set(), root);
    assert.deepEqual(r4.serves.map((p) => p.pid), [101], "pid===reg.pid 的登记宿主不回收；本 root 下无担保者回收");
    assert.deepEqual(r4.recognizedServes, [], "主 root 的登记宿主走的是 reg.pid 这条路，不是自证那条");
  } finally {
    cleanup(dir);
  }
});

test("classifyOrphanServes — 命名空间（主检出之外的兄弟目录）内的预览 serve 同样自证豁免；无担保者照旧回收", () => {
  const dir = tmp("serve-ns");
  try {
    const root = join(dir, "main");
    const ns = join(dir, "worktrees");
    const preview = join(ns, "goal-GOAL-028");
    mkdirSync(join(preview, ".quay"), { recursive: true });
    writeFileSync(join(preview, ".quay", "server.json"), JSON.stringify({ pid: 201 }));
    const orphan = join(ns, "goal-GOAL-029"); // 命名空间内、但无 carrier
    mkdirSync(orphan, { recursive: true });
    const serve = ["node", "/x/packages/quay/bin/quay.ts", "serve", "--port", "1"];
    const mk = (pid, cwd) => ({ pid, cwd, cwdDeleted: false, argv0: "node", state: "R", ppid: 1, openFiles: [], cmdline: serve });
    const reg = { state: "present", pid: 100, alive: true };

    const r = classifyOrphanServes([mk(201, preview), mk(202, orphan), mk(203, "/other/repo")], reg, new Set(), root, ns);
    assert.deepEqual(r.serves.map((p) => p.pid), [202], "命名空间内无担保者回收；其它仓库够不着 ⇒ 绝不动");
    assert.deepEqual(r.recognizedServes.map((p) => p.pid), [201], "命名空间内的自证预览 host 豁免");
  } finally {
    cleanup(dir);
  }
});

test("CLI --orphan-serves --list — 只报本仓库泄漏的 host（seam，不触碰真实进程）", () => {
  const dir = tmp("serve-reap");
  try {
    mkdirSync(join(dir, ".quay"), { recursive: true });
    writeFileSync(join(dir, ".quay", "server.json"), JSON.stringify({ pid: process.pid }));
    const serve = ["node", "/x/quay.ts", "serve", "--port", "1"];
    const seam = writeSeam(dir, [
      seamLineCmd(101, dir, "node", "R", 1, "", serve),
      seamLineCmd(102, "/other/repo", "node", "R", 1, "", serve),
    ]);
    const res = run(["--orphan-serves", "--root", dir, "--list", "--json"], {
      WORKTREE_PROCESS_REAPER_PS_SOURCE: seam,
    });
    assert.equal(res.status, 0, res.stderr);
    const payload = JSON.parse(res.stdout);
    assert.equal(payload.mode, "orphan-serves");
    assert.equal(payload.found, 1);
    assert.deepEqual(payload.pids, [101]);
    assert.equal(payload.serveNotEvaluated, false);
  } finally {
    cleanup(dir);
  }
});

test("CLI --orphan-serves — 命名空间里的预览 root 自证 ⇒ 豁免并计入 recognizedServes；同命名空间内无担保者仍回收", () => {
  const dir = tmp("serve-preview-cli");
  try {
    const root = join(dir, "main");
    mkdirSync(join(root, ".quay"), { recursive: true });
    writeFileSync(join(root, ".quay", "server.json"), JSON.stringify({ pid: process.pid }));
    // 命名空间由 .quay/config.yml 的 loop.worktree_root 解析（单一解析入口，不是字面量）
    const ns = join(dir, "worktrees");
    writeFileSync(join(root, ".quay", "config.yml"), `loop:\n  worktree_root: ${ns}\n`);
    // 预览 worktree 在主检出【之外】（兄弟目录），其 .quay/server.json 由预览 serve 自己写
    const preview = join(ns, "goal-GOAL-028");
    mkdirSync(join(preview, ".quay"), { recursive: true });
    writeFileSync(join(preview, ".quay", "server.json"), JSON.stringify({ pid: 201 }));

    const serve = ["node", "/x/packages/quay/bin/quay.ts", "serve", "--port", "1"];
    const seam = writeSeam(dir, [
      seamLineCmd(201, preview, "node", "R", 1, "", serve), // 自证的预览 host → 豁免
      seamLineCmd(202, join(ns, "goal-GOAL-029"), "node", "R", 1, "", serve), // 无 carrier → 回收
      seamLineCmd(203, "/other/repo", "node", "R", 1, "", serve), // 其它仓库 → 够不着
    ]);
    const res = run(["--orphan-serves", "--root", root, "--list", "--json"], { WORKTREE_PROCESS_REAPER_PS_SOURCE: seam });
    assert.equal(res.status, 0, res.stderr);
    const payload = JSON.parse(res.stdout);
    assert.deepEqual(payload.pids, [202], "只有命名空间内无担保的那一个在回收集");
    assert.deepEqual(payload.recognizedServes.map((p) => p.pid), [201], "自证的预览 host 被正面识别，不是静默丢弃");
    // 人类可读输出也要说清「豁免了几个」——否则「判过且干净」与「豁免了预览实例」同形（硬规则 3b）
    const text = run(["--orphan-serves", "--root", root, "--list"], { WORKTREE_PROCESS_REAPER_PS_SOURCE: seam });
    assert.match(text.stdout, /1 self-registered host\(s\) spared/, text.stdout);
  } finally {
    cleanup(dir);
  }
});

test("CLI --orphan-serves — 登记陈旧时打印 NOT-EVALUATED 且零杀（seam）", () => {
  const dir = tmp("serve-stale");
  try {
    mkdirSync(join(dir, ".quay"), { recursive: true });
    writeFileSync(join(dir, ".quay", "server.json"), JSON.stringify({ pid: 4194305 }));
    const serve = ["node", "/x/quay.ts", "serve", "--port", "1"];
    const seam = writeSeam(dir, [seamLineCmd(101, dir, "node", "R", 1, "", serve)]);
    const res = run(["--orphan-serves", "--root", dir], {
      WORKTREE_PROCESS_REAPER_PS_SOURCE: seam,
    });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /NOT-EVALUATED/, "拒判必须与「判过且干净」输出不同形（硬规则 3b）");
    assert.match(res.stdout, /0 reaped/);
  } finally {
    cleanup(dir);
  }
});
