// effort-tiering-effect.test.mjs — role 层 effort 降档效果测量工具的单元/反例测试。
// 覆盖 AC1：①同 role 的 high 与 low 会话分别聚合、互不混入；②缺 effort 字段 ⇒ not-evaluated；
//          ③同一 session 内 high/low 混用 ⇒ mixed，不并入任一侧。
// 另覆盖 AC2 的 --help 解析、role 分类、usage 解析与结论三选一。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseArgs, classifyRole, firstUserContentText, usageTokens, analyzeSessionRecords,
  aggregate, roleSufficiency, conclude, MIN_N,
} from "./effort-tiering-effect.mjs";

// ── fixture 构造 ────────────────────────────────────────────────────────────
const SELECTOR_MSG = "You are the resident task selector for the quay worker driver (SPEC §5 阶段 4 — AC129). Candidate task ids: gap-a.";
const POOL_JUDGE_MSG = "You are the pool-quality gate for the quay task pool (ADR-033). Repo root: /x.";
const ARCH_JUDGE_MSG = "You are the architecture-review judge for the quay repo (docs/proposals/archguard-generation-era-primitives.md §3).";
const META_DRIVER_MSG = "You are the meta-driver: a fresh-context reviewer of whether the project's ACTIVE GOALS are actually being reached.";

function user(content) {
  return { type: "user", timestamp: "2026-11-02T00:00:00.000Z", message: { role: "user", content } };
}
function assistant(effort, usage, ts = "2026-11-02T00:01:00.000Z") {
  const rec = { type: "assistant", timestamp: ts, message: { role: "assistant", usage } };
  if (effort !== undefined) rec.effort = effort;
  return rec;
}
function usage({ input = 100, output = 10, cacheRead = 0, cacheCreation = 0 } = {}) {
  return {
    input_tokens: input,
    output_tokens: output,
    cache_creation_input_tokens: cacheCreation,
    cache_read_input_tokens: cacheRead,
  };
}
function session(roleMsg, effort, opts = {}) {
  // 一个会话 = 一条 user + 一条（或多条）assistant。
  const records = [user(roleMsg)];
  if (opts.assistants) records.push(...opts.assistants);
  else records.push(assistant(effort, usage(opts.usage || {}), opts.ts));
  return analyzeSessionRecords(records);
}

// ── AC1①：同 role 的 high 与 low 分别聚合、互不混入 ────────────────────────
test("同 role 的 high 与 low 会话分别聚合、互不混入", () => {
  const analyses = [
    session(SELECTOR_MSG, "high", { usage: { input: 100, output: 10 } }),
    session(SELECTOR_MSG, "high", { usage: { input: 200, output: 20 } }),
    session(SELECTOR_MSG, "low", { usage: { input: 50, output: 5 } }),
  ];
  const sum = aggregate(analyses);
  assert.equal(sum.selector.high.n, 2);
  assert.equal(sum.selector.low.n, 1);
  // high 侧只聚合 high 的 output：均值 = (10+20)/2 = 15，不被 low 的 5 拉低。
  assert.equal(sum.selector.high.outputPerMsg.mean, 15);
  assert.equal(sum.selector.low.outputPerMsg.mean, 5);
  // 其它 role 无样本。
  assert.equal(sum["pool-judge"].high.n, 0);
  assert.equal(sum["meta-driver"].low.n, 0);
});

test("三个 role 的首条 user 消息各自归类，不互相污染", () => {
  assert.equal(session(SELECTOR_MSG, "high").role, "selector");
  assert.equal(session(POOL_JUDGE_MSG, "high").role, "pool-judge");
  assert.equal(session(ARCH_JUDGE_MSG, "high").role, "pool-judge"); // arch-review 也是 pool-judge role
  assert.equal(session(META_DRIVER_MSG, "high").role, "meta-driver");
  assert.equal(session("You are a per-task worker in the quay repo. Task: gap-x.", "high").role, "other");
});

// ── AC1②：缺 effort 字段 ⇒ not-evaluated，不计入任一侧 ──────────────────────
test("缺 effort 字段 ⇒ not-evaluated（独立取值，不并入 high/low）", () => {
  const a = session(SELECTOR_MSG, undefined, { usage: { input: 100, output: 10 } });
  assert.equal(a.bucket, "not-evaluated");
  const sum = aggregate([a, session(SELECTOR_MSG, "high")]);
  assert.equal(sum.selector.high.n, 1);
  assert.equal(sum.selector["not-evaluated"].n, 1);
  assert.equal(sum.selector.low.n, 0);
});

test("缺 usage ⇒ not-evaluated（缺值 = 未查，不与 0 共用）", () => {
  const a = analyzeSessionRecords([
    user(SELECTOR_MSG),
    { type: "assistant", timestamp: "2026-11-02T00:01:00.000Z", effort: "high", message: { role: "assistant" } }, // 无 usage
  ]);
  assert.equal(a.bucket, "not-evaluated");
});

test("无 assistant 记录 ⇒ not-evaluated", () => {
  const a = analyzeSessionRecords([user(SELECTOR_MSG)]);
  assert.equal(a.bucket, "not-evaluated");
});

