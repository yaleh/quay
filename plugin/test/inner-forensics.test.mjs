// @test-group engine
// inner-forensics.test.mjs — gap-inner-forensics-verify-reports-nonruns-and-zero-durations:
// RED/GREEN fixture tests for the three inner-forensics verify lies:
//
//   AC1 (引号内 test.sh 不再归类全量套件) + AC5 (负/正控制两个方向)
//   AC2 (后台套件报真实耗时，非 0，与 duration_ms 473965 同量级)
//   AC3 (取不到耗时 → 「未知」而非 0s；run_in_background 与 shell `&` 两条路径都有 fixture)
//   AC4 (会话归属：外层 fork 不再当作内层更早会话；归属不同列出但不计入)
//   AC6 (已知答案窗口 02:00–02:30Z：恰好 3 次真实全量套件，不多不少)
//   AC7 (@test-group engine 声明)
//
// Run:
//   scripts/test.sh plugin/test/inner-forensics.test.mjs
//   node --test plugin/test/inner-forensics.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE = path.resolve(__dirname, "..", "scripts", "inner-forensics.mjs");

let fn;
try {
  fn = await import(MODULE);
} catch (e) {
  throw new Error(`cannot import ${MODULE}: ${e.message}`);
}

// ── fixture helpers ────────────────────────────────────────────────────────────────────────────────

