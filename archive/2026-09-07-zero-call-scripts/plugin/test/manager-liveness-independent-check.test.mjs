// @test-group engine
// manager-liveness-independent-check.test.mjs — manager 自身活性独立兜底的负控制回放
// (tasks/gap-ac147-manager-liveness-independent-channel).
//
// AC1（能取假，独立通道）：manager 失能（交互阻塞/心跳停/进程死）超 T，存在不经过 manager 的机制
//   让人知道——本测试断言 `judge()` 对陈旧心跳产出【非空 notification】、对新鲜心跳产出 null
//   （正反两个方向都能取假：不是恒通知、也不是恒静默）。
// AC2（能取假，负控制回放）：把 manager 置入 AskUserQuestion 阻塞态（现成样本 outer
//   2026-08-23T04:13:54Z–07:30:07Z），T 之后须有通知。本测试用该真实样本时间戳回放：
//   lastTs=04:13:54Z，processAlive=true，blocked=true，now=04:13:54Z+T+ε ⇒ notification 非空且
//   failureMode=manager-interaction-blocked；now=04:13:54Z+T−ε ⇒ 仍 ALIVE（心跳尚未超 T）。
//
// Run:
//   scripts/test.sh plugin/test/manager-liveness-independent-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_MAX_AGE_SECS,
  MALFORMED,
  FAILURE_PROCESS_DEAD,
  FAILURE_INTERACTION_BLOCKED,
  FAILURE_HEARTBEAT_STOPPED,
  judgeLiveness,
  classifyFailureMode,
  buildNotification,
  judge,
  readHeartbeatTs,
  parseHeartbeatText,
  writeNotification,
} from "../scripts/manager-liveness-independent-check.ts";

const SCRIPT = fileURLToPath(new URL("../scripts/manager-liveness-independent-check.ts", import.meta.url));

// 现成样本（tasks/gap-ac147 负控制）：outer 阻塞在未答复的 AskUserQuestion 的真实时刻。
// 04:13:54Z = outer 最后真实回合（TOOL_USE:AskUserQuestion）；07:30:07Z = tool_result 已答。
const SAMPLE_LAST_TS = Math.floor(Date.parse("2026-08-23T04:13:54Z") / 1000);
const SAMPLE_RESOLVED_TS = Math.floor(Date.parse("2026-08-23T07:30:07Z") / 1000);

function runCli(args) {
  return spawnSync("node", ["--experimental-strip-types", SCRIPT, ...args], { encoding: "utf8" });
}

// ── AC2 负控制回放（纯函数）——AskUserQuestion 阻塞态，T 后须有通知 ─────────────────────────────

test("AC2 — AskUserQuestion 阻塞态回放：T 后 judge() 产出非空 notification（failureMode=interaction-blocked）", () => {
  const nowSec = SAMPLE_LAST_TS + DEFAULT_MAX_AGE_SECS + 60; // T + 60s
  const v = judge({ nowSec, lastTs: SAMPLE_LAST_TS, processAlive: true, blocked: true });
  assert.equal(v.alive, false, "heartbeat age > T ⇒ disabled");
  assert.equal(v.status, "stale");
  assert.equal(v.ageSecs, DEFAULT_MAX_AGE_SECS + 60);
  assert.equal(v.failureMode, FAILURE_INTERACTION_BLOCKED, "AskUserQuestion 阻塞 = interaction-blocked");
  assert.ok(v.notification, "T 后必须有通知");
  assert.equal(v.notification.failureMode, FAILURE_INTERACTION_BLOCKED);
  assert.equal(v.notification.ageSecs, DEFAULT_MAX_AGE_SECS + 60);
  assert.equal(v.notification.lastHeartbeatAt, "2026-08-23T04:13:54.000Z");
});

test("AC2 能取假（正方向）——T 之前仍 ALIVE，无通知（不是恒通知）", () => {
  const nowSec = SAMPLE_LAST_TS + DEFAULT_MAX_AGE_SECS - 60; // T − 60s
  const v = judge({ nowSec, lastTs: SAMPLE_LAST_TS, processAlive: true, blocked: true });
  assert.equal(v.alive, true, "heartbeat age < T ⇒ alive");
  assert.equal(v.notification, null, "未超 T 不得通知");
  assert.equal(v.failureMode, null);
});

