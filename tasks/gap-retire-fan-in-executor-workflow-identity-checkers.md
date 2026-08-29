---
id: gap-retire-fan-in-executor-workflow-identity-checkers
title: 退休 fan-in 执行者/工作流身份检查器（fan-in-ff-executor-check +
  fan-in-workflow-check）——机械 fan-in 模式下「执行者=subagent / 必经 workflow」前提已死，检查链已由
  runMechanicalFanIn + ff capture 闸结构性保证
status: todo
labels:
  - gap
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

机械 fan-in（`worker-driver.ts` `runMechanicalFanIn`）已是 fan-in 的 happy path（workflow 降为语义兜底，ADR-034 / gap-fan-in-driver-mechanical-orchestration）。它把检查链结构性内联成单一 fail-closed 序列（merge develop → anti-drift → delta 判定 → typecheck → scoped 门+doc → suite 写 capture → anti-drift 重跑+AC 闸+flip → ff），且 `fan-in-ff-merge.sh` 的 suite-capture 闸（缺证书 / 非绿 / suite_head 非待 ff tip 祖先 ⇒ exit 2 拒 ff）与 flock 让「未经检查链落地」在机制上**与执行者是谁无关地不可能**。

但两个 checker 仍执行一个已死的前提——「fan-in 执行者必须是任务 subagent / 必经 fan-in-execute workflow」：

1. `fan-in-ff-executor-check.ts`（AC67）判「执行者=subagent（agentId 非空且 ≠ 主会话）」。机械 fan-in 由 driver 进程执行、lock-events 记 `agentId:null` ⇒ 被 `checkAgentId` 判 `main-thread-executor-record`。其 2 条测试（`fan-in-ff-executor-check.test.mjs` 的 agentId-retry 与 AC75 --a6-file）未传 `--lock-events`、落到真实 `.quay/fan-in-merge-lock-events.jsonl` 的 null-agentId 记录 ⇒ 恒红 ⇒ 全量 suite 全局红 ⇒ 12 小时 86 次派发 60 次卡 suite 步、无一落地（本次 driver 停摆直接根因）。

2. `fan-in-workflow-check.ts`（AC78）判「必经 workflow」。机械 fan-in 不走 workflow ⇒ 靠 `isMechanicalRunId`（runId 前缀嗅探 `wk-prod-*`/`oneoff-*`）豁免才绿——前缀嗅探已在 whack-a-mole（oneoff-adr034 → oneoff-ls → oneoff-*）。

两个 checker 的失效前提（capability-catalog.sh 已写）都已触发：协议从「subagent 经 workflow」改为「driver 机械」，执行者身份不再携带正确性信息。正确处置是退休，不是补「机械执行者识别」。

## Plan

1. 删 `plugin/scripts/fan-in-ff-executor-check.ts` + `plugin/test/fan-in-ff-executor-check.test.mjs`（按需、zero callers，无接线）。
2. 删 `plugin/scripts/fan-in-workflow-check.ts`（含 `isMechanicalRunId`，grep 确认无外部 import）+ `plugin/test/fan-in-workflow-check.test.mjs`。
3. `plugin/scripts/runner-static-gate.ts` 摘线：删 `fan-in-workflow-check` 的 run_checker 行 + 对应 echo + @static-object 注释。
4. `plugin/scripts/capability-catalog.sh` 标两 checker 失效前提已触发、退休（或删条目）。

保留（对象仍在、actor 无关）：`fan-in-ff-protocol-check`、`direct-to-develop-bypass-check`（ledger 已接）、`per-task-suite-record-check`、`suite-slot-ssot-check`、以及已内联进 runMechanicalFanIn 的 anti-drift/typecheck/ac-gate/ff-merge。

## Acceptance Criteria

- [ ] AC1（能取假，ff-executor-check 退休）：`plugin/scripts/fan-in-ff-executor-check.ts` 与 `plugin/test/fan-in-ff-executor-check.test.mjs` 均不存在；`grep -rn 'fan-in-ff-executor-check' plugin/scripts/` 除 capability-catalog 的历史标注外无活引用（⛔ 文件仍在 / 有活 import ⇒ 假）。
- [ ] AC2（能取假，workflow-check 退休 + 摘线）：`plugin/scripts/fan-in-workflow-check.ts`（含 isMechanicalRunId）与 `plugin/test/fan-in-workflow-check.test.mjs` 均不存在；`grep -n 'fan-in-workflow-check' plugin/scripts/runner-static-gate.ts` 无命中（⛔ 文件仍在 / static-gate 仍引用已删 checker ⇒ 假）。
- [ ] AC3（能取假，suite 红解除）：全量 suite 绿——原先 `fan-in-ff-executor-check.test.mjs` 两条恒红测试随文件删除而消失（⛔ suite 仍红于这两条 ⇒ 假）。
- [ ] AC4（能取假，catalog 同步）：`capability-catalog.sh` 不再把两 checker 列为 active（失效前提已触发 → 退休标注或删条目）（⛔ catalog 仍列 active ⇒ 假）。

## Definition of Done

两个前提已死的执行者/工作流身份 checker 及各自测试、`isMechanicalRunId` 化石一并删除；`runner-static-gate.ts` 完成摘线；`capability-catalog.sh` 标注退休；全量 suite 绿（原两条状态依赖恒红测试消失）。落地即验证本次 driver 停摆的直接根因解除。

## Touches

- plugin/scripts/fan-in-ff-executor-check.ts（删）
- plugin/test/fan-in-ff-executor-check.test.mjs（删）
- plugin/scripts/fan-in-workflow-check.ts（删，含 isMechanicalRunId）
- plugin/test/fan-in-workflow-check.test.mjs（删）
- plugin/scripts/runner-static-gate.ts（摘线 fan-in-workflow-check）
- plugin/scripts/capability-catalog.sh（退休标注 + SUPERSEDED 表）
- plugin/scripts/checker-mutation-cases/fan-in-workflow-check.sh（删，孤儿 mutation case——checker 已退休）
- docs/proposals/quay-product-outline.md（DELIVERY-INVENTORY 快照刷新 scripts 296→294）
- tasks/gap-retire-fan-in-executor-workflow-identity-checkers.md（自身）
