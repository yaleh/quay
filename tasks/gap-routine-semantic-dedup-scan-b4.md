---
id: gap-routine-semantic-dedup-scan-b4
title: "semantic-dedup-scan: Byte-identical strip/collapse/trim normalizer; the
  ac61 comment names a third copy (retired-clause-check.norm)."
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
Byte-identical strip/collapse/trim normalizer; the ac61 comment names a third copy (retired-clause-check.norm).

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1793491958069` · ts `2026-11-01T00:12:38.069Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`norm`
- 涉及文件：
- `plugin/scripts/ac61-staleness-disposition-check.ts:62`
- `plugin/scripts/dual-source-check.ts:58`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-01T00:12:38.069Z

## 处置结论（可核）

处置：**修掉**（extract）。把两处 byte-identical 的 `norm`（strip backticks + collapse whitespace + trim）提取到既有共享模块 `plugin/scripts/gate-script-base.ts`，两个载体改为 `import` + `export { norm }`（历史导入路径不变，测试无需改 import）；并修正 `ac61` 里「mirrors retired-clause-check.norm」的误导注释 —— `retired-clause-check.ts` 的本地 `norm` 是**更宽**的实现（额外剥 `#`/`//` 行注释前缀，用于跨行匹配 fenced `.sh`/`.ts` 归档正文），属 load-bearing 分歧，**不并入**共享的简单 `norm`。

核验（本任务 DoD「判据实跑通过」的实测，任何读者可复跑）：
- `grep -n "export function norm" plugin/scripts/ac61-staleness-disposition-check.ts plugin/scripts/dual-source-check.ts` ⇒ 空（本地私有副本已删，仅剩 `export { norm }` 再导出）。
- `grep -n "export function norm" plugin/scripts/gate-script-base.ts` ⇒ 唯一一份定义。
- `node --no-warnings --experimental-strip-types --test plugin/test/dual-source-check.test.mjs plugin/test/ac61-staleness-disposition-check.test.mjs` ⇒ **17 pass / 0 fail**。
- `node --no-warnings --experimental-strip-types plugin/scripts/dual-source-check.ts --root .` ⇒ exit 0（4 responsibilities 单一执行者）；`node --no-warnings --experimental-strip-types plugin/scripts/ac61-staleness-disposition-check.ts --root .` ⇒ exit 0（11 items dispositioned / 45 integration hits classified / C7 gone）。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `B4`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1793491958069`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## ADR-007 暗轴

该轴仍暗,理由:本任务只把两处 byte-identical 的 norm helper 提取到既有共享模块 gate-script-base.ts,不新增包间依赖边、不新增或合并包,依赖结构与 god-package 两轴无可归因的变化

## Touches
- `plugin/scripts/ac61-staleness-disposition-check.ts`
- `plugin/scripts/dual-source-check.ts`
- `plugin/scripts/gate-script-base.ts`
- `tasks/gap-routine-semantic-dedup-scan-b4.md`