test("AC2 样本窗口内任一 > T 时刻都通知（07:30:07Z 解除阻塞那一刻早已应报出）", () => {
  // 真实解除时刻 07:30:07Z 距 04:13:54Z 约 3h17m，远超 T —— 通知早该在 T 时就已发出。
  const v = judge({ nowSec: SAMPLE_RESOLVED_TS, lastTs: SAMPLE_LAST_TS, processAlive: true, blocked: true });
  assert.equal(v.alive, false);
  assert.ok(v.notification);
  assert.ok(v.ageSecs > DEFAULT_MAX_AGE_SECS);
});

// ── AC1 三种失能形态分类 ─────────────────────────────────────────────────────────────────────────

test("AC1 — 进程死：stale + processAlive=false ⇒ failureMode=process-dead", () => {
  const v = judge({ nowSec: SAMPLE_LAST_TS + DEFAULT_MAX_AGE_SECS + 1, lastTs: SAMPLE_LAST_TS, processAlive: false });
  assert.equal(v.failureMode, FAILURE_PROCESS_DEAD);
  assert.ok(v.notification);
});

test("AC1 — 心跳停：stale + processAlive=true + 无阻塞 ⇒ failureMode=heartbeat-stopped", () => {
  const v = judge({ nowSec: SAMPLE_LAST_TS + DEFAULT_MAX_AGE_SECS + 1, lastTs: SAMPLE_LAST_TS, processAlive: true, blocked: false });
  assert.equal(v.failureMode, FAILURE_HEARTBEAT_STOPPED);
  assert.ok(v.notification);
});

test("AC1 — 进程状态未知：stale + processAlive=null ⇒ 兜底 heartbeat-stopped", () => {
  const v = judge({ nowSec: SAMPLE_LAST_TS + DEFAULT_MAX_AGE_SECS + 1, lastTs: SAMPLE_LAST_TS });
  assert.equal(v.failureMode, FAILURE_HEARTBEAT_STOPPED);
});

test("AC1 — 进程死优先于残留阻塞信号（死进程不是阻塞）", () => {
  const v = classifyFailureMode({ stale: true, processAlive: false, blocked: true });
  assert.equal(v, FAILURE_PROCESS_DEAD);
});

// ── judgeLiveness 边界 ─────────────────────────────────────────────────────────────────────────────

test("judgeLiveness — missing（从未写过心跳）也是失能，不是「为假」", () => {
  const v = judgeLiveness(1000, null);
  assert.equal(v.alive, false);
  assert.equal(v.status, "missing");
  assert.equal(v.reason, "manager-heartbeat-missing");
});

test("judgeLiveness — malformed（产物存在但无有效 ts）", () => {
  const v = judgeLiveness(1000, MALFORMED);
  assert.equal(v.alive, false);
  assert.equal(v.status, "malformed");
});

test("judgeLiveness — 未来时间戳（时钟漂移）钳到 0 = 新鲜", () => {
  const v = judgeLiveness(1000, 2000);
  assert.equal(v.alive, true);
  assert.equal(v.ageSecs, 0);
});

test("judgeLiveness — 恰好等于 T 仍新鲜（> T 才失能，边界不含）", () => {
  const v = judgeLiveness(1000 + DEFAULT_MAX_AGE_SECS, 1000);
  assert.equal(v.alive, true);
  const w = judgeLiveness(1000 + DEFAULT_MAX_AGE_SECS + 1, 1000);
  assert.equal(w.alive, false);
});

// ── 心跳读取 ─────────────────────────────────────────────────────────────────────────────────────

