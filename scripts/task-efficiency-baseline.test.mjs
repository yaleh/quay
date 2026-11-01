// task-efficiency-baseline.test.mjs — E1 效率基线工具的单元/反例测试。
// AC1：重复尝试、重复记录、跨窗口任务、缺结束事件、复用 run_id、suite 无法唯一关联均有反例；
//       缺失不能变成零或成功（缺值 = 未查，不与 0/成功共用取值）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildAttempts, attachFanInTrace, attachSuite, attachLanding, summarize,
  classifyRounds, e5Evidence, fanInLogFileName, parseArgs,
} from "./task-efficiency-baseline.mjs";

const ISO = (d) => new Date(d).toISOString();
const MIN = 60_000;

function baseSrc(overrides = {}) {
  return {
    root: "/tmp/fixture-root",
    sessionsDir: "/tmp/fixture-sessions",
    csv: null,
    workerOutcome: [],
    fanInTraceByName: new Map(),
    fanInLockEvents: [],
    verificationRound: [],
    workerRound: [],
    fastModeTelemetry: [],
    workflowEvents: [],
    workerSessions: [],
    csvPresent: false,
    csvRecords: [],
    ...overrides,
  };
}

function wo(task, startedAt, extra = {}) {
  return {
    ts: ISO(startedAt),
    task,
    started_at: ISO(startedAt),
    ended_at: ISO(startedAt + 10 * MIN),
    wall_clock_ms: 10 * MIN,
    run_id: "wk-prod-1",
    final_state: "completed",
    ...extra,
  };
}

test("--help 解析 exit 0 语义", () => {
  assert.equal(parseArgs(["--help"]).help, true);
  assert.equal(parseArgs(["--json"]).json, true);
  assert.equal(parseArgs(["--task", "x"]).task, "x");
  assert.equal(parseArgs(["--window-start", "2026-01-01T00:00:00Z"]).windowStart, "2026-01-01T00:00:00Z");
});

test("重复记录：同一 (task, started_at, ts) 出现两次，去重丢弃并计数", () => {
  const t0 = new Date("2026-10-01T00:00:00Z").getTime();
  const rec = wo("gap-a", t0);
  const src = baseSrc({ workerOutcome: [rec, { ...rec }] });
  const ctx = buildAttempts(src, { windowStart: null, windowEnd: null, task: null });
  assert.equal(ctx.attempts.length, 1);
  assert.equal(ctx.duplicates.length, 1);
});

test("重复尝试：同任务多次派发（不同 started_at）计为多次尝试，返工任务数 ≥1", () => {
  const t0 = new Date("2026-10-01T00:00:00Z").getTime();
  const src = baseSrc({
    workerOutcome: [wo("gap-a", t0), wo("gap-a", t0 + 60 * MIN)],
  });
  const ctx = buildAttempts(src, { windowStart: null, windowEnd: null, task: null });
  attachFanInTrace(src, ctx.attempts);
  attachSuite(src, ctx.attempts);
  attachLanding(src, ctx.attempts);
  const sum = summarize(src, { task: null }, ctx);
  assert.equal(sum.attemptsTotal, 2);
  assert.equal(sum.tasksTotal, 1);
  assert.equal(sum.reworkTasks, 1);
});

test("跨窗口任务：started_at 在窗口外不计入；窗口边界按 started_at（含）", () => {
  const t0 = new Date("2026-10-01T00:00:00Z").getTime();
  const before = wo("gap-before", t0 - 10 * MIN);
  const atStart = wo("gap-at-start", t0);
  const after = wo("gap-after", t0 + 60 * MIN);
  const src = baseSrc({ workerOutcome: [before, atStart, after] });
  const ctx = buildAttempts(src, {
    windowStart: ISO(t0), windowEnd: ISO(t0 + 30 * MIN), task: null,
  });
  assert.deepEqual(ctx.attempts.map((a) => a.task).sort(), ["gap-at-start"]);
});

