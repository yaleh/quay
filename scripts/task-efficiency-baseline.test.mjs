// task-efficiency-baseline.test.mjs — E1 效率基线工具的单元/反例测试。
// 覆盖（AC1-AC5）：同 task 多尝试、复用 run_id、窗口外 suite、缺 startedAt、歧义关联、重复 suite、
//   落地正负控制、CPU/验证时长身份去重、墙钟归属覆盖率（取代 ITE 误名 + 重叠不截断）、
//   suite 结局互斥分类与 E5 直接证据语义。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildAttempts, attachFanInTrace, attachSuite, attachLanding, summarize,
  classifyRounds, e5Evidence, fanInLogFileName, parseArgs, classifySuiteOutcome,
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

function trace(step, tsMs, extra = {}) {
  return { ts: ISO(tsMs), step, exit: 0, wall_ms: 1000, ok: true, ...extra };
}

function withTrace(src, task, runId, recs) {
  src.fanInTraceByName.set(fanInLogFileName(task, runId), recs);
  return src;
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

test("suite 关联：缺 taskId 的记录不 join；同任务两条各自唯一的 suite 记录都 proven（多次真实 suite 各自计一次）", () => {
  const t0 = new Date("2026-10-01T00:00:00Z").getTime();
  const a = wo("gap-a", t0);
  const src = baseSrc({
    workerOutcome: [a],
    verificationRound: [
      { round: 1, startedAt: ISO(t0 + 5 * MIN), durationMs: 1000, runId: "mfi-1", taskId: "gap-a", commit: "sha-1" },
      { round: 2, startedAt: ISO(t0 + 6 * MIN), durationMs: 2000, runId: "mfi-2", taskId: "gap-a", commit: "sha-2" },
      { round: 3, startedAt: ISO(t0 + 7 * MIN), durationMs: 3000, runId: "mfi-3" }, // 缺 taskId ⇒ 不 join
    ],
  });
  const ctx = buildAttempts(src, { windowStart: null, windowEnd: null, task: null });
  attachSuite(src, ctx.attempts);
  const attempt = ctx.attempts[0];
  assert.equal(attempt.suiteRecords.length, 2);
  assert.equal(attempt.suiteUniqueRecords.length, 2); // 两条记录都只被本尝试命中 ⇒ 都 proven
  assert.equal(attempt.suiteAssociation, "proven");
  assert.equal(attempt.suiteLockWaitMs, null); // 记录无 lock_wait_ms ⇒ null，不是 0
});

test("窗口外 suite 不用同 task 全部历史 recs 兜底（AC1）", () => {
  const t0 = new Date("2026-10-01T00:00:00Z").getTime();
  const a = wo("gap-a", t0); // 窗口 [t0, t0+10min]
  const src = baseSrc({
    workerOutcome: [a],
    verificationRound: [
      { round: 1, startedAt: ISO(t0 + 30 * MIN), durationMs: 1000, runId: "mfi-1", taskId: "gap-a", commit: "sha-1" },
    ],
  });
  const ctx = buildAttempts(src, { windowStart: null, windowEnd: null, task: null });
  attachSuite(src, ctx.attempts);
  const attempt = ctx.attempts[0];
  assert.equal(attempt.suiteRecords.length, 0); // 旧实现会回填 recs[0]，现在不回填
  assert.equal(attempt.suiteAssociation, "missing");
});

test("缺 startedAt 的 suite 记录不归属任何尝试（AC1）", () => {
  const t0 = new Date("2026-10-01T00:00:00Z").getTime();
  const a = wo("gap-a", t0);
  const src = baseSrc({
    workerOutcome: [a],
    verificationRound: [
      { round: 1, durationMs: 1000, runId: "mfi-1", taskId: "gap-a", commit: "sha-1" }, // 缺 startedAt
    ],
  });
  const ctx = buildAttempts(src, { windowStart: null, windowEnd: null, task: null });
  attachSuite(src, ctx.attempts);
  assert.equal(ctx.attempts[0].suiteAssociation, "missing");
});

test("重复 suite：同 round 记录两次，身份去重后只计一次（AC1/AC3）", () => {
  const t0 = new Date("2026-10-01T00:00:00Z").getTime();
  const a = wo("gap-a", t0);
  const rec = { round: 1, startedAt: ISO(t0 + 5 * MIN), durationMs: 1000, runId: "mfi-1", taskId: "gap-a", commit: "sha-1", cpu_time_s: 60, cpu_source: "gnu-time" };
  const src = baseSrc({
    workerOutcome: [a],
    verificationRound: [rec, { ...rec }], // 同一 round 重复
  });
  const ctx = buildAttempts(src, { windowStart: null, windowEnd: null, task: null });
  attachSuite(src, ctx.attempts);
  attachLanding(src, ctx.attempts);
  const attempt = ctx.attempts[0];
  assert.equal(src.verificationRoundDuplicates, 1);
  assert.equal(attempt.suiteAssociation, "proven"); // 去重后唯一
  const sum = summarize(src, { task: null }, ctx);
  assert.equal(sum.cpuUniqueSumS, 60); // 不翻倍
  assert.equal(sum.uniqueSuiteCount, 1);
});

test("多对多候选：同一 suite 记录被多次尝试命中 ⇒ 歧义，不参与确定归属聚合（AC1/AC3）", () => {
  const t0 = new Date("2026-10-01T00:00:00Z").getTime();
  // 两个窗口重叠的尝试（fixture 构造；真实尝试不重叠，但反向索引必须兜底）
  const a1 = wo("gap-a", t0, { ended_at: ISO(t0 + 8 * MIN) });
  const a2 = wo("gap-a", t0 + 4 * MIN, { started_at: ISO(t0 + 4 * MIN), ended_at: ISO(t0 + 12 * MIN) });
  const src = baseSrc({
    workerOutcome: [a1, a2],
    verificationRound: [
      { round: 1, startedAt: ISO(t0 + 5 * MIN), durationMs: 1000, runId: "mfi-1", taskId: "gap-a", commit: "sha-1", cpu_time_s: 60, cpu_source: "gnu-time" },
    ],
  });
  const ctx = buildAttempts(src, { windowStart: null, windowEnd: null, task: null });
  attachSuite(src, ctx.attempts);
  for (const a of ctx.attempts) assert.equal(a.suiteAssociation, "ambiguous");
  const sum = summarize(src, { task: null }, ctx);
  assert.equal(sum.cpuUniqueSumS, 0); // 歧义不并入 CPU 合计
  assert.equal(sum.uniqueSuiteCount, 0);
});

test("落地负控制：只有受测 commit / suite green / final_state=completed 不算落地（AC2）", () => {
  const t0 = new Date("2026-10-01T00:00:00Z").getTime();
  const a = wo("gap-a", t0, { final_state: "completed" });
  const src = baseSrc({
    workerOutcome: [a],
    verificationRound: [
      { round: 1, startedAt: ISO(t0 + 5 * MIN), durationMs: 1000, runId: "mfi-1", taskId: "gap-a", commit: "sha-1", state: "green" },
    ],
  });
  const ctx = buildAttempts(src, { windowStart: null, windowEnd: null, task: null });
  attachFanInTrace(src, ctx.attempts);
  attachSuite(src, ctx.attempts);
  attachLanding(src, ctx.attempts);
  assert.equal(ctx.attempts[0].landed, false);
  assert.equal(ctx.attempts[0].landingStatus, "unknown"); // 无法确认 ⇒ unknown，不是已失败
  assert.equal(ctx.attempts[0].fanInCommit, "sha-1"); // 受测 SHA 仍记录，但不是落地证据
});

test("落地正控制：ok:true 的 ff 步骤才是落地证据（AC2）", () => {
  const t0 = new Date("2026-10-01T00:00:00Z").getTime();
  const a = wo("gap-a", t0);
  const src = withTrace(baseSrc({ workerOutcome: [a] }), "gap-a", "wk-prod-1", [
    trace("acquire-fan-in-lock", t0 + 5 * MIN),
    trace("ff", t0 + 9 * MIN),
  ]);
  const ctx = buildAttempts(src, { windowStart: null, windowEnd: null, task: null });
  attachFanInTrace(src, ctx.attempts);
  attachSuite(src, ctx.attempts);
  attachLanding(src, ctx.attempts);
  assert.equal(ctx.attempts[0].landed, true);
  assert.equal(ctx.attempts[0].landingStatus, "landed");
  assert.equal(ctx.attempts[0].landedEvidence, "fan-in-trace.ff(ok)");
});

test("落地失败与后一次落地不污染前一次（AC2）", () => {
  const t0 = new Date("2026-10-01T00:00:00Z").getTime();
  const a1 = wo("gap-a", t0);
  const a2 = wo("gap-a", t0 + 60 * MIN);
  const src = withTrace(baseSrc({ workerOutcome: [a1, a2] }), "gap-a", "wk-prod-1", [
    // 第一次尝试：fan-in 收尾但无 ok ff（明确未落地）
    trace("acquire-fan-in-lock", t0 + 5 * MIN),
    trace("release-fan-in-lock", t0 + 6 * MIN),
    // 第二次尝试：ff ok（落地）
    trace("acquire-fan-in-lock", t0 + 65 * MIN),
    trace("ff", t0 + 69 * MIN),
    trace("release-fan-in-lock", t0 + 69 * MIN + 1000),
  ]);
  const ctx = buildAttempts(src, { windowStart: null, windowEnd: null, task: null });
  attachFanInTrace(src, ctx.attempts);
  attachSuite(src, ctx.attempts);
  attachLanding(src, ctx.attempts);
  const [f, s] = ctx.attempts;
  assert.equal(f.landed, false);
  assert.equal(f.landingStatus, "not-landed"); // 明确失败，不是未知
  assert.equal(s.landed, true);
  assert.equal(s.landingStatus, "landed");
});

test("CPU 只取 gnu-time 实测，wall-time 不换算", () => {
  const t0 = new Date("2026-10-01T00:00:00Z").getTime();
  const a = wo("gap-a", t0);
  const src = baseSrc({
    workerOutcome: [a],
    verificationRound: [{
      round: 1, startedAt: ISO(t0 + 5 * MIN), taskId: "gap-a", runId: "mfi-1",
      durationMs: 600_000, cpu_time_s: 123.4, cpu_source: "gnu-time", commit: "sha-1",
    }],
  });
  const ctx = buildAttempts(src, { windowStart: null, windowEnd: null, task: null });
  attachSuite(src, ctx.attempts);
  attachLanding(src, ctx.attempts);
  const sum = summarize(src, { task: null }, ctx);
  assert.equal(sum.withCpu, 1);
  assert.equal(sum.cpuUniqueSumS, 123.4);
  assert.equal(sum.uniqueSuiteCount, 1);
  assert.equal(sum.landedTasks, 0); // 受测 commit 不是落地
});

test("墙钟归属覆盖率：无 trace 的尝试缺失（不渲染为 0），重叠不截断（AC4）", () => {
  const t0 = new Date("2026-10-01T00:00:00Z").getTime();
  // 尝试 wall=10min，但 trace 阶段墙钟合计 15min ⇒ ratio=1.5，不截断到 1。
  const a = wo("gap-a", t0, { wall_clock_ms: 10 * MIN });
  const src = withTrace(baseSrc({ workerOutcome: [a] }), "gap-a", "wk-prod-1", [
    trace("acquire-fan-in-lock", t0 + 1 * MIN, { wall_ms: 9 * MIN }),
    trace("suite-end", t0 + 2 * MIN, { wall_ms: 6 * MIN }),
  ]);
  const ctx = buildAttempts(src, { windowStart: null, windowEnd: null, task: null });
  attachFanInTrace(src, ctx.attempts);
  attachSuite(src, ctx.attempts);
  attachLanding(src, ctx.attempts);
  const sum = summarize(src, { task: null }, ctx);
  assert.equal(sum.wallAttr.length, 1);
  assert.equal(sum.wallAttr[0].ratio, 1.5); // 不 Math.min(1,…)
  assert.equal(sum.wallAttrOverlap, 1);

  // 无 trace ⇒ 不产生 wallAttr（缺失不是 0）
  const src2 = baseSrc({ workerOutcome: [wo("gap-b", t0)] });
  const ctx2 = buildAttempts(src2, { windowStart: null, windowEnd: null, task: null });
  attachFanInTrace(src2, ctx2.attempts);
  attachSuite(src2, ctx2.attempts);
  attachLanding(src2, ctx2.attempts);
  const sum2 = summarize(src2, { task: null }, ctx2);
  assert.equal(sum2.wallAttr.length, 0);
  assert.equal(sum2.perTask[0].wallAttrMean, null);
});

test("suite 结局分类：分类失败只认明确证据，前序中止/缺结束事件/缺日志分别计量（AC5）", () => {
  const t0 = new Date("2026-10-01T00:00:00Z").getTime();
  const mk = (task, runId, recs) => {
    const a = wo(task, t0, { run_id: runId });
    const src = withTrace(baseSrc({ workerOutcome: [a] }), task, runId, recs);
    const ctx = buildAttempts(src, { windowStart: null, windowEnd: null, task: null });
    attachFanInTrace(src, ctx.attempts);
    return ctx.attempts[0].suiteOutcome;
  };
  // 前序中止：ac-precheck 失败，无 suite-start
  assert.equal(mk("gap-a", "r1", [
    trace("acquire-fan-in-lock", t0 + 1 * MIN),
    trace("ac-precheck", t0 + 2 * MIN, { ok: false, reason: "AC/DoD 段缺失" }),
    trace("release-fan-in-lock", t0 + 3 * MIN),
  ]), "pre-commit-abort");
  // 缺结束事件：suite-start 后无 end/skip/incomplete
  assert.equal(mk("gap-b", "r2", [
    trace("suite-start", t0 + 2 * MIN),
  ]), "missing-end-event");
  // 无 suite-end/skip 但也不是分类失败
  assert.equal(mk("gap-c", "r3", [
    trace("suite-start", t0 + 2 * MIN),
    trace("suite-end", t0 + 3 * MIN, { ok: false }),
  ]), "suite-ran");
  // 明确分类器失败
  assert.equal(mk("gap-d", "r4", [
    trace("instrument-probe", t0 + 2 * MIN, { ok: false, reason: "classifier=unavailable" }),
  ]), "classifier-failure");
  // 缺日志
  assert.equal(classifySuiteOutcome([]), "missing-log");
});

test("E5：pool-empty 不构成持续积压，resource-gate-wait 不单独证明持续队列；无直接证据输出未知（AC5）", () => {
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
  assert.equal(e5.persistentQueue, "not-evaluated"); // 无直接队列证据 ⇒ 未知
  assert.equal(Object.hasOwn(e5, "lockWaitSignificant"), false); // 撤销 p50>60s 自动判词
  assert.equal(Object.hasOwn(e5, "persistentQueueEvidence"), false); // 撤销 pool-empty+resource-gate-wait 相加
});

test("classifyRounds 可下钻至 sessionId，且不可分类者单列", () => {
  const dir = mkdtempSync(join(tmpdir(), "sessions-"));
  const sessionId = "sess-1";
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

test("fanInLogFileName 与 worker-fan-in.ts 同形：非法字符替换为 _", () => {
  assert.equal(fanInLogFileName("gap-a", "wk-prod/1"), "fan-in-gap-a-wk-prod_1.log");
});
