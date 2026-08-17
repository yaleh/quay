---
id: gap-webui-root-should-show-dashboard
title: WebUI `/` 应显示 dashboard，实际显示 task 列表（AC95 落地时 `/` 原样保留 tasks 路由，未接到新 dashboard）
status: ready
labels:
  - gap
  - webui
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**人类指出（2026-08-17，manager 已用真实 HTTP 实测核实）**：`/` 应显示 dashboard，实际显示 task 列表。

**设计正本** `docs/design/quay-webui-improved-2026-08-16/Quay改进版WebUI.dc.html:1049`：`state = {..., page: 'dashboard', ...}`（默认落地页）；`:1067-1068` navGroupDefs「核心」组顺序 `[dashboard, tasks]`，dashboard 在前。

**实现** `packages/quay/src/serve-handlers.ts:2363-2366`：`url.pathname === "/"` → `handleTaskList`；`/dashboard` 是独立路由（:2370-2373）。AC95 落地时把 `/` 原样当成既有 tasks 路由保留，加 6 个新页面时没有把 `/` 改接到 dashboard。

**实测（活服务器 100.78.206.100:4173，manager 已验证）**：`curl .../` 200、`curl .../dashboard` 200，内容不同，`/` 未重定向。

**能取假（⊢ 对照）**：`curl <host>/` 的响应体包含 dashboard 特征（如「任务」页标或 dashboard 专属区块），而非 task-list 特征；或 `curl -I /` 重定向到 `/dashboard`。

## Plan

1. 读设计正本 `Quay改进版WebUI.dc.html`（:1049 dashboard 默认页 / :1067 navGroupDefs）。
2. 改 `serve-handlers.ts` 路由：`url.pathname === "/"` → dashboard（或重定向到 `/dashboard`），task-list 挪到 `/tasks`（若既有路由依赖 `/` 则先核消费者）。
3. 核既有 `/` 消费者（`/tasks` 页、测试 pin 集、AC95 的 route 测试）迁移。
4. scoped 门（`--for-task`）+ 全量验证，fan-in。

## Acceptance Criteria

- [ ] AC1: `GET /` 显示 dashboard（或 3xx 重定向到 `/dashboard`），不再显示 task 列表。
- [ ] AC2: task 列表仍可从导航到达（`/tasks` 或等价路由），既有测试 pin 集同步。
- [ ] AC3: 测试全绿 + `--for-task` scoped 门绿。

## Definition of Done

- [ ] `/` 落到 dashboard，task-list 经导航可达，路由测试覆盖两路径，scoped + 全量绿。

## Touches

- packages/quay/src/serve-handlers.ts（`/` 路由改接 dashboard；⚠️ 与 in-flight ac98 共用此文件——ac98 持有 Touches 锁，须排队/判不相交）
- packages/quay/test/（路由测试）
- tasks/gap-webui-root-should-show-dashboard.md（自身）
