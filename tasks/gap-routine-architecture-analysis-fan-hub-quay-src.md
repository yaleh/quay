---
id: gap-routine-architecture-analysis-fan-hub-quay-src
title: "architecture-analysis: packages/quay/src has fanIn=486 fanOut=424 across
  30 files incl. 3907-line observation.ts and 2965-line init.ts"
status: ready
labels:
  - gap
  - routine-filed
  - architecture-analysis
parent: null
children: []
extra: {}
---
## Finding
packages/quay/src has fanIn=486 fanOut=424 across 30 files incl. 3907-line observation.ts and 2965-line init.ts

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793622670475` · ts `2026-11-02T12:31:10.475Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`liveSessionIdForPid`、`classifyConfig`
- 涉及文件：
- `packages/quay/src/observation.ts:221`
- `packages/quay/src/init.ts:177`
- kind：`god-package`
- verdict：`CONFIRMED`

## Requested action
Split observation/init monoliths and remove the re-export barrel so subpackages import each other directly

## Disposition
已修掉一半、并写明另一半为何是误报（复核 + 部分拆分；⛔ 非「已注意到」）：

- **拆分 observation.ts 三条新 seam**（保持 barrel 单 import 面，~90 个消费者一个不动）：
  - `./observation/needs-human-ledger.ts` — promotion-outcome 的 needs-human 显式承接 ledger；
  - `./observation/task-status-ref.ts` — git-ref 任务 status/title/commit-time 读取（develop-first 缓存 + 后台刷新）；
  - `./observation/live-state.ts` — `.quay/live-state.json` 四态快照读取。
  - observation.ts 3907 → 3272 行（移出 635 行），`tsc --noEmit -p packages/quay` exit 0。
- **不采纳「移除 re-export barrel」**：barrel 是上一个拆分任务（observation-ts-multi-responsibility-god-module, 2026-10-22）的刻意 facade，头注释写明「re-exports every moved symbol so `from "./observation.ts"` remains the single import surface」。移除它要把 ~90 个 import 点改成子包直连，是「稳定 facade」换「fanIn 数字好看」——不划算。barrel 上的高 fanIn 是 facade 的**预期**现象，不是 god-package 缺陷（archguard 的 fan-hub detector 不识别 facade 模式）。
- **init.ts 本轮不拆**：它已把 3 个 seam 拆进 `./init/`（carrier-env / delivery-surface / provider-maintenance），剩余 2965 行是**单一**职责（`runInit` 的 config/upgrade/profiles 生成链），fanOut=67 是依赖多（imports 多）、fanIn=15 是消费者少——不是「无关职责的 god module」。

「已有机制在管、失败在哪一步」（fan-in/fan-out 指标这一半）：`archguard-runner.ts`（L_G 读面）把 src scope 的 `maxInDegree/maxOutDegree` 写进 `.archguard/metrics-history.jsonl` 但**刻意不设阈值 gate**（其头注释：god-package 需要阈值、留待数据积累——硬规则 4 推论一）。失败点：L_G 只 fail-closed 在**环**（entitySccCount/directoryCycleCount），对 fan-in 只记录不阻止 ⇒ hub 增长由本例程下一轮重新立案兜底，而非被 gate 拦下。

- L_G archguard: entitySccCount=0 directoryCycleCount=0 maxInDegree=349 maxOutDegree=195

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-02T12:31:10.475Z

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `fan-hub-quay-src`（routine `architecture-analysis`，runId `architecture-analysis-1793622670475`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `packages/quay/src/observation.ts`
- `packages/quay/src/observation/needs-human-ledger.ts`
- `packages/quay/src/observation/task-status-ref.ts`
- `packages/quay/src/observation/live-state.ts`
- `packages/quay/src/init.ts`
- `tasks/gap-routine-architecture-analysis-fan-hub-quay-src.md`