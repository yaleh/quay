// cli/driver-vocab.ts — the CLI's driver verb + kind vocabulary (gap-driver-cli-help-hides-four-of-six-kinds).
//
// WHY THIS MODULE EXISTS（⛔ 不是"为了整齐"）：`quay driver` 的 verb/kind 词表要在三处用户可见的
// 帮助文本里出现（`quay --help` 顶层用法行、`quay driver --help` 的用法行与 `--kind` 旗标说明），
// 修前它们各自手抄一份、取值互不一致（2/4/5/6 四种）⇒ 用户唯一看得到的 `<promotion|worker>` 让
// outer/quality/meta/goal 四个**已实现**的 driver kind 在产品表层等于不存在（硬规则 3b 形态：
// 能力缺失与能力未暴露同形）。现在帮助文本一律插值本模块的两个常量（见 cli/driver.ts 与
// cli/help.ts），⛔ 不再有第二份副本；不变式由 plugin/scripts/enum-surface-parity-check.ts 的面
// `cli-driver-kinds` / `cli-driver-help-kind` / `cli-driver-usage-verbs` 机械守着。
//
// ⛔ 为什么独立成叶模块（而不是留在 cli/driver.ts 里让 help.ts import 它）：help.ts 被 bin/quay.ts
// **静态** import（每次 CLI 调用都会加载），而 cli/driver.ts 的传递闭包含 config.ts / plugin-root.ts
// 等重依赖——实测把 KINDS 留在 driver.ts 会让 `quay --help` 从 0.25s 涨到 0.67s（每次调用都付）。
// 本模块零 import ⇒ 加载成本可忽略。⚠️ 与"能不能少写一个文件"无关，是 help 路径的实测成本。

/** `quay driver <verb>` 的全部 verb。 */
export const VERBS = ["start", "stop", "drain", "resume", "status", "restart"];

// ⛔ 白名单必须与 kernel 的 DRIVER_KINDS 一致（suite 已按人 2026-09-07 裁定退役移除）。导出供
// goal-driver.test.mjs 断言两者集合相等（gap-goal-driver-mechanical-ring AC6），并作为帮助文本
// 的 kind 真源。⚠️ 它是 kernel 那张表的【已机械比对过的镜像】，⛔ 不是新的事实来源
// （enum-surface-parity-check 的 authority `driver-kind` 指向 driver-runtime.ts:DRIVER_KINDS）。
export const KINDS = ["promotion", "worker", "outer", "quality", "meta", "goal"];