// ── AC1③：同一 session 内 high/low 混用 ⇒ mixed，不并入任一侧 ────────────────
test("同一 session 内 high/low 混用 ⇒ mixed，不并入任一侧", () => {
  const a = analyzeSessionRecords([
    user(SELECTOR_MSG),
    assistant("high", usage({ input: 100, output: 10 }), "2026-11-02T00:01:00.000Z"),
    assistant("low", usage({ input: 80, output: 8 }), "2026-11-02T00:02:00.000Z"),
  ]);
  assert.equal(a.bucket, "mixed");
  assert.deepEqual(a.distinctEfforts, ["high", "low"]);
  const sum = aggregate([a, session(SELECTOR_MSG, "high")]);
  assert.equal(sum.selector.mixed.n, 1);
  assert.equal(sum.selector.high.n, 1);
  assert.equal(sum.selector.low.n, 0); // mixed 不并入 low
});

// ── 指标口径 ───────────────────────────────────────────────────────────────
test("usageTokens：fresh = input_tokens 本身（cache_* 是额外缓存读数）；缺 input/output ⇒ null", () => {
  assert.deepEqual(usageTokens(usage({ input: 100, output: 10, cacheRead: 20, cacheCreation: 5 })), {
    input: 100, output: 10, cacheRead: 20, cacheCreation: 5, fresh: 100,
  });
  assert.equal(usageTokens({ input_tokens: 100 }), null); // 缺 output
  assert.equal(usageTokens(null), null);
});

test("会话时长 = 最晚 − 最早 timestamp", () => {
  const a = analyzeSessionRecords([
    user(SELECTOR_MSG),
    assistant("high", usage(), "2026-11-02T00:03:00.000Z"),
  ]);
  // user ts = 00:00:00，assistant ts = 00:03:00 ⇒ 3 min。
  assert.equal(a.durationMs, 3 * 60 * 1000);
});

// ── 样本是否足够 / 结论 ─────────────────────────────────────────────────────
test("roleSufficiency：任一侧 n < MIN_N 判为不足", () => {
  const cell = {
    high: { n: 30 },
    low: { n: MIN_N - 1 },
    mixed: { n: 0 },
    "not-evaluated": { n: 0 },
  };
  assert.equal(roleSufficiency(cell).sufficient, false);
  cell.low.n = MIN_N;
  assert.equal(roleSufficiency(cell).sufficient, true);
});

test("conclude：没有任何 role 双侧足够 ⇒ not-evaluated（含缺输入与重测条件）", () => {
  const summary = {
    selector: { high: { n: 5, outputPerMsg: { mean: 10 }, durationMs: { p50: 1 } }, low: { n: 3, outputPerMsg: { mean: 10 }, durationMs: { p50: 1 } }, mixed: { n: 0 }, "not-evaluated": { n: 0 } },
    "pool-judge": { high: { n: 5, outputPerMsg: { mean: 10 }, durationMs: { p50: 1 } }, low: { n: 3, outputPerMsg: { mean: 10 }, durationMs: { p50: 1 } }, mixed: { n: 0 }, "not-evaluated": { n: 0 } },
    "meta-driver": { high: { n: 5, outputPerMsg: { mean: 10 }, durationMs: { p50: 1 } }, low: { n: 3, outputPerMsg: { mean: 10 }, durationMs: { p50: 1 } }, mixed: { n: 0 }, "not-evaluated": { n: 0 } },
  };
  const c = conclude(summary);
  assert.equal(c.verdict, "not-evaluated");
  assert.ok(c.missingInput);
  assert.ok(c.retestCondition);
});

test("conclude：足够 role 无回归 ⇒ keep；输出明显回归 ⇒ revert", () => {
  const cell = (highN, lowN, lowOutMean) => ({
    high: { n: highN, outputPerMsg: { mean: 100 }, durationMs: { p50: 60000 } },
    low: { n: lowN, outputPerMsg: { mean: lowOutMean }, durationMs: { p50: 60000 } },
    mixed: { n: 0 },
    "not-evaluated": { n: 0 },
  });
  const mk = (outMean) => ({
    selector: cell(30, 25, outMean),
    "pool-judge": cell(30, 30, 100),
    "meta-driver": cell(30, 30, 100),
  });
  assert.equal(conclude(mk(100)).verdict, "keep");
  assert.equal(conclude(mk(121)).verdict, "revert"); // 121 > 100×1.2
});

// ── AC2：--help 解析与公开 schema ───────────────────────────────────────────
test("parseArgs 解析 --help / --json / --sessions-dir / --root", () => {
  assert.equal(parseArgs(["--help"]).help, true);
  assert.equal(parseArgs(["--json"]).json, true);
  assert.equal(parseArgs(["--sessions-dir", "/x"]).sessionsDir, "/x");
  assert.equal(parseArgs(["--root", "/y"]).root, "/y");
});

test("classifyRole 对 null/未知返回 other", () => {
  assert.equal(classifyRole(null), "other");
  assert.equal(classifyRole(""), "other");
  assert.equal(classifyRole("random text"), "other");
});

test("firstUserContentText 处理 string 与 array 内容", () => {
  assert.equal(firstUserContentText([user("hello")]), "hello");
  assert.equal(firstUserContentText([
    { type: "user", message: { role: "user", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] } },
  ]), "ab");
  assert.equal(firstUserContentText([{ type: "assistant" }]), null);
});
