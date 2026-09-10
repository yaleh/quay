---
id: gap-dashboard-live-swimlane-fixed-lane-gantt-timeline
title: Dashboard「循环脉搏」泳道图升级为固定 5 泳道甘特图（合并历史任务+贪心打包+hover），保留在飞任务 mini-list
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**来源**：人 2026-09-09 提出「循环脉搏」升级为并发调度时间轴（Gantt 风格泳道图）的设计方案，本任务是该方案的可行性评审结论（同一对话内完成，评审人：Claude，基于对现有代码的实测读取，非目测）。

**现状**：当前 dashboard「循环脉搏」卡片的泳道图（`renderLiveSwimlaneSvg`，`packages/quay/src/serve-dashboard.ts:227`，由 `gap-dashboard-cards-layout-and-livecard-swimlane` 落地）只画**当前在飞任务**，每个任务一条轨（轨数 = 在飞任务数，非固定），且只画开区间 `[startedAtMs, now]`——历史（已结束）任务不可见，看不出吞吐率、空闲时段、长尾任务（如 41 分钟的 fan-in）造成的调度阻塞。

**评审结论（可行）**：方案要求的基础设施在本仓库已大部分存在，这是对已有三块机件的合并+扩展，不是新架构：
- 时间轴窗口选择（`?hours=` 查询参数，`serve-dashboard.ts:116-133`，已支持 1-24h、已有 `/dashboard?hours=N` 链接 UI，`:1021`）
- SVG 时间轴渲染的横轴换算（`renderTimelineBarSvg` 单轨历史 / `renderLiveSwimlaneSvg` 多轨在飞，二者横轴 `X(t)` 写法一致）
- 状态→颜色映射（`stateColorToken` / `fanInOutcomeColorToken` / `livePhaseColorToken` 三个已有函数）
- 历史任务起止时间数据源：`.quay/worker-outcome.jsonl`（`WorkerOutcomeRecord`：`started_at`/`ended_at`/`final_state`/`run_id`/`mechanical_fan_in`），已被 `readWorkerOutcomeRecords()` 整份读入并在 dashboard 别处使用（`serve-dashboard.ts:812`），本任务复用同一数据源不增加新 I/O 路径
- 并发上限 5（`FIXED_DISPATCH_CAP`）与方案「Y 轴固定 5 条泳道」一致
- Hover 提示：本代码库现有约定是原生 `title="..."` 属性（无 JS tooltip 框架，如 `serve-dashboard.ts:335`），SVG `<rect>` 同法加 `<title>` 子元素即可，零 JS

**必须保留**：卡片中现有的在飞任务 mini-list（`renderLiveCard` 里的 `liveMiniList`，取前 3 条 + 状态 tag，`serve-dashboard.ts:70`）——它与泳道图渲染路径本就独立（`swimlane` 与 `liveMiniList` 是并列拼接进同一张卡的两个变量，`:93-101`），改造甘特图不需要动它。

## Plan

1. **数据合并**：新增一个纯函数，把两路数据合并成统一区间列表：
   - 在飞：`readLive(root).inFlight`（`InFlightTask[]`：`taskId/runId/startedAtMs/phase`，开区间到 `now`）
   - 历史：`readWorkerOutcomeRecords(root)`（`WorkerOutcomeRecord[]`：`task/run_id/started_at/ended_at/final_state/mechanical_fan_in`），按窗口 `[nowMs - hours*3600000, nowMs]` 过滤（新增纯过滤函数，边界条件复用 `renderTimelineBarSvg` 已有的窗口相交判定写法）
   - 按 `run_id` 去重：同一次运行如果既在 `inFlight`（未写 outcome）又已出现在 `worker-outcome.jsonl`（historical），只保留一条，避免同一任务画两条重叠的块
   - 着色：复用既有 `livePhaseColorToken`（在飞按 phase）+ `fanInOutcomeColorToken`（历史按 `mechanical_fan_in.outcome`）+ `final_state`（`completed`/`failed`/`killed`/`timed-out`/`exited-not-landed` 等）的综合判色规则——不新造颜色 token 体系

