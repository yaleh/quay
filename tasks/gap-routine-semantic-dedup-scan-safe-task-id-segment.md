---
id: gap-routine-semantic-dedup-scan-safe-task-id-segment
title: "semantic-dedup-scan: Character-identical path-sanitizer duplicated
  across two files of the same lease-path family; comments claim verbatim reuse
  but each holds a private copy that "
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
Character-identical path-sanitizer duplicated across two files of the same lease-path family; comments claim verbatim reuse but each holds a private copy that can silently diverge on the traversal guard.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1791442852793` · ts `2026-10-08T07:00:52.793Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`safeTaskIdSegment`、`_safeTaskIdSegment`
- 涉及文件：
- `plugin/scripts/prepare-admission-check.ts:76`
- `plugin/scripts/proposal-convergence.ts:535`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `safe-task-id-segment`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791442852793`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Evidence

**处置：修掉（extract）。** 单一来源已建立，重复在结构上不可能复现。

**修复落点**（branch `task/gap-routine-semantic-dedup-scan-safe-task-id-segment`，worktree
`/data/home/yale/work/quay-worktrees/gap-routine-semantic-dedup-scan-safe-task-id-segment`）：

- `safeTaskIdSegment` 现只有 **1 处定义**，在 `plugin/scripts/prepare-admission-check.ts:83`（加 `export`，并加进该文件既有的 `_internal` 测试缝）。
- `plugin/scripts/proposal-convergence.ts` 删掉私有副本 `_safeTaskIdSegment`（原 `:535`），改为从 `./prepare-admission-check.ts` import（`:28`，与既有的 `releaseLease`/`_readLeaseFileWithRetry` 同一行 —— 依赖边本就存在，未新增边、无环），并把全部调用点与相关注释改为新名。
- 选择「导出复用」而非新建模块：该依赖方向（proposal-convergence → prepare-admission-check）在修复前就已存在；新建 `plugin/scripts/*.ts` 需要 capability-catalog 声明，属超范围。

**可核读数（修复前 → 修复后）**：

- `grep -rn "^\(export \)\?function _\?safeTaskIdSegment" plugin/scripts/` ⇒ **2 → 1**（修复前 `prepare-admission-check.ts:76` + `proposal-convergence.ts:535`；修复后仅 `prepare-admission-check.ts:83`）。
- 函数体字面串（`replace` 斜杠/反斜杠 → 下划线 正则）在 `plugin/scripts/` 下命中的**文件数** ⇒ **2 → 1**：`proposal-convergence.ts` 归零。
- 工作树 `git status --porcelain` 为空（产出全在提交里）。

**行为不变（既有直接单测全绿）**：

- `plugin/test/prepare-admission-check.test.mjs` 83/83 pass。
- `experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs` 218/218 pass（含 `telemetryPath` 对裸 `..` 的包含性检查、`checkpointPath`/`epochPath` 的路径形状断言）。
- scoped 门 `bash scripts/test.sh --for-task gap-routine-semantic-dedup-scan-safe-task-id-segment --allow-thin` ⇒ exit 0，301 tests / 0 fail（= 上述两条泳道之和）。

**复核 finding 原文**：`.quay/routine-findings.jsonl` 中 `"findingId":"safe-task-id-segment"`（runId `semantic-dedup-scan-1791442852793`）记 `dupKind: byte-identical-body`、`verdict: real-duplication`、`suggestedAction: extract`，观测符号（`safeTaskIdSegment`、`_safeTaskIdSegment`）与被指文件（`prepare-admission-check.ts:76`、`proposal-convergence.ts:535`）与本任务一致 —— 即上表的两处定义，两者现已合一。

**未动的（记录理由）**：`experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs` 的 3 处测试标题/断言消息仍写旧名 `_safeTaskIdSegment`。这是纯命名残留，不是本 finding 判定的「函数体重复」，且该文件不在本任务 `## Touches` 内 ⇒ 不改，在此记录以免被读成漏改。

## Touches
- `plugin/scripts/prepare-admission-check.ts`
- `plugin/scripts/proposal-convergence.ts`
- `tasks/gap-routine-semantic-dedup-scan-safe-task-id-segment.md`