// @test-group engine
// worker-pool.test.mjs — `WorkerPool` 拥有 retry/backoff 状态 (AC-914 / GOAL-909).
//
// WHY（本文件的取假面）：AC-914 把「把同样的闭包变量换个文件继续以模块级变量存在」判为**不达成**。
// 所以这里判的不是「grep 变绿」，而是两件事：
//   ① 结构面 —— 状态不可从外部持有（`Object.keys(new WorkerPool())` 里没有任何状态字段）；
//   ② 行为面 —— 转移确实经类的方法完成且可用（计数 / needs-human 落盘 / 退避窗口 / 排除集）。
// ⛔ 直接 import 生产模块（不复制一份实现到 fixture 里——那只能证明 fixture 自己会算）。
//
// 断言 ①-⑤ 逐条对应 tasks/gap-worker-pool-owns-retry-backoff-state 的 Plan 第 3 步。

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { WorkerPool } from "../scripts/worker-pool.ts";
import { makeGitRoot, rmSafe, writeTaskFile } from "./helpers/worker-driver-harness.mjs";

/** 夹具退避配置：显式给出四个量，⛔ 不依赖宿主/默认值的当前取值（否则断言会随默认值漂移）。 */
const CFG = { quickDeathMs: 60_000, backoffThreshold: 2, baseBackoffMs: 1_000, maxBackoffMs: 10_000 };

test("① 状态由类私有拥有 — Object.keys(new WorkerPool()) 看不到 retryState/backoffState", () => {
  const pool = new WorkerPool();
  const keys = Object.keys(pool);
  assert.deepEqual(keys, [], `实例上不得有自有可枚举字段（实测 ${JSON.stringify(keys)}）`);
  // `in` 也看不到：私有字段（#）结构性不可从外部命名。这两条合起来才是「不是搬家」的判据。
  assert.equal("retryState" in pool, false);
  assert.equal("backoffState" in pool, false);
});

test("② advanceRetryCap — 连续失败达 maxRetries 才返回该 id，且去重", () => {
  const pool = new WorkerPool();
  assert.deepEqual(pool.advanceRetryCap(["gap-a"], 3), [], "第 1 次未达上限 ⇒ 不返回");
  assert.deepEqual(pool.advanceRetryCap(["gap-a"], 3), [], "第 2 次未达上限 ⇒ 不返回");
  assert.deepEqual(pool.advanceRetryCap(["gap-a"], 3), ["gap-a"], "第 3 次达上限 ⇒ 返回该 id");
  assert.equal(pool.needsHuman("gap-a"), true, "达上限即 latch");
  assert.deepEqual(pool.advanceRetryCap(["gap-a"], 3), [], "已标记 ⇒ 去重，不重复返回");
});

test("③ applyNeedsHumanTransition — 返回 committed，且 needs-human 在磁盘上生效", () => {
  const root = makeGitRoot("worker-pool-apply");
  try {
    writeTaskFile(root, "gap-wp-nh", "ready");
    const pool = new WorkerPool();
    const res = pool.applyNeedsHumanTransition(root, {
      id: "gap-wp-nh",
      reason: "worker-pool.test: 验证内存 latch 与磁盘落盘在同一处配对",
      kind: "retry-cap",
    });
    assert.equal(res.id, "gap-wp-nh");
    assert.equal(res.ok, true, "task 存在且状态可翻转 ⇒ ok");
    assert.equal(res.committed, true, "翻转必须落盘并提交（committed）");
    const body = fs.readFileSync(path.join(root, "tasks", "gap-wp-nh.md"), "utf8");
    assert.match(body, /^status: needs-human$/m, "磁盘 frontmatter 已翻为 needs-human");
    assert.equal(pool.needsHuman("gap-wp-nh"), true, "内存 latch 与磁盘落盘配对");
  } finally {
    rmSafe(root);
  }
});

test("④ recordQuickDeath + isBackedOff — 阈值后设退避、窗口内 true/窗口外 false、非快速死亡复位", () => {
  const pool = new WorkerPool();
  const t0 = 1_000_000;

  // 连续快速死亡 1 次：未达 backoffThreshold(2) ⇒ 不退避。
  const r1 = pool.recordQuickDeath("gap-qd", "failed", 5_000, t0, 3, CFG);
  assert.equal(r1.quickDeath, true, "failed + <quickDeathMs ⇒ 快速死亡");
  assert.equal(r1.backedOff, false, "未达阈值 ⇒ 不退避");
  assert.equal(pool.isBackedOff("gap-qd", t0), false);

  // 第 2 次：达阈值 ⇒ 设 backoffUntil = now + baseBackoffMs。
  const t1 = t0 + 1;
  const r2 = pool.recordQuickDeath("gap-qd", "failed", 5_000, t1, 3, CFG);
  assert.equal(r2.backedOff, true, "达阈值 ⇒ 退避");
  assert.equal(r2.backoffUntil, t1 + CFG.baseBackoffMs, "退避时刻 = now + baseBackoffMs");
  assert.equal(pool.isBackedOff("gap-qd", t1), true, "窗口内 ⇒ true");
  assert.equal(pool.isBackedOff("gap-qd", t1 + CFG.baseBackoffMs - 1), true, "到期前仍 true");
  assert.equal(pool.isBackedOff("gap-qd", t1 + CFG.baseBackoffMs), false, "到期 ⇒ false（可重新派发）");
  assert.equal(pool.consecutiveQuickDeaths("gap-qd"), 2, "读面能看到连续计数");

  // 非快速死亡（活过 quickDeathMs）⇒ 连续计数复位 + 退避清除（「连续」断链）。
  const t2 = t1 + 5_000;
  const reset = pool.recordQuickDeath("gap-qd", "failed", CFG.quickDeathMs + 1, t2, 3, CFG);
  assert.equal(reset.quickDeath, false, "活过 quickDeathMs ⇒ 不是快速死亡");
  assert.equal(pool.consecutiveQuickDeaths("gap-qd"), undefined, "非快速死亡 ⇒ 连续计数复位");
  assert.equal(pool.isBackedOff("gap-qd", t2), false, "非快速死亡 ⇒ 退避清除");
});

test("⑤ dispatchExclusion — inFlight 合并 running+coldInflight，needs-human 进 retryExhausted", () => {
  const root = makeGitRoot("worker-pool-excl");
  try {
    writeTaskFile(root, "gap-wp-ex", "ready");
    const pool = new WorkerPool();
    pool.applyNeedsHumanTransition(root, {
      id: "gap-wp-ex",
      reason: "worker-pool.test: 验证排除集读面",
      kind: "retry-cap",
    });
    const ex = pool.dispatchExclusion([{ task: "gap-running" }], new Set(["gap-cold"]));
    assert.deepEqual(ex.inFlight, ["gap-running", "gap-cold"], "在飞 = running ∪ coldInflight");
    assert.equal(ex.retryExhausted.has("gap-wp-ex"), true, "needs-human 的任务进入排除集");
    assert.equal(ex.retryExhausted.has("gap-running"), false, "无关任务不被误排除");
  } finally {
    rmSafe(root);
  }
});
