---
id: gap-routine-architecture-analysis-dup-strict-jsonl-reader-two-copies
title: "architecture-analysis: archguard dup 97719ef99c4433c0: 251 tokens/19
  lines; both bodies are the same strict JSONL-object reader (missing flag,
  throw on non-object) differing only i"
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
archguard dup 97719ef99c4433c0: 251 tokens/19 lines; both bodies are the same strict JSONL-object reader (missing flag, throw on non-object) differing only in the path variable.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1792847950884` · ts `2026-10-24T13:19:10.884Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`readCarrierRounds`、`readLedgerRecords`
- 涉及文件：
- `plugin/scripts/discovery-method-routine.ts:509`
- `plugin/scripts/discovery-method-routine.ts:627`
- kind：`duplication`
- verdict：`confirmed`

## Requested action
Extract one readJsonlStrict(path) helper and make both readers delegate; AC: one definition, both call sites, non-object line still throws.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-24T13:19:10.884Z

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `dup-strict-jsonl-reader-two-copies`（routine `architecture-analysis`，runId `architecture-analysis-1792847950884`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Evidence
- 复核：`plugin/scripts/discovery-method-routine.ts` 中 `readCarrierRounds`（原 `:509`）与 `readLedgerRecords`（原 `:627`）函数体逐行等价，仅路径变量与错误前缀不同 —— 即 archguard dup `97719ef99c4433c0`。
- 处置（修掉，非「已注意到」）：抽出唯一 `readJsonlStrict(filePath)`（`:510`），两处改为 `return readJsonlStrict(...)` 委托（`:534` / `:636`）。语义保持：缺文件 ⇒ `{missing:true,records:[]}`；非法 JSON ⇒ 抛 `is not valid JSON`；非对象行 ⇒ 抛 `is not a JSON object`（硬规则 3b：缺值 ≠ 未查）。
- 硬规则 5b 同载体检索：`grep -c "is not a JSON object" plugin/scripts/discovery-method-routine.ts` ⇒ 2 行（`:508` 文档注释 + `:524` 唯一 throw；提取前是 2 条 throw）。`plugin/scripts/arch-discovery-routine.ts:361/400` 属另一条例程的独立实现，不在本 finding、也不在本任务 Touches 内，未改动。
- 提交：`246f88557`（task branch `task/gap-routine-architecture-analysis-dup-strict-jsonl-reader-two-copies`）。
- 测试：`bash scripts/test.sh plugin/test/discovery-method-routine.test.mjs` ⇒ exit 0，60/60 pass；新增用例 `both JSONL readers — ONE strict reader, both call sites, a non-object line still THROWS` 对两条读函数分别断言 missing / 正常对象行 / `[]`、`42`、`null`、字符串行抛 `/is not a JSON object/` / 破行抛 `/is not valid JSON/`。

## GIT axes (ADR-007)
- 该轴仍暗,理由:本任务只在 `plugin/scripts/discovery-method-routine.ts` 内部合并两个等价读函数，import 图与包边界零变化，未采集 archguard L_D/L_G 读数。

## Touches
- `plugin/scripts/discovery-method-routine.ts`
- `plugin/test/discovery-method-routine.test.mjs`
- `tasks/gap-routine-architecture-analysis-dup-strict-jsonl-reader-two-copies.md`