function toolUse(id, ts, command, { bg = false, sessionId = "inner" } = {}) {
  return {
    type: "assistant", timestamp: ts, session_id: "pane-src", sessionId,
    message: { content: [{ type: "tool_use", id, name: "Bash", input: { command, ...(bg ? { run_in_background: true } : {}) } }] },
  };
}
function toolResult(id, ts, content) {
  return { type: "user", timestamp: ts, session_id: "pane-src", sessionId: "inner",
    message: { content: [{ type: "tool_result", tool_use_id: id, content }] } };
}
function bgNotif(id, ts, status) {
  return { type: "queue-operation", operation: "enqueue", timestamp: ts,
    content: `<task-notification>\n<task-id>t1</task-id>\n<tool-use-id>${id}</tool-use-id>\n<status>${status}</status>\n<summary>x</summary>\n</task-notification>` };
}
function writeSession(dir, name, records) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return p;
}
function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function cleanup(tmp) {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

// ── AC1 + AC5: 分类按代码位置（引号内 test.sh 不算；真实调用算）──────────────────────────────────

test("AC1/AC5 — 引号内 test.sh 不归类全量套件；真实调用归类（两个方向都有 fixture）", () => {
  // 负控制：只在引号内提到 test.sh —— 单引号（02:09:14 命令的 ps 部分）
  assert.equal(fn.classify("Bash", { command: "ps aux | grep -E 'node --test|scripts/test.sh'" }), "其它 Bash");
  // 负控制：双引号
  assert.equal(fn.classify("Bash", { command: 'echo "scripts/test.sh"' }), "其它 Bash");
  // 负控制：反引号（命令替换）
  assert.equal(fn.classify("Bash", { command: "echo `scripts/test.sh`" }), "其它 Bash");
  // 负控制：stripQuoted 把引号内容清空，classify 不再能看到其中的字样
  assert.equal(fn.stripQuoted("ps aux | grep -E 'node --test|scripts/test.sh'"), "ps aux | grep -E ''");

  // 正控制：真实调用（batch4c 形态）
  assert.equal(
    fn.classify("Bash", { command: "cd /home/yale/work/quay; date -u +%H:%M:%S; bash scripts/test.sh > /tmp/full-suite-batch4c.log 2>&1" }),
    "全量套件"
  );
  // 正控制：02:09:14 那条真实命令（ps 部分带引号内的 test.sh，但整条命令确实调了 bash scripts/test.sh）
  const batch4b = "cd /home/yale/work/quay; echo \"=== no test procs:\"; ps aux | grep -E 'node --test|scripts/test.sh' | grep -v grep | wc -l; echo \"load: $(cat /proc/loadavg | cut -d' ' -f1-3)\"; date -u +%H:%M:%S; bash scripts/test.sh > /tmp/full-suite-batch4b.log 2>&1; echo \"FULL-SUITE-EXIT=$?\" >> /tmp/full-suite-batch4b.log";
  assert.equal(fn.classify("Bash", { command: batch4b }), "全量套件");
  // 正控制：node --test 真实调用 → 范围化
  assert.equal(fn.classify("Bash", { command: "node --test plugin/test/x.test.mjs" }), "范围化测试");
});

// ── AC2: 后台套件报真实耗时（非 0，与 duration_ms 473965 同量级）─────────────────────────────────

test("AC2 — run_in_background 套件按 <task-notification> 完成时刻报真实耗时，非 0", () => {
  const tmp = mkTmp("if-ac2-");
  try {
    const p = writeSession(tmp, "inner.jsonl", [
      toolUse("c1", "2026-08-03T02:17:17.303Z",
        "cd /home/yale/work/quay; date -u +%H:%M:%S; bash scripts/test.sh > /tmp/full-suite-batch4c.log 2>&1; echo \"FULL-SUITE-EXIT=$?\" >> /tmp/full-suite-batch4c.log",
        { bg: true }),
      toolResult("c1", "2026-08-03T02:17:17.600Z", "Command running in background with ID: b2si1i481."),
      bgNotif("c1", "2026-08-03T02:25:15.640Z", "completed"),
    ]);
    const { hits } = fn.pairCalls(fn.load(p, 0), "全量套件");
    assert.equal(hits.length, 1);
    const h = hits[0];
    assert.equal(typeof h.dur, "number");
    assert.notEqual(h.dur, 0, "must not report 0s for a 478s run");
    assert.ok(h.dur > 400000 && h.dur < 500000, `dur=${h.dur}ms should be same order as duration_ms 473965`);
    assert.equal(h.bgStatus, "completed");
  } finally { cleanup(tmp); }
});

// ── AC3: 取不到耗时 → 「未知」而非 0s（run_in_background 与 shell `&` 两条路径）─────────────────

test("AC3 — run_in_background 取不到完成信号 → 报「未知」，不是 0s", () => {
  const tmp = mkTmp("if-ac3a-");
  try {
    const p = writeSession(tmp, "inner.jsonl", [
      toolUse("c1", "2026-08-03T02:17:17Z", "bash scripts/test.sh > /tmp/full-suite-batch4c.log 2>&1", { bg: true }),
      toolResult("c1", "2026-08-03T02:17:17.3Z", "Command running in background with ID: b2."),
      // 没有 <task-notification> → dur null → 「未知」
    ]);
    const { hits } = fn.pairCalls(fn.load(p, 0), "全量套件");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].dur, null);
    assert.equal(fn.fmtDur(hits[0]), "未知");
  } finally { cleanup(tmp); }
});

test("AC3 — shell 级 `nohup … &` 后台套件取不到完成信号 → 报「未知」，不是 0s", () => {
  const tmp = mkTmp("if-ac3b-");
  try {
    const p = writeSession(tmp, "inner.jsonl", [
      toolUse("c2", "2026-08-03T08:07:04Z",
        "cd /home/yale/work/quay; nohup bash scripts/test.sh > /tmp/sigma-fanin-fullsuite.log 2>&1 &\necho \"launched pid $!\"",
        { bg: false }), // 不是 run_in_background，是 shell 级 & —— looksShellBg 应识别
      toolResult("c2", "2026-08-03T08:07:05Z", "launched pid 123\n"),
    ]);
    const { hits } = fn.pairCalls(fn.load(p, 0), "全量套件");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].dur, null, "nohup 后台套件的真实耗时不在 transcript，必须报未知");
    assert.equal(fn.fmtDur(hits[0]), "未知");
  } finally { cleanup(tmp); }
});

// ── AC4: 会话归属 ────────────────────────────────────────────────────────────────────────────────

