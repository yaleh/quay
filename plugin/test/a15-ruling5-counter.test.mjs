// @test-group engine
// a15-ruling5-counter.test.mjs — tasks/gap-a15-ruling5-counter-missing.
// A15 裁定5（连续 3 轮 A15 心跳缺失 ⇒ .halt；再 3 轮 ⇒ /clear）没有机械计数器——规则写在 git 跟踪的
// 执行核（orchestrator-tick-core.md A15，80 行，每轮必读）仍连续 9 轮未执行，capability-catalog 对该
// 规则 0 命中。本测试钉住计数器：plugin/scripts/a15-ruling5-counter.ts。
//
// Coverage map (task ACs + Contract):
//   AC2 — 计数器脚本：读 transcript 最后一次 Agent tool_use ts，算距现在 tick 行数，>=3/>=6 分档
//         「应 .halt」/「应 /clear」；伪造 transcript/tick-log 注入，断言 0/3/6 分档。
//   Contract measure — `--json` 输出 ticks_since_agent 数字。
//   Contract band — <3 健康（exit 0）；>=3 报「应 .halt」（exit 1）；>=6 报「应 /clear」（exit 1）。
//   Control — <3 健康静默；>=3 报应 .halt；>=6 报应 /clear。
//   按位置判定 — tool_result 正文里出现 `"name":"Agent"` 字符串不算命中；非 assistant 消息不算；
//   占位 tick 行（分钟位非数字）不数。
//
// Fixtures are self-contained: 伪造 transcript JSONL + 伪造 tick-log 注入，断言 0/3/6 分档。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  lastAgentTsMs,
  countTickRowsAfter,
  judgeTicks,
  TICK_ROW_RE,
} from "../scripts/a15-ruling5-counter.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const CLI = join(repoRoot, "plugin", "scripts", "a15-ruling5-counter.ts");

function run(args, opts = {}) {
  const res = spawnSync("node", ["--no-warnings", "--experimental-strip-types", CLI, ...args], {
    encoding: "utf8",
    ...opts,
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), `a15-ruling5-${prefix}-`));
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

// ── fixture builders ───────────────────────────────────────────────────────────────────────────────
// 一条 assistant 消息，content 里含一个 name=Agent 的 tool_use。
function agentMsg(isoTs) {
  return {
    type: "assistant",
    timestamp: isoTs,
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id: "call_x", name: "Agent", input: { description: "fixture dispatch" } }],
    },
  };
}

// 一条 assistant 消息，content 里含一个 name=Other 的 tool_use（非 Agent）。
function otherToolMsg(isoTs) {
  return {
    type: "assistant",
    timestamp: isoTs,
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id: "call_y", name: "Bash", input: { command: "true" } }],
    },
  };
}

// 一条 user 消息，content 里是一个 tool_result，其文本恰好包含字符串 "name":"Agent" ——
// 必须被按位置判定拒绝（正文引述不算命中）。
function toolResultMentioningAgent(isoTs) {
  return {
    type: "user",
    timestamp: isoTs,
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "call_x", content: 'the agent ran: {"name":"Agent"}' }],
    },
  };
}

function transcriptLines(records) {
  return records.map((r) => JSON.stringify(r));
}

// tick-log 行：| YYYY-MM-DD HH:MMZ | ...
function tickRow(date, hhmm, label = "wait") {
  return `| ${date} ${hhmm}Z | \`${label}\` | 做了什么 | 内层 | 核实 |`;
}

// ── pure function unit tests ───────────────────────────────────────────────────────────────────────

test("lastAgentTsMs — finds the LAST Agent tool_use across mixed records (by position, not keyword)", () => {
  const lines = [
    ...transcriptLines([agentMsg("2026-08-10T09:00:00.000Z")]),
    ...transcriptLines([otherToolMsg("2026-08-10T09:05:00.000Z")]),
    // tool_result 正文引述 "name":"Agent" —— 不得命中
    ...transcriptLines([toolResultMentioningAgent("2026-08-10T09:10:00.000Z")]),
    ...transcriptLines([agentMsg("2026-08-10T10:00:00.000Z")]),
  ];
  assert.equal(lastAgentTsMs(lines), Date.parse("2026-08-10T10:00:00.000Z"));
});

