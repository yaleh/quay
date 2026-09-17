---
id: gap-webui-dashboard-cards-poll-cost-eval
title: /dashboard/cards 30s 轮询占近 7 天总请求量 78%——评估改推送/条件请求是否值得，而非默认继续加频率
status: ready
labels:
  - gap
  - webui
parent: null
children: []
extra:
  schema: finding
---
**type:** finding

## Finding

**实测（2026-09-17，`.quay/quay-access.log` 近 7 天 8324 条请求）**：`/dashboard/cards?hours=N` 单一端点 6471 次，占总请求量 78%；轮询间隔众数 30s（200 个样本里 98 个落在 30s，其余在 29–32s 区间抖动，符合浏览器 `setInterval(30000)` 的典型抖动）。同期 `/health` 探活 1172 次（14%），真正对应"有人手动点了一下"的导航请求只有约 679 次（8%）。

**⚠️ 先排除了"这是性能急症"的误判**：对生产实例 `100.78.206.100:4173` 直接 `curl` 三次 `/dashboard/cards?hours=3`，单次耗时 22–27ms、响应体 22502 字节——**这个端点本身很便宜**，不是 `gap-webui-dashboard-regressed-to-12-60s-past-two-done-tasks`（已 done，那条修的是 `/dashboard` 整页渲染 12.8–60.5s 的问题）的同类回归。当前**没有**证据表明这个端点在拖慢服务器或造成用户可感知的延迟。

**真正的问题是比例，不是急症**：一个开着的 Dashboard 标签页，仅靠自动刷新就以 30s 一次的频率产生请求，7 天里一个标签页贡献的量级是 78% 的总流量；每多开一个标签页/多一个人常驻观察，这个比例线性增长。22.5KB × 每 30s，单个常驻查看者一周下来是 ~145MB 的重复传输，其中大部分时刻内容很可能没变化（circular pulse 状态、driver 状态等在两次刷新之间经常不变）。这是否值得优化，取决于实际会有多少并发常驻查看者——**本任务是先把这个比例摆出来交给实现者判断，不是预设了"必须换成 SSE/WebSocket"的结论**。`/live` 页面看起来已经用了不同的更新模式，可以参考其实现决定是否复用。

## AC

- [ ] 给出一个明确的技术决策记录（可以是"维持现状，理由是 XXX"，也可以是"改为 ETag/304 条件请求"或"改为 SSE/WebSocket 推送"），并在决策里引用本任务列出的两个实测数字（78% 占比、22-27ms 单次耗时）作为依据，不是凭空判断
- [ ] 若决策是优化：`node --experimental-strip-types --test packages/quay/test/gap-webui-dashboard-cards-poll-cost-eval.test.mjs` 覆盖新行为（如 ETag 命中时返回 304 且不重复渲染 body，或 SSE 推送的等价断言）
- [ ] 若决策是维持现状：任务体记录清楚"为什么现状已经足够"，并把这条 finding 转成一条可复用的基线读数（供以后并发查看者数量变化时重新评估），不需要新增代码改动，但仍需 `scripts/test.sh` 全绿收尾（无代码改动时确认这一条不会引入回归）
- [ ] `scripts/test.sh` 全绿

## DoD

无论最终决策是"改"还是"不改"，都要留下可追溯的依据（本任务体 + 如有实现则加代码注释指向本任务 id），不是一个只有代码、没有决策记录的静默改动；如果实现了 ETag/推送，需要在真实运行的 `quay serve` 实例上用浏览器 Network 面板复核确实减少了重复传输（截图或等价证据），不是只在单测 fixture 里断言。

## Touches

- packages/quay/src/serve-dashboard.ts
- packages/quay/test/gap-webui-dashboard-cards-poll-cost-eval.test.mjs
- tasks/gap-webui-dashboard-cards-poll-cost-eval.md
