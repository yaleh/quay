---
id: gap-test-detail-load-timeseries
title: Test 详情 ②——suite 运行期系统负载时间序列采样（新增采样器）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：manager 需求分析投立案（人产品要求 Test 详情页看同期系统负载）。数据现状：`verification-round.jsonl` 的 `load` 字段是整轮跑完后**单点采样**（如 `"load":11.04`），**非时间序列**；全仓无任何机制在 suite 运行期间做周期性资源采样落盘（`resource-gate.sh`/`process-budget.sh` 都是被动查询式瞬时快照）。

**成本（四项里最贵，⛔ 不是「加字段」）**：需新增一个采样器——suite 运行期间每 N 秒（5-10s）采 `loadavg`/`cpu_stall`/`mem_avail`，写进与 runId 关联的时间序列文件（`.quay/suite-load-<runId>.jsonl`），供页面拉取画图。

**⛔ 关键约束（manager 钉死，同 AC134-AC2 教训）**：**只在 suite 运行期间采样，不常驻空跑**——避免又是一个高频空转载体（outcome.jsonl 那种）。

## Plan

1. 新增采样器：suite 运行期间每 N 秒采 loadavg/cpu_stall/mem_avail → `.quay/suite-load-<runId>.jsonl`，suite 结束即停（⛔ 不常驻）。
2. Test 详情页拉该时间序列，服务端渲染负载曲线 SVG。

## Acceptance Criteria

- [x] AC1：suite 运行期间有 `.quay/suite-load-<runId>.jsonl` 时间序列（读生产载体⛔非 fixture），suite 结束即停采样（⛔ 常驻空跑 ⇒ 假）。
- [x] AC2：详情页渲染负载曲线（服务端 SVG，⛔ 客户端图表库 ⇒ 假）。

## Definition of Done

- [x] 采样器（suite 期采样、结束即停）+ 负载曲线渲染落地；AC1-2 全勾；land 到 develop。

## Retires

- 无（新增采样机制）

## Touches

- plugin/scripts/suite-load-sampler.ts (new)（suite 运行期采样，结束即停）
- plugin/scripts/full-suite-runner.ts（触发采样 start/stop）
- plugin/scripts/capability-catalog.sh（新增 suite-load-sampler.ts 的 QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING 声明——AC1c 入口闸：shipped 脚本必须声明问题）
- packages/quay/src/serve-handlers.ts（负载曲线 SVG 渲染）
- plugin/test/full-suite-runner.test.mjs（采样触发测试）
- packages/quay/test/serve-handlers.test.mjs（曲线渲染测试）
- .gitignore（采样器运行时输出 suite-load-*.jsonl/.pid 的 ignore 条目）
- tasks/gap-test-detail-load-timeseries.md（自身）
- docs/proposals/quay-product-outline.md（DELIVERY-INVENTORY snapshot 281→282，新增 suite-load-sampler.ts 计入交付面清单）
