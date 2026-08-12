// @test-group engine
// manager-tick-readings.test.mjs — the manager tick's single-command mechanical readings
// (tasks/gap-manager-tick-mechanical-checks-are-eight-loose-bash-blocks-in-prose.md AC1-AC5).
// PURE-IMPORT: imports the module, injects the tmux/git seams and fake /proc dirs — zero subprocesses.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PROJECTS,
  parseProjects,
  defaultTmuxSocket,
  tmuxListPanes,
  remoteTmuxListPanes,
  projectStatus,
  resourceReadings,
  outerReadings,
  latestTickLog,
  latestTickLogReading,
  readStat,
  monitorInstances,
  entryLastCommitEpoch,
  goalReading,
  render,
  renderSelected,
} from "../scripts/manager-tick-readings.ts";

function tmpdir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mtr-test-"));
  t.after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });
  return dir;
}

function write(root, rel, content) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

/** 构造 /proc/<pid>/stat：rest 字段到 starttime(rest[19])。 */
function statLine(pid, comm, ppid, starttime) {
  const rest = Array(20).fill("0");
  rest[0] = "S"; // state (field 3)
  rest[1] = String(ppid); // field 4
  rest[19] = String(starttime); // field 22
  return `${pid} (${comm}) ${rest.join(" ")}`;
}

const SCRIPT = fileURLToPath(new URL("../scripts/manager-tick-readings.ts", import.meta.url));

test("manager-tick-readings: parseProjects defaults to the quay network and honors MTR_PROJECTS", () => {
  assert.equal(DEFAULT_PROJECTS.length, 3);
  assert.equal(parseProjects({}).length, 3);
  assert.deepEqual(parseProjects({ MTR_PROJECTS: "foo=/tmp/foo bar=/tmp/bar" }), [
    { name: "foo", dir: "/tmp/foo" },
    { name: "bar", dir: "/tmp/bar" },
  ]);
});

test("manager-tick-readings: tmux socket follows session-liveness's TMUX_TMPDIR mechanism", () => {
  assert.equal(defaultTmuxSocket({ TMUX_TMPDIR: "/tmp/tt", TMPDIR: "/tmp" }), `/tmp/tt/tmux-${process.getuid()}/default`);
  assert.equal(defaultTmuxSocket({ TMPDIR: "/var/tmp" }), `/var/tmp/tmux-${process.getuid()}/default`);
});

test("manager-tick-readings: tmuxListPanes parses the read-only -F shape (AC4 identity fields)", () => {
  const env = { MTR_TMUX_LIST_PANES: "quay-0:outer\t2989418\tclaude\nquay-0:inner\t2989409\tclaude\n" };
  const panes = tmuxListPanes("/sock", env);
  assert.equal(panes.length, 2);
  assert.deepEqual(panes[0], { session: "quay-0", window: "outer", panePid: "2989418", cmd: "claude" });
});

test("manager-tick-readings: projectStatus reads .halt presence and first line", (t) => {
  const dir = tmpdir(t);
  assert.equal(projectStatus({ name: "x", dir }), "running");
  write(dir, ".halt", "HALTED by manager\n更多\n");
  const s = projectStatus({ name: "x", dir });
  assert.ok(s.startsWith("paused: HALTED by manager"), s);
  assert.equal(projectStatus({ name: "x", dir: "" }), "no-dir");
});

test("manager-tick-readings: resourceReadings counts node by pgrep semantics (comm regex) excluding self", (t) => {
  const dir = tmpdir(t);
  const proc = path.join(dir, "proc");
  write(proc, "pressure/cpu", "some avg10=61.28 avg60=1.00 avg300=1.00 total=0");
  write(proc, "loadavg", "7.23 1.11 1.00 3/456 78901");
  write(proc, "meminfo", "MemTotal:       32000000 kB\nMemAvailable:    28211200 kB\n");
  // 两个 node 进程（comm=node-MainThread，pgrep node 会命中）+ 一个 bash
  write(proc, "101/comm", "node-MainThread");
  write(proc, "102/comm", "node-MainThread");
  write(proc, "103/comm", "bash");
  const r = resourceReadings(proc, 9999);
  assert.equal(r.cpuSomeAvg10, "61.28");
  assert.equal(r.load1, "7.23");
  assert.equal(r.nodeCount, 2);
  assert.equal(r.memAvailMb, 27550); // 28211200 kB / 1024
});

