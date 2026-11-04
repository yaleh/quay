// @test-group engine
// worker-round-action-semantics.test.mjs — tasks/gap-worker-round-action-field-conflates-dispatch-and-wait.
//
// worker round 的 `action` 字段此前把两件不同的事压进同一个值域：终态 halt 与瞬时等待都写 `stop`
// （缺陷 B），cap 已满的空转轮（inFlight>0 但本轮未 spawn）写成 `dispatch`（缺陷 A）。本文件是
// `computeWorkerRoundAction`（四态判定）与 `computeWorkerRoundRecord`（terminal 显式位）的判据面。
//
// 判别力从哪来（硬规则 4 / 负控制 AC4）：`computeWorkerRoundAction` 不是回显——它接收 reason/terminal/
// spawned/pool 四个输入、输出四态之一。旧三元表达式 `reason != null ? "stop" : inFlight > 0 ? "dispatch"
// : "idle"` 在 cap 满轮与瞬时等待轮分别给出 dispatch / stop；本文件逐条断言新判定与旧三元**不同**——
// 若实现退化成旧三元，这些断言变红（⛔ 不是「测试存在且绿」的恒真）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeWorkerRoundAction, computeWorkerRoundRecord } from "../scripts/worker-driver.ts";

/** 旧三元表达式（缺陷基线）：`reason != null ? "stop" : inFlight > 0 ? "dispatch" : "idle"`。 */
const OLD = (reason, inFlight) => (reason != null ? "stop" : inFlight > 0 ? "dispatch" : "idle");

test("cap 满空转轮 → idle（⛔ 旧三元在 inFlight>0 时误写 dispatch，缺陷 A）", () => {
  const got = computeWorkerRoundAction({ reason: null, terminal: false, spawned: 0, pool: null });
  assert.equal(got, "idle");
  // 负控制：同样一轮（in_flight>0、pool=null、reason=null），旧三元写 dispatch——证明本断言能区分新旧。
  assert.equal(OLD(null, 5), "dispatch");
  assert.notEqual(got, OLD(null, 5));
});

test("瞬时等待轮 → wait（resource-gate-wait，terminal=false）", () => {
  const got = computeWorkerRoundAction({ reason: "resource-gate-wait: load too high", terminal: false, spawned: 0, pool: 5 });
  assert.equal(got, "wait");
  // 负控制：旧三元把瞬时等待压成 stop——证明本断言能区分新旧（缺陷 B）。
  assert.equal(OLD("resource-gate-wait: load too high", 0), "stop");
  assert.notEqual(got, OLD("resource-gate-wait: load too high", 0));
});

test("终态 halt 轮 → stop（terminal=true）", () => {
  const got = computeWorkerRoundAction({ reason: "mcp-halt (control state halted — no new dispatch; in-flight workers untouched)", terminal: true, spawned: 0, pool: null });
  assert.equal(got, "stop");
});

test("真实派发轮 → dispatch（pool!==null 且 spawned>0）", () => {
  const got = computeWorkerRoundAction({ reason: null, terminal: false, spawned: 1, pool: 3 });
  assert.equal(got, "dispatch");
});

test("dispatch 不因 pool===null 或 spawned===0 写出（结构判据：ready-pool 步没跑过 ⇒ 物理上不可能派发）", () => {
  // spawned>0 但 pool===null：结构上不可能发生（spawn 只发生在 ready-pool 之后），fail-closed 到 idle。
  assert.equal(computeWorkerRoundAction({ reason: null, terminal: false, spawned: 1, pool: null }), "idle");
  // pool!==null 但 spawned===0（本轮没 spawn）：不是 dispatch。
  assert.equal(computeWorkerRoundAction({ reason: null, terminal: false, spawned: 0, pool: 3 }), "idle");
});

test("computeWorkerRoundRecord 透传 terminal 显式位（halt=true / 瞬时等待=false 且 action=wait）", () => {
  const halt = computeWorkerRoundRecord({
    round: 1, runId: "r", pid: 1, at: "t",
    action: "stop", inFlight: 2, pool: null, stopReason: "mcp-halt (…)", terminal: true,
    coldStartInflight: [],
  });
  assert.equal(halt.action, "stop");
  assert.equal(halt.terminal, true, "halt 轮 terminal===true 由 stopCondition().terminal 原样透传");

  const wait = computeWorkerRoundRecord({
    round: 2, runId: "r", pid: 1, at: "t",
    action: "wait", inFlight: 3, pool: 5, stopReason: "resource-gate-wait: load too high", terminal: false,
    coldStartInflight: [],
  });
  assert.equal(wait.action, "wait");
  assert.equal(wait.terminal, false, "resource-gate-wait 轮 terminal===false 且 action===wait");

  // 缺省 terminal（旧调用方不传）也恒为 boolean false，⛔ 不在 JSON 里丢键。
  const legacy = computeWorkerRoundRecord({
    round: 3, runId: "r", pid: 1, at: "t",
    action: "idle", inFlight: 0, pool: 0, stopReason: null,
    coldStartInflight: [],
  });
  assert.equal(legacy.terminal, false);
  assert.equal(JSON.stringify(legacy).includes('"terminal":false'), true);
});
