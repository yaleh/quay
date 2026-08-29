---
id: gap-ac149-session-retirement-no-dual-source-no-throughput-collapse
title: AC149 会话真正退役 + 不留双真相源 + 产能不塌（AC149-1 真停 / -2 产能 / -3 无双真相源）
status: ready
labels:
  - gap
  - feature
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac143-observability-ledger-closing-driver
  - gap-ac148-inner-core-itemized-attribution
---
**type:** execution

## Proposal

outer / inner 会话真正退役，三条子判据缺一不可：
- **AC149-1（真停）**：outer/inner 会话停止；其 cron 锚、tick-log、执行核文档按 AC135/AC141/B9 的同一套写法标退役（删除线 + 指针 + 边界条件）。⛔ 取假：会话停了而文档仍写「每轮必跑」（本会话 09:0xZ 刚修掉的 B9 漂移形态）。
- **AC149-2（产能不塌）**：停会话后连续 ≥24h 任务持续 land（develop 有新 fan-in 合并提交），速率不低于停机前同长度窗口的 X%（X 落笔方定，⛔ 不设未测量过的阈值——硬规则④推论一）。取假：land 速率归零/断崖 ⇒ 回滚。
- **AC149-3（无双真相源）**：停机后不存在「两个执行者做同一件事」的路径。取假：任一职责同时有 driver 路径与人工/会话路径且都在用 ⇒ 假。

交叉引用：`gap-b0-retirement-precondition-checker-call-surface`（退役前置）是 AC149-1 的子条件，正本是该任务体，本任务不复制其内容。

## Plan

按 AC149-1/2/3 执行：先标退役（cron/tick-log/文档）、再测产能（≥24h land 速率）、再查双真相源。⛔ 一次性退役十几条会批量制造 B9 漂移（09:0xZ 刚修），逐条核死。三个机制脚本按以下命名落地（⛔ 不另取名）：`plugin/scripts/session-retirement-check.ts`（退役语义断言）、`plugin/scripts/land-capacity-monitor.ts`（≥24h land 速率监测）、`plugin/scripts/dual-source-check.ts`（双真相源判定），各配测试 `plugin/test/<同名>.test.mjs`。

## Acceptance Criteria

- [ ] AC1（能取假，真停）：outer/inner 会话停，cron 锚/tick-log/执行核文档按同一套写法标退役；（⛔ 文档仍写「每轮必跑」⇒ 假）。（待外部）
- [ ] AC2（能取假，产能不塌）：停会话后连续 ≥24h 任务持续 land，速率 ≥ 停机前 X%；（⛔ land 归零/断崖 ⇒ 假，回滚）。（待外部）
- [ ] AC3（能取假，无双真相源）：无「两个执行者做同一件事」的路径（任一职责只有 driver 或会话单一执行者）；（⛔ 双路径都在用 ⇒ 假）。（待外部）

## Definition of Done

AC149-1/2/3 全勾；outer/inner 真退役、产能不塌、无双真相源；B0 退役前置已作为前置检查执行。

## Touches

- orchestration/manager-tick-core.md（执行核文档标退役）
- orchestration/orchestrator-tick-core.md（执行核文档标退役）
- plugin/loop/orchestrator-tick-core.md（byte-identical 副本，随正本同步——AC90 drift 闸强制）
- orchestration/fast-mode-tick-core.md（执行核文档标退役）
- orchestration/manager-loop-tick.md（tick-log 标退役）
- orchestration/manager-tick-criteria.md（tick 判准标退役）
- orchestration/manager-tick-sending.md（发送形态标退役）
- orchestration/manager-tick-closing.md（收尾形态标退役）
- plugin/scripts/session-retirement-check.ts (new)（会话退役语义断言）
- plugin/scripts/land-capacity-monitor.ts (new)（≥24h land 速率产能监测）
- plugin/scripts/dual-source-check.ts (new)（双真相源判定）
- plugin/test/session-retirement-check.test.mjs (new)
- plugin/test/land-capacity-monitor.test.mjs (new)
- plugin/test/dual-source-check.test.mjs (new)
- plugin/scripts/capability-catalog.sh（三脚本六表登记：QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING/CONSUMER）
- docs/proposals/quay-product-outline.md（§6 DELIVERY-INVENTORY scripts 计数 296→299，结构性 co-touch）
- tasks/gap-ac149-session-retirement-no-dual-source-no-throughput-collapse.md（自身）

## Needs-Human

**执行 2026-08-28T19:48:23.581Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
