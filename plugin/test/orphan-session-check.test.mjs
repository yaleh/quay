// @test-group engine
// orphan-session-check.test.mjs — tasks/gap-suite-leaks-live-claude-sessions.
// 套件/teardown 泄漏活 Claude 会话（4 孤儿 109-120h）的孤儿检测器。测试钉住
// plugin/scripts/orphan-session-check.ts：枚举 `claude --settings <path>` 进程、按工作区目录是否
// 存在分孤儿/活、`--json` 门（orphan_count>0 ⇒ exit 1 红）、`--kill-workspace <p>` 回收进程、以及
// 崩溃后恢复裁定新增的 `--list`/`--dry-run`（验证闸门逻辑但真不杀任何东西）。
//
// Coverage map (task ACs + 裁定):
//   AC3 — 孤儿检测器：枚举 claude --settings 进程，工作区目录不存在计孤儿，孤儿>0 即红。
//   Dispatch review 追加（2026-08-12 崩溃后）：
//     - 保留 orphan-session-check.ts 检测器本体
//     - 丢弃 full-suite-runner.ts 的 reclaimFixtureSessions（闸门比 self 不比活循环检出）
//     - 补 list-only/dry-run（--list），验证闸门逻辑不需要真杀任何东西
//     - 负控制不固化进套件
// 按位置判定 — argv 里的 `claude --settings` 字符串不算命中；只有 argv[0] basename === `claude`
// 且真实携带 `--settings` flag 的进程才进分类。
//
// Fixtures are self-contained: ORPHAN_SESSION_CHECK_PS_SOURCE seam 注入伪造进程表（每行
// `<pid>\0<argv[0]>\0<argv[1]>\0...`），孤儿/活的判定用真实 tmpdir（live 目录存在 / orphan 目录不存在）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifyArgv,
  workspaceRootOf,
  isOrphan,
  classifySessions,
  sessionsUnderWorkspace,
  killProcs,
} from "../scripts/orphan-session-check.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const CLI = join(repoRoot, "plugin", "scripts", "orphan-session-check.ts");

function run(args, env = {}) {
  const res = spawnSync("node", ["--no-warnings", "--experimental-strip-types", CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), `orphan-session-${prefix}-`));
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

// ── seam fixture: 每行 `<pid>\0<argv[0]>\0<argv[1]>\0...` ──────────────────────────────────────────
function seamLine(pid, argv) {
  return [String(pid), ...argv].join("\0");
}

// ── classifyArgv（纯函数：argv 形态 → 分类）──────────────────────────────────────────────────────────

test("classifyArgv — only basename `claude` + a real --settings flag is classified", () => {
  const hit = classifyArgv(["claude", "--settings", "/ws/.claude/launch.settings.json"], 100);
  assert.equal(hit?.settingsKind, "path");
  assert.equal(hit?.workspace, "/ws");

  // 非 claude 进程（bash 包装 / claude-probe / node cli.js）⇒ null
  assert.equal(classifyArgv(["bash", "claude", "--settings", "/x"], 101), null);
  assert.equal(classifyArgv(["claude-probe", "--settings", "/x"], 102), null);
  assert.equal(classifyArgv(["node", "cli.js", "--settings", "/x"], 103), null);

  // 无 --settings flag ⇒ null
  assert.equal(classifyArgv(["claude"], 104), null);
});

test("classifyArgv — inline-json --settings (no filesystem workspace) is never an orphan candidate", () => {
  const p = classifyArgv(["claude", "--settings", '{"project":"p"}'], 105);
  assert.equal(p?.settingsKind, "inline-json");
  assert.equal(p?.workspace, null);
});

test("classifyArgv — missing/empty --settings value ⇒ settingsKind=missing", () => {
  const p = classifyArgv(["claude", "--settings", ""], 106);
  assert.equal(p?.settingsKind, "missing");
  assert.equal(p?.workspace, null);
});

test("workspaceRootOf — <ws>/.claude/launch.settings.json → <ws>; other path → its dirname", () => {
  assert.equal(workspaceRootOf("/a/b/.claude/launch.settings.json"), "/a/b");
  assert.equal(workspaceRootOf("/a/b/other.json"), "/a/b");
});

// ── isOrphan / classifySessions（孤儿 vs 活的判定，基于真实 fs）────────────────────────────────────

test("isOrphan — path-kind with a deleted workspace dir is an orphan; existing dir is live", () => {
  const dir = tmp("live");
  try {
    const live = { settingsKind: "path", workspace: dir } ;
    const orphan = { settingsKind: "path", workspace: join(dir, "does-not-exist") };
    const inline = { settingsKind: "inline-json", workspace: null };
    assert.equal(isOrphan(live), false);
    assert.equal(isOrphan(orphan), true);
    assert.equal(isOrphan(inline), false);
  } finally {
    cleanup(dir);
  }
});

test("classifySessions — partitions orphans vs live vs inline-json vs missing", () => {
  const dir = tmp("cls");
  try {
    const procs = [
      { pid: 1, settingsKind: "path", workspace: dir },        // live（目录存在）
      { pid: 2, settingsKind: "path", workspace: join(dir, "gone") }, // orphan
      { pid: 3, settingsKind: "inline-json", workspace: null },
      { pid: 4, settingsKind: "missing", workspace: null },
    ];
    const c = classifySessions(procs);
    assert.equal(c.total, 4);
    assert.equal(c.pathKind, 2);
    assert.equal(c.inlineJson, 1);
    assert.equal(c.missing, 1);
    assert.equal(c.orphanCount, 1);
    assert.equal(c.orphans[0].pid, 2);
    assert.equal(c.live[0].pid, 1);
  } finally {
    cleanup(dir);
  }
});

