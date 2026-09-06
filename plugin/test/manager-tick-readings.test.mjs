// @test-group engine
// manager-tick-readings.test.mjs — the manager tick's single-command mechanical readings
// (tasks/gap-manager-tick-mechanical-checks-are-eight-loose-bash-blocks-in-prose.md AC1-AC5).
// PURE-IMPORT: imports the module, injects the project/fake /proc seams — zero subprocesses.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PROJECTS,
  parseProjects,
  projectStatus,
  resourceReadings,
  listNodePids,
  countNodeCommLiteral,
  latestTickLog,
  latestTickLogReading,
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

const SCRIPT = fileURLToPath(new URL("../scripts/manager-tick-readings.ts", import.meta.url));

test("manager-tick-readings: parseProjects defaults to the quay network and honors MTR_PROJECTS", () => {
  assert.equal(DEFAULT_PROJECTS.length, 3);
  assert.equal(parseProjects({}).length, 3);
  assert.deepEqual(parseProjects({ MTR_PROJECTS: "foo=/tmp/foo bar=/tmp/bar" }), [
    { name: "foo", dir: "/tmp/foo" },
    { name: "bar", dir: "/tmp/bar" },
  ]);
});

test("manager-tick-readings: projectStatus reads .halt presence and first line", (t) => {
  const dir = tmpdir(t);
  assert.equal(projectStatus({ name: "x", dir }), "running");
  write(dir, ".halt", "HALTED by manager\n更多\n");
  const s = projectStatus({ name: "x", dir });
  assert.ok(s.startsWith("paused: HALTED by manager"), s);
  assert.equal(projectStatus({ name: "x", dir: "" }), "no-dir");
});

test("manager-tick-readings: resourceReadings counts node by CMDLINE (host-independent) with dual-read self-check (AC1b)", (t) => {
  const dir = tmpdir(t);
  const proc = path.join(dir, "proc");
  write(proc, "pressure/cpu", "some avg10=61.28 avg60=1.00 avg300=1.00 total=0");
  write(proc, "loadavg", "7.23 1.11 1.00 3/456 78901");
  write(proc, "meminfo", "MemTotal:       32000000 kB\nMemAvailable:    28211200 kB\n");
  // boheidc 形状：node 进程 comm=`MainThread`（不含 "node" 子串，旧 /node/ 正则恒零），cmdline argv[0] 才是 node。
  write(proc, "101/cmdline", "node\0/app.js\0");
  write(proc, "101/comm", "MainThread");
  write(proc, "102/cmdline", "/usr/bin/node\0--version\0");
  write(proc, "102/comm", "MainThread");
  write(proc, "103/cmdline", "bash\0--rcfile\0");
  write(proc, "103/comm", "bash");
  const r = resourceReadings(proc, 9999);
  assert.equal(r.cpuSomeAvg10, "61.28");
  assert.equal(r.load1, "7.23");
  assert.equal(r.nodeCount, 2); // cmdline 枚举：node + /usr/bin/node
  assert.equal(r.nodeCommLiteral, 0); // 交叉侧 comm 字面量（node-MainThread）在本机恒 0
  assert.equal(r.nodeInstrumentFailure, true); // comm 0 && cmdline 2 ⇒ 报【仪器故障】
  assert.equal(r.memAvailMb, 27550); // 28211200 kB / 1024
});

