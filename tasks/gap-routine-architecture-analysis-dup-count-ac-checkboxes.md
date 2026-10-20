---
id: gap-routine-architecture-analysis-dup-count-ac-checkboxes
title: "architecture-analysis: Identical AC-checkbox predicate in two layers
  (archguard dup hash 0bb360d4880cd7f4); the fail-closed sectionFound:false/NaN
  rationale comment exists only in "
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
Identical AC-checkbox predicate in two layers (archguard dup hash 0bb360d4880cd7f4); the fail-closed sectionFound:false/NaN rationale comment exists only in the plugin copy, so the product copy reads as an undocumented parallel implementation.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1792481915389` · ts `2026-10-20T07:38:35.389Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`countAcCheckboxes`
- 涉及文件：
- `packages/quay/src/task-parsing.ts:109`
- `plugin/scripts/task-schema.ts:429`
- kind：`duplication`
- verdict：`confirmed`

## Requested action
Make task-parsing.ts the single implementation (plugin re-exports it) or add a parity test that feeds null/empty/section bodies to both; AC: a test asserts both call sites return equal objects for 4 fixture inputs.

## Disposition

复核结论：finding 的**前提部分已过期**，但其**可执行的部分仍然成立，且已在本次派发中修掉**。

1. 「fail-closed 理由注释只存在于 plugin 副本」——**不成立（已过期）**：两份副本自 2026-09-04 起都带同一条
   `FAIL-CLOSED (gap-ac47-completion-predicate-consumer-fail-closed, AC1)` 注释
   （`packages/quay/src/task-parsing.ts` 于 9cf20bf5b、`plugin/scripts/task-schema.ts` 于 5571030698），
   且 `task-parsing.ts` 的文件头本就写明「机制层保留副本 + parity test 钉住」。探针命中的是**函数体**的
   dup hash，不是「缺注释」。
2. 「两份实现是否被钉住」——**成立，但钉得不够**：`plugin/test/task-parsing-parity.test.mjs` 早已存在，
   却只喂了 2 个输入（一个节选 + 一个 `null`）；Requested action 要的第 3、4 类 fixture（空串、无框散文）
   完全没覆盖，`[X]`/`[~]` 的语义也没有直接断言。
3. 为什么不改成「plugin 直接 re-export 产品层」：`build-plugin-dist` 打包 `plugin/` 时**不带** `packages/` 树，
   机制层不能静态 import 该模块（同一原因见 `loop-complete-task.ts` / `config-wiring-check.ts` 的
   `pathToFileURL` 动态 import）⇒「单一实现」这条路不可行，parity test 是 Requested action 的可行臂。

已修（本任务分支 `task/gap-routine-architecture-analysis-dup-count-ac-checkboxes`，commit `12f0586b4`）：

- parity test 改为把**同一组 4 类 fixture**（`null` / 空串 / 混合 `[ ]`+`[x]`+`[X]`+`[~]` / 无框散文）
  同时喂给产品副本与机制层的**两个**导入点（`task-schema.ts` 定义 + `task-status-drift-check.ts` 重导出，
  并先断言二者是同一个函数对象），逐个 `deepEqual`。
- 增加**非空转**断言：absent（`sectionFound:false` + `total:NaN`）必须与 present-but-empty（`total:0`）
  可区分；混合 fixture 断言 `total 4 / checked 2 / unchecked 2`（`[~]` 计入 total、算未勾）。
- 两份副本的**函数级**注释都写明「这是有意重复 + 由 parity test 钉住」，产品副本不再读起来像
  无文档的平行实现。

负控制：只把产品副本的 `[xX]` 改成 `[x]`，新测试即红（`countAcCheckboxes diverged for fixture: mixed checklist`）；
还原后 8/8 绿。scoped 门（`scripts/test.sh --for-task … --allow-thin`）实跑 EXIT=0，130/130 测试通过；
anti-drift Touches 检查 `ANTI-DRIFT OK`（3 actual files，全在声明的 4 条 glob 内）。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `dup-count-ac-checkboxes`（routine `architecture-analysis`，runId `architecture-analysis-1792481915389`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `packages/quay/src/task-parsing.ts`
- `plugin/scripts/task-schema.ts`
- `plugin/test/task-parsing-parity.test.mjs`
- `tasks/gap-routine-architecture-analysis-dup-count-ac-checkboxes.md`