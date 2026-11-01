---
id: gap-routine-semantic-dedup-scan-a1
title: "semantic-dedup-scan: Same budget/summary logic duplicated across Core
  and native, already diverged (native adds scannedFiles + directory arm)."
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
Same budget/summary logic duplicated across Core and native, already diverged (native adds scannedFiles + directory arm).

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1793491958069` · ts `2026-11-01T00:12:38.069Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`budgetedTaskListContent`
- 涉及文件：
- `packages/quay/src/mcp-handlers.ts:54`
- `packages/quay-native/src/mcp-server.ts:55`
- kind：`divergent-implementation`
- verdict：`divergent-implementation`

## Requested action
extract

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-01T00:12:38.069Z

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `A1`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1793491958069`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## Evidence
处置 = 抽取修掉。把 Core `mcp-handlers.ts` 与 native `mcp-server.ts` 各自内联的
`budgetedTaskListContent` + `TEXT_PAYLOAD_BUDGET_BYTES` 收敛为单一共享定义
`packages/quay/src/task-list-content.ts`（Core 侧），两个调用方沿既有 native→Core 依赖方向
（`../../quay/src/…` 相对路径，同 search-index.ts）导入；native 独有 `scannedFiles` 分支作为可选
字段保留在共享函数里，Core 调用方不传该字段、native 调用方传该字段 ⇒ 两者文本逐字节不变（runtime
检查已验证 under/over-budget 两种形态）。两个内联定义已删除。验证：`for d in packages/*/; do npx
tsc --noEmit -p "$d"; done` 全绿；scoped 选中的 10 个非 npm-pack-e2e 测试文件 `node --test` 全绿
（build-dist / mcp-handlers / mcp-server / plugin-packaging 等）。scoped 门的 npm-pack-e2e 文件红是
既有无关缺陷（`plugin/scripts/consumer-quay-deliverable-verify.sh` 未在
capability-catalog-declarations.json 声明 ⇒ catalog 入口闸 UNCLASSIFIED=1，非本任务改动引起，主检出
复现同红）。

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

该轴仍暗，理由：本任务把两处内联实现抽取为单一共享 leaf，不新增包间依赖（沿 native→Core 既有方向）、不改变调用图结构，L_D/L_G 轴对此类抽取无新增信号。

## Touches
- `packages/quay/src/mcp-handlers.ts`
- `packages/quay-native/src/mcp-server.ts`
- `packages/quay/src/task-list-content.ts`
- `tasks/gap-routine-semantic-dedup-scan-a1.md`