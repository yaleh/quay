// checker-io.ts — gap-b4-checker-reuse-driver-result (B4, SPEC-methodology-layer-architecture §2.3a):
//  checker 侧对 driver-result.ts 的 DriverResult<T> 判定契约桥（复用，⛔ 非设计新契约）。
//
// WHY THIS EXISTS（§2.3a ⭐ 跨角色发现）：driver-result.ts（AC153，2026-08-25）已定义
// { state:"not-evaluated"; reason }（逐字引硬规则 3b「读不懂 ≠ 合格，也不伪造成合格」），被
// driver-runtime / promotion-driver / worker-driver 消费——而 checker 采纳数 = 0。同一仓库同一周
// 同一条硬规则，driver 产出了 DriverResult<T> 词表，checker 还在用三义冲突的 exit 2。
// 本文件不是新词表：它只 re-export DriverResult 的构造器 + 提供一个 checker 侧的 exit-code 映射，
// 让 checker 的判定结果【收敛到已落地、已有 3 消费者、已有测试的那一份词表】。
//
// ⛔ 为什么不扩 checker-lib：checker-lib.test.mjs 钉住 checker-lib 的 4 个原语【全是判定侧】
//   （matchAtCommandPosition / buildNonCodeMask / enumerativeExistence / hasMatchAtCommandPosition），
//   不含任何 fs/I/O。本文件是【判定契约】桥（DriverResult ↔ exit code），不含 I/O——放在独立
//   模块而非污染 checker-lib 的纯净性（§2.3a 末的「先读 checker-lib.test.mjs」判定）。
//
// ── 语义映射（AC3：明文字段级对照，DriverResult 的 verified/failed/not-evaluated ↔ checker 的
//    pass/fail/not-evaluated）。本 SPEC 不代为判定（§2.3a 末），以下为实现方判定并在此固化：
//
//   ┌─────────────────────────────────────┬──────────────────────────┬──────────┬──────────────────────────────┐
//   │ DriverResult<T>（driver-result.ts） │ checker 判定             │ exit code│ 语义                        │
//   ├─────────────────────────────────────┼──────────────────────────┼──────────┼──────────────────────────────┤
//   │ { state:"verified", value, verifiedBy } │ PASS                 │ 0        │ 独立判据【证实】            │
//   │ { state:"failed", reason }           │ FAIL / VIOLATED         │ 1        │ 独立判据【证伪】            │
//   │ { state:"not-evaluated", reason }    │ NOT-EVALUATED           │ 2        │ 读不到输入 / 无法评估（3b） │
//   └─────────────────────────────────────┴──────────────────────────┴──────────┴──────────────────────────────┘
//
//   判定是 1:1 适配：driver 的 verified ↔ checker 的 pass，failed ↔ fail，not-evaluated ↔
//   NOT-EVALUATED，无需更上位词表。
//
//   ⛔ 三义 exit 2 的消歧（§1.3 的「三义冲突」根）：
//   - 【判定态】NOT-EVALUATED —— 由 DriverResult.not-evaluated 唯一承载，经 driverResultToExit 映射为 2。
//     一个 checker 要产出 NOT-EVALUATED，只能经 notEvaluated(reason) 构造（⛔ 无其它路径，与 driver
//     「要产出 verified 只能经 verifyIndependently」同构）。
//   - 【调用态】usage error —— checker 被错误调用（缺参数 / 非法 flag / 扫描根不存在）。这不是判定，
//     是「checker 根本没跑起来」，仍在 CLI 壳里独立 process.exit(2)，⛔ 不经 DriverResult。它与
//     NOT-EVALUATED 同用 exit 2 是【遗留表层】，归 harness 三态识别任务
//     gap-not-evaluated-harness-third-state 处置，不在本任务范围。
//
// 每个 checker 的判定函数返回 DriverResult<T>，CLI 壳经 driverResultToExit 映射退出码——判定词表
// 单源到 driver-result.ts，checker 不再自造第三态。

import type { DriverResult } from "./driver-result.ts";

export type { DriverResult } from "./driver-result.ts";
export { verified, notEvaluated, failed } from "./driver-result.ts";

/** checker 判定态 → 退出码（verified→0 / failed→1 / not-evaluated→2）。 */
export function driverResultToExit(result: DriverResult<unknown>): number {
  switch (result.state) {
    case "verified":
      return 0;
    case "failed":
      return 1;
    case "not-evaluated":
      return 2;
  }
}

/** checker 判定态 → 人类可读标签（PASS / FAIL / NOT-EVALUATED）。 */
export function driverResultToTag(result: DriverResult<unknown>): "PASS" | "FAIL" | "NOT-EVALUATED" {
  switch (result.state) {
    case "verified":
      return "PASS";
    case "failed":
      return "FAIL";
    case "not-evaluated":
      return "NOT-EVALUATED";
  }
}
