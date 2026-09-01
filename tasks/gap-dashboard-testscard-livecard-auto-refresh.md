---
id: gap-dashboard-testscard-livecard-auto-refresh
title: dashboard testsCard/liveCard 加轻量自动刷新（依据48h访问日志：/tests /live
  手动低频轮询，间隔1.4s~9h无自动刷新机制）
status: todo
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

**依据（实测读数）**：过去48h `.quay/quay-access.log` 访问日志里，`/tests`(152次)、`/live`(62次)
是访问量第二、第三高的路径，中位数请求间隔分别约 756 秒（12.6 分钟）与 1389 秒（23 分钟），但间隔跨度
从 1.4 秒到数小时（最大 33029 秒 ≈ 9.2 小时）都有——这是"挂着标签页、靠手动切回/刷新才能看到最新状态"
的模式，而不是自动更新。核实 `packages/quay/src/serve-live.ts`/`serve-tests.ts`/`serve-dashboard.ts`
三个文件均无 `setInterval`/`EventSource`/`<meta http-equiv="refresh">` 之类的自动刷新机制——每次看到
新状态都要用户主动重新发一次请求。

**现状**：dashboard 首页的 `liveCard`/`testsCard`（`serve-dashboard.ts` 的 `renderDashboardPage`）
和独立的 `/live`、`/tests` 整页，渲染出的都是"请求那一刻"的静态快照，页面渲染完成后不会再变。

**提议**：给 `liveCard`、`testsCard`（以及可选的独立 `/live`、`/tests` 页）加一个轻量、局部的自动刷新：
用一段内联 `<script>`，以 30-60 秒为周期对该卡片自己的数据端点做 `fetch`，只替换卡片内部 DOM（不整页
reload），失败时静默跳过本轮、下一轮重试。刷新周期建议对齐已有的 `TASK_SUMMARY_CACHE_TTL_MS`（30秒）
量级，避免比后端缓存刷新更快地空转请求。需要一个可关闭的开关（例如页面不可见时用
`document.visibilityState` 暂停轮询）以免后台标签页持续消耗资源。

## Acceptance Criteria

- [ ] `liveCard`、`testsCard` 渲染的 HTML 中包含一段自动刷新脚本（可 grep 生成的 HTML 断言其中含
      `setInterval` 或等效的定时 `fetch` 调用，且刷新目标限定在卡片自身的 DOM 节点，不触发整页
      `location.reload`）。
- [ ] 刷新周期可配置且默认落在 30-60 秒区间（写一个常量，测试里断言该常量的值域）。
- [ ] `document.visibilityState !== 'visible'` 时暂停轮询、恢复可见时继续（用一段单元测试或
      DOM 断言验证脚本里存在该判断逻辑，而不仅凭注释宣称）。
- [ ] 新增测试 `node --test packages/quay/test/gap-dashboard-testscard-livecard-auto-refresh.test.mjs`
      exit 0，覆盖：渲染出的自动刷新脚本存在、周期常量在预期范围、visibilitychange 判断存在。
- [ ] 既有 dashboard/live/tests 相关测试不因本改动回归：
      `node --test packages/quay/test/gap-dashboard-parallelize.test.mjs
      packages/quay/test/serve-live-implcomplete.test.mjs
      packages/quay/test/live-state.test.mjs` exit 0。
- [ ] `scripts/test.sh --for-task gap-dashboard-testscard-livecard-auto-refresh` scoped 静态检查通过，
      exit 0。

## Definition of Done

不是"脚本写进了 HTML 模板"就算完——DoD 要求：本机实际启动一次 `quay serve`，用浏览器（或
chrome-devtools/playwright MCP）打开 `/dashboard`，实测 Network 面板里能看到 liveCard/testsCard 的
数据端点在页面停留期间按周期自动发出请求（不是只有首次加载那一次），且切到后台标签页后请求停止、切回
后恢复——这是"确实在浏览器里跑起来"，不是"代码里加了 setInterval 就默认成立"。

## Touches

- packages/quay/src/serve-dashboard.ts
- packages/quay/src/serve-live.ts
- packages/quay/src/serve-tests.ts
- packages/quay/test/gap-dashboard-testscard-livecard-auto-refresh.test.mjs
- tasks/gap-dashboard-testscard-livecard-auto-refresh.md
