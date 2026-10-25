---
id: gap-routine-architecture-analysis-dup-cpu-split-validation-two-copies
title: "architecture-analysis: archguard exact-clone hash e903751a0cc007ae: a
  7-statement / 97-token / 10-line CPU-split admission rule is byte-identical
  (comments included) in two round-r"
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
archguard exact-clone hash e903751a0cc007ae: a 7-statement / 97-token / 10-line CPU-split admission rule is byte-identical (comments included) in two round-record checkers; recurrence of the 2026-10-24 finding, still unfiled, so a change to the fail-closed rule can land in one copy only.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1792940968187` · ts `2026-10-25T15:09:28.187Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`hasRealSplit`
- 涉及文件：
- `plugin/scripts/per-task-suite-record.ts:227`
- `plugin/scripts/pre-verified-round-record.ts:677`
- kind：`duplication`
- verdict：`confirmed`

## Requested action
Extract the rule into plugin/scripts/cpu-split-contract.ts and have both round-record checkers import it; AC = archguard_detect_duplicates totalGroups for that hash returns 0.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-25T15:09:28.187Z

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `dup-cpu-split-validation-two-copies`（routine `architecture-analysis`，runId `architecture-analysis-1792940968187`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Disposition
已修（不是「已有机制在管」）：把该 admission rule 抽成单一实现 `plugin/scripts/cpu-split-contract.ts` 的 `resolveCpuSplit`，`per-task-suite-record.ts` 与 `pre-verified-round-record.ts` 都改为 import 它。rule 语义逐条保留：真实 split 无 `cpu_time_s` ⇒ fail-closed；负值 / 非数值 ⇒ fail-closed；空串 / 字面 `null` / 0 ⇒ 省略（绝不伪造 0）。错误文案与原两份逐字相同，两个 writer 的对外行为未变。

## Evidence
- 修前（主检出 = 未改动的 develop 代码）：archguard `detect_duplicates` 返回 `hash=e903751a0cc007ae, tokenCount=97, statementCount=7, lineCount=10`，成员为 `plugin/scripts/per-task-suite-record.ts:227` 与 `plugin/scripts/pre-verified-round-record.ts:677` —— 与 finding 记录逐项一致，确认问题真实存在（不是误报）。
- 修后（本任务 worktree）：同一 `detect_duplicates` 扫描 `plugin/scripts`（312 files / 9013 functions）返回 `totalGroups=5`，**不含** `e903751a0cc007ae`（该 hash 的组数 = 0）。
- 行为回归：`node --experimental-strip-types --test plugin/test/per-task-suite-record-check.test.mjs plugin/test/pre-verified-round-record.test.mjs` ⇒ `tests 135 / pass 135 / fail 0`；两个 writer 的 split 用例（真实 split 入账、空/null/0 省略、无 sum fail-closed、负值/非数值 fail-closed）现在都落到同一实现上。
- 能力目录闸：`bash plugin/scripts/capability-catalog.sh --summary` ⇒ `401 scripts | 401 declared | 0 unclassified | 396 ship`（exit 0）；新模块的六张声明表已补。

## Dark axis (ADR-007)
- L_G archguard detect_duplicates — plugin/scripts after the extraction: totalGroups=5, hash e903751a0cc007ae absent (pre-change repo-wide scan: totalGroups=27, that hash present at per-task-suite-record.ts:227 + pre-verified-round-record.ts:677)
- L_D: 本次只移动代码、不新增文档面（新模块头注释替换了两份重复注释），code:doc 比无实质变化

## Touches
- `plugin/scripts/per-task-suite-record.ts`
- `plugin/scripts/pre-verified-round-record.ts`
- `plugin/scripts/cpu-split-contract.ts`
- `plugin/scripts/capability-catalog-declarations.json`
- `tasks/gap-routine-architecture-analysis-dup-cpu-split-validation-two-copies.md`
