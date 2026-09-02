---
id: gap-dashboard-minilist-row-layout
title: dashboard taskCard miniList 单行排版修复：flex:none 使 ellipsis
  失效导致长标题撑爆卡片，且更新时间未渲染（方案B）
status: todo
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

**现状与根因**（`packages/quay/src/serve-dashboard.ts:196-209` `miniList`）：

```html
<a style="display:flex;justify-content:space-between;gap:8px;...">
  <span style="font-weight:600;...">${id}</span>
  <span style="flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${title}</span>
</a>
```

- 每行是一个 flex 容器，内含两个子项：id（`font-weight:600`）与 title。`justify-content:space-between`
  想把 id 挤左、title 挤右；title 又是 `flex:none` + `white-space:nowrap` + `text-overflow:ellipsis`——
  但 `flex:none` 禁止该子项收缩，`ellipsis` 因此从未生效，长标题直接把卡片撑爆（该结构由
  `gap-dashboard-taskcard-multistatus-minitable` 引入时未覆盖长标题场景）。
- 这一行的数据其实已经取到 `updatedAt`（`miniList` 的 `rows` 本身就按 `updatedAt` 降序过滤排序），
  只是从未渲染到行内；`status` 目前仅靠所在分组标题（如"needs-human（最近 3 条）"）隐含表达。

**方案（人 2026-09-02 裁定：方案B，省略行内 status，只留更新时间）**：把每条任务从「单行两个 flex
子项」改为「纵向多要素」：
① id（`color:var(--color-accent)`，去掉 `white-space:nowrap`，允许整词换行）
② title（正文色 `var(--color-text)`，去掉 `flex:none`/`overflow:hidden`/`text-overflow:ellipsis`/
`white-space:nowrap`，允许自然换行——不再依赖失效的 ellipsis 截断）
③ 更新时间（小号灰字 `color:var(--color-neutral-700)`，复用已存在的 `relativeTime()`
——`packages/quay/src/serve-render.ts:599`，该函数已在 `serve-task.ts`/`serve-live.ts`/
`serve-needs-human.ts` 用于同类场景；本次只需把它加进 `serve-dashboard.ts` 顶部对
`./serve-render.ts` 的 import 列表，不重复实现相对时间格式化）。**不重复渲染 status**——依赖所在
分组标题（"ready/todo/needs-human（最近 3 条）"）传达 status，方案B 取舍。
④ 条目间一条细分隔线（复用既有 `border-top:1px solid var(--color-divider)` 手法，用在条目之间而非
只在整个迷你列表顶部，避免行数变多后视觉粘连）

**不改变的部分**：`miniList`/`miniStatuses`/N=3/updatedAt 降序/0 任务时不渲染空块——这些既有行为不
受影响，只改单条任务行内部的标签结构与样式。

## Acceptance Criteria

- [ ] `packages/quay/src/serve-dashboard.ts` 顶部对 `./serve-render.ts` 的 import 列表新增
      `relativeTime`（`grep -n 'relativeTime' packages/quay/src/serve-dashboard.ts` 命中 ≥2 处：
      import 语句 + `miniList` 内的调用处）。
- [ ] `miniList` 单条任务行渲染 id、title、`relativeTime(updatedAt)` 三个独立文本节点——可用测试
      断言渲染出的 HTML 中，同一条任务的 id 之后依次能找到该任务的 title 全文与一个由
      `relativeTime` 产出的时间字符串，而不是仅 id+title 两项。
- [ ] title 对应的 `<span>`/标签样式不再包含 `flex:none`、`overflow:hidden`、`text-overflow:ellipsis`
      或 `white-space:nowrap`（对 `miniList` 函数体源码 `grep` 核实这四个 token 均不出现在 title 所在
      的标签属性上）。
- [ ] 迷你列表条目间渲染分隔线：同一状态块内 ≥2 条任务时，第 2 条及以后的行样式含 `border-top`；
      且原有"该状态下任务数为 0 时不渲染该区块"行为不回归。
- [ ] `node --test packages/quay/test/gap-dashboard-taskcard-multistatus-minitable.test.mjs` 既有
      测试 exit 0 不回归（该测试只断言 id 链接与分组标题存在、未锚定旧的两栏 flex 结构，用于验证
      本次改动不破坏既有断言）。
- [ ] 新增 `packages/quay/test/gap-dashboard-minilist-row-layout.test.mjs`，覆盖：短标题正常渲染；
      长标题（如 60+ 字符）不再被截断为省略号（输出 HTML 中不含 `text-overflow:ellipsis` 且该长标题
      原文全文出现在输出中）；每行渲染出 `relativeTime` 格式的时间文本（可用一个已知 `updatedAt` 差值
      构造可预期的输出片段断言）。测试 exit 0。
- [ ] `scripts/test.sh --for-task gap-dashboard-minilist-row-layout` scoped 静态检查通过，exit 0。

## Definition of Done

不是"新增测试变绿"就算完——DoD 要求：在本机实际启动的 `quay serve`（例如
`node --experimental-strip-types packages/quay/bin/quay.ts serve --host <ip> --port <p>`）上，
`curl`/浏览器打开 `/dashboard`，用当前任务store里真实存在的、标题足够长的一条 ready/todo/
needs-human 任务核实：卡片不再因长标题被撑爆（若当前真实数据里没有天然的长标题样本，允许临时把
一条真实任务的 title 改长以验证渲染效果，验证后改回原值，不得残留测试污染），且每行下方能看到
`relativeTime` 产出的相对更新时间文案（如"3 小时前"）。将验证截图或 curl/浏览器观察结果记入提交
信息。

## Touches

- packages/quay/src/serve-dashboard.ts
- packages/quay/test/gap-dashboard-minilist-row-layout.test.mjs
- tasks/gap-dashboard-minilist-row-layout.md
