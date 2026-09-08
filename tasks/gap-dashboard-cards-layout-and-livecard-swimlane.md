---
id: gap-dashboard-cards-layout-and-livecard-swimlane
title: Dashboard 卡片精简+改版：测试卡去冗余色块条、bar chart 挪到卡片顶部、循环脉搏卡补全标题+泳道 chart（连带修复移动端整页横向溢出）
status: done
labels:
  - gap
  - webui
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**背景**：2026-09-08 用 MCP 浏览器（chrome-devtools/playwright）对生产 `/dashboard` 做了一轮桌面端
（1600px）+ 移动端（390px）视觉核查，人点名 4 项、核查中又实测发现 1 项系统性 bug，合并为一个任务：

1. **测试卡「近5轮（新→旧）」色块条冗余**（`serve-dashboard.ts:236-247` `recentStrip`）：
   与紧接着的 `:252-271` `recentList`（默认可见、每行已用文字 `red`/`green` 标状态）渲染的是同一份
   `recentRuns` 数据；色块条只有 hover 才出 tooltip，不 hover 时零信息增量，纯占位置。
2. **测试卡 / Fan-in 卡的时间段 bar chart 在卡片底部**：`renderTestsCard` 的 `timelineBar`（`:298`）
   与 `renderFanInCardFromRecords` 的 `bar`（`:807`）都是各自 `return` 语句里倒数第二个内容块
   （仅早于跳转链接），需要滚到卡片末尾才可见，而它是这两张卡最直观的一眼总览信息。
3. **循环脉搏卡标题被单行截断**（`renderLiveCard`，`serve-dashboard.ts:88`）：标题 `<div>` 带
   `overflow:hidden;text-overflow:ellipsis;white-space:nowrap`，对比 `renderTaskCard` 的
   miniList（`:579`）同类标题行没有这三个属性、正常换行——唯一差异就是这三个 CSS 属性。
   循环脉搏卡目前也没有「在飞任务泳道时间段 chart」，人点名参照测试卡/Fan-in 卡的
   `renderTimelineBarSvg` 手法补一个。
4. **（实测新增发现，非人点名，但与 3 同根）移动端整页横向溢出**：390px 视口下
   `document.documentElement.scrollWidth === 1541`（约 4 倍视口宽度），逐层 `getComputedStyle`
   排查确认根因两层：
   - 直接触发点：`renderLiveCard` 的 in-flight 行是 `flex-row`（taskId `<a>` 用
     `white-space:nowrap`，右侧 tag `<span>` 用 `flex:none`），窄容器里不会正常收缩截断，
     而是把整行撑到内容的最大宽度（实测该 `<a>` 计算宽度 411px，已经比 390px 视口本身还宽）——
     这与已完成的 `gap-dashboard-minilist-row-layout`（taskCard miniList 同款 `flex:none` +
     ellipsis 失效 bug，已改成纵向多要素布局修复）是**同一个 bug 模式在另一张卡片上的复现**，
     只是这次没被那次修复覆盖到（`renderLiveCard` 是独立函数）。
   - 放大到整页级别的原因：`.dash-grid` 的移动端媒体查询（`dashboardGridStyles`，`:855`）写的是
     `grid-template-columns:1fr !important`——裸 `1fr` 隐含最小宽度是 `auto`（即内容 min-content），
     不像桌面端 `gridColumns()`（`:838`，`repeat(n, minmax(0,1fr))`，已被
     `gap-dashboard-grid-autofit-columns-vs-card-count` 修好）那样把最小宽度钳到 0。桌面端
     1600px 视口实测 `scrollWidth === 1600`（无溢出），证实只有移动端这一条媒体查询规则缺了
     `minmax(0, ...)` 钳位。

## Plan

1. **测试卡**：删除 `recentStrip`；`recentList` 每行的 `#1322` round 号替换为按 `stateColorToken`
   反色底色的 chip（如 red → `background:var(--color-accent-800);color:#fff`，green →
   `background:var(--color-positive-700);color:#fff`），保留原有 hover title 文案信息量。
2. **测试卡 / Fan-in 卡**：`timelineBar`/`bar` 从 `return` 语句尾部挪到 `detailLine`/subtitle 之后、
   `recentList`/`list` 之前（两张卡统一挪到「状态行之后、明细列表之前」的位置）。
3. **循环脉搏卡标题**：去掉 `overflow:hidden;text-overflow:ellipsis;white-space:nowrap` 三个属性，
   改成与 `renderTaskCard` miniList 一致的正常换行；同一行的 taskId `<a>` 补 `min-width:0`
   （flex 子项显式钳位，防止同类 bug 在别处重演，而不仅是这一处凑巧换行绕开）。
