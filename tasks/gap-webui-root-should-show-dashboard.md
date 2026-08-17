---
id: gap-webui-root-should-show-dashboard
title: WebUI `/` 应显示 dashboard，实际显示 task 列表（AC95 落地时 `/` 原样保留 tasks 路由，未接到新 dashboard）
status: done
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

- [x] AC1: `GET /` 显示 dashboard（或 3xx 重定向到 `/dashboard`），不再显示 task 列表。
- [x] AC2: task 列表仍可从导航到达（`/tasks` 或等价路由），既有测试 pin 集同步。
- [x] AC3: 测试全绿 + `--for-task` scoped 门绿。

## Definition of Done

- [x] `/` 落到 dashboard，task-list 经导航可达，路由测试覆盖两路径，scoped + 全量绿。

## Evidence（实现记录）

- **路由**：`serve-handlers.ts` 的 `handleAllRoutes` 中 `url.pathname === "/"` 改为 302 → `/dashboard`；task-list 挪到新 `/tasks` 路由。
- **导航**：`SITE_NAV_ROUTES.tasks` `/`→`/tasks`；`buildHref` 产 `/tasks?...`；各详情页「← tasks」回链、dashboard「查看任务列表 →」、task-detail 默认 backHref 全部改 `/tasks`。
- **测试**：新增 `packages/quay/test/gap-webui-root-should-show-dashboard.test.mjs`（AC1/AC2/AC3 四断言：`/` 302+Location、`/tasks` 200 列表、`/dashboard` 200+nav 链 /tasks、detail backHref /tasks）；迁移 16 个既有测试文件里 `GET /`→`GET /tasks` 的列表断言与 `href="/"`→`href="/tasks` 回链断言（serve.test / web-ui-browser / cli.test / serve-ac102 / serve-ac95 / serve-adr / serve-adversarial-eval / serve-ac96 / serve-browser-render / core-three-way-symmetry / serve-goal-doc / provider-env-symmetry / serve-github / serve-list-realtime / unparseable-frontmatter / build-dist-smoke）。
- **验证**：`bash scripts/test.sh --for-task gap-webui-root-should-show-dashboard --allow-thin` → 89/89 绿；全量 `scripts/test.sh` → `SUITE_EXIT=0`（4351 tests / 4238 pass / 0 fail / 113 skip）。

## Touches

- packages/quay/src/serve-handlers.ts（`/` 路由改接 dashboard；⚠️ 与 in-flight ac98 共用此文件——ac98 持有 Touches 锁，须排队/判不相交）
- packages/quay/test/（路由测试）
- tasks/gap-webui-root-should-show-dashboard.md（自身）
