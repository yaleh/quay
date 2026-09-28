---
id: gap-routine-semantic-dedup-scan-p035
title: "semantic-dedup-scan: Diff of the two regions is clean, including the
  absent-file return null and the {__unparseable:true} sentinel that keeps line
  counts comparable: a contract the"
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
Diff of the two regions is clean, including the absent-file return null and the {__unparseable:true} sentinel that keeps line counts comparable: a contract the shared readJsonLines (returns []) cannot express.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1790592211995` · ts `2026-09-28T10:43:31.995Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`readJsonlLines`
- 涉及文件：
- `plugin/scripts/direct-to-develop-bypass-check.ts:926`
- `plugin/scripts/fan-in-ff-protocol-check.ts:280`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract the counting variant; do NOT point both at readJsonLines whose fail-open form loses the malformed row

## Disposition — 修掉（extract），⛔ 非「已注意到」

复核：carrier 记录在位（runId `semantic-dedup-scan-1790592211995`，files 逐字 = 本任务 body 点名的两处，
verdict `real-duplication`）；两处 region 的 `diff` 为空（byte-identical）——finding 可复现。

处置 = 按 requested action **抽取**，并**不折叠**：
1. `readJsonlLines` 上提到 `plugin/scripts/gate-script-base.ts`（单一定义）；两个载体改为 import
   （两者本就从该模块 import，⛔ 不新增 import 边）。`grep -rn "function readJsonlLines" plugin/scripts/`
   命中数 2 → 1。
2. ⛔ 不指向 `readJsonLines`：其 fail-open 形态（缺失 ⇒ `[]`、坏行 ⇒ 跳过）会让
   `rows.some(r => r.__unparseable)` 恒假 —— 两个检查器的 NOT-EVALUATED 分支会静默变 PASS（硬规则 3b）。
   两条轴都是承载性差异：缺失载体 ⇒ `null`（非 `[]`）；坏行 ⇒ `{__unparseable:true}` 占位行（非跳过）。
   判据形态 = `plugin/test/gate-script-base.test.mjs` 的 boundary 测试（单一定义 + 两者 import +
   ⛔ 不得 import `readJsonLines`），外加一条**实测对照**：同一坏行夹具下 sentinel 读法分支为真、
   行丢弃读法分支恒假。
3. `direct-to-develop-bypass-check.ts` 去掉随之空置的 `node:fs` import。

失败在哪一步（若日后复发）：本机制**只**钉住这两个载体；同族新增读取器不会被自动拦住 —— 复发点
= 新写了一处「缺失⇒null / 坏行⇒占位」的读取器而未上提到 base，此时 `readJsonlLines` 的 single-source
ratchet 不覆盖它（它按符号名精确匹配）。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `p035`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790592211995`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/direct-to-develop-bypass-check.ts`
- `plugin/scripts/fan-in-ff-protocol-check.ts`
- `plugin/scripts/gate-script-base.ts`
- `plugin/test/gate-script-base.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-p035.md`
