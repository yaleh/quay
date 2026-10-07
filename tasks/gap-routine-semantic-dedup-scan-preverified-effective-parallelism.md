---
id: gap-routine-semantic-dedup-scan-preverified-effective-parallelism
title: "semantic-dedup-scan: Bodies are identical (null-guard on non-finite
  cpu/wall, else Number((cpu/wall).toFixed(3))) and the copy's own comment
  states it uses the same formula as full"
status: ready
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
Bodies are identical (null-guard on non-finite cpu/wall, else Number((cpu/wall).toFixed(3))) and the copy's own comment states it uses the same formula as full-suite-runner.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1791353789266` · ts `2026-10-07T06:16:29.266Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`effectiveParallelism`
- 涉及文件：
- `plugin/scripts/full-suite-runner.ts:505`
- `plugin/scripts/pre-verified-round-record.ts:536`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
import from full-suite-runner or lift to a leaf module

## Disposition
处置 = 修掉（requested action 的第二项「lift to a leaf module」）。`effectiveParallelism` 的**唯一**函数体现在在
`plugin/scripts/suite-accounting.ts`（full-suite-runner.ts 已有的 NON-hub 遥测/记账叶子模块）：
- `full-suite-runner.ts` 内部 import + 对外 re-export（其公开 API 面逐字不变）；
- `pre-verified-round-record.ts` import + re-export **同一条** binding，不再复写函数体。

可核产物（executable invariant，能取假）：`plugin/test/pre-verified-round-record.test.mjs` 的 SSOT 判据按位置扫
`plugin/scripts` 全部 `.ts` 的 `export function effectiveParallelism(` 声明，断言【正好一个家】= suite-accounting.ts，
且本模块与 full-suite-runner 的导出必须是 suite-accounting 的**同一个函数对象**；自带 scanner 负控制。
负控制实跑（cp 备份，非 git checkout）：恢复本地副本 ⇒ RED，报
`[{file:pre-verified-round-record.ts,line:541},{file:suite-accounting.ts,line:532}]`；恢复后 md5 `590191cc4e422f890d75b02b764e5b0e` 不变。

5b 扫描（同载体同原则：同一符号的 byte-identical 函数体出现在 >1 文件）：报 14 组；与本 finding 同形（薄 writer 为避免
import full-suite-runner 而本地复写）的两处留原样并记因：`concurrentSuiteSlots`（一行委托 `suiteLockSlotCount()`，其 SSOT 家
是 thin writer 不该 import 的 runner-concurrency **hub**）、`countHeldSuiteLocks`（唯一家在重模块），二者已在姊妹任务
`gap-routine-semantic-dedup-scan-hostparallelism-missed-import` 的 5b 里记录在案。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `preverified-effective-parallelism`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791353789266`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/full-suite-runner.ts`
- `plugin/scripts/pre-verified-round-record.ts`
- `plugin/scripts/suite-accounting.ts`
- `plugin/test/pre-verified-round-record.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-preverified-effective-parallelism.md`

## Test-Files
- `plugin/test/pre-verified-round-record.test.mjs`
- `plugin/test/suite-accounting.test.mjs`
- `plugin/test/full-suite-runner-phases.test.mjs`
- `plugin/test/full-suite-runner-cgroup.test.mjs`
