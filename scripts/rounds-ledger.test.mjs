// rounds-ledger.test.mjs — 轮数台账工具的单元/反例测试。
// 覆盖（AC1）：①同一任务多会话合并；②同一 message.id 多 block 只计 1 轮；③verify+edit
//   混合工具按优先级只归一类且原始工具计数保留；④缺会话文件/fan-in trace ⇒ not-evaluated，
//   不变成 0 或成功；⑤返工原因无法判定 ⇒ unknown 单列，不并入已知类。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseArgs, analyzeSession, classifyRound, classifyToolPhase, buildLedger,
  scanSessions, firstUserMessageText, sessionFirstTsMs, windowMembership,
  attributeRework, attachFanInFacts,
} from "./rounds-ledger.mjs";

const ISO = (d) => new Date(d).toISOString();
const MIN = 60_000;

function baseSrc(overrides = {}) {
  return {
    root: "/tmp/fixture-root",
    sessionsDir: "/tmp/fixture-sessions",
    args: { task: null },
    workerOutcome: [],
    stepTrace: [],
    sessions: [],
    sessionsScanned: 0,
    notWorker: 0,
    notEvaluatedSessions: 0,
    ...overrides,
  };
}

// 一个 worker 会话 jsonl：queue-operation enqueue（带时间戳）+ user + N 条 assistant。
function writeWorkerSession(dir, id, task, tsMs, assistantRecords = []) {
  const lines = [
    JSON.stringify({ type: "queue-operation", operation: "enqueue", timestamp: ISO(tsMs), sessionId: id }),
    JSON.stringify({ type: "user", message: { role: "user", content: `You are a per-task worker in the quay repo (SPEC-worker-driven-inner §5 阶段 2). Task: ${task}. Repo root: /x.` } }),
    ...assistantRecords.map((a) => JSON.stringify(a)),
  ];
  writeFileSync(join(dir, `${id}.jsonl`), lines.join("\n") + "\n");
  return { sessionId: id, task, file: `${id}.jsonl`, firstTs: tsMs };
}

// 一个 assistant 轮（message.id 唯一，含一个 tool_use）。
function assistantRound(messageId, tools = [], usage = null) {
  return {
    type: "assistant",
    message: {
      id: messageId,
      role: "assistant",
      model: "test",
      usage: usage || { input_tokens: 100, cache_read_input_tokens: 200, output_tokens: 10 },
      content: [
        { type: "text", text: "thinking" },
        ...tools.map((t) => ({ type: "tool_use", ...t })),
      ],
    },
  };
}
// 同一 message.id 被 apiBlockIndex 拆成多条记录（thinking/text/tool_use 各一条，usage 相同）。
function assistantBlock(messageId, blockType, usage = null) {
  const content = blockType === "tool_use"
    ? [{ type: "tool_use", name: "Read", input: { file_path: "/x/f.txt" } }]
    : [{ type: blockType, text: "x" }];
  return {
    type: "assistant",
    message: {
      id: messageId,
      role: "assistant",
      model: "test",
      usage: usage || { input_tokens: 50, cache_read_input_tokens: 0, output_tokens: 5 },
      content,
    },
  };
}

test("parseArgs：--help/--json/--window 解析", () => {
  assert.equal(parseArgs(["--help"]).help, true);
  assert.equal(parseArgs(["--json"]).json, true);
  assert.equal(parseArgs(["--window-start", "2026-01-01T00:00:00Z"]).windowStart, "2026-01-01T00:00:00Z");
  assert.equal(parseArgs(["--task", "x"]).task, "x");
});

test("AC1 ②：同一 message.id 的多 block 记录只计 1 轮，usage 只取一次", () => {
  const lines = [
    JSON.stringify({ type: "user", message: { role: "user", content: "Task: gap-a" } }),
    // 同一个 message.id 拆成 4 条 apiBlockIndex 记录（thinking/text/tool_use/tool_use）
    JSON.stringify(assistantBlock("m1", "thinking")),
    JSON.stringify(assistantBlock("m1", "text")),
    JSON.stringify(assistantBlock("m1", "tool_use")),
    JSON.stringify(assistantBlock("m1", "tool_use")),
  ].join("\n") + "\n";
  const a = analyzeSession(lines);
  assert.equal(a.rounds, 1); // ⛔ 不是 4 行
  // usage 相同只取一次：50 + 0.1*0 + 5*5 = 75
  assert.equal(a.costEq, 75);
  assert.equal(a.roundsMissingUsage, 0);
});

test("AC1 ③：一轮内含 verify+edit 按优先级归 verify，原始工具计数保留", () => {
  const tools = [
    { name: "mcp__plugin_quay_quay__task_check", input: { task: "gap-a" } }, // verify（优先级最高）
    { name: "Edit", input: { file_path: "/x/f.js" } }, // edit
  ];
  const r = classifyRound(tools);
  assert.equal(r.phase, "verify");
  assert.deepEqual(r.rawToolCounts, { "mcp__plugin_quay_quay__task_check": 1, Edit: 1 });
  assert.equal(r.toolCount, 2);
});

