---
id: gap-routine-architecture-analysis-god-package-serve-fanout-556
title: "architecture-analysis: archguard god-packages (scope 075f2c0c @ HEAD
  01bdc8d54): serve/ has fanOut=556, fanIn=12, 25 files, 285 entities, 15687
  lines — highest fanOut in the repo a"
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
archguard god-packages (scope 075f2c0c @ HEAD 01bdc8d54): serve/ has fanOut=556, fanIn=12, 25 files, 285 entities, 15687 lines — highest fanOut in the repo and 2.2x the next package; recurrence of the 2026-10-23 finding that was never filed.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1792940968187` · ts `2026-10-25T15:09:28.187Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`handleAllRoutes`、`startDashboardSnapshotRefresh`、`resolveServeBinding`
- 涉及文件：
- `packages/quay/src/serve/serve-i18n.ts:1`
- `packages/quay/src/serve/serve-dashboard.ts:1`
- `packages/quay/src/serve/serve-render.ts:1`
- kind：`god-package`
- verdict：`confirmed`

## Requested action
Split serve/ into serve/view (i18n 2780 + dashboard 1859 + render 1303) and serve/io (git/tests/task/goal/sessions), leaving serve.ts as the router; AC on serve/ fanOut < 300.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-25T15:09:28.187Z

## 处置（2026-10-26）：修掉，不是记录

**结论：真的拆开了。** 不是「已注意到」，也没有「已有机制在管」可写 —— `plugin/scripts/archguard-runner.ts`
头注释明确把 god-package 阈值列为「留待数据积累」，即当前**没有**任何机制在管这个维度。

**为什么复发**：2026-10-22 的 e7e84366a 把 24 个 serve* 文件从 `src/` 平铺移入 `src/serve/`，archguard 的
package 粒度是**目录**，于是 `quay/src/serve` 本身成了那个 god package（fanOut=556）。那是「搬家」不是「拆分」。
2026-10-23 的同一条 finding 被 rate 闸（3/窗口）拒收 → 从未立案 → 2026-10-25 以本任务复发。

**本轮做法**：`serve.ts` 保留为 router（setup + server lifecycle）、`serve-handlers.ts` 仍是路由分发器；
其余 19 个模块按内聚性拆进 5 个子包：

- `serve/view/`：i18n、lang、render、dashboard、binding（展示层）
- `serve/pages/`：board、live、needs-human、system（页面 handler）
- `serve/io/`：git、sessions、send、snapshot-store（I/O 与传输）
- `serve/feat/`：task、tests、goal（功能页 handler）
- `serve/docs/`：adr、architecture、doc（文档面）

**纯搬迁**：任何模块的导出、行为、关系图都没有变 —— 只有目录变了，以及因此必须重算的相对说明符
（逐条 re-resolve，不是字符串替换）。唯一模块相对文件读 `webui-modernist.css` 随之加了一层 `..`；
测试/检查器里的递归 source scan 与 repo 相对路径常量一并跟着搬。

### 读数（archguard 0.1.42，scope "packages"，1125 entities / 3433 relations，拆分前后各跑一次 analyze）
- L_G archguard: serve_fanOut=112 (before=556) serve_fanIn=19 serve_files=6 subpackages=5 all_subpackages_lt_300=true
- `quay/src/serve/view` fanOut=225 · `io`=281 · `pages`=227 · `feat`=294 · `docs`=96
- 全仓最高 fanOut 现为 `quay/src`=407（拆分前 `quay/src/serve`=556 居首）

判据**能取假**：同一 scope、同一算法、同一台机；拆分前实测 556，拆分后实测 112，五个子包各自 < 300。
（`archguard` 缺失/analyze 失败时该读数为 not-evaluated，不会被当成 0 —— 本任务两次 analyze 都 exit 0。）

### 判据实跑
- `npx tsc --noEmit` → exit 0
- 受影响的 119 个测试文件（`packages/quay/test/serve-*`、`gap-*`、`plugin/test/*`）逐个跑过并全绿；
  两个环境性失败（`server-status-web-control-same-pid` 的 dist-bundle 断言、`quay-init-characterization`
  的 `.quay/config.yml` 哈希）在**未改动的 develop 基线 worktree 上同样失败**，不是本改动引入。
- scoped 门：`bash scripts/test.sh --for-task gap-routine-architecture-analysis-god-package-serve-fanout-556 --allow-thin`

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `god-package-serve-fanout-556`（routine `architecture-analysis`，runId `architecture-analysis-1792940968187`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `packages/quay/src/serve/**`
- `packages/quay/src/cli/goal.ts`
- `packages/quay/src/cli/help.ts`
- `packages/quay/src/cli/lanes.ts`
- `packages/quay/scripts/build-plugin-dist.mjs`
- `packages/quay/test/*.mjs`
- `plugin/scripts/checker-mutation-cases/serve-binding-literal-check.sh`
- `plugin/scripts/config-wiring-check.ts`
- `plugin/scripts/enum-surface-parity-check.ts`
- `plugin/scripts/runner-static-gate.ts`
- `plugin/scripts/send-to-session.ts`
- `plugin/scripts/serve-binding-literal-check.ts`
- `plugin/test/arch-discovery-space.test.mjs`
- `plugin/test/config-key-consumer-check.test.mjs`
- `plugin/test/delivery-status-single-source.test.mjs`
- `plugin/test/kernel-sibling-resolution-check.test.mjs`
- `plugin/test/serve-binding-literal-check.test.mjs`
- `plugin/test/session-primitives-adoption.test.mjs`
- `plugin/test/suite-bucket-attribution.test.mjs`
- `plugin/test/worker-driver-fan-in-s03.test.mjs`
- `plugin/test/worker-driver-fan-in-s04.test.mjs`
- `plugin/test/worker-driver-retry-classification.test.mjs`
- `plugin/test/worker-driver.test.mjs`
- `docs/analysis/discovery-portfolio.mjs`
- `tasks/gap-routine-architecture-analysis-god-package-serve-fanout-556.md`