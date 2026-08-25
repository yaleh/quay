// @test-group governance
// driver-result.test.mjs — AC153 (tasks/gap-ac153-core-invariant-single-impl-not-evaluated-vocab): the
// core invariant「⛔ 不信执行者自述，用独立于执行者的量复核」is implemented ONCE (verifyIndependently)
// and shared by both task-processing drivers (worker computeLandingState / promotion AC133 reverify);
// the DriverResult<T> vocab MANDATORILY carries a not-evaluated state that is a DIFFERENT SHAPE from
// verified (硬规则 3b: 读不到输入 ≠ 合格). AC1 falsifiable: either kind producing `verified` without an
// independent criterion confirming it ⇒ false. AC2 falsifiable: "读不到输入" expressible as a non-
// not-evaluated value ⇒ false.
//
// Run: scripts/test.sh plugin/test/driver-result.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  verifyIndependently,
  verified,
  notEvaluated,
  failed,
} from "../scripts/driver-result.ts";
import { verifyIndependently as workerVerifyIndependently } from "../scripts/worker-driver.ts";
import { verifyIndependently as promotionVerifyIndependently } from "../scripts/promotion-driver.ts";

// ── AC2：DriverResult 词表强制含 not-evaluated（与 verified / failed 都不同形） ─────────────────

test("AC2 — DriverResult 词表三态齐全，not-evaluated 与 verified 不同形、与 failed 也不同形", () => {
  const v = verified("x", "by");
  assert.equal(v.state, "verified", "verified 态携带 value + verifiedBy");
  assert.ok("value" in v && "verifiedBy" in v, "verified 有形 value/verifiedBy");
  assert.ok(!("reason" in v), "verified 无 reason 键（⛔ 不同形）");

  const n = notEvaluated("读不到输入");
  assert.equal(n.state, "not-evaluated", "not-evaluated 态存在");
  assert.ok(!("value" in n) && !("verifiedBy" in n), "not-evaluated 无 value/verifiedBy（与 verified 不同形）");
  assert.ok("reason" in n, "not-evaluated 有形 reason");

  const f = failed("证伪");
  assert.equal(f.state, "failed", "failed 态存在");
  assert.ok(!("value" in f) && !("verifiedBy" in f), "failed 无 value/verifiedBy");

  // 三个 state 字面量互不相同。
  assert.notEqual(v.state, n.state);
  assert.notEqual(v.state, f.state);
  assert.notEqual(n.state, f.state);
});

// ── AC1：verifyIndependently 是唯一三态映射（true⇒verified / false⇒failed / null·throw⇒not-evaluated） ─

test("AC1 — verifyIndependently 三态映射：independentCriterion true/false/null/throw", () => {
  const v = verifyIndependently(
    { value: "id", verifiedBy: "独立判据", failedReason: "证伪", notEvaluatedReason: "读不到" },
    () => true,
  );
  assert.deepEqual(v, { state: "verified", value: "id", verifiedBy: "独立判据" });

  const f = verifyIndependently(
    { value: "id", verifiedBy: "独立判据", failedReason: "证伪", notEvaluatedReason: "读不到" },
    () => false,
  );
  assert.deepEqual(f, { state: "failed", reason: "证伪" });

  const n = verifyIndependently(
    { value: "id", verifiedBy: "独立判据", failedReason: "证伪", notEvaluatedReason: "读不到" },
    () => null,
  );
  assert.deepEqual(n, { state: "not-evaluated", reason: "读不到" });

  // throw（读输入失败）= 读不到输入 ⇒ not-evaluated，⛔ 不伪装成 verified/failed。
  const thrown = verifyIndependently(
    { value: "id", verifiedBy: "独立判据", failedReason: "证伪", notEvaluatedReason: "读不到" },
    () => { throw new Error("read failed"); },
  );
  assert.deepEqual(thrown, { state: "not-evaluated", reason: "读不到" });
});

test("AC1 — verified 只能由 independentCriterion()===true 产出（取假：任何其它路径给 verified ⇒ 假）", () => {
  // 唯一能产出 verified 的是 verifyIndependently 且 criterion 严格 === true。false ⇒ failed、null ⇒
  // not-evaluated，都不是 verified。
  for (const verdict of [false, null, undefined, 0, "", "true"]) {
    const r = verifyIndependently(
      { value: 1, verifiedBy: "by", failedReason: "f", notEvaluatedReason: "n" },
      () => verdict,
    );
    assert.notEqual(r.state, "verified", `criterion=${JSON.stringify(verdict)} ⇒ ⛔ not verified`);
  }
});

// ── AC1：两 driver 共用同一份实现（函数身份相等，⛔ 非平行副本） ───────────────────────────────

test("AC1 — worker 与 promotion 消费同一个 verifyIndependently（identity，非平行副本）", () => {
  assert.equal(workerVerifyIndependently, verifyIndependently, "worker re-export is the driver-result function (identity)");
  assert.equal(promotionVerifyIndependently, verifyIndependently, "promotion re-export is the driver-result function (identity)");
  assert.equal(workerVerifyIndependently, promotionVerifyIndependently, "两 driver 共用同一函数");
});
