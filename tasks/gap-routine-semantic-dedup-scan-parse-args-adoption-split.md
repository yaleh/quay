---
id: gap-routine-semantic-dedup-scan-parse-args-adoption-split
title: "semantic-dedup-scan: Split adoption of one canonical: eight sites thinly
  wrap gate-script-base.ts parseArgs while six hand-roll their own token loops
  with genuinely divergent error"
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
Split adoption of one canonical: eight sites thinly wrap gate-script-base.ts parseArgs while six hand-roll their own token loops with genuinely divergent error models (throw vs process.exit(2) vs an error return field vs silent accept of unknown flags).

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1791908616513` · ts `2026-10-13T16:23:36.513Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`parseArgs`
- 涉及文件：
- `plugin/scripts/gate-script-base.ts:164`
- `plugin/scripts/accounting-emit.ts:270`
- `plugin/scripts/discovery-path-classify.ts:544`
- `plugin/scripts/guard-lineage-check.ts:381`
- `plugin/scripts/instrument-decay-check.ts:322`
- `plugin/scripts/outer-cron-registry.ts:656`
- `plugin/scripts/phase-declare.ts:268`
- `plugin/scripts/checked-in-write-check.ts:384`
- `plugin/scripts/perfile-failure-rate.ts:280`
- `plugin/scripts/psi-failure-correlation-check.ts:193`
- `plugin/scripts/psi-window-join.ts:155`
- `plugin/scripts/self-report-vocab-check.ts:138`
- `plugin/scripts/suite-scheduler.ts:475`
- `plugin/scripts/workflow-invariant-ownership.mjs:29`
- `plugin/scripts/workflow-metadata-conformance.mjs:711`
- kind：`divergent-implementation`
- verdict：`divergent-implementation`

## Requested action
migrate the six hand-rolled parsers onto gate-script-base parseArgs

## Resolution
处置 = **修掉**（不是「已注意到」，也不是「另有机制在管」）。finding 的计数在本轮复核中逐条对上：
`.quay/routine-findings.jsonl` 同一 runId 记录的 15 个文件里，**8 个已 import `parseArgs as baseParseArgs`**
（gate-script-base 本体 + checked-in-write-check / perfile-failure-rate / psi-failure-correlation-check /
psi-window-join / self-report-vocab-check / suite-scheduler / workflow-invariant-ownership /
workflow-metadata-conformance），**6 个手搓 token 循环**（accounting-emit / discovery-path-classify /
guard-lineage-check / instrument-decay-check / outer-cron-registry / phase-declare）—— 正是 finding
rationale 说的「eight wrap + six hand-roll」，四种互不兼容的 error model 也逐一对应：
throw（discovery / guard / instrument）· `process.exit(2)`（accounting-emit）· error 返回字段
（phase-declare）· 静默接受未知 flag（outer-cron-registry）。

六个手搓点全部迁到 `gate-script-base.ts` 的 `parseArgs`：本地只剩**各自的 flag 集 + 各自的校验 +
各自的 usage 文本**，四种 error model 由共享解析器**已有的 opt-in 键**表达，未改 `gate-script-base.ts`
一个字节 —— `errors: "exit" | "return"`（exit vs 返回 error 字段）、`help: "exit" | "return"`、
`unknown: "accept" | "skip" | "reject"`（reject = 拒绝未知 flag / skip = 丢弃且**不吞后一个 token**，
正是 outer-cron-registry 原来「不消费」的读法）。每次迁移都保留了原脚本的输入语言：位置参数仍按各脚本
原样拒绝或忽略，缺值 flag 仍走各脚本原来的失败路径（如 `--stale-seconds` 无量值仍报 usage，不静默变 0
—— 硬规则 3b）。唯一放宽的是 `--flag=value`（共享解析器自己的拼写）。

可核产物 = `plugin/test/gate-script-base-adoption.test.mjs`：对六个载体断言「**调用**共享解析器 ∧ **不含**
把 token 与 `--` 字面量比较的手搓扫描」，且谓词**两个方向都被夹具跑过**（退役循环读作 handrolled:true，
适配器读作 handrolled:false）—— 一个只能取一值的谓词是回声，不是测量（硬规则 2/3b）。
本树实测：301 个 plugin/scripts 源里 125 个仍带 `--` 字面量比较，六个载体为 0。
六个载体各自的端到端 CLI 行为由它们**原有的测试文件**继续钉住（本迁移后全部原样通过）。

验证读数（本任务 worktree，scoped gate `scripts/test.sh --for-task … --allow-thin`）：`tests 323 / pass 315 /
fail 0 / skipped 8 / exit 0`；六个载体的自测（accounting-emit / discovery-path-classify / guard-lineage-check /
instrument-decay-check / outer-cron-registry / phase-declare）与新钉 `gate-script-base-adoption.test.mjs`
均在选中集内实跑。
`anti-drift-touches-check --merge-target develop`：`7 actual file(s), all within declared Touches (17 glob(s))`，exit 0。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `parse-args-adoption-split`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791908616513`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/gate-script-base.ts`
- `plugin/scripts/accounting-emit.ts`
- `plugin/scripts/discovery-path-classify.ts`
- `plugin/scripts/guard-lineage-check.ts`
- `plugin/scripts/instrument-decay-check.ts`
- `plugin/scripts/outer-cron-registry.ts`
- `plugin/scripts/phase-declare.ts`
- `plugin/scripts/checked-in-write-check.ts`
- `plugin/scripts/perfile-failure-rate.ts`
- `plugin/scripts/psi-failure-correlation-check.ts`
- `plugin/scripts/psi-window-join.ts`
- `plugin/scripts/self-report-vocab-check.ts`
- `plugin/scripts/suite-scheduler.ts`
- `plugin/scripts/workflow-invariant-ownership.mjs`
- `plugin/scripts/workflow-metadata-conformance.mjs`
- `plugin/test/gate-script-base-adoption.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-parse-args-adoption-split.md`
