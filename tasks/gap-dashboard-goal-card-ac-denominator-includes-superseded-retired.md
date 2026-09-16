---
id: gap-dashboard-goal-card-ac-denominator-includes-superseded-retired
title: Dashboard GOAL 卡「AC 达成 X/Y」分母未排除 superseded/retired 等已退场状态，误导用户高估待办量
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**现状（当轮核实，`packages/quay/src/serve-dashboard.ts`，`renderGoalCard` 函数，约 `:991-1009`）**：

```ts
const acs = goals.filter((r) => String(r.goal ?? "") === gid);           // 分母 Y = 该 goal 下【所有】挂钩记录
const achieved = acs.filter((r) => r.status === "achieved").length;      // 分子 X = 只数 achieved
...
const acBar = acs.length > 0
  ? html`<div ...><div style="width:${((achieved / acs.length) * 100).toFixed(1)}%;..."></div></div>`
  : "";
...
<div ...>AC 达成 ${achieved}/${acs.length}${acBar}</div>
```

**分母 `acs.length` 没有排除任何终态**：只要某条记录的 `goal` 字段等于该 GOAL 的 id，不论它自己的
`status` 是什么都会被计入分母。`acBar` 进度条的百分比计算（`achieved / acs.length`）用的是同一个
未过滤分母，两处口径一致地错。

**实测代价（2026-09-16 本次对话中真实发生的误导）**：`GOAL-020` 名下共有 10 条挂钩的 AC 记录
（AC-265 到 AC-274），其中 AC-266/AC-267/AC-268 三条已在 2026-09-16 被人裁定 `superseded`
（SEA/npm 发布渠道退役，SPEC §11）——即这三条已经是"不再需要被满足"的终态。但 dashboard 卡片仍然把
它们计入分母，显示「AC 达成 6/10」，而真实"仍在域内、需要被判定"的只有 7 条（6 条 achieved + 1 条
active 未达成，即 AC-274），正确的比例应该是「6/7」。用户看到卡片上的数字后问出了"GOAL-020 还有 4 个
AC 没翻"（10-6=4），但实际上只有 AC-274 一条真正待完成，另外 3 条已经处理完毕（superseded），完全
不需要再管——这正是分母口径错误造成的真实误解案例。

## 权威状态枚举（已核实，不要凭空假设"只排除 superseded"）

`packages/quay/src/abi.ts:103`：
```ts
export const GOAL_STATUSES: readonly string[] = ['draft', 'active', 'achieved', 'superseded', 'retired', 'needs-human'];
```
六个合法状态。**实测 `goals/*.md` 里实际出现过的值分布**（`grep -h "^status:" goals/*.md | sort | uniq -c`）：
`achieved` 136 条、`superseded` 8 条、`retired` 7 条、`active` 2 条——**没有 `draft`/`needs-human` 的
实例**，但这两个状态在类型上合法，不能排除某个 active GOAL 关联的 AC 记录未来处于这两种状态之一的可能性。

**这次立案最容易踩的坑**：只想到排除 `superseded`（因为这是本次对话里直接触发问题的那个状态），但实测
显示 `retired` 也是一个真实存在、语义上同样"已退场、不再追踪"的终态（7 条实例），如果只改 `superseded`
不改 `retired`，同样的误导会在带 `retired` AC 的 GOAL 上原样复发。**这是本任务的核心风险点，必须在 AC
里用一个真实带 `retired` 状态记录的场景去验证，不能只测 `superseded`。**

## Plan

把分母从"该 goal 下所有挂钩记录数"改为"有效 AC 数"。**倾向性建议**：有效状态 = `active` ∪ `achieved`
（即只统计"仍在被追踪、需要被满足，或已经被满足"的记录），显式排除 `superseded`/`retired`（已退场终态）。

**需要实现者在动手前核实、并在任务体/commit 里写清楚结论的两个问题**（不要想当然假设）：

1. `draft` 状态的 AC 记录，是否在实际数据/store 语义上可能出现在某个 `active` GOAL 的 `goal` 字段关联
   下（即一条 draft 的 AC 提案已经写了 `goal: GOAL-NNN` 但尚未被激活）？若可能，是否也应排除出分母
   （倾向性判断：应排除，因为"未裁定的提案"不算"进行中需要被判定"的有效 AC，但请实现者核实 goal-store
   的实际写入路径后确认）。
2. `needs-human` 这个状态实际主要用在 GOAL 层级的人工裁定请求上，还是也可能出现在单条 AC criterion
   记录上？若后者可能，是否计入分母（倾向性判断：计入——一条 needs-human 的 AC 仍然是"待处理、未退场"
   的，应该像 active 一样被算作"待达成"计入分母但不计入分子）。

实现落点局限在 `renderGoalCard` 内部（分母计算 + `acBar` 百分比计算两处需同步改，不留一处新口径、一处
旧口径的不一致）。

## AC

- [ ] 构造一个测试 fixture：一个 GOAL 下挂钩 N 条记录，覆盖 `active`/`achieved`/`superseded`/`retired`
      四种状态各至少一条，验证新的分母只统计"有效"状态（按实现者最终确定的集合），`superseded`/`retired`
      的记录**都**不计入分母——⛔ 不能只测 `superseded` 漏测 `retired`（这是本任务最容易复发的坑，见上文）。
- [ ] 负控制：一个 GOAL 下所有挂钩记录都是 `active`/`achieved`（没有任何 `superseded`/`retired`）的
      场景，新逻辑与旧逻辑（`acs.length` 作为分母）结果完全一致——证明这不是引入了另一种偏差，只是排除
      了已退场状态。
- [ ] 复算 GOAL-020 的真实数据（此刻）：验证卡片对 GOAL-020 显示的分母是 7（不是 10），分子是 6
      （AC-265/269/270/271/272/273 achieved），即「AC 达成 6/7」。这是本任务修复效果的直接、真实印证，
      不是构造的 fixture。
- [ ] 进度条 `acBar` 的百分比计算（`(achieved / acs.length) * 100`）同步改用新分母，不要留一处用旧
      分母、一处用新分母的不一致。
- [ ] 若仓库里已有依赖当前 `achieved/acs.length` 语义（旧口径）的既有测试断言，找出并相应更新（先跑
      一次现有测试确认哪些会因本次改动而红，不要假设没有）。
- [ ] `bash scripts/test.sh --for-task gap-dashboard-goal-card-ac-denominator-includes-superseded-retired` 退出码 0。

## DoD

验收对象是「dashboard 卡片上『AC 达成 X/Y』这个数字，Y 不再包含任何已退场（superseded/retired，以及
实现者核实后可能追加的其他非追踪态）的 AC 记录」——用 GOAL-020 的真实生产数据复算验证（6/7 而非 6/10），
不是「加了一个 filter 条件」就算完成。

## Touches

- packages/quay/src/serve-dashboard.ts
- packages/quay/test/gap-dashboard-goal-card-provider-backed.test.mjs
- tasks/gap-dashboard-goal-card-ac-denominator-includes-superseded-retired.md