test("manager-tick-readings: outerReadings reports window-missing as a labeled line, not silence (AC3)", () => {
  const panes = [{ session: "quay-0", window: "outer", panePid: "2989418", cmd: "claude" }];
  const out = outerReadings(DEFAULT_PROJECTS, panes);
  assert.equal(out.length, 3); // 三项目各一行，不缺行
  assert.deepEqual(out[0], { project: "quay", target: "quay-0:outer", exists: true, panePid: "2989418", cmd: "claude", host: "", session: "quay" });
  assert.equal(out[1].exists, false);
  assert.equal(out[2].exists, false);
  assert.equal(out[1].target, "archguard:outer");
});

test("manager-tick-readings: outerReadings resolves cross-host archguard by configured session, not hardcoded prefix (缺陷②/AC3)", () => {
  const projects = [
    { name: "quay", dir: "/x" },
    { name: "archguard", dir: "/x", session: "archguard-0", host: "ad-arm1.wan.hwang.men" },
  ];
  const local = [{ session: "quay-0", window: "outer", panePid: "1", cmd: "claude" }];
  const remote = [{ session: "archguard-0", window: "outer", panePid: "295132", cmd: "claude" }];
  const out = outerReadings(projects, (p) => (p.host ? remote : local));
  assert.equal(out.length, 2);
  assert.deepEqual(out[1], {
    project: "archguard", target: "archguard-0:outer", exists: true, panePid: "295132", cmd: "claude",
    host: "ad-arm1.wan.hwang.men", session: "archguard-0",
  });
  // 负控制：远端只有 archguard-1，配置说 archguard-0 ⇒ 仍 window-missing（会话名从配置取，不 prefix 推导）
  const remoteWrong = [{ session: "archguard-1", window: "outer", panePid: "9", cmd: "claude" }];
  const out2 = outerReadings(projects, (p) => (p.host ? remoteWrong : local));
  assert.equal(out2[1].exists, false);
  assert.equal(out2[1].target, "archguard:outer");
});

test("manager-tick-readings: remoteTmuxListPanes honors the MTR_REMOTE_TMUX_LIST_PANES seam (cross-host tmux read-only)", () => {
  const env = { MTR_REMOTE_TMUX_LIST_PANES: "archguard-0:outer\t295132\tclaude\narchguard-0:inner\t307974\tclaude\n" };
  const panes = remoteTmuxListPanes("ad-arm1.wan.hwang.men", env);
  assert.equal(panes.length, 2);
  assert.deepEqual(panes[0], { session: "archguard-0", window: "outer", panePid: "295132", cmd: "claude" });
});

test("manager-tick-readings: latestTickLog handles quay dated format and archguard table format", (t) => {
  const quay = { name: "quay", dir: tmpdir(t) };
  const longLine = "| 2026-08-07 04:39Z | `no-action` | " + "很长".repeat(120);
  write(quay.dir, "orchestration/tick-log.md", "# log\n\n" + longLine + "\n| 2026-08-07 03:00Z | older\n");
  const ql = latestTickLog(quay);
  assert.ok(ql.startsWith("| 2026-08-07 04:39Z"), ql);
  assert.ok(ql.endsWith("...") && ql.length === 200, ql.length);

  const arch = { name: "archguard", dir: tmpdir(t) };
  write(arch.dir, "orchestration/tick-log.md", "# Tick Log\n\n| 类型 | 计数 |\n|---|---|\n\n| 1 | 09:53Z | first\n| 2 | 10:05Z | second\n| 145 | 11:30Z | newest\n");
  assert.ok(latestTickLog(arch).startsWith("| 145 | 11:30Z"), latestTickLog(arch));

  const none = { name: "none", dir: tmpdir(t) };
  write(none.dir, "orchestration/tick-log.md", "# nothing\n");
  assert.equal(latestTickLog(none), "no-tick-row");
  assert.equal(latestTickLog({ name: "x", dir: "" }), "no-dir");
});

