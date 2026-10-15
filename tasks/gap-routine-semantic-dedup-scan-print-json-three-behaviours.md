---
id: gap-routine-semantic-dedup-scan-print-json-three-behaviours
title: "semantic-dedup-scan: One name spans three shapes: three byte-identical
  console.log(JSON.stringify(x)), two pretty-printers that are one behaviour in
  two spellings, and a third pret"
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
One name spans three shapes: three byte-identical console.log(JSON.stringify(x)), two pretty-printers that are one behaviour in two spellings, and a third pretty variant with a different signature — extraction must respect that core cannot import plugin sources.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1792033478766` · ts `2026-10-15T03:04:38.766Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`printJson`
- 涉及文件：
- `plugin/scripts/run-identity.ts:471`
- `plugin/scripts/stage-receipt.ts:800`
- `plugin/scripts/workflow-journal.ts:607`
- `plugin/scripts/guard-lineage-check.ts:465`
- `plugin/scripts/worktree-process-reaper.ts:517`
- `packages/quay/src/cli/shared.ts:41`
- kind：`divergent-implementation`
- verdict：`divergent-implementation`

## Requested action
extract

## Disposition
**已修（extract），除一处结构性分歧外。** 三形态各自的落点：

- 紧凑（`console.log(JSON.stringify(obj))` ×3，三处字节相同）→ `plugin/scripts/gate-script-base.ts` 的 `printJsonCompact`。三处**本就** import 该模块，无新增依赖边。
- 美化（`console.log(JSON.stringify(x, null, 2))` 与 `` `process.stdout.write(\`${JSON.stringify(x, null, 2)}\n\`)` `` —— 同一行为两种拼写）→ 同模块的 `printJson`。
- 美化核心变体（`packages/quay/src/cli/shared.ts:41`）→ **保留**，并就地声明为**结构性分歧而非漂移**：`packages/quay` 从不 import plugin 源（依赖方向是 plugin → Core），两个面共用一份定义就得把 Core 源码放上 plugin 的 import 路径——`packages/quay/scripts/build-plugin-dist.mjs` 的 `CORE_SRC_DIR` 注释已记该写法在 staged 布局下 break esbuild。finding 自己的 rationale 点名了这条边界。

**字节等价是实测的，不是推的**：Node 的 `format()` 对单个字符串参数原样返回后再补 `\n`，故 `process.stdout.write(JSON.stringify(x) + "\n")` 与 `console.log(JSON.stringify(x))` 输出同字节（cmp 嵌套/undefined/null 夹具：46 字节，一致）；三个紧凑 CLI 的冒烟输出仍是单行。

**5b 扫描（同一符号，⛔ 不是「全仓 JSON 输出」）**：`grep -rn 'function printJson' plugin/scripts` 另命中 finding 未列的 **3 处**——`orphan-session-check.ts:240`、`psi-failure-correlation-check.ts:771`、`instrument-decay-check.ts:297`。三者都是**载荷构造器**（不是裸 emitter），其末行是两种共享形状之一的副本；现全部改走共享 emitter，并改名 `printOrphanReport` / `printCorrelationReport` / `printDecayReport`，使 `printJson` 在全仓只指一件事（emitter）。
**范围上界（写明，免得被读成「这一类已清完」）**：同一扫描的**内联**形态（`console.log(JSON.stringify(` / `stdout.write(JSON.stringify`）在 `plugin/scripts` 命中约 200 处——那是另一个、大得多的类，本 finding 的 `printJson` 簇不是它；`instrument-decay-check.ts` 内剩下的内联 error-path emitter 随该类留待另案。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `print-json-three-behaviours`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1792033478766`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/gate-script-base.ts`
- `plugin/scripts/run-identity.ts`
- `plugin/scripts/stage-receipt.ts`
- `plugin/scripts/workflow-journal.ts`
- `plugin/scripts/guard-lineage-check.ts`
- `plugin/scripts/worktree-process-reaper.ts`
- `plugin/scripts/orphan-session-check.ts`
- `plugin/scripts/psi-failure-correlation-check.ts`
- `plugin/scripts/instrument-decay-check.ts`
- `packages/quay/src/cli/shared.ts`
- `tasks/gap-routine-semantic-dedup-scan-print-json-three-behaviours.md`

## Blocker

**2026-10-15T03:27:22.521Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: incomplete suite (925/925 files) — recovery exhausted at floor concurrency 32 — no declared rung produced a complete verdict (64,48,32); needs a code/config fix, see plugin/scripts/full-suite-runner.ts
- run_id：wk-prod-anchor
- session_id：48c126d6-cda2-4288-869a-166a1d2f367b
