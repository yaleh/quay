---
id: gap-ac136-web-truth-source-follows-driver
title: AC136 web 观测面随真相源切换
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac134-promotion-outcome-ledger
---

**type:** execution

## Proposal

**来源**：manager 投立案（判据正本在 `orchestration/manager-phase-goal.md` `### AC136`，⛔ 不在此复制，读那一段）。

**形态**：晋升面机械化后，web 展示的任务台账 / pool 指标必须读驱动的 outcome 载体、或与之口径一致（⛔ 页面不得读一个已不是真相源的量）。

**为什么必须单列（硬规则 5b 自用）**：manager 已为 AC129 在复扫检查点写了 web 载体切换条款，却没在本阶段写同样的——「在某处修好 X ≠ X 只在那一处」。

**核查点（实读现状，逐个核）**：
- `packages/quay/src/observation.ts:1227` `readPoolMetrics()` 冷调 `slot-refill.ts` 取 pool/floor/deficit/cap——驱动接管晋升后，该量真相源变为驱动自己的判定记录；
- `serve-handlers.ts:2477`（状态计数）/ `:2489`（最近更新非-done）任务台账卡片，与 `/tasks` 页；
- 今日立案的 web 任务（`gap-webui-dashboard-load-time-optimization` 等）均基于旧真相源撰写，其字段假设是否仍成立须一并核。

## Plan

1. `observation.ts` 的 pool 指标读驱动 outcome 载体（或与驱动口径一致）。
2. `serve-handlers.ts` 任务台账 / `/tasks` 页随真相源切换。
3. 取假验证：构造一次由驱动完成的晋升 ⇒ web 应在刷新周期内反映；仍只反映 outer 旧路径 ⇒ 假。

## Acceptance Criteria

- [x] AC1：晋升面机械化后，web 展示的任务台账 / pool 指标读驱动 outcome 载体、或与之口径一致（核查点逐个核）。
- [x] AC2（能取假）：构造一次由驱动完成的晋升（todo→ready）⇒ web 对应视图在其刷新周期内反映；若仍只反映 outer 旧路径 ⇒ 本条为假。

## Definition of Done

- [x] web 观测面随真相源切换落地；AC1-2 全勾（含驱动晋升反映取假）；land 到 develop。

## Retires

- 无（观测面切换，非退役机件）

## Touches

- packages/quay/src/observation.ts（readPoolMetrics 真相源切换：读 .quay/promotion-round.jsonl；pool 类型加 lastPromoted；缓存改名 poolMetricsCache）
- packages/quay/src/serve-handlers.ts（/manager 页 pool 真相源标注 + lastPromoted 渲染；台账口径一致注释）
- packages/quay/test/gap-ac136-web-truth-source.test.mjs（新增：AC1 解析/负控制 + AC2 驱动晋升反映取假）
- packages/quay/test/gap-dashboard-parallelize.test.mjs（旧 slot-refill 缓存测试改为 promotion-round 缓存测试）
- tasks/gap-ac136-web-truth-source-follows-driver.md（自身）
