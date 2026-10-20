---
id: gap-routine-semantic-dedup-scan-slot-refill-ff-records
title: "semantic-dedup-scan: Two exported functions in the same file have
  identical bodies (read, split, trim, JSON.parse each, skip corrupt, [] on
  failure) differing only in the ledger fi"
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
Two exported functions in the same file have identical bodies (read, split, trim, JSON.parse each, skip corrupt, [] on failure) differing only in the ledger filename literal.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1792405443214` · ts `2026-10-19T10:24:03.214Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`readFfRetryRecords`、`readFfEscalationRecords`
- 涉及文件：
- `plugin/scripts/slot-refill.ts:257`
- `plugin/scripts/slot-refill.ts:276`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `slot-refill-ff-records`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1792405443214`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Evidence

**复核（finding 原文）**：`.quay/routine-findings.jsonl:2754` 记录 `findingId:"slot-refill-ff-records"`,
`symbols:["readFfRetryRecords","readFfEscalationRecords"]`, `files:["plugin/scripts/slot-refill.ts:257","plugin/scripts/slot-refill.ts:276"]`,
`dupKind:"byte-identical-body"`, `verdict:"real-duplication"`. 逐字比对确认两函数体一致，仅
`fan-in-retries.jsonl` / `fan-in-ff-escalations.jsonl` 字面量不同。

**处置（修掉，非「已注意到」）**：两个函数改为委托 `gate-script-base.ts` 的共享 `readJsonLines`
（该 reader 本就是为另一条 semantic-dedup-scan finding `readjsonlines-seven-defs-three-behaviors`
抽取的唯一副本）。提交 `c4a9320b6`：`plugin/scripts/slot-refill.ts` +15/−38。

**5b 同载体清扫**（同文件内第三条同形循环）：`computeExitedNotLandedContinueIds` 内联的
read/split/trim/JSON.parse/skip-corrupt 循环一并折叠到 `readJsonLines`。守卫：
`grep -n 'readFileSync\|split("\\n")' plugin/scripts/slot-refill.ts` 剩余 4 处均非 `.quay/*.jsonl`
解析循环（full-suite-state.json 单文档 ×1、task 文件读 ×2、git log stdout ×1）。

**行为等价性**：缺席/不可读 ⇒ `[]`；空行与损行跳过；`readJsonLines` 的严格非数组对象守卫只丢弃
各调用方原本就用 `rec &&` 挡掉的非对象行 ⇒ 对 `computeFfFailureCounts` /
`computeUnresolvedEscalationTaskIds` / `computeExitedNotLandedContinueIds` 的输入集无变化。

**实测证据**：
- `node --experimental-strip-types --test plugin/test/slot-refill-*.test.mjs` ⇒ tests 120 / pass 120 / fail 0。
- scoped 门 `scripts/test.sh --for-task gap-routine-semantic-dedup-scan-slot-refill-ff-records --allow-thin` ⇒ exit 0（静态闸全 PASS）。
- anti-drift Touches：`ANTI-DRIFT OK … 1 actual file(s), all within declared Touches (2 glob(s))`。

## Touches
- `plugin/scripts/slot-refill.ts`
- `tasks/gap-routine-semantic-dedup-scan-slot-refill-ff-records.md`