test("AC4 — 外层 fork 会话不再被当作内层更早会话；归属不同列出但不计入", () => {
  const tmp = mkTmp("if-ac4-");
  try {
    const target = writeSession(tmp, "3bbd.jsonl", [
      { type: "mode", sessionId: "3bbd" },
      { type: "assistant", timestamp: "2026-08-03T02:00:00Z", session_id: "pane-src", sessionId: "3bbd", message: { content: [] } },
    ]);
    // /clear 延续：session_id 指向同一 pane 源
    writeSession(tmp, "82ecfb6a.jsonl", [
      { type: "mode", sessionId: "82ecfb6a" },
      { type: "assistant", timestamp: "2026-08-03T02:30:00Z", session_id: "pane-src", sessionId: "82ecfb6a", message: { content: [] } },
    ]);
    // 外层人开的 fork：session_id 指向外层（≠ pane 源）—— 正是 47eb704e 的形态
    writeSession(tmp, "47eb704e.jsonl", [
      { type: "mode", sessionId: "47eb704e" },
      { type: "assistant", timestamp: "2026-08-03T02:40:00Z", session_id: "outer-src", sessionId: "47eb704e", message: { content: [] } },
    ]);
    fn._setProj(tmp);
    const res = fn.earlierSessions(target, Date.parse("2026-08-03T02:00:00Z"), Date.parse("2026-08-03T02:05:00Z"));
    assert.deepEqual(res.samePane.map((e) => e.f), ["82ecfb6a.jsonl"], "同源会话才算「更早会话」");
    assert.deepEqual(res.other.map((e) => e.f), ["47eb704e.jsonl"], "fork 归属不同，列出但不计入");
    assert.equal(fn.paneSource(target), "pane-src");
    assert.equal(fn.samePaneAs(path.join(tmp, "82ecfb6a.jsonl"), "pane-src"), true);
    assert.equal(fn.samePaneAs(path.join(tmp, "47eb704e.jsonl"), "pane-src"), false);
  } finally { cleanup(tmp); }
});

test("AC4 — CLI 输出把 fork 放进「归属不同」，不再报「更早的会话未被包含」", () => {
  const tmp = mkTmp("if-ac4cli-");
  try {
    // 目标会话：首条在 02:10（since 之后），含一次真实套件；同目录里只有一个外层 fork（无同源 /clear 延续）
    writeSession(tmp, "inner.jsonl", [
      toolUse("a", "2026-08-03T02:10:00Z", "bash scripts/test.sh > /tmp/full-suite-batch4c.log 2>&1", { bg: true }),
      toolResult("a", "2026-08-03T02:10:00.3Z", "Command running in background with ID: a."),
      bgNotif("a", "2026-08-03T02:18:00Z", "completed"),
    ]);
    writeSession(tmp, "47eb704e.jsonl", [
      { type: "mode", sessionId: "47eb704e" },
      { type: "assistant", timestamp: "2026-08-03T02:40:00Z", session_id: "outer-src", sessionId: "47eb704e", message: { content: [] } },
    ]);
    // 直接传 path.join 表达式而非 target 变量 —— target 的初始化器（fixture 数组）里含
    // "scripts/test.sh" 字样，会被 test-isolation-check R3 误判为「spawn 了 test.sh」。
    const res = spawnSync("node", [MODULE, "verify", "全量套件", "--since", "2026-08-03T02:00:00Z", "--session", path.join(tmp, "inner.jsonl")],
      { env: { ...process.env, INNER_FORENSICS_PROJ: tmp }, encoding: "utf8" });
    assert.equal(res.status, 0, `CLI exit ${res.status}\nstderr: ${res.stderr}`);
    assert.match(res.stdout, /归属不同/, "fork 必须出现在「归属不同」一节");
    assert.match(res.stdout, /47eb704e/, "fork 的文件名要列出来");
    assert.doesNotMatch(res.stdout, /更早的会话未被包含/, "fork 不得被计入「更早的会话未被包含」（那是 /clear 断裂的误报）");
  } finally { cleanup(tmp); }
});

