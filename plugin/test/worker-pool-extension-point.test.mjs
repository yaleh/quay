// @test-group serial
// worker-pool-extension-point.test.mjs — 结局处理扩展点的可取假验证（GOAL-909 / AC-915；DIR-133 裁定 2）。
//
// WHY（本文件的取假面）：AC-915 明确把「把代码搬到了另一个文件」判为**不达成**。判据问的是
// 「新增一种结局 / 决策种类，能不能不改中心文件就接入」。所以本文件只 import 一个项目模块：
// `worker-pool.ts`（外加 node 标准库）——⛔ 它不得提到中心文件名，也不得 import 第二个项目模块。
// 正向：从**外部**注册一个中心文件从未见过的合成处理单元 ⇒ 该单元被调用、其声明的转移被应用。
// 反向（硬规则 4，测试内自带两条负对照）：
//   ① 同构的**未注册**池喂同一结局 ⇒ 报告为空且【没有】转移（用 assert.equal 明确断言「没注册就没有」）；
//   ② **绕过注册表**直接调 `applyTransition` ⇒ 转移仍生效——证明转移机制本身可用，因此 ① 之外的
//      正向断言失败只可能来自注册面失效（区分「未评估」与「不合格」，硬规则 3b）。
// ⛔ 断言不以「新增文件存在」为达成。

import { test } from "node:test";
import assert from "node:assert/strict";

import { WorkerPool } from "../scripts/worker-pool.ts";

/** 合成结局事件（只填处理单元需要的字段；⛔ 不依赖生产默认值）。 */
const makeEvent = (finalState, taskId = "gap-synthetic") => ({
  taskId,
  finalState,
  exitedNotLanded: null,
  quickDeath: null,
  maxRetries: 3,
  quickDeathMs: 60_000,
});

/** 一个外部合成单元：只在 finalState 命中时声明「该任务 needs-human」。 */
const syntheticUnit = (id, finalState, taskId, counter) => ({
  id,
  matches: (e) => e.finalState === finalState,
  plan: () => {
    counter.n += 1;
    return { needsHuman: [{ taskId, reason: `synthetic:${id}`, kind: "stop-terminal" }] };
  },
});

test("正向：外部注册的合成单元被调用，它声明的转移被应用，报告含该单元 id", () => {
  const pool = new WorkerPool();
  const counter = { n: 0 };
  pool.registerOutcomeHandler(syntheticUnit("synthetic-unit", "synthetic-outcome", "gap-synthetic", counter));

  const reports = pool.dispatchOutcome(makeEvent("synthetic-outcome"));

  assert.equal(counter.n, 1, "单元被调用恰好一次");
  assert.equal(pool.needsHuman("gap-synthetic"), true, "声明的转移（needs-human latch）被应用");
  assert.deepEqual(reports.map((r) => r.id), ["synthetic-unit"], "报告含命中单元 id");
  assert.equal(reports[0].applied, true, "报告标明转移已应用");
});

test("通用分派：两个不同 finalState 的合成单元各自命中（不是硬编码单例）", () => {
  const pool = new WorkerPool();
  const first = { n: 0 };
  const second = { n: 0 };
  pool.registerOutcomeHandler(syntheticUnit("unit-first", "synthetic-outcome", "gap-first", first));
  pool.registerOutcomeHandler(syntheticUnit("unit-second", "synthetic-other", "gap-second", second));

  const reports = pool.dispatchOutcome(makeEvent("synthetic-other"));

  assert.deepEqual(reports.map((r) => r.id), ["unit-second"], "只命中结局种类匹配的那个单元");
  assert.equal(first.n, 0, "另一结局种类的单元计数器不增");
  assert.equal(second.n, 1, "匹配的单元被调用一次");
  assert.equal(pool.needsHuman("gap-second"), true, "匹配单元声明的转移被应用");
  assert.equal(pool.needsHuman("gap-first"), false, "未命中单元声明的转移不被应用");
});

test("负对照A：未注册该单元 ⇒ 报告为空且没有转移（没注册就没有）", () => {
  // 同构的池，但【不注册】任何处理单元。若正向断言在「注册面失效」时仍能通过，这条就会同时通过
  // ⇒ 两条合起来才能取假（硬规则 4）。
  const pool = new WorkerPool();
  const reports = pool.dispatchOutcome(makeEvent("synthetic-outcome"));

  assert.equal(reports.length, 0, "无命中单元 ⇒ 报告为空数组");
  assert.equal(pool.needsHuman("gap-synthetic"), false, "没注册就没有转移（不是「转移恒成立」）");
});

test("负对照B：绕过注册表直接调 applyTransition ⇒ 转移机制本身可用", () => {
  // 这条证明的不是注册面，而是 applyTransition 这一层：它可用 ⇒ 负对照A 里「没有转移」只能归因于
  // 「没有单元声明它」，而不是「转移机制坏了」。两个取值因此在读数上可区分（硬规则 3b）。
  const pool = new WorkerPool();
  const res = pool.applyTransition({
    needsHuman: [{ taskId: "gap-synthetic", reason: "direct-apply", kind: "stop-terminal" }],
  });

  assert.equal(res.needsHumanResults.length, 1, "applyTransition 返回落地读数");
  assert.equal(pool.needsHuman("gap-synthetic"), true, "绕过注册表时转移仍生效");
});