test("sessionsUnderWorkspace — exact workspace or a path beneath it; never a sibling", () => {
  const procs = [
    { workspace: "/a/b" },
    { workspace: "/a/b/c" },
    { workspace: "/a/other" },
    { workspace: null },
  ];
  const under = sessionsUnderWorkspace(procs, "/a/b");
  assert.deepEqual(under.map((p) => p.workspace), ["/a/b", "/a/b/c"]);
});

test("killProcs — already-exited pid counts as killed (fail-open); empty list is a no-op", () => {
  // 999999/999998 不存在 ⇒ process.kill 抛 ESRCH ⇒ 记为 killed（已消失，非错误）。
  const res = killProcs([999999, 999998], 50);
  assert.equal(res.killed, 2);
  assert.equal(res.failed, 0);
  assert.deepEqual(killProcs([]), { killed: 0, sigkilled: 0, failed: 0 });
});

// ── CLI --json（AC3：orphan>0 ⇒ exit 1 红）─────────────────────────────────────────────────────────

test("CLI --json — orphan under a deleted workspace ⇒ exit 1, orphan_count>0", () => {
  const dir = tmp("json");
  try {
    const ws = join(dir, "deleted-ws");
    const seam = join(dir, "ps.txt");
    writeFileSync(seam, seamLine(999001, ["claude", "--settings", join(ws, ".claude/launch.settings.json")]) + "\n");
    const r = run(["--json"], { ORPHAN_SESSION_CHECK_PS_SOURCE: seam });
    assert.equal(r.status, 1, `expected exit 1:\n${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.orphan_count, 1);
    assert.equal(out.total, 1);
    assert.equal(out.orphans.length, 1);
  } finally {
    cleanup(dir);
  }
});

test("CLI --json — live workspace ⇒ exit 0, orphan_count=0 (no false red)", () => {
  const dir = tmp("jsonlive");
  const liveWs = join(dir, "live-ws");
  mkdirSync(liveWs, { recursive: true });
  try {
    const seam = join(dir, "ps.txt");
    writeFileSync(seam, seamLine(999002, ["claude", "--settings", join(liveWs, ".claude/launch.settings.json")]) + "\n");
    const r = run(["--json"], { ORPHAN_SESSION_CHECK_PS_SOURCE: seam });
    assert.equal(r.status, 0, `expected exit 0:\n${r.stdout}\n${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.orphan_count, 0);
    assert.equal(out.live.length, 1);
  } finally {
    cleanup(dir);
  }
});

// ── CLI --kill-workspace 的 --list / --dry-run（崩溃恢复裁定新增：验证闸门逻辑，真不杀）───────────────

test("CLI --kill-workspace <p> --list — dry-run prints the target sessions, kills nothing", () => {
  const dir = tmp("dryrun");
  const ws = join(dir, "ws");
  mkdirSync(ws, { recursive: true });
  try {
    const seam = join(dir, "ps.txt");
    writeFileSync(seam, seamLine(999003, ["claude", "--settings", join(ws, ".claude/launch.settings.json")]) + "\n");
    const r = run(["--kill-workspace", ws, "--list"], { ORPHAN_SESSION_CHECK_PS_SOURCE: seam });
    assert.equal(r.status, 0, `expected exit 0:\n${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.dryRun, true);
    assert.equal(out.found, 1);
    assert.equal(out.killed, 0); // 绝不真杀
    assert.equal(out.sigkilled, 0);
    assert.equal(out.failed, 0);
    assert.deepEqual(out.pids, [999003]);
    assert.equal(out.sessions.length, 1);
    assert.equal(out.sessions[0].pid, 999003);
  } finally {
    cleanup(dir);
  }
});

test("CLI --kill-workspace <p> --dry-run — --dry-run is an accepted alias for --list", () => {
  const dir = tmp("alias");
  const ws = join(dir, "ws");
  mkdirSync(ws, { recursive: true });
  try {
    const seam = join(dir, "ps.txt");
    writeFileSync(seam, seamLine(999004, ["claude", "--settings", join(ws, ".claude/launch.settings.json")]) + "\n");
    const r = run(["--kill-workspace", ws, "--dry-run"], { ORPHAN_SESSION_CHECK_PS_SOURCE: seam });
    assert.equal(r.status, 0);
    assert.equal(JSON.parse(r.stdout).dryRun, true);
    assert.equal(JSON.parse(r.stdout).killed, 0);
  } finally {
    cleanup(dir);
  }
});

test("CLI --kill-workspace <p> (no --list) — real reclaim of seam pids is fail-open, exit 0", () => {
  const dir = tmp("kill");
  const ws = join(dir, "ws");
  mkdirSync(ws, { recursive: true });
  try {
    const seam = join(dir, "ps.txt");
    // seam pid 999005 不存在 ⇒ SIGTERM 抛 ESRCH ⇒ 记为已消失（killed），绝不停留在真实进程上。
    writeFileSync(seam, seamLine(999005, ["claude", "--settings", join(ws, ".claude/launch.settings.json")]) + "\n");
    const r = run(["--kill-workspace", ws], { ORPHAN_SESSION_CHECK_PS_SOURCE: seam });
    assert.equal(r.status, 0, `expected exit 0:\n${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.dryRun, false);
    assert.equal(out.found, 1);
    assert.ok(out.killed >= 1);
  } finally {
    cleanup(dir);
  }
});

test("CLI --kill-workspace with a non-root/empty path exits 2 (usage)", () => {
  const r = run(["--kill-workspace", "/"]);
  assert.equal(r.status, 2);
});