test("readHeartbeatTs — JSON 心跳 {ts} 用 ts 字段", () => {
  const dir = mkdtempSync(join(tmpdir(), "mlic-"));
  try {
    const f = join(dir, "hb.json");
    writeFileSync(f, JSON.stringify({ ts: 1750000000 }), "utf8");
    assert.equal(readHeartbeatTs(f), 1750000000);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("readHeartbeatTs — markdown tick-log 用 mtime（JSON 解析失败回退）", () => {
  const dir = mkdtempSync(join(tmpdir(), "mlic-"));
  try {
    const f = join(dir, "tick.md");
    writeFileSync(f, "| 时刻 | 动作 |\n|---|---|\n| 04:13Z | blocked |\n", "utf8");
    const ts = readHeartbeatTs(f);
    assert.equal(typeof ts, "number");
    assert.ok(ts > 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("readHeartbeatTs — 文件缺失 ⇒ null（从未写过）", () => {
  assert.equal(readHeartbeatTs(join(tmpdir(), "definitely-missing.md")), null);
});

test("parseHeartbeatText — 非 JSON 文本 ⇒ null（交给 mtime）", () => {
  assert.equal(parseHeartbeatText("| 时刻 | 动作 |\n|---|---|"), null);
  assert.equal(parseHeartbeatText(""), null);
  assert.equal(parseHeartbeatText(null), null);
});

// ── buildNotification 形状 ────────────────────────────────────────────────────────────────────────

test("buildNotification — 通知记录携带 notifiedAt / failureMode / ageSecs / maxAgeSecs / lastHeartbeatAt", () => {
  const n = buildNotification({
    nowSec: SAMPLE_LAST_TS + DEFAULT_MAX_AGE_SECS + 60,
    ageSecs: DEFAULT_MAX_AGE_SECS + 60,
    failureMode: FAILURE_INTERACTION_BLOCKED,
    maxAgeSecs: DEFAULT_MAX_AGE_SECS,
    lastTs: SAMPLE_LAST_TS,
  });
  assert.equal(n.failureMode, FAILURE_INTERACTION_BLOCKED);
  assert.equal(n.ageSecs, DEFAULT_MAX_AGE_SECS + 60);
  assert.equal(n.maxAgeSecs, DEFAULT_MAX_AGE_SECS);
  assert.equal(n.lastHeartbeatAt, "2026-08-23T04:13:54.000Z");
  assert.ok(n.message.includes("manager 失能"));
  assert.ok(n.message.includes("interaction-blocked"));
});

test("writeNotification — 追加一行 JSON 到载体（可回看）", () => {
  const dir = mkdtempSync(join(tmpdir(), "mlic-"));
  try {
    const f = join(dir, "notifications.jsonl");
    const n = buildNotification({ nowSec: 1000, ageSecs: 10, failureMode: FAILURE_HEARTBEAT_STOPPED, maxAgeSecs: 5, lastTs: 990 });
    writeNotification(f, n);
    writeNotification(f, n);
    const lines = readFileSync(f, "utf8").trim().split("\n");
    assert.equal(lines.length, 2, "追加式——两条记录");
    assert.deepEqual(JSON.parse(lines[0]), n);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── CLI 负控制回放（端到端：退出码 + 通知落盘）──────────────────────────────────────────────────

test("CLI — 负控制回放：T 后 exit 1 且通知写入 --notify-file", () => {
  const dir = mkdtempSync(join(tmpdir(), "mlic-"));
  try {
    const notifyFile = join(dir, "notify.jsonl");
    const res = runCli([
      "--last-heartbeat-ts", String(SAMPLE_LAST_TS),
      "--now", String(SAMPLE_LAST_TS + DEFAULT_MAX_AGE_SECS + 60),
      "--process-alive", "true",
      "--blocked", "true",
      "--notify-file", notifyFile,
      "--json",
    ]);
    assert.equal(res.status, 1, "DISABLED ⇒ exit 1");
    const out = JSON.parse(res.stdout.trim());
    assert.equal(out.verdict, "DISABLED");
    assert.equal(out.failureMode, FAILURE_INTERACTION_BLOCKED);
    assert.ok(out.notification, "T 后须有通知");
    assert.ok(existsSync(notifyFile), "通知已落盘到载体");
    const rec = JSON.parse(readFileSync(notifyFile, "utf8").trim());
    assert.equal(rec.failureMode, FAILURE_INTERACTION_BLOCKED);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI — 正控制：新鲜心跳 exit 0 且不落盘", () => {
  const dir = mkdtempSync(join(tmpdir(), "mlic-"));
  try {
    const notifyFile = join(dir, "notify.jsonl");
    const res = runCli([
      "--last-heartbeat-ts", String(SAMPLE_LAST_TS),
      "--now", String(SAMPLE_LAST_TS + 10),
      "--process-alive", "true",
      "--blocked", "true",
      "--notify-file", notifyFile,
      "--json",
    ]);
    assert.equal(res.status, 0, "ALIVE ⇒ exit 0");
    const out = JSON.parse(res.stdout.trim());
    assert.equal(out.verdict, "ALIVE");
    assert.equal(out.notification, null, "新鲜心跳不得通知");
    assert.ok(!existsSync(notifyFile), "新鲜时什么都不落盘");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI — 进程死形态：--process-alive false ⇒ failureMode=process-dead", () => {
  const res = runCli([
    "--last-heartbeat-ts", String(SAMPLE_LAST_TS),
    "--now", String(SAMPLE_LAST_TS + DEFAULT_MAX_AGE_SECS + 1),
    "--process-alive", "false",
    "--notify-file", "",
    "--json",
  ]);
  assert.equal(res.status, 1);
  assert.equal(JSON.parse(res.stdout.trim()).failureMode, FAILURE_PROCESS_DEAD);
});
