---
id: gap-routine-semantic-dedup-scan-jsonl-batch-appenders
title: "semantic-dedup-scan: Four batch appenders are byte-identical modulo
  parameter name (ensure dir, map JSON.stringify+newline, one appendFileSync,
  return count) with a fifth near-vari"
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
Four batch appenders are byte-identical modulo parameter name (ensure dir, map JSON.stringify+newline, one appendFileSync, return count) with a fifth near-variant; gate-script-base appendJsonlLine is the single-record sibling whose best-effort void contract these return-count callers need beside it.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1792940684375` · ts `2026-10-25T15:04:44.375Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`appendCarrierRecords`、`appendLedgerRecords`、`appendRoutineFindings`
- 涉及文件：
- `plugin/scripts/arch-discovery-routine.ts:376`
- `plugin/scripts/discovery-method-routine.ts:538`
- `plugin/scripts/discovery-method-routine.ts:641`
- `plugin/scripts/probe-routine.ts:758`
- `plugin/scripts/resource-anomaly-detector.ts:463`
- `plugin/scripts/gate-script-base.ts:564`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-25T15:04:44.375Z

## Disposition（处置）

**结论：已修掉（extract），不是「已注意到」。** 实现提交 `2081d4323`（任务分支 `task/gap-routine-semantic-dedup-scan-jsonl-batch-appenders`）。

**做了什么**

- 在 `plugin/scripts/gate-script-base.ts` 新增 `appendJsonlRecords(file, records): number` —— 与既有单条版
  `appendJsonlLine` 并列的**批量兄弟**：ensure-dir → 一次 `appendFileSync` → 返回条数；空批次不写、不建目录、返回 0。
  **两个函数的契约刻意相反**：批量版 fail-loud（抛出即失败，调用方都要知道「载体没拿到这些行」），单条版 best-effort
  （吞掉，长驻探针的证据损丢失不该杀死写者）。注释里写死了「⛔ 不要给它加吞异常的 catch」。
- 五处全部改为**委托**，并**保留各自导出的名字**（`appendCarrierRecords` / `appendLedgerRecords` /
  `appendRoutineFindings` 仍被兄弟模块 `open-semantic-discovery-routine.ts`、`cross-project-dogfood-routine.ts`
  与 `plugin/test/*.test.mjs` import，删除名字会改公共面）：
  `arch-discovery-routine.ts`、`discovery-method-routine.ts`（两处：carrier + ledger）、`probe-routine.ts`、
  `resource-anomaly-detector.ts`。
- 第五处（`resource-anomaly-detector.ts`）是 join-style 近似变体 `.map(JSON.stringify).join("\n") + "\n"`；对非空批次它与
  共享实现**逐字节相同**，故合并是行为保持的 —— 这一条由差分 oracle 测试钉住（两种旧拼法 × 4 组输入，输出必须相等），
  不是靠人眼看。

**硬规则 5b 的兄弟实例清扫（同一载体 `plugin/scripts`）**

判据：`fs.appendFileSync(<x>, <...>.map(...JSON.stringify...)`（同一行）。
- `develop` 上 **7 处**；本改动后 **2 处**。
- 第 6 处（扫描器没算进本 finding 的那一个）：`gate-event-coverage-check.ts` 的 `recordNonBlockReport` 里**内联**了
  同一段字节（没有「返回条数」契约，又不是独立 appender，所以 function-body 级扫描抓不到）—— **一并折掉**。
- 第 7 处：`design-evolution-readings.ts` 的 `appendEvolutionFindings` —— **故意不折**，理由可核：它先经
  `evolutionFindingRecord(f, ts)` **变换**，且以返回值 `{ok:false, error}` 报告失败而非抛出，是与 fail-loud helper
  **不同的契约**；折它需要额外 try/catch 包装，那是行为改动而不是合并。测试把这条写成断言，将来要折必须是一次明确决定。
- 剩下的 1 处是共享定义本身（`gate-script-base.ts`）。

**防复发（产物，不是提醒）** —— `plugin/test/gate-script-base.test.mjs` 新增 8 条判据：

1. 判据先拿**修改前逐字函数体**干跑（5 段样本必须命中）—— 防空转（硬规则 4c：恒真的判据与「验过了」同形）；
2. 同一干跑带**负控制**：单条版 `appendJsonlLine` 与 transform 变体必须**不**命中；
3. 该函数体在 `plugin/scripts` 下**只有一处定义**（`gate-script-base.ts`）；
4. 四个原载体都不再内联，且每个都 **import** 共享实现、**保留原导出名**（区分「提取」与「删除」）；
5. 5b 清扫出来的内联兄弟也已折掉并留痕（且断言 transform 契约仍保留，折它必须显式改测试）；
6. 行为：N 条记录落成**一次** append、自动建目录、返回条数、第二批追加不截断；
7. 空批次：不写文件、**不建目录**、返回 0；
8. 删掉共享导出 ⇒ 消费者 import **链不上**（机制为真，不是"删了也不红"）。

**实跑（本会话）**：`gate-script-base` 82 tests / 0 fail；四个原载体 `resource-anomaly-detector` 12、
`arch-discovery-routine` 23、`probe-routine` 32、`discovery-method-routine` 60，全 0 fail；
`gate-event-coverage-check` 19 tests / 0 fail。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `jsonl-batch-appenders`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1792940684375`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## ADR-007 暗轴记录

本任务是**去重提取**，看的是 L_D（结构/重复），读数用改动前后的同一判据量出来（不是形容词）：

- L_D: `plugin/scripts` 批量 JSONL 追写体（一行内 `fs.appendFileSync` 的实参带 `.map(...JSON.stringify...)`）
  batch-jsonl-appenders=7→2
  measured-by: `git grep 'fs\.appendFileSync(.*\.map(' develop -- 'plugin/scripts/*.ts'` 对照本任务工作树；
  实现后 2 = 1 个共享定义（`gate-script-base.appendJsonlRecords`）+ 1 个**故意不折**的 transform 契约
  （`design-evolution-readings.appendEvolutionFindings`，理由见 Disposition）。
- L_G（通用性/是否只是搬文件）：本次没有新增模块、没有改任何调用点的语义，5 处导出名与契约保持 —— 判为不打分（非本轮判据）。

## Touches
- `plugin/scripts/arch-discovery-routine.ts`
- `plugin/scripts/discovery-method-routine.ts`
- `plugin/scripts/probe-routine.ts`
- `plugin/scripts/resource-anomaly-detector.ts`
- `plugin/scripts/gate-script-base.ts`
- `plugin/scripts/gate-event-coverage-check.ts`
- `plugin/test/gate-script-base.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-jsonl-batch-appenders.md`