test("classifyToolPhase：五个阶段与 unclassified 的映射", () => {
  assert.equal(classifyToolPhase("Edit", {}), "edit");
  assert.equal(classifyToolPhase("Write", {}), "edit");
  assert.equal(classifyToolPhase("mcp__plugin_quay_quay__task_write", {}), "edit");
  assert.equal(classifyToolPhase("Read", {}), "inspect");
  assert.equal(classifyToolPhase("Grep", {}), "inspect");
  assert.equal(classifyToolPhase("mcp__plugin_quay_quay__task_get", {}), "inspect");
  assert.equal(classifyToolPhase("mcp__plugin_archguard_archguard__archguard_analyze", {}), "inspect");
  assert.equal(classifyToolPhase("mcp__plugin_quay_quay__gate_run", {}), "verify");
  assert.equal(classifyToolPhase("mcp__plugin_quay_quay__lifecycle_promote", {}), "verify");
  assert.equal(classifyToolPhase("SendMessage", {}), "orchestration");
  assert.equal(classifyToolPhase("ListAgents", {}), "orchestration");
  assert.equal(classifyToolPhase("Bash", { command: "git commit -m x" }), "fix");
  assert.equal(classifyToolPhase("Bash", { command: "git status" }), "inspect");
  assert.equal(classifyToolPhase("Bash", { command: "node scripts/test.sh --for-task x" }), "verify");
  assert.equal(classifyToolPhase("Bash", { command: "node plugin/scripts/worker-driver.ts --write-scoped-gate-cache" }), "orchestration");
  assert.equal(classifyToolPhase("SomethingUnknown", {}), null);
});

test("AC1 ①：同一任务多会话正确合并到一个 task 下", () => {
  const dir = mkdtempSync(join(tmpdir(), "ledger-merge-"));
  const t0 = new Date("2026-11-01T00:00:00Z").getTime();
  const s1 = writeWorkerSession(dir, "s1", "gap-a", t0, [assistantRound("m1", [{ name: "Read", input: {} }])]);
  const s2 = writeWorkerSession(dir, "s2", "gap-a", t0 + MIN, [assistantRound("m2", [{ name: "Edit", input: {} }]), assistantRound("m3", [{ name: "Read", input: {} }])]);
  const src = baseSrc({
    sessionsDir: dir,
    sessions: [s1, s2],
    stepTrace: [
      { event: "step-end", step: "ff", ok: true, task: "gap-a", ts: ISO(t0 + 2 * MIN) },
    ],
  });
  const ctx = buildLedger(src, { task: null, windowStart: null, windowEnd: null });
  assert.equal(ctx.tasksTotal, 1);
  assert.equal(ctx.sessionsTotal, 2);
  assert.equal(ctx.totalRounds, 3); // 1 + 2
  assert.equal(ctx.perTask.length, 1);
  assert.equal(ctx.perTask[0].task, "gap-a");
  assert.equal(ctx.perTask[0].sessions, 2);
  assert.equal(ctx.perTask[0].rounds, 3);
});

test("AC1 ④：缺会话文件 ⇒ 轮数 not-evaluated（null），不变成 0", () => {
  const dir = mkdtempSync(join(tmpdir(), "ledger-missingfile-"));
  const t0 = new Date("2026-11-01T00:00:00Z").getTime();
  // sessions 列表里声明了一个 file 但磁盘上没有对应文件
  const ghost = { sessionId: "ghost", task: "gap-a", file: "ghost.jsonl", firstTs: t0 };
  const src = baseSrc({
    sessionsDir: dir,
    sessions: [ghost],
    stepTrace: [{ event: "step-end", step: "ff", ok: true, task: "gap-a", ts: ISO(t0) }],
  });
  const ctx = buildLedger(src, { task: null, windowStart: null, windowEnd: null });
  assert.equal(ctx.sessionsTotal, 1);
  assert.equal(ctx.totalRounds, 0);
  // perTask 里该会话的 rounds 是 null（缺值 = 未查），⛔ 不是 0
  assert.equal(ctx.perTask[0].rounds, 0); // 会话级 rounds=null 不并入合计
  assert.equal(ctx.perTask[0].sessions, 1);
});

