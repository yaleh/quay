---
id: gap-routine-semantic-dedup-scan-rev-parse-head-identical
title: "semantic-dedup-scan: Bodies identical including the SHA regex and
  try/catch-null, and both take the same single root parameter, so the two names
  are purely historical."
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
Bodies identical including the SHA regex and try/catch-null, and both take the same single root parameter, so the two names are purely historical.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1792752400273` · ts `2026-10-23T10:46:40.273Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`revParseHead`、`revParseHeadOf`
- 涉及文件：
- `plugin/scripts/ready-pool-check.ts:3793`
- `plugin/scripts/driver-filters.ts:1225`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
merge

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-23T10:46:40.273Z

## Disposition
**修掉**（不是「已有机制在管」）—— 逐字副本合并为单一实现：

- 单一实现留在 `plugin/scripts/driver-filters.ts` 的 `revParseHeadOf`（改为 `export`）；`plugin/scripts/ready-pool-check.ts`
  删除本地 `revParseHead`，改从 `./driver-filters.ts` import。该 import 边在本任务之前就已存在
  （`judgeDeps, syncDocDevelopBidirectional` 同一行），因此**没有新增依赖边、没有值环**（`import-graph-check` PASS）。
- 两个调用点（`setTaskStatus` / `retreatReadyToTodo` 的 `evidence.commit` 读取）改用共享实现，行为逐字不变：
  同一 `git -C <root> rev-parse HEAD`、同一 `["ignore","pipe","ignore"]`、同一 `/^[0-9a-f]{40,64}$/i`、同一 null-on-throw。
- 为什么值得修：该 subject 自 2026-10-13 起已复发 6 次（`.quay/routine-findings.jsonl` 的
  `rev-parse-head` / `rev-parse-head-pair` ×3 / `revparseheadof-copy` / `rev-parse-head-byte-identical` /
  `rev-parse-head-identical`），根因是「只报不修」；本任务修掉的正是探针检测的那份重复体本身。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `rev-parse-head-identical`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1792752400273`）所描述的问题被复核并处置
- [x] 处置结论可核：已修掉 —— `plugin/scripts` 内 `revParseHead*` 定义数 develop=2 → 本树=1（`grep -rE '^(export )?function revParseHead' plugin/scripts/*.ts | wc -l`），提交 `4f84aa264`；scoped gate `scripts/test.sh --for-task … --allow-thin` EXIT=0。

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑
- [x] L_D: revParseHeadDefinitions=1, duplicateBodiesRemoved=1, newImportEdges=0
  - baseline (develop): revParseHeadDefinitions=2（`ready-pool-check.ts` + `driver-filters.ts`）
  - after: revParseHeadDefinitions=1（`driver-filters.ts:export function revParseHeadOf`）
  - import edge ready-pool-check→driver-filters 任务前已存在；import-graph-check verdict=PASS

## Evidence
- commit: `4f84aa264`（任务分支 `task/gap-routine-semantic-dedup-scan-rev-parse-head-identical`）
- scoped gate: `bash scripts/test.sh --for-task gap-routine-semantic-dedup-scan-rev-parse-head-identical --allow-thin` → exit 0
  （scoped static tier PASS，含 `import-graph-check`；受影响 shard 90 tests pass / 0 fail）
- 模块冒烟：import 两个模块成功，`driver-filters.revParseHeadOf(root)` 返回真实 HEAD sha；
  `ready-pool-check` 不再导出任何 `revParseHead` 本地实现
- anti-drift Touches: `ANTI-DRIFT OK — 2 actual file(s), all within declared Touches`
- 复发判据（Effect Prediction）：探针按 byte-identical body 检测；本树中该函数体只剩一份 ⇒ 同一 subject 的后续 finding 应为 0。⛔ 不以「已注意到」结案。

## Touches
- `plugin/scripts/ready-pool-check.ts`
- `plugin/scripts/driver-filters.ts`
- `tasks/gap-routine-semantic-dedup-scan-rev-parse-head-identical.md`