4. **循环脉搏卡新增泳道 chart**：写一个新的多行 SVG 渲染函数（复用 `renderTimelineBarSvg` 的横轴
   换算逻辑，新增纵向 lane 偏移 + 左侧任务 id 标签），每个 in-flight 任务一条 lane，
   segment 为 `[startedAtMs, nowMs]`（in-flight 任务没有确定的结束时刻，开放区间画到当前时刻），
   颜色按 phase（实现中/fan-in/待落地/已落地，复用 `renderLiveCard` 已有的 phase 判断）区分。
5. **`.dash-grid` 移动端媒体查询修复**：`grid-template-columns:1fr !important` →
   `grid-template-columns:minmax(0,1fr) !important`，与桌面端钳位方式统一。这一条独立于第 3 条的
   `renderLiveCard` 换行修复——两者都要做：3 修的是这次触发溢出的具体内容，本条修的是"任何一张卡
   将来出现超长不换行内容都不该再把整页撑爆"的系统性防线。

## Acceptance Criteria

- [x] AC1（近5轮色块条移除）：`grep -n "近${recentRuns.length}轮\|近.*轮（新→旧）" packages/quay/src/serve-dashboard.ts`
      在 `renderTestsCard` 函数体内命中数为 0。
- [x] AC2（round 号反色 chip）：给定固定 `state: "red"`/`"green"` 的 run fixture，`renderTestsCard`
      输出中该行的 round 号被一个带 `background:var(--color-accent-800)` / `--color-positive-700`
      的元素包裹（不是仅文字变色）。
- [x] AC3（bar 位置）：在 `renderTestsCard` 与 `renderFanInCardFromRecords` 各自的输出字符串里，
      `timelineBar`/`bar` 出现的字符偏移量早于 `recentList`/`list` 出现的字符偏移量
      （`indexOf` 数值比较，而非目测截图）。
- [x] AC4（循环脉搏标题换行）：给定一个标题超过 40 字符的 in-flight fixture，`renderLiveCard`
      输出中标题所在元素不含 `white-space:nowrap`；对照 fixture（改动前的代码）必须先能复现
      `white-space:nowrap` 存在（负控制，证明测试真的在测这个属性而非恒真）。
- [x] AC5（泳道 chart）：给定 ≥2 个 in-flight 任务的固定 fixture（不同 `startedAtMs`/phase），
      新渲染函数输出的 `<rect>` 数量等于 in-flight 任务数，且每个 `<rect>` 的纵向位置
      （`y` 属性）两两不同（真正分行，不是叠在同一条 lane 上）。
- [x] AC6（移动端零横向溢出，真实回归而非静态审查）：用 MCP 浏览器把视口设为 390×844 打开生产
      `/dashboard`（或本地起服务后打开），`document.documentElement.scrollWidth` 必须
      `<= 390 + 5`（容许滚动条误差）；**改动前必须先在同一视口下复现 `scrollWidth ≈ 1541`
      的负控制**（证明这条 AC 真的在测刚才发现的 bug，而不是一个从未失败过的恒真断言，
      对应 CLAUDE.md 硬规则 4）。
- [x] AC7（`.dash-grid` 媒体查询钳位）：`grep -n "grid-template-columns:1fr !important"
      packages/quay/src/serve-dashboard.ts` 命中数为 0，改为
      `grep -n "grid-template-columns:minmax(0,1fr) !important"` 命中数为 1。

## Definition of Done

- 代码改动已合入 `develop`。
- `scripts/test.sh --for-task gap-dashboard-cards-layout-and-livecard-swimlane`（或等价 scoped 调用）绿。
- 手工用 MCP 浏览器分别在桌面端（≥1200px）与移动端（390px）刷新生产 dashboard 页确认：
  近5轮色块条已移除、round 号有反色 chip、两张卡的时间段 bar 在卡片顶部、循环脉搏标题完整可读、
  循环脉搏卡有在飞任务泳道 chart、移动端页面不再有整页横向滚动条。
- `quay task check gap-dashboard-cards-layout-and-livecard-swimlane --json` 的 `missing` 为 `[]`。

## Touches

- packages/quay/src/serve-dashboard.ts
- packages/quay/test/gap-dashboard-visual-review-batch-fixes.test.mjs
- packages/quay/test/gap-dashboard-cards-layout-and-livecard-swimlane.test.mjs
- packages/quay/test/gap-dashboard-grid-autofit-columns-vs-card-count.test.mjs
- tasks/gap-dashboard-cards-layout-and-livecard-swimlane.md
- packages/quay/test/gap-webui-dashboard-tests-card-latest-round-no-live-signal.test.mjs

## Evidence

- 2026-09-08：suite 红在 `gap-webui-dashboard-tests-card-latest-round-no-live-signal.test.mjs` AC3（断言 `/近\d+轮/` 色块条仍在）——本任务 AC1 有意删除该 hover-only 色块条（信息已并入 recentList 的
  round 反色 chip，chip `title` 仍携带 `未执行测试` / `pass X/Y`）。已把该测试 AC3 改为断言 round chip
  渲染（green `#2` + gate-blocked `#3`，即「单一最新行不是唯一信号」），并扩 Touches。
