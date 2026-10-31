---
id: gap-routine-semantic-dedup-scan-argv-flag-value
title: "semantic-dedup-scan: Byte-identical 3-line argv flag reader
  re-implemented in two scripts with no shared accessor."
status: done
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
Byte-identical 3-line argv flag reader re-implemented in two scripts with no shared accessor.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1793401709530` · ts `2026-10-30T23:08:29.530Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`argvFlagValue`、`flagValue`
- 涉及文件：
- `plugin/scripts/driver-runtime.ts:2401`
- `plugin/scripts/resource-anomaly-detector.ts:938`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-30T23:08:29.530Z

## ADR-007 暗轴
该轴仍暗,理由:本次是 plugin/scripts 内 argv 标志读取器去重（三份字节相同的私有副本收敛到 gate-script-base 已有的单一 flagValue，未新增任何模块间依赖边——三个文件本就 import gate-script-base），未跑 archguard 的 L_D/L_G 读数。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `argv-flag-value`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1793401709530`）所描述的问题被复核并处置 —— 复核结论：**属实**。develop `59b05dca0` 上按代码位置枚举 `argv[i + 1] : null` 三行体 = **3 处 / 3 文件**（finding 点名的 `driver-runtime.ts:2401` `argvFlagValue` 与 `resource-anomaly-detector.ts:938` `flagValue`，外加硬规则 5b 同载体 grep 命中的第三份 `duration-report.ts:690` `flagValue`）。处置 = **修掉（extract）**：三份私有副本删除，统一 import `gate-script-base.ts` 已存在的单一 `flagValue`（返回 `undefined`）；`driver-runtime.ts` 的 `model_alias` 加 `?? null` 保持 `string | null` 契约，`resource-anomaly-detector.ts` 的 `before !== null` 改 `before !== undefined` 且 `parse` 签名补 `undefined`，均为行为保持。
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案 —— 结论 = **修掉**，四条可复跑读数：① 三行体 `argv[i + 1] : null`（按代码位置，硬规则 2）develop = **3 处 / 3 文件** → 本分支 = **0 处**；② `function flagValue(` 声明 develop = **3 处**（gate-script-base + 2 份私有副本）→ 本分支 = **1 处**（仅 `gate-script-base.ts:275`），`argvFlagValue` 出现数 develop = **1** → 本分支 = **0**；③ 行为保持：`resource-anomaly-detector.test.mjs` 12/12、`profile-policy.test.mjs` 41/41、`duration-report.test.mjs` 9/9；④ 空串语义未漂移：`--effect-after ""` 仍 `not-evaluated`（AC4 回归）。

## DoD
- [x] 上面的判据实跑通过 —— 上述读数均已实跑：三处副本删除后按位置 grep（0 处三行体 / 仅 1 处 `flagValue` 声明）、三个受影响测试文件 62/62 全绿。
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑 —— 修复由 worker 派发链执行（worktree `quay-worktrees/gap-routine-semantic-dedup-scan-argv-flag-value`，分支 `task/gap-routine-semantic-dedup-scan-argv-flag-value`，提交 `212c873d1`）；例程探针只往 `.quay/routine-findings.jsonl` 写 finding 记录并机械立案，未执行任何修复。

## Touches
- `plugin/scripts/driver-runtime.ts`
- `plugin/scripts/duration-report.ts`
- `plugin/scripts/resource-anomaly-detector.ts`
- `tasks/gap-routine-semantic-dedup-scan-argv-flag-value.md`