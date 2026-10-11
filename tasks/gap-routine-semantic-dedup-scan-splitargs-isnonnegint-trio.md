---
id: gap-routine-semantic-dedup-scan-splitargs-isnonnegint-trio
title: "semantic-dedup-scan: Both bodies byte-identical across the three peer
  driver modules, whose comments even say 'same family as
  driver-runtime.splitArgs' yet carry their own copy"
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
Both bodies byte-identical across the three peer driver modules, whose comments even say 'same family as driver-runtime.splitArgs' yet carry their own copy

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1791733865369` · ts `2026-10-11T15:51:05.369Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`splitArgs`、`isNonNegInt`
- 涉及文件：
- `plugin/scripts/driver-runtime.ts:1986`
- `plugin/scripts/quality-gate-driver.ts:1154`
- `plugin/scripts/suite-driver.ts:320`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## Disposition
已修（extract，2026-10-12）。三份 byte-identical 副本归并为一份：`driver-runtime.ts` 成为
`splitArgs` / `isNonNegInt` 的单一实现（其注释本就写着「与 driver-runtime.splitArgs 同族」，
且全体外部消费者——outer / goal / promotion-driver——早已 import 自此处）；`suite-driver.ts` /
`quality-gate-driver.ts` 改为 import + re-export `splitArgs`（保留既有 import 面，手法同
`process-kill-lib.ts` / finding `kill-procs-pair`）。

证据（可复跑）：
- `grep -rn "function splitArgs\|function isNonNegInt" plugin/scripts/*.ts` —— 修前 6 处（3 文件 × 2 函数），修后 2 处，均在 `plugin/scripts/driver-runtime.ts`。
- ESM 载入：`node --experimental-strip-types -e "import('./plugin/scripts/suite-driver.ts')…"` —— 两 peer 模块命名导出解析通过（re-export 的 `splitArgs` 可解析，`isNonNegInt` 私有不导出，与原面一致）。
- 边界（硬规则 5b）：同一 idiom `trim().split(/\s+/).filter(Boolean)` 在 `task-contract-check.ts:142` 等处以**内联表达式**出现（非函数体副本，且契约不同——抽取 entry path / 解析 globs），不属本 finding 的 `byte-identical-body` 判据，未扩大改动面。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `splitArgs-isNonNegInt-trio`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791733865369`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/driver-runtime.ts`
- `plugin/scripts/quality-gate-driver.ts`
- `plugin/scripts/suite-driver.ts`
- `tasks/gap-routine-semantic-dedup-scan-splitargs-isnonnegint-trio.md`