test("manager-tick-readings: latestTickLog returns the newest dated row across eras, not the stale old-format one (缺陷①/AC2)", (t) => {
  // 真实 quay 形状：旧倒序表 + `> **` inner tick + 新 `## YYYY-MM-DD HH:MMZ tick` 节（追加顺序）。
  // 修复前 `grep '^| 2026'` 稳定返回 08-09 陈旧行；修复后必须取全局最新 = 08-12 节。
  const quay = { name: "quay", dir: tmpdir(t) };
  write(quay.dir, "orchestration/tick-log.md", [
    "# 外层 tick 记录",
    "| 2026-08-09 10:04Z | `correct` | round-162 红…",
    "> **02:1xZ inner tick（capability-catalog 真测试失败）**:",
    "## 2026-08-12 03:2xZ tick — #50 fan-in 完成（compound 死锁解除）; #54 派发",
    "- **#54 派发**：gap-manager-tick-readings-stale-readings",
  ].join("\n"));
  const row = latestTickLog(quay);
  assert.ok(row.includes("2026-08-12"), row);
  assert.ok(row.startsWith("## 2026-08-12 03:2xZ"), row);
  const r = latestTickLogReading(quay);
  assert.equal(r.freshness, "dated");
});

test("manager-tick-readings: latestTickLog falls back to mtime for an undated positional winner (AC2)", (t) => {
  // 只有无日期行（如 archguard 表 / 无日期 ## 节）且文件 mtime 可得 ⇒ positional，返回该行。
  const p = { name: "archguard", dir: tmpdir(t) };
  write(p.dir, "orchestration/tick-log.md", "| 1 | 09:53Z | first\n| 145 | 11:30Z | newest\n");
  const r = latestTickLogReading(p, { mtimeEpoch: 1786000000 });
  assert.equal(r.freshness, "positional");
  assert.ok(r.row.startsWith("| 145 | 11:30Z"), r.row);
  assert.ok(latestTickLog(p).startsWith("| 145 | 11:30Z"), latestTickLog(p));
});

test("manager-tick-readings: latestTickLog emits stale-unknown when the newest row is undated and mtime is unavailable (AC2 invariant)", (t) => {
  // 无日期行 + 无 mtime 锚定 ⇒ 无法确定新鲜度，显式 stale-unknown（绝不返回「看似正常」的旧行）。
  const p = { name: "x", dir: tmpdir(t) };
  write(p.dir, "orchestration/tick-log.md", "> **02:1xZ inner tick（…）**:\n## 03:0xZ tick — 无日期节\n");
  assert.equal(latestTickLogReading(p, { mtimeEpoch: 0 }).row, "stale-unknown");
  assert.equal(latestTickLog(p, 200, { mtimeEpoch: 0 }), "stale-unknown");
  // mtime 可得 ⇒ 同一文件返回该行（positional），不再是 stale-unknown
  assert.equal(latestTickLogReading(p, { mtimeEpoch: 1786000000 }).freshness, "positional");
});

test("manager-tick-readings: readStat parses ppid + starttime→epoch via btime", (t) => {
  const dir = tmpdir(t);
  const proc = path.join(dir, "proc");
  write(proc, "stat", "btime 1000000\n");
  write(proc, "100/stat", statLine(100, "bash", 99, 500000));
  const s = readStat(100, proc);
  assert.equal(s.ppid, 99);
  assert.equal(s.startEpoch, 1000000 + 5000); // starttime/HZ = 5000
});

