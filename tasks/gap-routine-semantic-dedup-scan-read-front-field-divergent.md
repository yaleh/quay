---
id: gap-routine-semantic-dedup-scan-read-front-field-divergent
title: "semantic-dedup-scan: Same helper in two files; one escapes the key into
  the regex, the other interpolates it unescaped."
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
Same helper in two files; one escapes the key into the regex, the other interpolates it unescaped.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1793622123912` · ts `2026-11-02T12:22:03.912Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`readFrontField`
- 涉及文件：
- `plugin/scripts/ready-pool-check.ts:763`
- `plugin/scripts/slot-refill.ts:424`
- kind：`divergent-implementation`
- verdict：`divergent-implementation`

## Requested action
merge

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-02T12:22:03.912Z

## 处置结论（可核）

处置：**修掉**（merge）。把两处 `readFrontField` 的分歧——`ready-pool-check.ts` 用 `escapeRegExp(key)` 转义、`slot-refill.ts` 原样内插 key——收敛为**唯一一份**定义，落在两文件本就共同导入的共享模块 `plugin/scripts/task-schema.ts`（原始 frontmatter 单字段读取器的既有正本处，与 `readDependsOn`/`readGoalAc` 同区）。两个载体删本地私有副本，改为 `import { …, readFrontField } from "./task-schema.ts"`。转义语义取正确侧（key 先 `escapeRegExp`，与 `extractSection` 同一 metacharacter-literal 规则）；`slot-refill.ts` 行为从「原样内插」升级为「转义内插」，当前所有调用点传 `status`/`role`/`parent` 无元字符，行为不变。

核验（本任务 DoD「判据实跑通过」的实测，任何读者可复跑）：
- `grep -rn "function readFrontField" plugin/scripts/` ⇒ 仅 `plugin/scripts/task-schema.ts:283` 一份定义（两个载体的本地私有副本已删）。
- `grep -n "readFrontField" plugin/scripts/ready-pool-check.ts plugin/scripts/slot-refill.ts` ⇒ 只有 `import` 与调用点，无本地 `function readFrontField`。
- `node --no-warnings --experimental-strip-types --input-type=module -e 'const m=await import("./plugin/scripts/task-schema.ts"); console.log(m.readFrontField("status: ready\nsta.us: x\n", "sta.us"))'` ⇒ `null`（转义生效：`sta.us` 不再被当成 `status` 的宽松正则误匹配）。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `read-front-field-divergent`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1793622123912`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## ADR-007 暗轴

该轴仍暗,理由:本任务只把两处 readFrontField 收敛为唯一一份 task-schema.ts 定义,不新增包间依赖边(两文件本就 import task-schema.ts)、不新增/合并包,依赖结构与 god-package 两轴无可归因变化

## Touches
- `plugin/scripts/ready-pool-check.ts`
- `plugin/scripts/slot-refill.ts`
- `plugin/scripts/task-schema.ts`
- `tasks/gap-routine-semantic-dedup-scan-read-front-field-divergent.md`