test("AC1 ④：缺 fan-in trace ⇒ 落地 not-evaluated，不读成「0 落地」也不读成「成功」", () => {
  const dir = mkdtempSync(join(tmpdir(), "ledger-nofanin-"));
  const t0 = new Date("2026-11-01T00:00:00Z").getTime();
  const s1 = writeWorkerSession(dir, "s1", "gap-a", t0, [assistantRound("m1", [{ name: "Read", input: {} }])]);
  const src = baseSrc({
    sessionsDir: dir,
    sessions: [s1],
    stepTrace: [], // 无 fan-in trace
  });
  const ctx = buildLedger(src, { task: null, windowStart: null, windowEnd: null });
  assert.equal(ctx.tasksTotal, 0); // ⛔ 不把证据不足当「0 落地」
  assert.equal(ctx.landingNotEvaluatedCount, 1); // 单列 not-evaluated
  assert.deepEqual(ctx.landingNotEvaluatedTasks.map((t) => t.task), ["gap-a"]);
});

test("AC1 ⑤：返工原因无法判定 ⇒ unknown 单列，不并入已知类", () => {
  const src = baseSrc({
    workerOutcome: [], // 无任何尝试记录
    stepTrace: [],     // 无 fan-in trace
  });
  // 无 crash/red/exited/landed 证据 ⇒ unknown
  assert.equal(attributeRework(src, "gap-a", new Set(), new Set(), null, null), "unknown");
});

test("返工归因优先级：crash > fan-in-red > worker-exited > superseded > unknown", () => {
  const mk = (workerOutcome, redTasks, landed) => attributeRework(
    baseSrc({ workerOutcome }), "gap-a", landed, redTasks, null, null,
  );
  assert.equal(mk([{ task: "gap-a", final_state: "failed", started_at: ISO(0) }], new Set(), new Set()), "crash-or-timeout");
  assert.equal(mk([{ task: "gap-a", final_state: "completed", started_at: ISO(0) }], new Set(["gap-a"]), new Set()), "fan-in-red");
  assert.equal(mk([{ task: "gap-a", final_state: "exited-not-landed", started_at: ISO(0) }], new Set(), new Set()), "worker-exited");
  assert.equal(mk([{ task: "gap-a", final_state: "completed", started_at: ISO(0) }], new Set(), new Set(["gap-a"])), "superseded");
  assert.equal(mk([], new Set(), new Set()), "unknown");
});

test("attachFanInFacts：ff ok 落地 / ok:false 红；窗口无关（任务级全量）", () => {
  const src = baseSrc({
    stepTrace: [
      { event: "step-end", step: "ff", ok: true, task: "gap-a", ts: "2026-01-01T00:00:00Z" },
      { event: "step-end", step: "suite-end", ok: false, task: "gap-b", ts: "2026-01-01T00:01:00Z" },
      { event: "step-begin", step: "ff", task: "gap-c", ts: "2026-01-01T00:02:00Z" }, // step-begin 不算
    ],
  });
  const fan = attachFanInFacts(src);
  assert.ok(fan.landedTasks.has("gap-a"));
  assert.ok(fan.redTasks.has("gap-b"));
  assert.ok(!fan.landedTasks.has("gap-b"));
  assert.ok(!fan.redTasks.has("gap-c"));
});

test("scanSessions / firstUserMessageText / sessionFirstTsMs：worker 会话识别与 not-evaluated", () => {
  const dir = mkdtempSync(join(tmpdir(), "ledger-scan-"));
  const t0 = new Date("2026-11-01T00:00:00Z").getTime();
  writeWorkerSession(dir, "s1", "gap-a", t0, []);
  // 像 worker 但读不到 Task id
  writeFileSync(join(dir, "s2.jsonl"),
    JSON.stringify({ type: "user", message: { role: "user", content: "You are a per-task worker in the quay repo, no task id here" } }) + "\n");
  // 非 worker 会话
  writeFileSync(join(dir, "s3.jsonl"),
    JSON.stringify({ type: "user", message: { role: "user", content: "some human question" } }) + "\n");
  const r = scanSessions({ sessionsDir: dir });
  assert.equal(r.sessions.length, 1);
  assert.equal(r.sessions[0].task, "gap-a");
  assert.equal(r.notEvaluated, 1);
  assert.equal(r.notWorker, 1);
});

test("windowMembership / sessionFirstTsMs / firstUserMessageText：missing 有独立取值", () => {
  const t0 = new Date("2026-11-01T00:00:00Z").getTime();
  assert.equal(windowMembership(null, t0, t0 + MIN), "missing");
  assert.equal(windowMembership(t0 - 1, t0, t0 + MIN), "outside");
  assert.equal(windowMembership(t0, t0, t0 + MIN), "inside");
  const txt = JSON.stringify({ type: "queue-operation", operation: "enqueue", timestamp: "2026-11-01T00:00:00Z" }) + "\n";
  assert.equal(sessionFirstTsMs(txt), t0);
  assert.equal(sessionFirstTsMs(JSON.stringify({ type: "user", message: {} })), null);
  assert.equal(firstUserMessageText(JSON.stringify({ type: "user", message: { role: "user", content: "hi" } })), "hi");
  assert.equal(firstUserMessageText("no user here\n"), null);
});
