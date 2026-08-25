// plugin/scripts/driver-result.ts — AC153: 核心不变式单一实现 + DriverResult 词表强制含 not-evaluated。
// (tasks/gap-ac153-core-invariant-single-impl-not-evaluated-vocab)
//
// WHY THIS EXISTS（manager-phase-goal.md ### AC153 / SPEC-unified-driver-architecture §2.1「共同不变式」）：
// 「⛔ 不信执行者自述，用独立于执行者的量复核」这条核心不变式此前被两个 driver 独立实现两遍：
//   promotion AC133            「fix worker 退出后重跑同一个闸验证，⛔ 不信 worker 自述」
//   worker  computeLandingState 「读任务侧直接量 status=done ∧ 无残留 worktree，⛔ 不信 exit code」
//   其中 worker 那份在 2026-08-23 11:37 之前一直是坏的（exitCode===0 ⇒ completed 造成假完成 bug）。
// 抽本文件的理由不是省代码，是让这条不变式只有一份、且结构上不可能被某个 kind 悄悄漏掉。
//
// DriverResult<T> 词表强制含 not-evaluated（⛔ 与 verified 不同形，也与 failed 不同形）：
//   verified      = 独立判据【证实】——kind 要产出 verified 只能经 verifyIndependently 且
//                   independentCriterion() === true，⛔ 无其它路径。
//   not-evaluated = 【读不到输入】（读失败/缺失/未查成）——硬规则 3b：读不懂 ≠ 合格，也不伪造成
//                   「查过且不合格」（failed）。
//   failed        = 独立判据【证伪】。
// 三个构造器显式给出词表；kind 的生产路径只应经 verifyIndependently（构造器主要供测试与 thin 分支用）。

export type DriverResult<T> =
  | { state: "verified"; value: T; verifiedBy: string }   // 由独立判据证实
  | { state: "not-evaluated"; reason: string }             // ⛔ 与「合格」不同形
  | { state: "failed"; reason: string };

/** verified 构造器。value = 被证实的主张载体；verifiedBy = 记录「用什么独立量证实」（可核）。 */
export function verified<T>(value: T, verifiedBy: string): DriverResult<T> {
  return { state: "verified", value, verifiedBy };
}

/** not-evaluated 构造器（⛔ 与 verified 不同形、与 failed 也不同形——独立取值，硬规则 3b）。 */
export function notEvaluated<T = never>(reason: string): DriverResult<T> {
  return { state: "not-evaluated", reason };
}

/** failed 构造器。 */
export function failed<T = never>(reason: string): DriverResult<T> {
  return { state: "failed", reason };
}

/**
 * 核心不变式单一实现：「⛔ 不信执行者自述，用独立于执行者的量复核」。
 *
 * 执行者的自述（worker 的 exitCode、fix worker 的「已修好」）【不作为】判断依据；判断依据只有
 * `independentCriterion` —— 一个读【独立于执行者】的直接量、返回三态的函数：
 *   true  ⇒ 独立判据证实 ⇒ verified（携带 value + verifiedBy）
 *   false ⇒ 独立判据证伪 ⇒ failed（携带 failedReason）
 *   null  ⇒ 读不到输入（读失败/缺失/未查成）⇒ not-evaluated（携带 notEvaluatedReason）
 *   throw ⇒ 同 null ⇒ not-evaluated（读输入失败 = 读不到输入）
 *
 * 结构保证（AC1 取假）：kind 要产出 verified 只能经本函数，且只有当 independentCriterion() 严格返回
 * `true`。worker（computeLandingState）与 promotion（computeReverifyOutcome）都消费本函数——
 * 任一 kind 在未经独立判据证实的情况下产出 verified ⇒ 假。
 */
export function verifyIndependently<T>(
  opts: {
    value: T;
    verifiedBy: string;
    failedReason: string;
    notEvaluatedReason: string;
  },
  independentCriterion: () => boolean | null,
): DriverResult<T> {
  let verdict: boolean | null;
  try {
    verdict = independentCriterion();
  } catch {
    verdict = null;
  }
  if (verdict === true) return verified(opts.value, opts.verifiedBy);
  if (verdict === false) return failed(opts.failedReason);
  return notEvaluated(opts.notEvaluatedReason);
}
