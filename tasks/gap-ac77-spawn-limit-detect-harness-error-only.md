---
id: gap-ac77-spawn-limit-detect-harness-error-only
title: AC77 spawn 触顶只检测 harness 报错，不自建计数（人 07:4xZ 裁定）
status: todo
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**AC77（spawn 触顶只检测 harness 报错，不自建计数 —— 人 2026-08-14 07:4xZ 逐字「agentLimit 的处理仅应包括检测 harness 的报错（报错后的处理暂定由人执行），而不要自己重复计数」）**。

**现状**：`inner-wakeup-heartbeat-check.ts:347/:353` 判据是 `blocked==[] && agentDispatches >= heartbeat.agentLimit`，**而心跳现读 `agentLimit = undefined`（`agentDispatches=15`）⇒ 该判据结构上恒假，从不报。**

**⚠️ 修法不是补写 `agentLimit`**——那正是人禁止的「自己重复计数」，也是 4b：**用我们自己维护的计数去判一个由 harness 掌握的预算**（量由被测对象自产，停摆时跟着停，与「一切正常」同形）。

**⇒ 改为检测 harness 自己的报错串**：`CLAUDE.md:21` 已记识别法逐字——**目标会话 transcript 里搜 `Subagent spawn limit reached`**。

**判据**：
- **判据1**：检测到 harness 报错串（`Subagent spawn limit reached`）即报（进 tick-log 升级列）。
- **判据2**：`agentDispatches >= agentLimit` **按 AC58 退役即迁出**（留着 = 恒假判据，与「一切正常」同形，硬规则 4）。
- **判据3（只报不动）**：人「报错后的处理暂定由人执行」⇒ 明确不自动 `/clear`、不自动降 cap、不自动重启。
- **判据4（3b）**：无真样本时**记为未验证而非勾**（当前 agentLimit=undefined 恒假是现成红样本）。

**不覆盖**：不估上限数值（正本在 `tasks/gap-inner-subagent-budget-invisible.md`，随版本变）。

**与 AC76 是两个不同资源，不合并**：`AC76 = 并发 subagent（cap 管）`；`AC77 = 会话累计 spawn（harness 管，触顶后静默降级为主线程串行）`。**后者触顶的表现与「inner 主线程在跑 fan-in」现象上一模一样**——CLAUDE.md:21 逐字记着上次代价：「三层 + 人共花数小时反复误诊为『outer 不派发』『inner 自锁』『唤醒链断』，全错」。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 inner-wakeup-heartbeat-check.ts:340-360（agentLimit 判据）+ CLAUDE.md:21（识别法）+ tasks/gap-inner-subagent-budget-invisible.md（正本）。
2. 判据1：改检 harness 报错串（`Subagent spawn limit reached`）。
3. 判据2：`agentDispatches >= agentLimit` 退役迁出（AC58 形态，落点映射）。
4. 判据3：只报不动（不 /clear、不降 cap、不重启）。
5. 判据4：无真样本记未验证（当前恒假是红样本）。
6. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：检测 harness 报错串（`Subagent spawn limit reached`）即报。
- [ ] AC2 判据2：`agentDispatches >= agentLimit` 退役迁出（恒假判据与一切正常同形）。
- [ ] AC3 判据3：只报不动（不 /clear、不降 cap、不重启——处理归人）。
- [ ] AC4 判据4：无真样本记未验证非勾（3b；当前恒假是红样本）。
- [ ] AC5 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] spawn 触顶检测改为 harness 报错串 + 自建计数退役 + 只报不动 + 无样本记未验证。

## Touches

- plugin/scripts/inner-wakeup-heartbeat-check.ts（判据改 harness 报错串 + agentLimit 判据退役）
- orchestration/archive/（agentLimit 判据退役落点——AC58 形态，落点映射）
- plugin/test/inner-wakeup-heartbeat-check.test.mjs（负控制 fixture + 真样本回放）
- tasks/gap-ac77-spawn-limit-detect-harness-error-only.md（自身）

## Evidence

（落地后回填）
