---
id: gap-dashboard-goal-card-ac-progress-bar
title: Goal 卡「AC 达成 x/y」加一条 mini 进度条（复用 task-card 分段条手法）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal
`renderGoalCard`（packages/quay/src/serve-dashboard.ts:760-802）里每个 active goal 只用纯文本渲染
`AC 达成 ${achieved}/${acs.length}`，达成比例没有任何可视化。同一份文件里 `renderTaskCard` 的
`bar()` 闭包（:644-648）已经用一个 `<div style="width:{pct}%">` 段实现了同类的比例可视化，直接复用
这个手法即可，不需要新组件/新依赖。这是 2026-09-09 一次 Dashboard 视觉改进方案核对（对照生产截图
与源码逐条验证）里认定的三个高性价比项之一：改动局限在一个已有渲染函数内，achieved/acs.length 已经
算出来了，只是没有画出来。

## Plan
1. 在 `renderGoalCard` 的每行 goal 渲染里，在「AC 达成 x/y」文字同一行或紧邻处加一条 mini 进度条：
   一个固定高度（如 4-6px）的容器 + 一个 `width:${pct}%` 的填充 div，pct = achieved/acs.length*100
   （acs.length === 0 时不渲染进度条，只保留原文本，避免除零）。
2. 填充色复用现有 token（如 `var(--color-positive-700)` 或既有的 accent 系），不要引入新的十六进制色值。
3. 保持原有的 `AC 达成 x/y` 文本（进度条是补充，不是替换），确保纯文本读者/无障碍场景仍可读。
4. 新增单测文件 `packages/quay/test/gap-dashboard-goal-card-ac-progress-bar.test.mjs`：对
   `renderGoalCard` 传入已知 achieved/total 组合，断言渲染出的进度条宽度百分比与 achieved/total 一致
   （字符串包含 `width:XX.X%` 或等价断言），并覆盖 acs.length===0 的空分母场景。

## Acceptance Criteria
- [x] `renderGoalCard` 渲染的每个 active goal 行在「AC 达成 x/y」旁包含一个宽度正比于
      achieved/total 的进度条元素，可由单测断言出具体百分比数值。
- [x] acs.length === 0 时不产出 NaN/Infinity 宽度，进度条要么不渲染要么渲染为 0%，单测覆盖此分支。
- [x] 新增测试文件通过 `scripts/test.sh`（含在其 --for-task scoped 静态检查内）。

## Definition of Done
- [x] 代码改动落在 `packages/quay/src/serve-dashboard.ts` 的 `renderGoalCard` 内，未触碰其它卡片的
      渲染函数。
- [x] `packages/quay/test/gap-dashboard-goal-card-ac-progress-bar.test.mjs` 存在且断言了具体宽度值
      （不是布尔存在性检查），随 fan-in/scoped gate 一起跑绿。
- [x] 生产 `/dashboard` 页面人工截图核实：三个 active goal（不同 AC 达成比例）在浏览器里显示出长度
      不同的进度条。

## Touches
- packages/quay/src/serve-dashboard.ts
- packages/quay/test/gap-dashboard-goal-card-ac-progress-bar.test.mjs
- tasks/gap-dashboard-goal-card-ac-progress-bar.md

## Evidence

**AC1/AC2 自动化**：`node --test packages/quay/test/gap-dashboard-goal-card-ac-progress-bar.test.mjs` — 3/3 通过（2/3 ⇒ `width:66.7%`、0/2 ⇒ `width:0.0%`、acs.length===0 ⇒ 无进度条且无 NaN/Infinity，纯文本「AC 达成 0/0」保留）。

**AC3 自动化**：`scripts/test.sh --for-task gap-dashboard-goal-card-ac-progress-bar --allow-thin` — scoped gate 全绿（85/85，0 fail）。

**DoD 截图**（worktree 起服务 `node --experimental-strip-types packages/quay/bin/quay.ts serve --host 127.0.0.1 --port 4189`，fixture workspace `/tmp/goalbar-ws` 三个 active goal GOAL-A 0/3、GOAL-B 1/3、GOAL-C 2/3，chrome-devtools MCP 实测）：
- 渲染 HTML 含三条填充 div：`width:0.0%`、`width:33.3%`、`width:66.7%`（`background:var(--color-positive-700)`），浏览器 DOM 实测三条长度不同的进度条；截图 `/tmp/goalbar-dashboard.png`、`/tmp/goalbar-card.png`。
