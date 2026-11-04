---
id: gap-routine-architecture-analysis-god-package-serve-view-fanin-516
title: "architecture-analysis: web view layer is the most-imported surface;
  every serve page/cell pulls its render+binding helpers"
status: done
labels:
  - gap
  - routine-filed
  - architecture-analysis
parent: null
children: []
extra: {}
---
## Finding
web view layer is the most-imported surface; every serve page/cell pulls its render+binding helpers

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793780643192` · ts `2026-11-04T08:24:03.192Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`resolveServeBinding`、`renderLiveCard`、`formatDurationMs`
- 涉及文件：
- `packages/quay/src/serve/view/serve-binding.ts:100`
- `packages/quay/src/serve/view/serve-dashboard.ts:79`
- kind：`god-package`
- verdict：`god-package: fanIn=516 (repo max), fanOut=193, 84 entities / 7 files`

## Requested action
extract per-cell render/binding modules and narrow the exported surface

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-04T08:24:03.192Z

## Disposition

### 1. 复核：finding 逐字命中，是同一 subject 的复发

`grep -o '"findingId":"god-package-serve-view-fanin-516"[^}]*}' .quay/routine-findings.jsonl` 逐字命中：
verdict `god-package: fanIn=516 (repo max), fanOut=193, 84 entities / 7 files`、suggestedAction
`extract per-cell render/binding modules and narrow the exported surface`、符号 `resolveServeBinding` /
`renderLiveCard` / `formatDurationMs` —— 与任务体 `## Finding` / `## Requested action` 一致。

本轮实测（worktree @ develop `8cb794419` + 本任务提交 `158074f2a`，archguard scope `27a6b0e2` fresh）：
`serve/view` package fanIn=515 fanOut=193 fileCount=8 entityCount=86 cycleCount=0（拆分后 +1 文件 / +2 导出实体，
fanIn/fanOut 结构不变——见第 3 点）。

### 2. 处置：修掉文件级半边，不重复「已注意到」结案

这是同 subject 的复发；前序任务 `gap-routine-architecture-analysis-god-package-serve-view`（done）与
`-serve-view-7368b251`（done，已拆 serve-i18n.ts 2780→124 行）把「先拆 serve-i18n.ts → 再拆
serve-dashboard.ts 的 per-domain card renderer → 最后 serve-render.ts page chrome」明确记为后续增量。
本任务执行 serve-dashboard.ts 的第一刀 per-cell 切片（正是 requested action「extract per-cell
render/binding modules」）：

- 新模块 `packages/quay/src/serve/view/serve-live-cell.ts`（431 行）承载三个观测符号中的两个
  （`renderLiveCard`、`formatDurationMs`）+ 整个循环脉搏 cell：`formatSuiteElapsed` / `formatDurationMs` /
  `formatSeconds`、`renderLiveCard`、`DEFAULT_TIMELINE_HOURS` / `parseTimelineHours` /
  `timelineHoursFromRequest`、`stateColorToken` / `fanInOutcomeColorToken` / `livePhaseColorToken`、
  `renderTimelineBarSvg`（G/H 共用时间轴）/ `renderLiveSwimlaneSvg` / `renderLiveGanttSvg`（固定 5 泳道甘特）
  与 dashboard-kernel 的 gantt packing 再导出。第三个符号 `resolveServeBinding` 无需动作——它已在
  零 import 叶子 `serve-binding.ts`（前序任务已抽）。
- `serve-dashboard.ts` 1863 → 1480 行；保留 route handler（handleDashboard/handleDashboardCards）、
  snapshot store、其余 card（tests/sys/mgr/task/goal/fan-in/grid），并把 serve-live-cell 的公开
  renderer **原样再导出** ⇒ serve/index.ts barrel 与全部直接 importer（cli/lanes.ts、serve/feat、
  serve/serve-handlers.ts、serve/serve.ts、serve/feat/serve-tests.ts）零改动。
- 唯一 source-grep 重锚：`packages/quay/test/gap-dashboard-fanin-panel-and-timeline-bars.test.mjs`
  的 AC2/AC4 原 `readFileSync(SERVE_DASHBOARD_SRC)` 钉 `renderTimelineBarSvg` 定义/签名与 `windowEndMs`
  计数；定义与签名已搬到 serve-live-cell.ts，该两处改读 `SERVE_LIVE_CELL_SRC`，调用点计数（G=testsCard、
  H=fan-in card）仍读 serve-dashboard.ts（≥2 处）。

### 3. 包级 fanIn=515 是结构恒等，不是本轮要改的缺陷轴（诚实交代）

拆成同包 sibling 后实体仍在 `serve/view`、外部 import 仍指向同样的导出实体 ⇒ **fanIn/fanOut 不随拆分变**
（本轮实测 fanIn 515、fanOut 193，与 finding 的 516/193 一致）。这是前序任务已裁定的 leaf-package 结构
恒等：叶子包的职责就是被每个页面 handler / CLI import，高 fanIn 是「共享展示原语确实被共享」的证据；
`serve-fanout-556` 的 AC 判的是 fanOut<300（已满足 193<300），不是 fanIn。本任务的真实收益是**文件级**
god-file 消除（serve-dashboard.ts 不再是一个 1863 行厨房水槽）。

### 4. 验证（实跑，非断言）

| 判据 | 结果 |
|---|---|
| `npx tsc --noEmit -p packages/quay/tsconfig.json` | 全绿（exit 0） |
| `node --test packages/quay/test/directory-cycle.test.mjs` | 5/5 全绿（arm 1 零目录环） |
| 相关 dashboard 测试（fanin-panel-and-timeline-bars 18/18 + 其余 7 文件 50/50） | 全绿 |
| `node --experimental-strip-types plugin/scripts/import-graph-check.ts . --json` | valueSccs=[] typeSccs=[] reverseEdges=[] verdict ok |
| `node --experimental-strip-types plugin/scripts/archguard-runner.ts --root .` | PASS — no dependency cycles in any scope |

### 5. ADR-007 读数（本轮 worktree 实测，非引用）

- L_D import-graph-check: valueSccs=0 typeSccs=0 reverseEdges=0 files=557 edges=1720 valueEdges=1561 typeEdges=159
- L_G archguard-runner: entitySccCount=0 directoryCycleCount=0 scopes=6 entities=1147 relations=3618

### 6. 复发预期

文件级半边已修（serve-dashboard.ts 不再是 god-file；剩余 card 拆片是后续独立增量）。包级
`fanIn=516` 读数结构恒等，若 routine 仍以同一 subject 立案，由 rate 闸兜底——这与前序任务的一致结论相同，
不是「已注意到」：本轮落了一个真实、可核的文件级修复（新模块 + 重锚测试 + 上面两组暗轴读数）。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `god-package-serve-view-fanin-516`（routine `architecture-analysis`，runId `architecture-analysis-1793780643192`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `packages/quay/src/serve/view/serve-binding.ts`
- `packages/quay/src/serve/view/serve-dashboard.ts`
- `packages/quay/src/serve/view/serve-live-cell.ts`
- `packages/quay/test/gap-dashboard-fanin-panel-and-timeline-bars.test.mjs`
- `tasks/gap-routine-architecture-analysis-god-package-serve-view-fanin-516.md`