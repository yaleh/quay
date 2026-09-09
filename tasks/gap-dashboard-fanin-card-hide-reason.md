---
id: gap-dashboard-fanin-card-hide-reason
title: dashboard FAN-IN 卡片不显示 mfi.reason(改选项控制,/task/<id> 详情页保留全文)
status: done
labels:
  - gap
  - webui
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**现状与根因**：`renderFanInCell`（`packages/quay/src/serve-task.ts:508`）把 `mechanical_fan_in.reason` 这个无界自由文本原样拼进输出，用 `<br>` 和 `step`/`lock`/`suite`/`sha`/`view·download` 等字段连在一起。该函数只有两处调用：`serve-task.ts:575`（`/task/<id>` 详情页 Runs 表格，一行一个 cell，放全文合理）与 `serve-dashboard.ts:857`（dashboard 精简 FAN-IN 卡片，直接复用同一个函数）。dashboard 是概览页，卡片设计意图是"最近 5 次机械 fan-in 的一句话摘要"，但 `reason` 字段长度上不封顶——实测 5 条记录里 3 条超过 130 字符，最长一条 **1084 字符**，把整张卡片撑到 2189px 自然高度（当次快照）。

**修法（人裁定：不显示，而不是截断）**：`renderFanInCell` 加一个选项（如 `showReason?: boolean`，默认 `true`，保持 `/task/<id>` 调用点行为不变），dashboard 调用点传 `false`，跳过 `mfi.reason` 这一段拼接（连同它前面的分隔 `<br>` 一起跳过，不留空行）。选择"不显示"而不是"截断到 N 字符"：`step`/`lock`/`suite`/`view·download` 已经提供了"哪一步失败、锁持有多久、点开看全文"的信息，reason 全文只在需要深挖时才有价值，此时用户本就会点 `view`/`/task/<id>` 看完整记录；不显示比截断更彻底——截断仍然不封顶（未来出现比 1084 字符更长的 reason，截断后的固定长度仍会累积成同样的行数问题当记录数增多时），且不需要挑一个截断阈值。

**实测**（chrome-devtools 连生产 dashboard `http://100.78.206.100:4173/dashboard` 只读核实，未改动生产实例；同一时刻冻结快照，克隆节点内移除 `mfi.reason` 对应的 `<span style="font-size:0.75rem;color:var(--color-neutral-700)">` 及其前置 `<br>` 后重新测量）：FAN-IN 卡片自然高度从 1476px 降到 912px（降 38%，该次快照仅有 2 条超长 reason）；另一时刻的快照（5 条里 3 条超长，最长 1084 字符）从 2189px 降到 1215px（降 44%）。已用浏览器把去 reason 后的卡片临时渲染出来做过视觉复核（客户端本地 DOM 实验，未改动生产实例）：红色条目清爽地显示为 `red / step ff / lock 270s / view · download`，信息完整、不再有大段堆栈文本。

## AC

- [x] `renderFanInCell`（`packages/quay/src/serve-task.ts:508`）签名新增一个选项参数控制是否渲染 `mfi.reason`，默认值使 `/task/<id>` 调用点（`serve-task.ts:575`）行为与改动前逐字一致（不传该选项，或显式传默认值）。
- [x] `serve-dashboard.ts:857` 的 FAN-IN 卡片调用点显式传入"不显示 reason"的选项值。
- [x] 新增/扩展单元测试：构造一条 `mfi.reason` 超过 500 字符的假记录，断言 `renderFanInCardFromRecords`（dashboard 路径）的输出**不包含**该 reason 文本，而 `renderFanInCell`（`/task/<id>` 路径，直接调用不经 dashboard 选项）的输出**仍包含**该 reason 文本——两个路径的行为差异要在同一条测试里对照断言，不能只测一边。
- [x] `step`/`lock`/`suite`/`sha`/`view·download` 等其余字段在 dashboard 路径上渲染不受影响（用现有测试或新增断言核实，不能因为去掉 reason 顺带影响其它字段的拼接顺序）。
- [x] 一次真实浏览器视觉复核（本地临时 `quay serve` 实例，不得连接/改动生产 100.78.206.100:4173 实例）：对一条真实存在长 reason 的 fan-in 记录，确认 dashboard 卡片不再显示该文本。

## DoD

改动落地 develop：dashboard 的 FAN-IN 卡片不再渲染 `mechanical_fan_in.reason`，`/task/<id>` 详情页的 Runs 表格保持全文不变；有真实浏览器渲染复核作为落地证据，不是仅凭"测试绿"判定完成。

## Touches

- packages/quay/src/serve-task.ts
- packages/quay/src/serve-dashboard.ts
- packages/quay/test/gap-dashboard-fanin-card-not-in-auto-refresh.test.mjs
- tasks/gap-dashboard-fanin-card-hide-reason.md
