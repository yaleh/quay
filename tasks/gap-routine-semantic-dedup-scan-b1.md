---
id: gap-routine-semantic-dedup-scan-b1
title: "semantic-dedup-scan: Seven named wrappers across six files all reduce to
  the same 1-2 line createHash('sha256') body; ~30 repo-wide call sites."
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
Seven named wrappers across six files all reduce to the same 1-2 line createHash('sha256') body; ~30 repo-wide call sites.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1793491958069` · ts `2026-11-01T00:12:38.069Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`sha256Hex`、`sha256`、`sha256OfString`、`sha256OfBuffer`
- 涉及文件：
- `plugin/scripts/experiment-manifest.ts:175`
- `plugin/scripts/proposal-convergence.ts:37`
- `plugin/scripts/execution-policy.ts:124`
- `plugin/scripts/stage-receipt.ts:206`
- `plugin/scripts/stage-receipt.ts:210`
- `plugin/scripts/run-identity.ts:92`
- `plugin/scripts/primitives-drift-check.ts:71`
- kind：`same-symbol-multi-file`
- verdict：`real-duplication`

## Requested action
extract

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-01T00:12:38.069Z

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `B1`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1793491958069`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Evidence
复核结论 = 真实重复（verdict `real-duplication` 核实无误），处置 = **extract**，单一实现落在
`plugin/scripts/sha256.ts`（plugin-scripts 叶，仅 import `node:crypto`；七个被点名 wrapper 的调用者全在
`plugin/scripts/`，无 `packages/**` 调用者，故放 plugin 侧而非 kernel）：

- 新增 `sha256OfString(s)` 与 `sha256OfBuffer(buf)`：`createHash("sha256").update(...).digest("hex")` 只此一处（字符串/缓冲两个编码变体）。
- 七个被点名 wrapper 全部改为 import 该叶：
  - `plugin/scripts/experiment-manifest.ts`（原 `sha256Hex`）
  - `plugin/scripts/proposal-convergence.ts`（原 `sha256` → `sha256OfString as sha256` 别名，调用点不动）
  - `plugin/scripts/execution-policy.ts`（原 `sha256OfString`）
  - `plugin/scripts/stage-receipt.ts`（原 `sha256OfBuffer` + `sha256OfString`；保留 re-export 与 `sha256File` 委托 —— finding-backpropagate.ts 再导出 `sha256OfString`）
  - `plugin/scripts/run-identity.ts`（原私有 `sha256OfBuffer`）
  - `plugin/scripts/primitives-drift-check.ts`（原私有 `sha256OfBuffer`）
- 复核判据（可核，非声明）：`grep -rn 'createHash("sha256")' plugin/scripts/{experiment-manifest,proposal-convergence,execution-policy,stage-receipt,run-identity,primitives-drift-check}.ts` → 0 命中。
- ⛔ 范围边界（诚实声明）：本 finding 只点名上述七个 wrapper。`plugin/scripts/` 里仍有**未被本 finding 点名**的同族独立实现（如 `build-evidence-manifest.ts` 的 buffer/string 变体、`worker-driver.ts:4182`、`suite-fs-trace.ts:71`、`goal-driver.ts`、`mirror-pair-drift-check.ts:93`、`codex-stage1-live-proof-audit.ts:133`），属例程未立案/未点名的兄弟实例，不在本任务 Touches，故**不声称已收敛全家族** —— 由下一轮 semantic-dedup-scan 按自身 concept_key 决定是否另行立案。

实跑：
- `node --no-warnings --experimental-strip-types plugin/scripts/import-graph-check.ts . --json` → EXIT=0：
  valueSccs=0 / typeSccs=0 / reverseEdges=0 / kernelViolations=0 / gateLayerViolations=0
  （files=536 edges=1644，含新增叶与 6 条 import 边 —— 抽取未引入任何依赖环或反向边）。

## ADR-007 暗轴记录
- L_D import-graph-check: valueSccs=0 typeSccs=0 reverseEdges=0 kernelViolations=0 gateLayerViolations=0 files=536 edges=1644（worktree 实跑 `node --no-warnings --experimental-strip-types plugin/scripts/import-graph-check.ts . --json`，EXIT=0）
- L_G：该轴仍暗,理由:本任务为字节相同函数体的去重抽取，未对重复/再造抽象跑 archguard detect_duplicates 读数；抽取的「家族收敛」由本 finding 自身的 concept_recurs_after_merge 指标在 merge 后回读，不在本任务内自证。

## Touches
- `plugin/scripts/experiment-manifest.ts`
- `plugin/scripts/proposal-convergence.ts`
- `plugin/scripts/execution-policy.ts`
- `plugin/scripts/stage-receipt.ts`
- `plugin/scripts/run-identity.ts`
- `plugin/scripts/primitives-drift-check.ts`
- `plugin/scripts/sha256.ts`
- `tasks/gap-routine-semantic-dedup-scan-b1.md`