test("manager-tick-readings: listNodePids/countNodeCommLiteral dual-read on the old-host comm shape (no instrument failure)", (t) => {
  const dir = tmpdir(t);
  const proc = path.join(dir, "proc");
  write(proc, "101/cmdline", "node\0/app.js\0");
  write(proc, "101/comm", "node-MainThread"); // 旧宿主 Node comm
  write(proc, "102/cmdline", "/usr/bin/node\0--version\0");
  write(proc, "102/comm", "node-MainThread");
  write(proc, "103/cmdline", "bash\0--rcfile\0");
  write(proc, "103/comm", "bash");
  assert.deepEqual(listNodePids(proc, 9999), [101, 102]);
  assert.equal(countNodeCommLiteral(proc, 9999), 2); // 交叉侧命中 ⇒ 双读互校 ok
  const r = resourceReadings(proc, 9999);
  assert.equal(r.nodeCount, 2);
  assert.equal(r.nodeCommLiteral, 2);
  assert.equal(r.nodeInstrumentFailure, false);
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

test("manager-tick-readings: latestTickLog full:true carries the complete row (A0 截断缺陷 fix, manager ③ 2026-08-15)", (t) => {
  // 缺陷：默认 maxLen=200 把 outer tick-log 行（实测 500-1000+ 字符）截到 A11 前 ⇒ 判准⑥′ 无法判 outer tick 完整性。
  // 修法：A0 feed 走 full:true（完整行）；显式 maxLen 仍是截断语义（向后兼容）。
  const quay = { name: "quay", dir: tmpdir(t) };
  const longLine = "- `2026-08-07 04:39Z` `correct` — " + "A11 suite=green ".repeat(50);
  write(quay.dir, "orchestration/tick-log.md", "# log\n\n" + longLine + "\n");
  const full = latestTickLog(quay, 200, { full: true });
  assert.ok(!full.endsWith("..."), "full:true must not truncate");
  assert.ok(full.includes("A11 suite=green"), "full:true must carry A11+ content");
  assert.ok(full.length > 200, "full:true must exceed the 200 default cap");
  // 向后兼容：显式 maxLen（无 full）仍是截断语义
  const trunc = latestTickLog(quay, 200);
  assert.ok(trunc.endsWith("...") && trunc.length === 200, trunc.length);
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

test("manager-tick-readings: latestTickLog parses the quay dash-tick shape `- \\`HH:MMZ\\` \\`action\\`` (AC2)", (t) => {
  // 修复前四谓词（DATED/QUOTE/HEADER/TABLE）全不命中 dash tick ⇒ 恒 no-tick-row。
  // 修复后 `- \`04:09Z\` \`unblock\` — …` 被 UNDATED_DASH_RE 命中，按追加顺序取最后一行。
  const quay = { name: "quay", dir: tmpdir(t) };
  write(quay.dir, "orchestration/tick-log.md", [
    "- `03:31Z` `unblock` — 冷启动后首个常规 tick。",
    "  - 后续：reconcile 关闭冷启动括号（缩进子行不是 tick 行）。",
    "- `04:09Z` `correct` — 方向性违规认领。",
    "- `04:22Z` `no-action` — 等裁定。",
  ].join("\n"));
  const r = latestTickLogReading(quay);
  assert.notEqual(r.row, "no-tick-row", "dash-tick 行必须被识别（AC2：对当前真实文件能亮红）");
  assert.ok(r.row.includes("04:22Z"), r.row);
  assert.equal(r.freshness, "positional"); // 无日期行 + mtime 可得 ⇒ positional
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
  };
  write(dir, ".halt", "paused msg");
  write(dir, "orchestration/tick-log.md", "| 2026-08-07 04:39Z | `no-action` | hello\n");
  write(dir, "orchestration/manager-phase-goal.md", "- [x] a\n- [ ] b\n");
  const out = render(parseProjects(env), { repoRoot: dir });
  const lines = out.trim().split("\n");
  // 每个标签族都必须出现 —— 缺一个即该机械项被跳过（可被机械检出）
  assert.ok(lines.some((l) => l.startsWith("project.status quay ")), lines.join(";"));
  assert.ok(lines.some((l) => l.startsWith("resource.cpu_some_avg10 ")), lines.join(";"));
  assert.ok(lines.some((l) => l.startsWith("resource.load1 ")), lines.join(";"));
  assert.ok(lines.some((l) => l.startsWith("resource.node_count ")), lines.join(";"));
  assert.ok(lines.some((l) => l.startsWith("resource.node_comm_literal ")), lines.join(";"));
  assert.ok(lines.some((l) => l.startsWith("resource.node_dual_read ")), lines.join(";"));
  assert.ok(lines.some((l) => l.startsWith("resource.mem_available_mb ")), lines.join(";"));
  assert.ok(lines.some((l) => l.startsWith("outer.ticklog quay ")), lines.join(";"));
});

test("manager-tick-readings: renderSelected emits targeted outer.ticklog readings (Contract invoke)", (t) => {
  const dir = tmpdir(t);
  const env = {
    MTR_PROJECTS: "quay=" + dir + " archguard=" + dir + " meta-cc=" + dir,
  };
  const projects = parseProjects(env);
  write(dir, "orchestration/tick-log.md", "## 2026-08-12 03:2xZ tick — #54 派发\n");
  const tlog = renderSelected("outer.ticklog", ["quay"], projects);
  assert.ok(tlog.startsWith("outer.ticklog quay ## 2026-08-12"), tlog);
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
