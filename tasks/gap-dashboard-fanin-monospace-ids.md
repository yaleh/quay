---
id: gap-dashboard-fanin-monospace-ids
title: Fan-in 卡的 sha/lock 耗时套等宽字体（复用站内既有 monospace 约定）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---

## Proposal
Dashboard 已经有等宽字体的先例：`serve-dashboard.ts:1008`（「最近提交」卡）与 `serve-system.ts:140`
（系统资源卡）都对 git hash/日志用 `font-family:ui-monospace,monospace` 渲染。但同一个 dashboard 的
fan-in 卡（`renderFanInCardFromRecords`，serve-dashboard.ts:808-894，经 `renderFanInCell`,
serve-task.ts）渲染的 `sha 36384f5`、`lock 332s` 等同类型内容（git hash、耗时秒数）没有跟上这个约定，
生产截图里这些数字和普通正文用同一个 Archivo 变宽字体渲染，纵向对不齐、也不像旁边"最近提交"卡那样一
眼认出是数据。这是 2026-09-09 Dashboard 视觉改进方案核对认定的三个高性价比项之一：不是"全站从无等宽
字体"，是"隔壁卡片已经在用，这张卡没跟上"的一致性缺口，成本是纯样式改动。

## Plan
1. 在 `renderFanInCell`（serve-task.ts）与/或 `renderFanInCardFromRecords`
   （serve-dashboard.ts）渲染 `sha <hash>`、`lock <Ns>` 这两处文本节点时，套上
   `font-family:ui-monospace,monospace`（与 :1008/:140 用同一个字体栈字符串，不要另起一个）。
2. 若同一处还渲染其它类 ID/hash/耗时字段（如 fan-in 卡列表行的任务 id 本身），一并评估是否套用；
   任务 id 是长 kebab 字符串，是否上等宽视觉效果需人工截图确认后再定，不强制。
3. 不引入新字体文件/新 CDN 依赖——`ui-monospace,monospace` 是系统字体栈，零加载成本。
4. 新增单测文件 `packages/quay/test/gap-dashboard-fanin-monospace-ids.test.mjs`：断言
   `renderFanInCell`（或改动落点的具体函数）对含 sha/lock 字段的记录，输出的 HTML 片段包含
   `font-family:ui-monospace,monospace`（或改用的等价 class 名）包裹 sha/lock 的文本节点。

## Acceptance Criteria
- [x] fan-in 卡渲染的 `sha <hash>` 与 `lock <Ns>` 文本节点带有
      `font-family:ui-monospace,monospace`（或等价 class），单测对含这两个字段的样本记录断言存在。
- [x] 改动不影响 fan-in 卡其余字段（task id 链接、`view`/`download`、时间戳）的既有渲染，既有
      `gap-dashboard-fanin-panel-and-timeline-bars.test.mjs` 等测试无回归红。
- [x] 新增测试文件通过 `scripts/test.sh`（含 --for-task scoped 静态检查）。

## Definition of Done
- [x] 代码改动落在 `packages/quay/src/serve-task.ts`（`renderFanInCell`）和/或
      `packages/quay/src/serve-dashboard.ts`（`renderFanInCardFromRecords`）之内。
- [x] `packages/quay/test/gap-dashboard-fanin-monospace-ids.test.mjs` 存在且断言具体字体样式字符串
      （不是布尔存在性检查），随 scoped gate 跑绿。
- [x] 生产 `/dashboard` 页面人工截图核实：fan-in 卡的 `sha`/`lock` 数值改为等宽字体渲染，与「最近提
      交」卡的视觉风格一致。

## Touches
- packages/quay/src/serve-task.ts
- packages/quay/src/serve-dashboard.ts
- packages/quay/test/gap-dashboard-fanin-monospace-ids.test.mjs
- tasks/gap-dashboard-fanin-monospace-ids.md