2. **固定 5 泳道贪心打包算法**：新增纯函数 `packLanes(intervals, maxLanes=5)`，实现经典「会议室调度」贪心算法（按 start 排序，分配给最早可用的泳道）。数学依据：若窗口内并发上限恒为 5，任一时刻重叠区间数 ≤5，贪心打包必然收敛到 ≤5 条轨。**必须处理溢出**：若因非严格计入并发上限的信号（如 fan-in 阶段是否计入 driver 的 worker 并发上限）导致某时刻重叠 >5，不得静默丢弃或让下标越界——降级为可见的「+N 更多」提示或明确的降级分支，不能假设恒 ≤5（这是本任务需要验证/加固的地方，不是可以跳过的边界）。

3. **SVG 渲染**：新增/扩展渲染函数（可基于 `renderLiveSwimlaneSvg` 改造，或新增 `renderLiveGanttSvg`），复用 `renderTimelineBarSvg`/`renderLiveSwimlaneSvg` 已有的横轴换算（`X(t)`）、`hhmm` 轴标签写法。固定渲染 5 条泳道行（哪怕某轨当前无任务也画出空轨，保持「这是并发上限」的视觉语义）。每个任务块加 `<title>` 子元素做原生 hover 提示（任务 id、阶段/终态、耗时、起止时间戳）——沿用本代码库现有的零 JS 原生 tooltip 约定，不引入 JS tooltip 框架。

4. **接入 `/dashboard` 与既有窗口选择器**：`timelineHoursFromRequest` 已支持 `?hours=`，新甘特图复用同一份 `hours` 值，不新增查询参数。`renderLiveCard` 的调用点从 `renderLiveSwimlaneSvg(live.inFlight, DEFAULT_TIMELINE_HOURS, nowMs)` 改为新函数，传入合并后的区间列表；`live.inFlight.slice(0,3)` 的 mini-list 渲染逻辑原样保留。

5. **自动刷新**：`/dashboard/cards` 局部刷新端点已存在，新甘特图作为 `liveCard` 的一部分自动被覆盖，无需新增刷新路径。

## Acceptance Criteria

- [x] 新增的区间合并纯函数：给定构造的 `inFlight` + `WorkerOutcomeRecord[]` 固定样本，输出的区间列表按 `run_id` 去重正确（同一 run_id 只出现一次），且历史区间的 `end` 用 `ended_at`、在飞区间的 `end` 用 `now`（单测覆盖两种输入都存在同一 run_id 的情况）
- [x] `packLanes` 贪心打包：单测覆盖（a）不重叠区间全部分到 lane 0；（b）5 个同时重叠区间恰好占满 5 条泳道；（c）第 6 个与前 5 个都重叠的区间触发溢出路径（断言不越界、不静默丢弃，走「+N」或明确的降级分支）
- [x] 新 SVG 渲染函数：给定固定并发上限=5 的样本，`<rect` 计数 = 输入任务数（每个任务恰好一个矩形，同既有 `renderLiveSwimlaneSvg`/`renderTimelineBarSvg` 的计数约定），且渲染出 5 条泳道线（无论是否每条都有任务）
- [x] 每个任务矩形都带 `<title>` 子元素，内容包含任务 id 与耗时（可用字符串包含断言验证是否含关键字段）
- [x] `renderLiveCard` 单测：给定同时含在飞 + 历史任务的样本，输出 HTML 中在飞任务 mini-list（现有 `liveMiniList` 渲染的 tag 文案）与新甘特图两者都存在（grep 断言两段都在，验证「保留卡片中的在飞任务列表」这条硬约束没有被移除）
- [x] `scripts/test.sh` 全绿（含新增测试文件）

## Definition of Done

`renderLiveCard`（或其等价的新导出函数）在真实 `/dashboard?hours=` 请求路径下渲染出固定 5 泳道甘特图 + 原有在飞任务 mini-list，两者同时可见；用真实/模拟的 `.quay/worker-outcome.jsonl` + `readLive()` 数据跑通至少一条端到端集成测试（非纯 unit 构造样本），确认合并/打包/渲染三段管线接得上生产数据形状。

## Touches

- packages/quay/src/serve-dashboard.ts
- packages/quay/test/serve-dashboard.test.mjs
- packages/quay/src/observation.ts
- packages/quay/test/observation.test.mjs
- tasks/gap-dashboard-live-swimlane-fixed-lane-gantt-timeline.md
