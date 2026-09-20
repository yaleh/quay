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

/** `quay driver <verb>` 的全部 verb。
 *
 *  ⚠️ `log` 与其余六个 verb 的**类别不同**：那六个是 supervisor kernel 的**控制面**动词（start/stop/
 *  drain/resume/status/restart 都要落到常驻进程上），`log` 是**只读的载体读取**——它不 spawn kernel、
 *  也不碰任何控制态。它仍在此表里，是因为用户找它的位置就是 `quay driver`（人 2026-09-20 的裁定把
 *  「driver 应当记录的日志」的可达面点名在 quay cli/mcp/web 上）；cli/driver.ts 在委派 kernel 之前
 *  截住它（见那里的 `runDriverLog`）。 */
export const VERBS = ["start", "stop", "drain", "resume", "status", "restart", "log"];

// ⛔ 白名单必须与 kernel 的 DRIVER_KINDS 一致（suite 已按人 2026-09-07 裁定退役移除）。导出供
// goal-driver.test.mjs 断言两者集合相等（gap-goal-driver-mechanical-ring AC6），并作为帮助文本
// 的 kind 真源。⚠️ 它是 kernel 那张表的【已机械比对过的镜像】，⛔ 不是新的事实来源
// （enum-surface-parity-check 的 authority `driver-kind` 指向 driver-runtime.ts:DRIVER_KINDS）。
export const KINDS = ["promotion", "worker", "outer", "quality", "meta", "goal"];

// ── GOAL-017/AC-254（SPEC §6.9 阶段 B）：服务清单也住在这里，理由与上面完全相同 ────────────────────
//
// 服务名要在**三处用户可见的帮助文本**里出现（`quay --help` 的用法行、`quay server --help` 的
// 用法行与 services 行），而 `cli/serve` 那条路径的传递闭包带 config/provider/serve-handlers ——
// 把清单留在 serve.ts 会让 `quay --help` 每次调用付那份加载成本（driver-vocab.ts 的头注释记着
// 同一个实测：0.25s → 0.67s）。本模块零 import ⇒ 成为**单一实现 + 零加载成本**的那个落点。
//
// ⛔ 这里是**唯一**的服务清单：`packages/quay/src/serve.ts`（宿主）与 `packages/quay/src/cli/server.ts`
// （四个动词）都从这里 import，⛔ 不各写一份（SPEC §6.8 单一实现；两份 = 假）。
//
// `DRIVER_SERVICE_KINDS` 与上面的 `KINDS` 是同一集合 —— 服务名 `driver:<kind>` 的 kind 段由它构造。
// `peer` 是 SPEC §6.9 清单里唯一的**尚不存在**的服务（阶段 D），故刻意不在此列：把它写进来会让
// `--only peer` 通过解析然后在没有任何实现的地方静默假成功。
export const HOSTED_SERVICE_NAMES = ["web", "control"];
export const DRIVER_SERVICE_KINDS = KINDS.slice();
export const ALL_SERVICE_NAMES = [
  ...HOSTED_SERVICE_NAMES,
  ...DRIVER_SERVICE_KINDS.map((k) => `driver:${k}`),
];