test("lastAgentTsMs — a malformed line is skipped, never fatal", () => {
  const lines = [
    "this is not json {",
    ...transcriptLines([agentMsg("2026-08-10T10:00:00.000Z")]),
  ];
  assert.equal(lastAgentTsMs(lines), Date.parse("2026-08-10T10:00:00.000Z"));
});

test("lastAgentTsMs — returns null when there is never an Agent tool_use", () => {
  const lines = [
    ...transcriptLines([otherToolMsg("2026-08-10T10:00:00.000Z")]),
    ...transcriptLines([toolResultMentioningAgent("2026-08-10T10:05:00.000Z")]),
  ];
  assert.equal(lastAgentTsMs(lines), null);
});

test("countTickRowsAfter — counts only real tick rows strictly after the boundary", () => {
  const lines = [
    tickRow("2026-08-10", "09:50"),
    tickRow("2026-08-10", "09:55"),
    tickRow("2026-08-10", "10:05"),
    tickRow("2026-08-10", "10:10"),
    tickRow("2026-08-10", "10:15"),
    // 占位行：分钟位非数字 → 不数
    "## 2026-08-10 11:3xZ | wait — 占位",
    "## 2026-08-10 ${TS} | wait — 占位",
    // 表头/分隔线 → 不数
    "| 时刻 | 动作类型 | 做了什么 | 内层状态 | 核实了哪一项 |",
    "|---|---|---|---|---|",
  ];
  const after = Date.parse("2026-08-10T10:00:00.000Z");
  assert.equal(countTickRowsAfter(lines, after), 3);
});

test("countTickRowsAfter — boundary row at the same minute does NOT count (strictly after)", () => {
  const lines = [tickRow("2026-08-10", "10:00"), tickRow("2026-08-10", "10:01")];
  const after = Date.parse("2026-08-10T10:00:30.000Z"); // 10:00 行(10:00:00) < after
  assert.equal(countTickRowsAfter(lines, after), 1);
});

test("TICK_ROW_RE — matches both table and ## heading forms", () => {
  assert.ok(TICK_ROW_RE.test("| 2026-08-10 10:05Z | `wait` | ..."));
  assert.ok(TICK_ROW_RE.test("## 2026-08-10 11:53Z | correct — ..."));
  assert.ok(!TICK_ROW_RE.test("## 2026-08-10 11:3xZ | placeholder"));
  assert.ok(!TICK_ROW_RE.test("| 时刻 | 动作类型 |"));
});

// ── band judgment (AC2: 0/3/6 分档) ────────────────────────────────────────────────────────────────

test("judgeTicks — 0/2 healthy (silent), 3 halt, 6 clear", () => {
  assert.equal(judgeTicks(0).band, "healthy");
  assert.equal(judgeTicks(0).signal, false);
  assert.equal(judgeTicks(2).band, "healthy");
  assert.equal(judgeTicks(3).band, "halt");
  assert.equal(judgeTicks(3).action, "应 .halt");
  assert.equal(judgeTicks(3).signal, true);
  assert.equal(judgeTicks(5).band, "halt");
  assert.equal(judgeTicks(6).band, "clear");
  assert.equal(judgeTicks(6).action, "应 /clear");
  assert.equal(judgeTicks(9).band, "clear");
});

// ── CLI end-to-end with injected fixtures (AC2: 0/3/6 分档 via --transcript/--tick-log) ──────────

function makeFixtures(builder) {
  const dir = tmp("cli");
  const transcript = join(dir, "transcript.jsonl");
  const tickLog = join(dir, "tick-log.md");
  const { agentIso, rows } = builder();
  writeFileSync(transcript, transcriptLines([agentMsg(agentIso)]).join("\n") + "\n");
  writeFileSync(tickLog, rows.join("\n") + "\n");
  return { dir, transcript, tickLog };
}

function rowsAfter(minutesAfter, count) {
  // last Agent 在 10:00；每分钟一条 tick 行，从 10:01 起。
  const rows = [];
  for (let i = 1; i <= count; i++) {
    const m = 10 + Math.floor(i / 60);
    const mm = String(i % 60).padStart(2, "0");
    rows.push(tickRow("2026-08-10", `${String(m).padStart(2, "0")}:${mm}`));
  }
  return rows;
}