test("manager-tick-readings: monitorInstances finds bash session-liveness.sh by argv basename (AC2 self-match safe)", (t) => {
  const dir = tmpdir(t);
  const proc = path.join(dir, "proc");
  write(proc, "stat", "btime 1000000\n");
  write(proc, "100/stat", statLine(100, "bash", 1, 500000));
  write(proc, "100/cmdline", "bash\0/home/yale/work/quay/plugin/scripts/session-liveness.sh\0--once\0");
  // argv[0]=node → 不匹配；argv[1] basename 不对 → 不匹配
  write(proc, "200/stat", statLine(200, "node", 1, 100000));
  write(proc, "200/cmdline", "node\0--experimental-strip-types\0/session-liveness.sh\0");
  write(proc, "300/stat", statLine(300, "bash", 1, 900000));
  write(proc, "300/cmdline", "bash\0/opt/quay/plugin/scripts/session-liveness.sh\0");
  const ms = monitorInstances(2000000, proc);
  assert.equal(ms.length, 2);
  assert.deepEqual(ms.map((m) => m.pid), [100, 300]);
  assert.equal(ms[0].stale, true); // start=1005000 < 2000000
  assert.equal(ms[1].stale, true); // start=1009000 < 2000000
  assert.equal(ms[0].ppid, 1);
});

test("manager-tick-readings: entryLastCommitEpoch honors the git seam", () => {
  assert.equal(entryLastCommitEpoch("/x", { MTR_ENTRY_LAST_COMMIT: "1786055547" }), 1786055547);
  assert.equal(entryLastCommitEpoch("/x", { MTR_ENTRY_LAST_COMMIT: "junk" }), 0);
});

test("manager-tick-readings: goalReading counts checked/total ACs in manager-phase-goal.md", (t) => {
  const dir = tmpdir(t);
  write(dir, "orchestration/manager-phase-goal.md", "# goal\n- [x] a\n- [ ] b\n- [x] c\n");
  const g = goalReading(dir);
  assert.deepEqual(g, { total: 3, checked: 2, file: path.join(dir, "orchestration", "manager-phase-goal.md") });
  assert.deepEqual(goalReading(path.join(dir, "none")), { total: 0, checked: 0, file: "no-manager-phase-goal.md" });
});

test("manager-tick-readings: render emits the full fixed labeled structure (AC3 one command, no silent absence)", (t) => {
  const dir = tmpdir(t);
  const env = {
    MTR_PROJECTS: "quay=" + dir,
    MTR_TMUX_LIST_PANES: "quay-0:outer\t2989418\tclaude\n",
    MTR_ENTRY_LAST_COMMIT: "2000000",
  };
  write(dir, ".halt", "paused msg");
  write(dir, "orchestration/tick-log.md", "| 2026-08-07 04:39Z | `no-action` | hello\n");
  write(dir, "orchestration/manager-phase-goal.md", "- [x] a\n- [ ] b\n");
  const out = render(parseProjects(env), { socket: "/sock", repoRoot: dir, env });
  const lines = out.trim().split("\n");
  // 每个标签族都必须出现 —— 缺一个即该机械项被跳过（可被机械检出）
  assert.ok(lines.some((l) => l.startsWith("project.status quay ")), lines.join(";"));
  assert.ok(lines.some((l) => l.startsWith("resource.cpu_some_avg10 ")), lines.join(";"));
  assert.ok(lines.some((l) => l.startsWith("resource.load1 ")), lines.join(";"));
  assert.ok(lines.some((l) => l.startsWith("resource.node_count ")), lines.join(";"));
  assert.ok(lines.some((l) => l.startsWith("resource.mem_available_mb ")), lines.join(";"));
  assert.ok(lines.some((l) => l.startsWith("outer.liveness quay-0:outer ")), lines.join(";"));
  assert.ok(lines.some((l) => l.startsWith("outer.ticklog quay ")), lines.join(";"));
  assert.ok(lines.some((l) => l.startsWith("goal.phase_ac_checked ")), lines.join(";"));
  assert.ok(lines.some((l) => l.startsWith("monitor.mounted ")), lines.join(";"));
  assert.ok(lines.some((l) => l.startsWith("monitor.instances ")), lines.join(";"));
  assert.ok(lines.some((l) => l.startsWith("monitor.entry_last_commit ")), lines.join(";"));
});