test("缺结束事件：缺 started_at 未静默丢弃（missingStart），缺 ended_at 时长 not-evaluable", () => {
  const t0 = new Date("2026-10-01T00:00:00Z").getTime();
  const noStart = wo("gap-nostart", t0, { started_at: null, ended_at: null });
  const noEnd = wo("gap-noend", t0, { ended_at: null });
  const src = baseSrc({ workerOutcome: [noStart, noEnd] });
  const ctx = buildAttempts(src, { windowStart: null, windowEnd: null, task: null });
  assert.equal(ctx.missingStart, 1);
  assert.equal(ctx.missingEnd, 1);
  const a = ctx.attempts[0];
  assert.equal(a.task, "gap-noend");
  assert.equal(a.endedAtMs, null); // 缺值 = 未查，不是 0
});

test("复用 run_id：同一 run_id 跨多任务被计量为复用", () => {
  const t0 = new Date("2026-10-01T00:00:00Z").getTime();
  const src = baseSrc({
    workerOutcome: [wo("gap-a", t0, { run_id: "wk-shared" }), wo("gap-b", t0 + 5 * MIN, { run_id: "wk-shared" })],
  });
  const ctx = buildAttempts(src, { windowStart: null, windowEnd: null, task: null });
  assert.equal(ctx.reusedRunIds, 1);
});

test("suite 无法唯一关联：缺 taskId 的记录不 join；同任务两条 suite 记录非唯一", () => {
  const t0 = new Date("2026-10-01T00:00:00Z").getTime();
  const a = wo("gap-a", t0);
  const src = baseSrc({
    workerOutcome: [a],
    verificationRound: [
      { startedAt: ISO(t0 + 5 * MIN), durationMs: 1000, runId: "mfi-1", taskId: "gap-a", commit: "sha-1" },
      { startedAt: ISO(t0 + 6 * MIN), durationMs: 2000, runId: "mfi-2", taskId: "gap-a", commit: "sha-2" },
      { startedAt: ISO(t0 + 7 * MIN), durationMs: 3000, runId: "mfi-3" }, // 缺 taskId ⇒ 不 join
    ],
  });
  const ctx = buildAttempts(src, { windowStart: null, windowEnd: null, task: null });
  attachSuite(src, ctx.attempts);
  const attempt = ctx.attempts[0];
  assert.equal(attempt.suiteRecords.length, 2);
  assert.equal(attempt.suiteUnique, false);
  assert.equal(attempt.suiteLockWaitMs, null); // 缺 lock_wait_ms ⇒ null，不是 0
});

test("缺失不能变成零或成功：无 trace 的尝试锁等待=null，无落地证据 landed=false", () => {
  const t0 = new Date("2026-10-01T00:00:00Z").getTime();
  const a = wo("gap-a", t0);
  const src = baseSrc({ workerOutcome: [a] });
  const ctx = buildAttempts(src, { windowStart: null, windowEnd: null, task: null });
  attachFanInTrace(src, ctx.attempts);
  attachSuite(src, ctx.attempts);
  attachLanding(src, ctx.attempts);
  const attempt = ctx.attempts[0];
  assert.equal(attempt.fanInLockWaitMs, null);
  assert.equal(attempt.landed, false);
  assert.equal(attempt.fanInCommit, null);
  assert.equal(attempt.landedEvidence, null);
});

test("CPU 只取 gnu-time 实测，wall-time 不换算", () => {
  const t0 = new Date("2026-10-01T00:00:00Z").getTime();
  const a = wo("gap-a", t0);
  const src = baseSrc({
    workerOutcome: [a],
    verificationRound: [{
      startedAt: ISO(t0 + 5 * MIN), taskId: "gap-a", runId: "mfi-1",
      durationMs: 600_000, cpu_time_s: 123.4, cpu_source: "gnu-time", commit: "sha-1",
    }],
  });
  const ctx = buildAttempts(src, { windowStart: null, windowEnd: null, task: null });
  attachSuite(src, ctx.attempts);
  attachLanding(src, ctx.attempts);
  const sum = summarize(src, { task: null }, ctx);
  assert.equal(sum.withCpu, 1);
  assert.equal(sum.cpuSumS, 123.4);
  assert.equal(sum.landedTasks, 1);
});

