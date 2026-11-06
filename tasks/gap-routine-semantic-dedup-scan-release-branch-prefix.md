---
id: gap-routine-semantic-dedup-scan-release-branch-prefix
title: "semantic-dedup-scan: the globs-to-prefix derivation is exported by the
  declared release-model authority yet release-cut.mjs hand-copies it although
  it already spawns that module fo"
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
the globs-to-prefix derivation is exported by the declared release-model authority yet release-cut.mjs hand-copies it although it already spawns that module for --print-model

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1793943196283` · ts `2026-11-06T05:33:16.283Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`releaseBranchPrefix`
- 涉及文件：
- `plugin/scripts/release-cut.mjs:355`
- `plugin/scripts/release-model-check.ts:182`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
merge

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-06T05:33:16.283Z

## Disposition
**修掉（fixed）** —— 按 Requested action `merge` 执行，落点 commit `83b3e9e74`（task 分支
`task/gap-routine-semantic-dedup-scan-release-branch-prefix`）。

**为什么这次不是「leave」**：同一 finding 在 2026-10-26 那轮的建议是
`leave - document the cross-reference`（`.quay/routine-findings.jsonl:3303`），本轮
（`semantic-dedup-scan-1793943196283`）它又原样复现 —— 「已注意到」在本仓库等于没处置。
本轮的新事实是：两个文件之间**已经存在**一条 spawnSync 通道（`release-cut.mjs` 正是为
`--print-model` 去调 `release-model-check.ts`），所以合并**不需要新机制**，只需把推导搬到那条
既有通道上。

**合并方式（走既有接缝，⛔ 不加 import）**：`release-cut.mjs` 是 plain ESM 且**必须**如此
（文件自己的 "WHY THIS IS A `.mjs`" 段：发布工具要在切版那一刻 PATH 上的 `node` 下跑，而类型擦除要
Node ≥22.6），因此它**不能** import 这个 `.ts`。于是：
1. `release-model-check.ts --print-model` 多输出一行 `branch_prefix=<派生值>`（**恒存在**，派生值为空串时
   也打印 —— 「空」与「缺」是两件事，硬规则 3b）；
2. `release-cut.mjs::readReleaseModel` 解析这一行，**缺行即拒**
   （`CAUSE=release-cut-release-model-unreadable`，报文里写明 `branch_prefix=ABSENT`），⛔ 不在本地再推一遍；
3. 两个调用点（`const branch = ...`、shipped-set preflight 的探针分支前缀）改读 `releaseModel.branch_prefix`；
4. 本地那份 `releaseBranchPrefix` 函数体**删除**。

**可核（本轮实跑，非断言）**：
- `grep -c 'function releaseBranchPrefix' plugin/scripts/release-cut.mjs` = **0**；
  `plugin/scripts/release-model-check.ts` = **1**；全 `plugin/scripts/*.{ts,mjs}` 中该定义只出现在 **1** 个文件里。
- `grep -c 'indexOf("*")' plugin/scripts/release-cut.mjs` = **0**（推导形态本身已从该文件消失）。
- `identity-replication-check.ts --root . --json`（探针自己的 FALLBACK 读数器，非我另造）：输出中提及
  `releaseBranchPrefix` 的条目 **0** —— 修复前该名字在两个文件各自独立声明（见本文 Finding 的 files 字段）。
- 行为不变是**证过**的：`plugin/test/release-model-check.test.mjs` **11/11 绿**；
  `plugin/test/release-cut.test.mjs` 的「the cut takes baseline / tag_prefix / branch globs from
  .quay/config.yml's release: section」实跑绿 —— 它断言 dry-run 打印 `create 'rel/9.9.9' at 'trunk'`，
  即前缀确实**穿过接缝**从声明模型到达渲染器，而不是在渲染器里重新算出来的。
- 新增负控（`release-cut.test.mjs`）：读侧喂一个**完整的旧模型**（其余键齐全、唯有 `branch_prefix=` 行缺席）
  ⇒ exit 2 且报文含 `branch_prefix=ABSENT`，证明「缺行」不会被本地重导悄悄补上。
- 新增接缝用例（`release-model-check.test.mjs`）：`globs: ["*"]` ⇒ 打印 `branch_prefix=`（**存在且为空**），
  把「空 ≠ 缺」钉在读数一侧。

**硬规则 5b（修的是共享源，不是一份拷贝）**：全 `plugin/scripts` 搜同一推导形态
（`indexOf("*")` + 前缀切片）命中 **1** 处 —— `release-model-check.ts:198`，即正本本身。另 1 处
`import-graph-check.ts:247` 是 exports-map 通配符匹配（前缀+后缀各取一段），**不是同一概念**，不并入。
`release-branch-finish.sh:381` 只按 globs 做匹配、不派生前缀，无需改动。

**ADR-007 暗轴读数**（本轮实跑）：
- L_D: releaseBranchPrefix definitions=1 (was 2); derivation-occurrences-in-release-cut.mjs=0; identity-replication-entries=0
- L_G archguard-runner six-scopes: entitySccCount=0, directoryCycleCount=0, verdict=PASS

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `release-branch-prefix`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1793943196283`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Test-Files
- `plugin/test/release-model-check.test.mjs`
- `plugin/test/release-cut.test.mjs`

## Touches
- `plugin/scripts/release-cut.mjs`
- `plugin/scripts/release-model-check.ts`
- `plugin/test/release-model-check.test.mjs`
- `plugin/test/release-cut.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-release-branch-prefix.md`