---
id: gap-dashboard-fanin-panel-and-timeline-bars
title: Dashboard 四项改进：testsCard 补 startedAt/bucket + 测试与新增 fan-in panel
  的过去N小时分段时间轴 + 循环脉搏在飞列表加任务 title
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

背景：`gap-dashboard-visual-review-batch-fixes`（已 done、已落 develop）落地后，人继续在 dashboard 上走查，
提出四项后续改进（F/G/H/I 编号沿用讨论时的编号，避免下游重新对齐）。逐条列出发现 + 证据：

- **F｜testsCard 近期列表缺 startedAt / bucket**：`TestRunRecord`（`observation.ts`）本就带 `startedAt`
  和 `buckets`（`P|M|P+M|full`）字段——完整版 `/tests` 页面的历史表格（`serve-tests.ts:619`）已经在显示
  这两列，只是 `renderTestsCard`（`serve-dashboard.ts`）新加的"近 N 轮"精简列表没有带上，纯粹是漏透出，
  不是缺数据。
- **G｜测试过去 N 小时（默认 3，可配置）分段着色时间轴**：仓库里已有两处同类技术路线的先例——
  `serve-tests.ts:433-515` 的 per-file timeline gantt（服务端字符串拼 SVG、零客户端 JS、颜色走
  `.gantt-bucket-*`/`.gantt-svg-bar-fail` CSS token）和同文件的 load-curve SVG。本项是同一手法的变体：
  横轴从"该轮内相对耗时"换成"过去 N 小时的绝对墙钟时间"，每个 `TestRunRecord` 的
  `[startedAt, startedAt+durationMs]` 是一段，颜色复用 `renderTestsCard` 自己现有的 state 配色三元式
  （`state==="green"→--color-positive-700`／`"red"→--color-accent-800`／其它→--color-neutral-400`，
  这是 dashboard 卡片自己已经在用的配色，比 serve-tests.ts 那套更老的 `.gantt-svg-bar` accent 配色更
  贴合本次场景——不重新发明配色）。`readTests` 返回的是全量历史（不是只有卡片截的那 5 条），3 小时窗口
  内按当前跑测频率（观测到约 5 轮/20 分钟）估计有 20-40 段，量级合适。
- **H｜新增 Fan-in panel（列表 + 同款分段 bar）**：`WorkerOutcomeRecord.mechanical_fan_in`
  （`observation.ts`）已经带 `outcome`（landed/red）、`lockAcquireEpoch`/`lockReleaseEpoch`（fan-in
  锁持有区间，即耗时）、`suiteOutcome`、`fanInLog`；`/task/<id>` 页面已有
  `renderFanInCell(taskId, r)`（`serve-task.ts:508`，已 export）把这些字段渲成一整行（含
  `/fan-in-log/<task>/<file>` 的 view/download 链接），目前只按单任务过滤
  （`readWorkerOutcomeRecords(root).filter(r=>r.task===taskId)`），从未跨任务聚合过。新 panel = 去掉
  taskId 过滤、按 `lockAcquireEpoch` 倒序取最近 N 条、直接复用 `renderFanInCell` 渲染每一行（不重新
  实现一遍字段拼接），再配一条同款分段 bar（区间 `[lockAcquireEpoch, lockReleaseEpoch]`，颜色按
  `outcome` landed/red，配色同 G）。
- **I｜循环脉搏在飞列表加任务 title**：`renderLiveCard`（`live.inFlight`，有 taskId）与 taskCard
  （`d.tasks`，有 id+title，`readTaskSummary` 30s 缓存）在同一次 `/dashboard` 请求里本来就各自读过，
  只是从未互相 join。`/dashboard/cards` 轮询端点（`handleDashboardCards`）目前不读 `tasks`，要让 30s
  自动刷新时 title 也保持更新，该端点需要也调一次 `readTaskSummary`（命中缓存，非新开销）。

**与上次 sysCard 折线的关键区别**：sysCard 因为没有历史落盘，退而求其次用前端内存攒点、刷新页面清零；
本次 G/H 两条 bar 的数据源（`verification-round.jsonl`/`worker-outcome.jsonl`）本来就是持久化的真实
历史，因此做成和现有 gantt/load-curve 一样的**服务端渲染 SVG**（零客户端 JS、刷新页面历史不丢）——
不复用 sysCard 那套客户端攒数组的手法。

## Plan

1. **F**：`renderTestsCard` 的 recent-runs 列表（已有的纵向多要素行）每行追加 `startedAt`（复用
   `serve-render.ts` 已导出的 `relativeTime()`，与本文件其余时间戳风格一致，不新增/不导出
   `serve-tests.ts` 里私有的 `shortUtcTime`）与 `buckets`（无值时不渲染该子项，不是显示"—"，因为
   legacy 行本就没有这个字段——absent-field 契约）。
2. **共用时间轴渲染函数**：在 `serve-dashboard.ts` 内新增一个私有函数（如
   `renderTimelineBarSvg(segments: {startMs, endMs, colorVar}[], windowHours: number, nowMs: number)`
   → SVG 字符串），G 和 H 两条 bar 共用同一份横轴换算逻辑，不写两遍。只在本文件内使用，不导出到
   `serve-render.ts`/`serve-tests.ts`（当前只有这两个消费者，YAGNI）。窗口外或时间戳不可解析的输入
   跳过（不外推、不假定位置）。
3. **G**：`renderTestsCard` 在近期列表下方加一段用 `renderTimelineBarSvg` 画的 bar，输入取
   `tests.runs` 里 `startedAt`/`durationMs` 均可解析、且落在 `[now-hours*3600000, now]` 窗口内的记录，
   颜色按 `state` 用 Proposal 里提到的既有三元式。
4. **H**：新增 `renderFanInCard(root, hours, nowMs)`：`readWorkerOutcomeRecords(root)` 不按 task 过滤，
   保留 `mechanical_fan_in != null` 的记录，按 `lockAcquireEpoch`（缺失退化用 `Date.parse(r.ts)`）倒序
   取最近 5 条，每条用 `import { renderFanInCell } from "./serve-task.ts"` 直接复用渲染（附
   `r.task` 到 `/task/<id>` 的链接）；下方加一段 `renderTimelineBarSvg`，区间取
   `[lockAcquireEpoch, lockReleaseEpoch]` 落在窗口内的记录，颜色按 `outcome` landed/red。新卡片加入
   "工作进展" 那一行网格（`repeat(auto-fit,minmax(240px,1fr))` 会自动重排，不需要改网格结构），容器
   `id="fanin-card"`。
5. **I**：`renderLiveCard` 新增可选参数（taskId→title 的 Map 或 `tasks` 数组），`liveMiniList` 每行在
   现有 taskId 基础上追加 title 一行，排版复用 taskCard miniList 已有的"id + 正文色 title"纵向手法。
   `handleDashboard`（整页）与 `handleDashboardCards`（轮询端点）都在调用 `renderLiveCard` 前先拿到
   `readTaskSummary(root, client)` 的结果传进去——`handleDashboardCards` 目前没有 `client` 参数，需要
   补上（沿用 `handleDashboard` 已有的取 client 方式）。
6. **可配置窗口（G/H 共用）**：`/dashboard` 与 `/dashboard/cards` 都从请求 URL 读 `?hours=` 查询参数，
   缺省 3，钳制到 `[1, 24]`（非法/超界值回退默认，不报错）。轮询脚本
   （`renderDashboardCardRefreshScript`）从 `location.search` 里读当前 `hours` 值，原样拼进它自己发
   给 `/dashboard/cards` 的 fetch URL，保证 30s 自动刷新后 bar 的窗口不跳变。页面上加几个窗口预设链接
   （如 1h/3h/6h/12h，`<a href="/dashboard?hours=N">`，页面整刷，不需要新客户端逻辑）。

## Acceptance Criteria

- [x] AC1（F）：`renderTestsCard` 对一条带 `startedAt`/`buckets` 的固定 `recentRuns` 输入，渲染 HTML
      同时包含一个由 `relativeTime` 产出的时间字符串与该 `buckets` 原始值；对一条两字段皆为
      `null`/`undefined` 的输入，渲染 HTML 不包含这两个子项对应的固定占位文案（absent-field 契约，
      不是显示"—"）。
- [x] AC2（共用渲染函数）：`grep -n "function renderTimelineBarSvg" packages/quay/src/serve-dashboard.ts`
      命中恰好 1 处定义，且 `grep -c "renderTimelineBarSvg(" packages/quay/src/serve-dashboard.ts`
      ≥3（1 处定义 + G、H 两处调用）。
- [x] AC3（G）：对固定 `nowMs` 与一组落在/不落在 3 小时窗口内的 `TestRunRecord` 混合输入，
      `renderTestsCard` 输出的 SVG 里可数的分段元素（`<rect`）个数等于落在窗口内、且
      `startedAt`/`durationMs` 均可解析的记录数——单测断言这个计数，而不是断言"SVG 存在"。
- [x] AC4（H 列表）：新函数对跨任务的固定 `WorkerOutcomeRecord[]` 输入（含 ≥2 个不同 `task`、
      `mechanical_fan_in` 均非空），渲染 HTML 按 `lockAcquireEpoch` 降序排列，且每行文本包含各自的
      `outcome`/`task` id——单测断言顺序与内容，同时断言对 `mechanical_fan_in == null` 的记录被过滤
      掉（不出现在渲染结果里）。
- [x] AC5（H bar + 挂载）：`renderDashboardPage` 输出的 HTML 里 `grep` 能命中 `id="fanin-card"`；对
      落在窗口内的 `mechanical_fan_in` 记录，AC3 同款计数判据（`<rect` 个数 = 窗口内可解析记录数）
      在 fan-in 卡片的 SVG 里同样成立。
- [x] AC6（I）：`renderLiveCard` 对一个 `startedAtMs` 已知的 `InFlightTask` + 一份包含该 taskId→title
      映射的 `tasks` 输入，`liveMiniList` 渲染 HTML 包含该任务的 title 全文；`handleDashboardCards`
      源码里 `grep -n "readTaskSummary"` 命中（不再是只有 `handleDashboard` 一处调用）。
- [x] AC7（可配置窗口）：`handleDashboard`/`handleDashboardCards` 对 `?hours=6` 的请求，AC3/AC5 的计数
      判据在 6 小时窗口下与 3 小时窗口下产生不同的结果（用一组横跨 3-6 小时的固定输入验证两个窗口值
      确实过滤出不同的段数，而不是窗口参数被读取但从未真正生效）；对 `?hours=` 缺失或非法值
      （如 `abc`、`0`、`999`），回退到默认 3 且不报错（HTTP 200）。

## Definition of Done

四项改动全部落地 develop，`scripts/test.sh --for-task gap-dashboard-fanin-panel-and-timeline-bars` 绿
（或等价 scoped 跑法）。浏览器手工核验：①测试卡近期列表能看到启动时间与 bucket；②测试卡下方出现过去
3 小时（默认）的分段时间轴，能看出跑测的时间段和间隔；③"工作进展"行新增 Fan-in 卡片，列表展示最近
几次 fan-in 的 landed/red + 耗时 + 链接，下方同款时间轴；④循环脉搏在飞任务行显示任务标题；⑤把 URL
换成 `?hours=6` 整页刷新后两条时间轴的窗口确实变宽、段数变多。AC1-7 全部勾选，
`node packages/quay/bin/quay.ts task check gap-dashboard-fanin-panel-and-timeline-bars --json` 的
`missing` 为空。

## Touches

- packages/quay/src/serve-dashboard.ts
- packages/quay/test/gap-dashboard-fanin-panel-and-timeline-bars.test.mjs
- tasks/gap-dashboard-fanin-panel-and-timeline-bars.md