test("落地证据 = verification-round.commit（权威），不是 completed outcome", () => {
  const t0 = new Date("2026-10-01T00:00:00Z").getTime();
  // completed final_state 但无 commit ⇒ 不落地（completed ≠ 权威落地）
  const noCommit = wo("gap-a", t0, { final_state: "completed" });
  const src = baseSrc({ workerOutcome: [noCommit] });
  const ctx = buildAttempts(src, { windowStart: null, windowEnd: null, task: null });
  attachFanInTrace(src, ctx.attempts);
  attachSuite(src, ctx.attempts);
  attachLanding(src, ctx.attempts);
  assert.equal(ctx.attempts[0].landed, false);
});

test("fanInLogFileName 与 worker-fan-in.ts 同形：非法字符替换为 _", () => {
  assert.equal(fanInLogFileName("gap-a", "wk-prod/1"), "fan-in-gap-a-wk-prod_1.log");
});

test("classifyRounds 可下钻至 sessionId，且不可分类者单列", () => {
  const dir = mkdtempSync(join(tmpdir(), "sessions-"));
  const sessionId = "sess-1";
  // 一个 worker 会话：首条 user 消息是 worker 派发前缀，随后 2 条 assistant 轮（1 条无工具 = unclassified，1 条 Edit = fix）
  const lines = [
    JSON.stringify({ type: "user", message: { role: "user", content: "You are a per-task worker in the quay repo (SPEC-worker-driven-inner §5 阶段 2). Task: gap-a. Repo root: /x." } }),
    JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "thinking" }] } }),
    JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Edit", input: { file_path: "/x/f.txt" } }] } }),
  ];
  writeFileSync(join(dir, `${sessionId}.jsonl`), lines.join("\n") + "\n");
  const src = baseSrc({ sessionsDir: dir, workerSessions: [{ sessionId, task: "gap-a", file: `${sessionId}.jsonl` }] });
  const ctx = buildAttempts(src, { windowStart: null, windowEnd: null, task: null });
  const rounds = classifyRounds(src, { task: null }, ctx);
  assert.equal(rounds.sessionsTotal, 1);
  assert.equal(rounds.totalRounds, 2);
  assert.equal(rounds.catCounts.toolWait ?? rounds.catCounts["tool-wait"], 1);
  assert.equal(rounds.catCounts.fix, 1);
  assert.equal(rounds.perSession[0].sessionId, sessionId);
});

test("e5Evidence：资源门拒绝与 ready 池空直接读数，缺 queuedAtMs 不是 0", () => {
  const t0 = new Date("2026-10-01T00:00:00Z").getTime();
  const src = baseSrc({
    workerOutcome: [wo("gap-a", t0)],
    workerRound: [
      { stop_reason: "pool-empty (no dispatchable candidate in the ready pool)" },
      { stop_reason: "resource-gate-wait: {\"load\":99}" },
      { stop_reason: null },
    ],
    workflowEvents: [{ eventKind: "start", timing: { queuedAtMs: null, startedAtMs: t0 } }],
  });
  const ctx = buildAttempts(src, { windowStart: null, windowEnd: null, task: null });
  attachFanInTrace(src, ctx.attempts);
  const e5 = e5Evidence(src, ctx);
  assert.equal(e5.poolEmptyRounds, 1);
  assert.equal(e5.resourceGateRounds, 1);
  assert.equal(e5.queueMeasurable, 0);
  assert.equal(e5.queueMissing, 1);
  assert.equal(e5.queueDelayP50, null); // 缺值 = 未查，不是 0
});
