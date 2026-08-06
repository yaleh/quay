---
id: gap-web-action-buttons-unused-route-and-open-redirect-delete
title: "delete web action buttons (/task/<id>/action/<actionId> POST + two
  form renders in serve-handlers.ts + corresponding tests) — human directive
  (docs/proposals/quay-web-human-is-not-an-operator.md): evidence: .quay/
  gate-events.jsonl 365 events ALL actor quay-cli, web 0 (the route has ZERO
  web consumers); the route carries a confirmed open-redirect fix comment
  (serve-handlers.ts:1068/M26 ADV-003) — an UNUSED feature contributed a real
  vulnerability; KEEP: CLI quay action run (source of the 365 events, alive),
  read-only displays, the actions concept itself; NEGATIVE CONTROL: after
  deletion the gate-events actor distribution must be UNCHANGED — if it
  changes, the route actually had consumers and the deletion was wrong;
  order: human decided this BEFORE the message-bus channel (① then ②)"
status: ready
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

**删除 web action buttons——人指示（先删再建消息总线）。**

**【证据（外层核实）】**：`.quay/gate-events.jsonl` **365 条事件 actor 全是 `quay-cli`，web 0 条**——web
action buttons 没有任何消费者。该路由带**已确认 open-redirect 修复注释**（serve-handlers.ts:1068 /
M26 ADV-003：`POST .../action/<id>'s baseRedirect had only...`）——**未被使用的功能贡献了真实漏洞**。

**【范围（精确）】**：
- **删**：`/task/<id>/action/<actionId>` POST 路由 + serve-handlers.ts 两处 form 渲染 + 相应测试
- **不删**：CLI 的 `quay action run`（365 条事件的来源，是活的）、只读展示、actions 概念本身

**【负控制（人建议，写进 AC）】**：删完后 `.quay/gate-events.jsonl` 的 actor 分布不应有任何变化——变了说明
它其实有消费者、删错了。

### 选定机制

1. 删 POST 路由 + 两处 form 渲染 + 相应测试
2. CLI action run 不动
3. 负控制：actor 分布不变

## Acceptance Criteria

- [ ] AC1: `/task/<id>/action/<actionId>` POST 路由删除（grep 无残留）
- [ ] AC2: serve-handlers.ts 两处 form 渲染删除（grep 无残留）
- [ ] AC3: 相应测试更新/删除；CLI `quay action run` 原样保留（grep 确认）
- [ ] AC4: **负控制**——删后 `.quay/gate-events.jsonl` actor 分布不变（365 全 quay-cli，web 0）
- [ ] AC5: 只读展示与 actions 概念保留（不误删）
- [ ] AC6: open-redirect 漏洞面消除（该路由删除后无此攻击面）

## Touches
- tasks/gap-web-action-buttons-unused-route-and-open-redirect-delete.md（自身文件：勾 AC + 贴 invoke 证据授权）


- packages/quay/src/serve-handlers.ts（删 POST 路由 + 两处 form）
- packages/quay/test/（对应测试）
- docs/proposals/quay-web-human-is-not-an-operator.md（提案引用）

## Contract

measure   route_gone = `grep -c 'action/\${encodeURIComponent\|action/.*actionId' packages/quay/src/serve-handlers.ts` stdout 数字段
band      route_gone = 0（路由删除）
invoke    `grep -n 'action/' packages/quay/src/serve-handlers.ts`
control   删后 gate-events actor 分布不变（AC4 负控制）
resume    路由与测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-06T00:3xZ
changed: 人指示立案（先删 action buttons 再建消息总线）。证据核实（365 全 CLI + open-redirect 漏洞）。
范围精确（不删 CLI/只读/概念）+ 负控制 AC。

## Dispatch review（追加 2026-08-06T02:5xZ，管理者撤回一句补充证据）

- **撤回留痕**：管理者上一轮口头补充「抽查前 30 个任务详情页，没有一个渲染出 action 按钮」——
  经人指出核实为**抽样方法有偏**（`ls tasks/*.md | head -30` 按字母序取，ARCH-* 排在 DIR-* 前，
  系统性漏掉唯一配了 action 的 DIR-* 类），**撤回**。此句未写入本任务文件（仅口头补充），无需修正。
- **核心证据独立复核仍成立**：`.quay/gate-events.jsonl` 365 条 actor 全 `quay-cli`、web 0 条
  （外层独立重跑验证）。**新事实**（管理者核实）：全量列表页 25 个任务配了 action（全 DIR-* 前缀，
  动作 advance）——与核心结论一致：**按钮有配置、但从未被真点过产生状态变更**。任务范围不受撤回影响。
