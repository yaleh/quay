---
id: gap-routine-semantic-dedup-scan-strip-touch-annotation
title: "semantic-dedup-scan: Identical algorithm with the same three regexes and
  the same fixed-point loop over stripTrailingFullWidthAnnotation plus paren
  stripping, differing only by a S"
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
Identical algorithm with the same three regexes and the same fixed-point loop over stripTrailingFullWidthAnnotation plus paren stripping, differing only by a String() type-safety wrapper, and both already import the same kernel touches-annotation leaf.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1792560001684` · ts `2026-10-21T05:20:01.684Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`stripTouchAnnotation`
- 涉及文件：
- `plugin/scripts/touches-parser.ts:78`
- `packages/quay/src/observation.ts:507`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `strip-touch-annotation`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1792560001684`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/touches-parser.ts`
- `packages/quay/src/observation.ts`
- `packages/quay/src/kernel/touches-annotation.ts`
- `packages/quay/test/kernel-pure-judges.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-strip-touch-annotation.md`

## Evidence

**复核**：`.quay/routine-findings.jsonl` 中该 runId 的 finding（`findingId: strip-touch-annotation`,
`dupKind: byte-identical-body`, `verdict: real-duplication`）逐字存在，指向两处定义：
`plugin/scripts/touches-parser.ts:78` 与 `packages/quay/src/observation.ts:507`。修复前实测两处
`function stripTouchAnnotation` 各一份，算法逐行相同（同三条正则 + 同一定点循环），仅差一个
`String(entry)` 包装。

**处置 = extract（已修掉）**：把复合 strip 移入两边**已经共同 import** 的 kernel leaf
`packages/quay/src/kernel/touches-annotation.ts`（`stripTrailingFullWidthAnnotation` 就在其中，
沿用 gap-three-pure-judges-kernel-single-def 的同款做法）；`String()` 收进实现内部一次，
wrapper 差异消失。`plugin/scripts/touches-parser.ts` 改为 import 并**re-export 同一函数对象**
（其消费者 `task-status-drift-check.ts` 无需改动），`packages/quay/src/observation.ts` 的
`parseTouchPaths` 直接调用该 kernel 函数。

**判据（可核、能取假）**：
- 单一定义：`grep -rn "function stripTouchAnnotation" packages/quay/src plugin/scripts scripts`
  → 恰好 1 条：`packages/quay/src/kernel/touches-annotation.ts:78`（修复前 2 条）。
- 委派关系：`grep -n "import { stripTouchAnnotation }"` 命中 `plugin/scripts/touches-parser.ts:9`
  与 `packages/quay/src/observation.ts:49`；`export { stripTouchAnnotation }` 在前者 :10。
- 结构闸（防回退）：`packages/quay/test/kernel-pure-judges.test.mjs` 把 `stripTouchAnnotation`
  加入 `JUDGES` 单定义集合，并新增断言「touches-parser re-export 的是**同一个对象**」
  （重新手抄一份即使字节相同也会红）。
- 行为回归：`node --no-warnings --experimental-strip-types --test
  packages/quay/test/kernel-pure-judges.test.mjs packages/quay/test/observation.test.mjs
  plugin/test/touches-parser-parity.test.mjs` → 86 tests, 86 pass / 0 fail。
- 类型：workspace 的 ts-typecheck 命令（`for d in packages/*/; do npx tsc --noEmit -p "$d" || exit 1; done`）全绿。
- 实现提交：worktree `task/gap-routine-semantic-dedup-scan-strip-touch-annotation` 上 `bb6378c5e`。

**执行主体**：finding 由探针机械产出、任务由例程机械立案；修复由**派发链的 per-task worker**
执行（见上提交），探针本身未执行任何修复动作。