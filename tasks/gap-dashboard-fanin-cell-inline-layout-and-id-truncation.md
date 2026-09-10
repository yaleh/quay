---
id: gap-dashboard-fanin-cell-inline-layout-and-id-truncation
title: Fan-in 卡字段改单行内联排版 + 任务 id 单行省略号（收窄纵向堆叠）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal
`renderFanInCell`（packages/quay/src/serve-task.ts:513-541）末尾：
```js
return parts.join("<br>");
```
outcome 徽章、（red 时的）step 徽章、`lock Ns`、`suite ...`、`sha ...`、`view · download` 每个字段各占
一行，`<br>` 硬换行。该函数被两处复用：`/task/<id>` 的 Runs 表格单元格（行本来就窄，竖排合理）与
dashboard 的 fan-in 概览卡（仅展示 5 条记录的紧凑卡片）。2026-09-10 生产截图核实：即使
`gap-dashboard-status-tag-badges`/`gap-dashboard-fanin-monospace-ids`（均已 done）把徽章和等宽字体
补上之后，每条记录仍然是 4-6 个字段各占一行 + 任务 id 因未做单行截断而换行 2 行 + 独立时间戳行，单
条记录纵向堆到 7-9 行，5 条记录把整张卡撑得很长，信息密度低。

函数已有先例证明"共享函数按调用场景切换字段"是本函数接受的模式——`showReason` 选项让 dashboard 跳过
自由文本 reason 字段；本任务要补的是同一模式的延伸：**布局**而非**字段取舍**。
任务 id 的单行省略号也有站内先例：`renderGoalCard` 的描述行（serve-dashboard.ts:786）已用
`overflow:hidden;text-overflow:ellipsis;white-space:nowrap` 这套三属性组合，fan-in 卡的 id 链接
（serve-dashboard.ts:1065，`renderFanInCardFromRecords`）没有跟上。

## Plan
1. 给 `renderFanInCell` 的 `opts` 加一个布局开关，如 `layout?: "stacked" | "inline"`（默认
   `"stacked"`，保持 `/task/<id>` Runs 表格现状不变——不改其调用点）。
2. `layout: "inline"` 时：outcome 徽章 / step 徽章 / `lock Ns` / `suite ...` / `sha ...` /
   `view · download` 用 `" · "` 拼接成同一行（`parts.join(" · ")`），而不是 `<br>`；徽章
   （`<span class="tag ...">`）本身是 `inline-flex`，和文本内联不冲突。`showReason` 语义不变
   （dashboard 仍传 `showReason:false`）。
3. dashboard 调用点（`renderFanInCardFromRecords`，serve-dashboard.ts:1066）改传
   `renderFanInCell(r.task ?? "", r, { showReason: false, layout: "inline" })`。
4. 同一函数里（:1065）给任务 id 的 `<a>` 加
   `overflow:hidden;text-overflow:ellipsis;white-space:nowrap` + `title="${escapeHtml(r.task ?? "")}"`
   （hover 看完整 id，点击行为不变），和 goal 卡描述行用同一套三属性组合，不发明新惯用法。
5. 新增单测文件
   `packages/quay/test/gap-dashboard-fanin-cell-inline-layout-and-id-truncation.test.mjs`：
   - `renderFanInCell(..., { layout: "inline" })` 对一条含 outcome/lock/suite/sha/fanInLog 的样本
     记录，输出中不含 `<br>`、字段以 `" · "` 分隔（断言具体拼接结果，不是仅断言"不含 <br>"）；
   - 不传 `layout`（或传 `"stacked"`）时行为与改动前一致（`<br>` 分隔），验证 `/task/<id>` 路径未回归；
   - `renderFanInCardFromRecords` 对一条长 id（如 60+ 字符的 kebab 字符串）样本，输出的 `<a>` 标签携带
     `text-overflow:ellipsis` 与匹配的 `title` 属性。

## Acceptance Criteria
- [x] `renderFanInCell(..., { layout: "inline" })` 输出不含 `<br>`，字段以 `" · "` 连接，单测对固定样本
      断言出完整拼接字符串。
- [x] `renderFanInCell` 不传 `layout` 时输出与改动前逐字节一致（`<br>` 分隔未变），既有
      `gap-mech-fan-in-log-webui-visible-clickable`、`gap-dashboard-status-tag-badges`、
      `gap-dashboard-fanin-monospace-ids` 相关测试无回归红。
- [x] `renderFanInCardFromRecords` 渲染的任务 id `<a>` 标签同时带
      `overflow:hidden;text-overflow:ellipsis;white-space:nowrap` 与 `title` 属性，单测对长 id 样本断言。

## Definition of Done
- [x] 代码改动落在 `packages/quay/src/serve-task.ts`（`renderFanInCell`）与
      `packages/quay/src/serve-dashboard.ts`（`renderFanInCardFromRecords` 调用点 + id 链接样式）之内，
      `/task/<id>` Runs 表格的现有渲染（`layout` 默认值路径）无视觉变化。
- [x] `packages/quay/test/gap-dashboard-fanin-cell-inline-layout-and-id-truncation.test.mjs` 存在且按
      具体字符串/属性断言，随 scoped gate 跑绿。
- [ ] 生产 `/dashboard` 页面人工截图核实：fan-in 卡每条记录收窄到约 3 行（id 单行省略号 + 字段一行 + 时间戳一行），5 条记录的整卡高度较改动前明显变短；`/task/<id>` 页面 Runs 表格视觉不变。（待外部）

## Touches
- packages/quay/src/serve-task.ts
- packages/quay/src/serve-dashboard.ts
- packages/quay/test/gap-dashboard-fanin-cell-inline-layout-and-id-truncation.test.mjs
- tasks/gap-dashboard-fanin-cell-inline-layout-and-id-truncation.md