---
id: gap-sessions-page-slow-unclickable-flat-render
title: sessions 页三缺陷：列表每卡同步读 200KB tail（慢）+ 卡片裸 div 无链接（不可点）+ 详情页 2MB 全量平铺——阶段一三改
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

sessions 列表/详情页三缺陷（人 MCP 浏览器 + manager 读代码双核实，我逐条读码复核，非猜测）：

1. **列表打开慢**：`readSessions()`（`observation.ts:2732`）对每张卡片同步读 200KB transcript tail（`SESSIONS_TRANSCRIPT_TAIL_BYTES = 200_000`，:2588/:2600）——LIVE 全量 + GONE 最多 `SESSIONS_ENDED_MAX = 20`（:2699），最多 ~27 次同步文件 I/O ≈ 5.4MB，是「打开数秒」根因。
2. **卡片不可点**：`cardFor()`（`serve-sessions.ts:12-27`）返回裸 `<div>`（名字是 `<b>`、无 `<a href>`）——而 `/session/<id>` 详情页本身已存在且做得不差（结构化分块 + 已有消息投递表单），只是列表页没链过去。
3. **详情页全量平铺**：`renderSessionPage` 把 tail 从旧到新平铺渲染，`SESSION_VIEW_TRANSCRIPT_TAIL_BYTES = 2_000_000`（`observation.ts:2792`）无分页。

## Plan

阶段一三改（人定稿）：
1. `cardFor` 卡片用 `<a href="/session/<id>">` 包裹——最小改动，立即解决点击。
2. 列表页默认只渲染 LIVE；GONE 收进 `<details>`（默认折叠，点开才读取/显示）——不改数据抓取逻辑，先解决首屏可读性。
3. 详情页「全量平铺」改「默认只渲染最近 N 条 + 滚动动态加载更早内容（非「加载更早」分页链接）」，服务端按需重新截取 tail。

**⛔ 第 3 条设计张力（实现前必须摊开写清楚，⛔ 不得悄悄选一个，人已点名）**：人同时要求「滚动动态加载」和「不引入客户端 JS/WebSocket」——但纯 HTML 做不到滚动触发加载（至少需 IntersectionObserver/scroll listener 最小 JS），与现有约定（`serve-sessions.ts` 注释「Zero client JS: collapse via native `<details>`」）冲突。两个方向均可，落笔方在 Plan 里明确选一个 + 写理由：
- (a) 为此处破例引入最小滚动监听 JS（明确写打破 zero-JS 约定的理由）；
- (b) 退让为「滚动接近底部时用 `<details>`/锚点等原生机制触发」（需人确认是否满足「滚动动态加载」本意）。

## Acceptance Criteria

- [ ] AC1（能取假，卡片可点）：列表页卡片 `<a href="/session/<id>">` 包裹，点击导航到 `/session/<id>` 详情页；（⛔ 仍裸 `<div>` 不可点 ⇒ 假）。
- [ ] AC2（能取假，LIVE-only + GONE 折叠）：列表页默认只渲染 LIVE；GONE 收进 `<details>` 默认折叠（点开才读取/显示），首屏不再同步读全部 GONE 的 200KB tail；（⛔ 仍全量渲染 GONE ⇒ 假）。
- [ ] AC3（能取假，详情页最近 N + 按需加载）：详情页默认只渲染最近 N 条 turn，更早内容按需加载（滚动或原生机制），不再 2MB 全量平铺；（⛔ 仍全量平铺 ⇒ 假）。

## Definition of Done

三改落地；AC1-AC3 全勾；第 3 条的滚动加载 vs zero-JS 张力在 Plan 摊开并写明所选方向 + 理由（非悄悄选）。

## Touches

- packages/quay/src/serve-sessions.ts（cardFor 加 `<a>`、LIVE/GONE 分组 `<details>`、renderSessionPage 最近 N + 按需加载）
- packages/quay/src/observation.ts（readSessions / readTranscript 按需重新截取 tail，如需）
- packages/quay/test/ 或 plugin/test/（卡片链接 / GONE 折叠 / 详情按需加载 测试）
- tasks/gap-sessions-page-slow-unclickable-flat-render.md（自身）