// ── AC6: 已知答案窗口 02:00–02:30Z —— 恰好 3 次真实全量套件（batch4a/b/c）─────────────────────

test("AC6 — 窗口内恰好 3 次真实全量套件，不多不少（batch4a/b/c 形态）", () => {
  const tmp = mkTmp("if-ac6-");
  try {
    const p = writeSession(tmp, "inner.jsonl", [
      // batch4a（status killed）
      toolUse("a", "2026-08-03T02:00:43Z",
        "cd /home/yale/work/quay; echo \"=== test procs:\"; ps aux | grep -E 'node --test|scripts/test.sh' | grep -v grep | wc -l; bash scripts/test.sh > /tmp/full-suite-batch4a.log 2>&1; echo \"FULL-SUITE-EXIT=$?\" >> /tmp/full-suite-batch4a.log",
        { bg: true }),
      toolResult("a", "2026-08-03T02:00:44Z", "Command running in background with ID: a."),
      bgNotif("a", "2026-08-03T02:06:25Z", "killed"),
      // batch4b
      toolUse("b", "2026-08-03T02:09:14Z",
        "cd /home/yale/work/quay; echo \"=== no test procs:\"; ps aux | grep -E 'node --test|scripts/test.sh' | grep -v grep | wc -l; bash scripts/test.sh > /tmp/full-suite-batch4b.log 2>&1; echo \"FULL-SUITE-EXIT=$?\" >> /tmp/full-suite-batch4b.log",
        { bg: true }),
      toolResult("b", "2026-08-03T02:09:15Z", "Command running in background with ID: b."),
      bgNotif("b", "2026-08-03T02:16:57Z", "completed"),
      // batch4c
      toolUse("c", "2026-08-03T02:17:17Z",
        "cd /home/yale/work/quay; date -u +%H:%M:%S; bash scripts/test.sh > /tmp/full-suite-batch4c.log 2>&1; echo \"FULL-SUITE-EXIT=$?\" >> /tmp/full-suite-batch4c.log",
        { bg: true }),
      toolResult("c", "2026-08-03T02:17:18Z", "Command running in background with ID: c."),
      bgNotif("c", "2026-08-03T02:25:15Z", "completed"),
      // 干扰：只在引号内提到 test.sh 的 ps 命令（不算全量套件）
      toolUse("d", "2026-08-03T02:20:00Z", "ps aux | grep -E 'scripts/test.sh'", { bg: false }),
      toolResult("d", "2026-08-03T02:20:00.5Z", "12345 ?        0:00 0\n"),
      // 干扰：范围化测试（不算全量套件）
      toolUse("e", "2026-08-03T02:22:00Z", "scripts/test.sh plugin/test/x.test.mjs", { bg: false }),
      toolResult("e", "2026-08-03T02:22:30Z", "ok\n"),
    ]);
    const { hits } = fn.pairCalls(fn.load(p, Date.parse("2026-08-03T02:00:00Z")), "全量套件");
    assert.equal(hits.length, 3, "恰好 3 次真实全量套件，不多不少");
    for (const h of hits) {
      assert.equal(typeof h.dur, "number", "每次都是真实耗时，非 0");
      assert.ok(h.dur > 100000, `dur=${h.dur}ms 必须是分钟级`);
    }
    // 顺序按开始时刻：a → b → c；三条都是真实套件调用
    assert.deepEqual(hits.map((h) => h.bgStatus), ["killed", "completed", "completed"]);
    for (const h of hits) assert.match(h.cmd, /scripts\/test\.sh/, `hit cmd should reference a real suite call: ${h.cmd}`);
  } finally { cleanup(tmp); }
});

// ── AC7: @test-group engine 声明 ───────────────────────────────────────────────────────────────

test("AC7 — 本测试文件声明 // @test-group engine", () => {
  const src = fs.readFileSync(new URL(import.meta.url), "utf8");
  assert.match(src, /@test-group\s+engine/, "new test file must declare @test-group engine");
});
