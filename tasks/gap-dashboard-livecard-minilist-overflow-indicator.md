---
id: gap-dashboard-livecard-minilist-overflow-indicator
title: 循环脉搏卡 mini-list 截断加「+N 更多」提示（复用甘特图已有措辞）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal
`renderLiveCard`（packages/quay/src/serve-dashboard.ts）的在飞任务文字 mini-list：
```js
const liveMiniList = live.inFlight.slice(0, 3).map((t) => { ... })
```
`3` 是硬编码，和同一张卡头部的 `在飞 ${live.inFlight.length} / 上限 ${live.concurrencyCap}`（真实值）
脱节。2026-09-10 生产截图核实：在飞=5、上限=5 时，甘特图（`FIXED_GANTT_LANES = 5`）按并发上限画满 5
条泳道色块，但泳道本身不带任务 id 标签——能认出"是谁"的信息只存在于被砍到 3 条的文字 mini-list 里，
于是用户能看到 5 根彩条，却只能读出其中 3 个任务的 id/阶段/耗时，另外 2 条既不在列表里、也没有任何
"还有更多"的提示，误读为"信息缺失"而非"刻意截断"。

这不是发明新样式：甘特图自己在 `renderLiveGanttSvg`（serve-dashboard.ts:464）对超过 5 条并发的 overflow
已经有现成惯用法：
```js
`+${overflow} 更多`
```
mini-list 缺的正是这同一个惯用法的文字版。

前序任务 `gap-dashboard-live-swimlane-fixed-lane-gantt-timeline`（done）在改造甘特图时明确记录了
"`live.inFlight.slice(0,3)` 的 mini-list 渲染逻辑原样保留"——即当时刻意不动这处截断，本任务补的正是
那个遗留缺口，不是回退它的决定。

## Plan
1. 在 `renderLiveCard` 的 `liveMiniList` 渲染之后（mini-list 容器内，`</div>` 之前），当
   `live.inFlight.length > 3` 时追加一行：`+${live.inFlight.length - 3} 更多 →`，文案与甘特图 overflow
   badge 的 `+N 更多` 保持一致措辞；该行链接到 `/live`（与卡片底部既有的「查看 Live →」同一目标，该页
   已完整列出全部在飞任务）。
2. `live.inFlight.length <= 3` 时不渲染该行（不产出 `+0 更多`）。
3. 不改 `slice(0, 3)` 本身的取值来源——不要改成 `slice(0, live.concurrencyCap)`：并发上限在其它
   workspace 可能配得更高（如 10），卡片会跟着无界变长；"+N 更多" 提示比放大截断阈值更能扩展。
4. 新增单测文件 `packages/quay/test/gap-dashboard-livecard-minilist-overflow-indicator.test.mjs`：
   - 在飞任务数 = 5 时，`renderLiveCard` 输出包含 `+2 更多`；
   - 在飞任务数 = 3 时，输出不包含 `更多` 字样；
   - 在飞任务数 = 0 时（空态分支）不受影响，既有测试不回归。

## Acceptance Criteria
- [x] 在飞任务数 > 3 时，`renderLiveCard` 输出的字符串包含 `+${N-3} 更多`（N 为实际在飞数），单测对
      N=5、N=4 两个具体值分别断言出精确数字。
- [x] 在飞任务数 ≤ 3 时，输出不包含"更多"字样，单测覆盖 N=3 边界。
- [x] 既有 `gap-dashboard-live-swimlane-fixed-lane-gantt-timeline.test.mjs` 等测试无回归红（mini-list
      本体渲染逻辑未被替换，只是追加了一行）。

## Definition of Done
- [x] 代码改动落在 `packages/quay/src/serve-dashboard.ts` 的 `renderLiveCard` 内。
- [x] `packages/quay/test/gap-dashboard-livecard-minilist-overflow-indicator.test.mjs` 存在且按具体
      数字断言，随 scoped gate 跑绿。
- [ ] 生产 `/dashboard` 页面人工截图核实：在飞任务数 > 3 时循环脉搏卡文字列表底部出现「+N 更多 →」，（待外部）
      点击跳转 `/live` 且该页能看到被截断的那几条。

## Touches
- packages/quay/src/serve-dashboard.ts
- packages/quay/test/gap-dashboard-livecard-minilist-overflow-indicator.test.mjs
- tasks/gap-dashboard-livecard-minilist-overflow-indicator.md