test("CLI — 0 ticks since Agent ⇒ exit 0, band healthy, ticks_since_agent=0", () => {
  const { dir, transcript, tickLog } = makeFixtures(() => ({
    agentIso: "2026-08-10T10:00:00.000Z",
    rows: [tickRow("2026-08-10", "09:50"), tickRow("2026-08-10", "09:55")],
  }));
  try {
    const r = run(["--transcript", transcript, "--tick-log", tickLog, "--json"]);
    assert.equal(r.status, 0, `expected exit 0:\n${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ticks_since_agent, 0);
    assert.equal(out.band, "healthy");
    assert.equal(out.signal, false);
  } finally {
    cleanup(dir);
  }
});

test("CLI — 3 ticks since Agent ⇒ exit 1, 应 .halt", () => {
  const { dir, transcript, tickLog } = makeFixtures(() => ({
    agentIso: "2026-08-10T10:00:00.000Z",
    rows: rowsAfter(10, 3),
  }));
  try {
    const r = run(["--transcript", transcript, "--tick-log", tickLog, "--json"]);
    assert.equal(r.status, 1, `expected exit 1:\n${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ticks_since_agent, 3);
    assert.equal(out.band, "halt");
    assert.equal(out.action, "应 .halt");
    assert.equal(out.signal, true);
    // 人类可读形态也报出
    const hr = run(["--transcript", transcript, "--tick-log", tickLog]);
    assert.equal(hr.status, 1);
    assert.match(hr.stdout, /应 \.halt/);
  } finally {
    cleanup(dir);
  }
});

test("CLI — 6 ticks since Agent ⇒ exit 1, 应 /clear", () => {
  const { dir, transcript, tickLog } = makeFixtures(() => ({
    agentIso: "2026-08-10T10:00:00.000Z",
    rows: rowsAfter(10, 6),
  }));
  try {
    const r = run(["--transcript", transcript, "--tick-log", tickLog, "--json"]);
    assert.equal(r.status, 1, `expected exit 1:\n${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ticks_since_agent, 6);
    assert.equal(out.band, "clear");
    assert.equal(out.action, "应 /clear");
    assert.equal(out.signal, true);
  } finally {
    cleanup(dir);
  }
});

test("CLI — no Agent tool_use ever ⇒ all tick rows count (fail-closed); 0 rows ⇒ healthy", () => {
  // 从未派发 Agent + 有 3 条 tick 行 = 跑了 tick 却没执行 ⇒ 应 .halt
  const dir = tmp("noagent");
  const transcript = join(dir, "transcript.jsonl");
  const tickLog = join(dir, "tick-log.md");
  try {
    writeFileSync(transcript, transcriptLines([otherToolMsg("2026-08-10T10:00:00.000Z")]).join("\n") + "\n");
    writeFileSync(tickLog, rowsAfter(10, 3).join("\n") + "\n");
    const r = run(["--transcript", transcript, "--tick-log", tickLog, "--json"]);
    assert.equal(r.status, 1);
    assert.equal(JSON.parse(r.stdout).ticks_since_agent, 3);
    assert.equal(JSON.parse(r.stdout).band, "halt");

    // 空 tick-log（刚起步）⇒ 0 健康
    writeFileSync(tickLog, "# 外层 tick 记录\n\n还没有行\n");
    const r0 = run(["--transcript", transcript, "--tick-log", tickLog, "--json"]);
    assert.equal(r0.status, 0);
    assert.equal(JSON.parse(r0.stdout).ticks_since_agent, 0);
    assert.equal(JSON.parse(r0.stdout).band, "healthy");
  } finally {
    cleanup(dir);
  }
});

test("CLI — missing transcript / tick-log exits 2 (usage/environment)", () => {
  const dir = tmp("missing");
  try {
    const r = run(["--transcript", join(dir, "nope.jsonl"), "--tick-log", join(dir, "nope.md"), "--json"]);
    assert.equal(r.status, 2);
  } finally {
    cleanup(dir);
  }
});
