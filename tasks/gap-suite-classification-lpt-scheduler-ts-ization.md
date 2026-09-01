---
id: gap-suite-classification-lpt-scheduler-ts-ization
title: suite 分类+LPT 移 TS——suite-scheduler.ts 收原始文件列表（分类→LPT→调度一体），test.sh 薄转发
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

ts-ization 方向已定（`gap-execution-loop-p4-suite-entry-ts-ization` done：test.sh 决策逻辑抽 TS 纯函数、收窄为薄转发），但「分类 + LPT」还赖在 bash——这是 ts-ization 没做彻底的痕迹，也是 `gap-suite-scheduler-main-lpt-missing`（main 组漏 LPT 长尾）的**结构性根因**：

- **调度正主已是 TS**：`suite-scheduler.ts` 是调度正主（组预算+水位+事件驱动），但其 stdin 契约是「`group\tpath` 已分类+LPT 的行」（`suite-scheduler.ts:36` usage 原文）——分类与 LPT 由 bash 侧（`scripts/test.sh` 的 `lpt_reorder_files` + `runner-grouping.ts`）喂给它。
- **分类是「.ts 名装 bash 函数」**：`plugin/scripts/runner-grouping.ts` 头注释自认「this file is SOURCED by scripts/test.sh — bash does not care about the extension」，内容是从 test.sh 1292-1416 逐字搬来的 bash 函数（`group_of` / `effective_groups` / `in_group` / `select_files` 等），`test.sh:790` `source` 它。
- **LPT 是 bash**：`lpt_reorder_files`（读 verification-round 历史时长做 LPT）在 test.sh 内，是 nameref（`local -n` @`:938`）bash 函数。
- **切成两段的代价**：分类/LPT 在 bash 组装 + 调度在 TS = 一整条决策链被切成 bash+TS 两段，复制粘贴 3 套（serial/lowconc/main）各自演化 ⇒ main 组有机会漏（正是 main-lpt-missing 的根因）。

**正确形态**：`suite-scheduler.ts`（或新 TS 模块）接收**原始文件列表**（不是现在的 `group\tpath` 已分类+LPT 输入），内部做「分类（`group_of`）→ LPT（读 verification-round 历史）→ 调度（组预算+水位+事件驱动）」；`test.sh` 收窄为「收集文件列表 → 一行调 TS」。分类逻辑（`runner-grouping.ts` 的 bash 函数）随本次一起 ts-ize 到 TS 模块（或让 `suite-scheduler.ts` 复用其 TS 版本）。

**与 `gap-suite-scheduler-main-lpt-missing` 的关系**：该任务当前的 bash 实现（`declare -A` + `declare -n` 组表循环，worktree 9c983d9ef）是**中间态**——修 main 漏 LPT 的即时症状，但保留了「分类+LPT 在 bash」的结构缺陷。本任务是**终态**：分类+LPT 收进 TS，bash 组表循环（若已落地）随之删除。两者 Touches 重叠（都触 `scripts/test.sh` + `suite-scheduler.ts`）⇒ 派发按共享状态序列化；本任务落地方向是 TS，先落地者不改变本任务方向。

## Plan

1. **分类 ts-ize**：`runner-grouping.ts` 的 bash 函数（`group_of` / `effective_groups` / `in_group` / `select_files` 等）抽成真 TS 模块（或并入 `suite-scheduler.ts`），test.sh 不再 `source` bash 版。
2. **LPT ts-ize**：`lpt_reorder_files`（读 verification-round 历史时长做 LPT）抽成 TS 纯函数，`suite-scheduler.ts` 内部调用。
3. **输入契约改**：`suite-scheduler.ts` 从「`group\tpath` 已分类+LPT 行」改为「原始文件列表」，内部做 分类→LPT→调度。
4. **test.sh 薄转发**：收集文件列表 → 一行调 TS；删除 bash 的 `lpt_reorder_files`、`runner-grouping.ts` source、3 套 dispatch 循环（含 `gap-suite-scheduler-main-lpt-missing` 的 nameref 组表循环，若已落地）。
5. **验证**：全量 suite 绿；main 长文件 offset 回 0；legacy `QUAY_SUITE_SCHEDULER=0` 路径 pass/fail-neutral。

## Acceptance Criteria

- [ ] AC1（能取假，机制级）：`suite-scheduler.ts` 收原始文件列表、分类+LPT 在 TS 内——grep test.sh 无 `lpt_reorder_files` bash 定义/调用、无 `source ... runner-grouping.ts`、无 3 套 dispatch 循环；`suite-scheduler.ts`（或新 TS 模块）含 group 分类 + LPT 排序逻辑；（⛔ 分类/LPT 仍在 bash ⇒ 假）。
- [ ] AC2（能取假，生产载体，硬规则 4 推论三）：落地后时间窗内，全量轮 main 组最长文件启动 offset 回 0 附近（与短文件差消除），N 只计落地后轮次；（⛔ 用落地前轮冒充 ⇒ 假）。
- [ ] AC3（能取假，无回归）：legacy `QUAY_SUITE_SCHEDULER=0` 路径 + `--group`/`--buckets` 分组结果同文件集同断言 pass/fail 结果一致（分类逻辑 ts-ize 不改分类语义）。

## Definition of Done

分类+LPT 收进 TS（`suite-scheduler.ts` 收原始文件列表，分类→LPT→调度一体）；test.sh 收窄为薄转发；bash 中间态（nameref 组表循环 + runner-grouping.ts bash 版 source）清理；AC1-AC3 全勾；全量 suite 绿；main 长文件 offset 回 0 实测。

## Touches

- plugin/scripts/suite-scheduler.ts（输入契约改原始文件列表；内部分类+LPT）
- plugin/scripts/runner-grouping.ts（bash 函数 ts-ize 为真 TS，或并入 suite-scheduler.ts 后删除 bash 版）
- scripts/test.sh（薄转发：删 lpt_reorder_files + runner-grouping source + 3 套 dispatch）
- tasks/gap-suite-classification-lpt-scheduler-ts-ization.md（自身）