test("manager-tick-readings: render resolves archguard liveness cross-host via MTR_REMOTE_TMUX_LIST_PANES (缺陷②/AC3)", (t) => {
  const dir = tmpdir(t);
  const env = {
    MTR_PROJECTS: "quay=" + dir + " archguard=" + dir + ":archguard-0:ad-arm1.wan.hwang.men",
    MTR_TMUX_LIST_PANES: "quay-0:outer\t2989418\tclaude\n",
    MTR_REMOTE_TMUX_LIST_PANES: "archguard-0:outer\t295132\tclaude\n",
  };
  write(dir, "orchestration/tick-log.md", "# log\n");
  const out = render(parseProjects(env), { socket: "/sock", repoRoot: dir, env });
  assert.ok(out.includes("outer.liveness quay-0:outer alive pane_pid=2989418 cmd=claude"), out);
  assert.ok(out.includes("outer.liveness archguard-0:outer alive pane_pid=295132 cmd=claude host=ad-arm1.wan.hwang.men"), out);
  assert.ok(!out.includes("outer.liveness archguard:outer window-missing"), out);
});

test("manager-tick-readings: renderSelected emits targeted outer.ticklog / outer.liveness readings (Contract invoke)", (t) => {
  const dir = tmpdir(t);
  const env = {
    MTR_PROJECTS: "quay=" + dir + " archguard=" + dir + ":archguard-0:ad-arm1.wan.hwang.men meta-cc=" + dir,
    MTR_TMUX_LIST_PANES: "quay-0:outer\t2989418\tclaude\n",
    MTR_REMOTE_TMUX_LIST_PANES: "archguard-0:outer\t295132\tclaude\n",
  };
  const projects = parseProjects(env);
  write(dir, "orchestration/tick-log.md", "## 2026-08-12 03:2xZ tick — #54 派发\n");
  const tlog = renderSelected("outer.ticklog", ["quay"], projects, { socket: "/sock", repoRoot: dir, env });
  assert.ok(tlog.startsWith("outer.ticklog quay ## 2026-08-12"), tlog);
  const live = renderSelected("outer.liveness", ["archguard:outer"], projects, { socket: "/sock", repoRoot: dir, env });
  assert.ok(live.startsWith("outer.liveness archguard:outer alive"), live);
  assert.ok(live.includes("session=archguard-0") && live.includes("host=ad-arm1.wan.hwang.men"), live);
  const missing = renderSelected("outer.liveness", ["meta-cc:outer"], projects, { socket: "/sock", repoRoot: dir, env });
  assert.ok(missing.includes("window-missing"), missing);
});

test("manager-tick-readings: tmux is read-only and identity is pane-based (AC2/AC4 hard constraints)", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  // 只看代码（去掉 // 注释），docstring 里描述约束的措辞不算。
  const codeOnly = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.ok(src.includes('"list-panes"'), "must use read-only list-panes");
  assert.ok(!/"kill/.test(codeOnly), "no destructive tmux subcommand as a spawn argument");
  assert.ok(!/pgrep\s+-P/.test(codeOnly), "identity must not use pgrep -P");
  assert.ok(codeOnly.includes("pane_pid") && codeOnly.includes("pane_current_command"), "identity uses pane_pid + pane_current_command");
});

test("manager-tick-readings: registered behind quay-session and dispatched with the ts interpreter", async () => {
  const { MEMBERS, run } = await import("../scripts/quay-session.ts");
  const m = MEMBERS.find((x) => x.name === "manager-tick-readings");
  assert.ok(m, "member not registered");
  assert.equal(m.kind, "ts");
  assert.equal(m.file, "manager-tick-readings.ts");
  // 通过入口 dispatch → node 解释器 + 成员文件（与 quay-dispatch 的 ts 成员同构）
  const record = [];
  const exec = (command, argv, opts) => {
    record.push({ command, argv, cwd: opts.cwd });
    return { status: 0, stdout: "fake", stderr: "" };
  };
  const res = run("manager-tick-readings", ["--x"], { scriptDir: path.dirname(SCRIPT), exec });
  assert.equal(res.status, 0);
  assert.equal(record.length, 1);
  assert.equal(record[0].command, process.execPath);
  assert.ok(record[0].argv[2].endsWith("manager-tick-readings.ts"), record[0].argv.join(" "));
  assert.deepEqual(record[0].argv.slice(3), ["--x"]);
});
