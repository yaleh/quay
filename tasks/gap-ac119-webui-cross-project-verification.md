---
id: gap-ac119-webui-cross-project-verification
title: "AC119 Web UI 跨项目验证：近期 5 项 webui 改进在第三方项目真实数据上逐条核对"
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：人 2026-08-20 14:0xZ 逐字：「最近 web ui 有重大改进。本阶段 AC 和任务也应包括对其它项目中 quay web ui 使用的验证。」

**背景**：上阶段"Web UI 改进版落地"已达成的 5 项具体改进，此前只在 quay 自己的任务板/tick-log 数据上验证过——quay 自己的数据形状（字段是否齐全、任务数量级、label 分布）可能恰好绕开某些边界情况（同 AC92 教训："验证的是端口活着，不是真实使用"）。

**待验证的 5 项改进**：
- `/sessions` 按 Manager/Outer/Inner 分层渲染（`gap-webui-sessions-no-layer-labels`）
- `/journal` 读 tick-log 改用 `readRecentSections`（`gap-webui-journal-reads-stale-data`）
- `/board` 服务端分页 + status/label 筛选（`gap-webui-board-no-pagination`）
- `/board` 冷加载 120s→个位数秒（`gap-webui-board-load-120s`）
- 统一 `renderSiteNav`/`renderMobileChrome` 导航（`gap-webui-nav-inconsistent-routes`）

**判据**（完整原文在 orchestration/manager-phase-goal.md AC119，本任务体不复制）：在 AC118 所用第三方项目（或另一个独立第三方项目）上 `quay serve` 指向该项目配置，通过真实 HTTP 请求（**不是 `curl` 200 探活**，需实际取回页面内容并断言关键元素存在）逐条验证 5 项。**若发现新缺陷**：按缺陷处置（归 outer 立案），⛔ 不得为了勾 AC 回避/隐藏该缺陷。

**⛔ 前置依赖**：需要 AC118（或并行另一独立第三方项目）已就位 + 当前版本产物可 serve。AC104→AC105→AC107 完成前无法执行。

## Plan

1. **前置确认**：AC118 的目标项目（或另一独立第三方项目）+ 当前版本产物可用。
2. **`quay serve` 指向该项目配置**：在目标主机（B/C）上启动 serve 指向该项目的 `.quay/config.yml`。
3. **逐条真实 HTTP 验证 5 项**（非探活，断言关键元素）：
   - `/sessions`：分层渲染正确无跨层混排；无 manager 层则优雅降级不报错
   - `/journal`：正确读取该项目自己的 tick-log/等价记录；无该文件则 fail-closed 报 empty 不崩溃
   - `/board`：分页 + status/label 筛选在该项目真实数据上工作正确
   - 导航栏在该项目所有路由上一致渲染
4. **缺陷处置**：任一出现渲染错误/崩溃/串号 ⇒ 按缺陷立案，不回避。
5. **写记录**：`.quay/productization-verification.jsonl`，`ac="AC119"`，含目标项目名 + 逐条验证结果。

## Acceptance Criteria

- [ ] AC1: 在第三方项目上 `quay serve` 指向该项目 `.quay/config.yml`，真实 HTTP 请求（非 curl 探活）取回页面内容并断言关键元素。
- [ ] AC2: `/sessions` 分层渲染正确（多层数据无跨层混排；无 manager 层则优雅降级）。
- [ ] AC3: `/journal` 正确读取该项目自己的数据（无文件则 fail-closed 报 empty，不崩溃不串号）。
- [ ] AC4: `/board` 分页 + status/label 筛选在该项目真实数据上工作正确。
- [ ] AC5: 导航栏在所有路由一致渲染；任一渲染错误/崩溃/串号按缺陷立案（⛔ 不回避）。
- [ ] AC6: 记录写入 `.quay/productization-verification.jsonl`（`ac="AC119"`，含项目名 + 逐条结果）。

## Definition of Done

- [ ] 判据全满足；`.quay/productization-verification.jsonl` 有 `ac="AC119"` 记录；发现的新缺陷已立案非回避。

## Touches

- .quay/productization-verification.jsonl（记录）
- 目标第三方项目（AC118 项目或另一独立项目）的 web ui 数据面
- tasks/gap-ac119-webui-cross-project-verification.md（自身）