test("注销函数生效：registerOutcomeHandler 返回的函数把单元撤出注册表", () => {
  const pool = new WorkerPool();
  const counter = { n: 0 };
  const unregister = pool.registerOutcomeHandler(
    syntheticUnit("synthetic-unit", "synthetic-outcome", "gap-synthetic", counter),
  );
  unregister();
  const reports = pool.dispatchOutcome(makeEvent("synthetic-outcome"));
  assert.equal(reports.length, 0, "注销后不再命中");
  assert.equal(counter.n, 0, "注销后不再被调用");
  assert.equal(pool.needsHuman("gap-synthetic"), false);
});

test("同一 id 重复注册 ⇒ 显式报错（⛔ 不静默覆盖）", () => {
  const pool = new WorkerPool();
  const counter = { n: 0 };
  pool.registerOutcomeHandler(syntheticUnit("dup-unit", "synthetic-outcome", "gap-a", counter));
  assert.throws(
    () => pool.registerOutcomeHandler(syntheticUnit("dup-unit", "synthetic-other", "gap-b", counter)),
    /already registered/,
    "重复注册同一 id 必须显式失败",
  );
});

test("内置单元经同一注册面注册：覆盖 3 个 exited-not-landed 分支 + 快速死亡退避 + environment-fatal + needs-human 终态", () => {
  const pool = new WorkerPool();
  const required = [
    "exited-not-landed-stop-terminal",
    "exited-not-landed-count-and-retry",
    "exited-not-landed-baseline-red-deadlock",
    "quick-death-backoff",
    "environment-fatal-halt",
    "needs-human-terminal",
  ];
  const builtins = pool.builtinOutcomeHandlerIds();
  const registered = pool.outcomeHandlerIds();
  for (const id of required) {
    assert.equal(builtins.includes(id), true, `内置单元 ${id} 已注册（builtinOutcomeHandlerIds）`);
    assert.equal(registered.includes(id), true, `内置单元 ${id} 在同一注册表里（⛔ 不走后门）`);
  }
  assert.ok(builtins.length >= 6, `内置 id 集合至少 6 个（实测 ${builtins.length}）`);
});

test("内置单元对真实形状的事件声明转移：count-and-retry 推进重试上限、达上限转 needs-human", () => {
  const pool = new WorkerPool();
  const event = {
    ...makeEvent("exited-not-landed", "gap-builtin"),
    maxRetries: 2,
    exitedNotLanded: {
      evaluated: true,
      decisionKind: "count-and-retry",
      decisionReason: "first unattributable exited-not-landed failure",
      failingTestFiles: [],
      deadlock: null,
      retryExempt: false,
      exemptionVerdict: "insufficient-data-fallback",
      exemptionReason: null,
    },
  };

  const first = pool.dispatchOutcome(event);
  assert.deepEqual(first.map((r) => r.id), ["exited-not-landed-count-and-retry"], "命中重试分支");
  assert.deepEqual(first[0].retryAdvanced, [], "第 1 次未达上限 ⇒ 不转 needs-human");
  assert.equal(pool.needsHuman("gap-builtin"), false);

  const second = pool.dispatchOutcome(event);
  assert.deepEqual(second[0].retryAdvanced, ["gap-builtin"], "第 2 次达上限 ⇒ 标记该 id");
  assert.equal(pool.needsHuman("gap-builtin"), true, "达上限即 latch needs-human");
});

test("内置单元：environment-fatal ⇒ 报告带 halt 声明（pool 不执行磁盘动作、⛔ 不翻转任务）", () => {
  const pool = new WorkerPool();
  const event = {
    ...makeEvent("failed", "gap-env-fatal"),
    quickDeath: {
      quickDeath: true,
      backedOff: false,
      newlyNeedsHuman: false,
      cause: "environment-fatal",
      backoffUntil: null,
      signature: "model_not_found",
      evidence: "API error: model_not_found",
    },
  };

  const reports = pool.dispatchOutcome(event);
  const halt = reports.find((r) => r.id === "environment-fatal-halt");
  assert.ok(halt, "environment-fatal 单元命中");
  assert.match(halt.transition.halt.reason, /model_not_found/, "停机原因带签名名");
  assert.equal(halt.applied, true, "halt 声明被带出（写控制态由调用方执行）");
  assert.equal(pool.needsHuman("gap-env-fatal"), false, "⛔ 不翻转任何任务状态");
});

test("内置单元：exited-not-landed 未评估（ff-not-fast-forward）⇒ 不命中任何重试分支", () => {
  const pool = new WorkerPool();
  const event = {
    ...makeEvent("exited-not-landed", "gap-not-evaluated"),
    exitedNotLanded: {
      evaluated: false,
      decisionKind: null,
      decisionReason: null,
      failingTestFiles: [],
      deadlock: null,
      retryExempt: false,
      exemptionVerdict: null,
      exemptionReason: null,
    },
  };
  const reports = pool.dispatchOutcome(event);
  assert.deepEqual(reports.map((r) => r.id), [], "未评估 ≠ 某个决策种类（⛔ 不落进任一分派）");
  assert.equal(pool.needsHuman("gap-not-evaluated"), false);
});
