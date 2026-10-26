---
id: gap-routine-architecture-analysis-dup-readtouches-closure-driver-filters
title: "architecture-analysis: archguard exact-clone 7fab593681548b81 (89 tokens
  / 6 statements / 10 lines): makeTouchesAttributor re-inlines the
  readTouches+expand closure that makeTouche"
status: ready
labels:
  - gap
  - routine-filed
  - architecture-analysis
parent: null
children: []
extra: {}
---
## Finding
archguard exact-clone 7fab593681548b81 (89 tokens / 6 statements / 10 lines): makeTouchesAttributor re-inlines the readTouches+expand closure that makeTouchesSideReaders already builds and that three other call sites (260, 452, 571) already consume, so the touchesDisjoint predicate and the GOAL-037 attributor can silently start reading the same tasks/<id>.md differently.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793051973088` · ts `2026-10-26T21:59:33.088Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`makeTouchesSideReaders`、`makeTouchesAttributor`、`readTouches`、`expandDeclaredTouches`
- 涉及文件：
- `plugin/scripts/driver-filters.ts:274`
- `plugin/scripts/driver-filters.ts:1741`
- `plugin/scripts/driver-filters.ts:1742`
- kind：`duplication`
- verdict：`confirmed`

## Requested action
Have makeTouchesAttributor call const { expand, readTouches } = makeTouchesSideReaders(ctx) instead of re-declaring them; AC = archguard detect_duplicates on scope 4747cc54 no longer returns group 7fab593681548b81, and driver-filters tests that pin touchesDisjoint byte-parity plus the GOAL-037 attributor tests stay green.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-26T21:59:33.088Z

## Evidence
处置 = **修掉**（不是「已注意到」，也不是「已有机制在管」）。

1. **archguard `detect_duplicates`**（scope = `plugin/scripts`，options `minStatements=6` / `minTokens=50`）：
   - BEFORE：主检出 scope `4747cc54`，`generatedAt=2026-10-26T22:07:34.772Z`，`scannedFiles=313 scannedFunctions=9034 totalGroups=5`；组 `7fab593681548b81` **在场**（89 tokens / 6 statements / 10 lines），成员 = `driver-filters.ts:274-283 readTouches` 与 `driver-filters.ts:1742-1751 readTouches`。
   - AFTER：本任务 worktree 重分析 scope `045059a9`，`generatedAt=2026-10-26T22:07:47.364Z`，`scannedFiles=313 scannedFunctions=9032 totalGroups=4`；组 `7fab593681548b81` **已消失**（余下 4 组均与本 finding 无关：measure-trend-check / workflow-replay ×2 / channel-probe-server+peer-identity-probe）。
2. **修法**：`makeTouchesAttributor` 改为 `const { expand, readTouches } = makeTouchesSideReaders(ctx)`，删掉重复的 `readTouches`/`expand` 闭包；`touchesDisjoint` 谓词本体一字未动，故 AC9 / Plan 1「五个谓词的实现一处不改」仍成立。两侧读取闭包现在由**同一份构造**产出，「读同一批单一真相源」不再依赖两份手写闭包碰巧一致。
3. **测试**（worktree 内实跑）：`plugin/test/driver-filters.test.mjs` = 90 tests / 90 pass / 0 fail；`plugin/test/touches-relax-{off-parity,filter-trace,live-predicate,auto-tighten}.test.mjs` = 33 tests / 33 pass / 0 fail。
4. 原始读数全文：`.quay/dup-readtouches-closure-evidence.md`（worktree 内，未跟踪）。

- L_G archguard detect_duplicates on plugin/scripts: groups_before=5 groups_after=4 target_group=7fab593681548b81 target_present_before=true target_present_after=false

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `dup-readtouches-closure-driver-filters`（routine `architecture-analysis`，runId `architecture-analysis-1793051973088`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案
- [x] archguard `detect_duplicates`（scope = `plugin/scripts`）不再返回组 `7fab593681548b81`，且 `touchesDisjoint` 逐字节平价测试与 GOAL-037 归因测试保持绿

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/driver-filters.ts`
- `tasks/gap-routine-architecture-analysis-dup-readtouches-closure-driver-filters.md`