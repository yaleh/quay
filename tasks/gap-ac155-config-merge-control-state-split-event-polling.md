---
id: gap-ac155-config-merge-control-state-split-event-polling
title: AC155 配置合并 + 控制态分界 + 事件触发保留兜底轮询
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-worker-driver-no-record-on-abnormal-death
  - gap-ac141-execution-face-inner-manual-retirement
  - gap-direct-to-develop-check-reflog-to-revlist
  - gap-git-history-branch-summary-wrong-numbers
  - gap-launch-script-worker-cap-broken
---

**type:** execution

## Proposal

**来源**：manager 2026-08-23 架构裁定（判据正本 `orchestration/manager-phase-goal.md` `### AC155`，⛔ 不在此复制；设计正本 `orchestration/SPEC-unified-driver-architecture-2026-08-23.md` §2.6 + §2.2）。

**缺口（实测）**：配置散在六处，且并发解析有三份「单一真相源」：
```
_launchSpec.roles（LLM）· 8 张 bash registry 表（kind）· CLI flags · env（QUAY_MAX_TASK_SUBAGENTS）·
.quay/worker-control.json（运行时）· 硬编码字面量（CAP_DEFAULT=5 / INTERVAL_MS_DEFAULT / ROUND_TIMEOUT_MS）
并发解析三份：CAP_DEFAULT=5 / resolveConcurrency / cap-from-gate.ts FIXED_EFFECTIVE_CAP=5（后者注释自称「single source is QUAY_MAX_TASK_SUBAGENTS」）
```
**⛔ 合并时的硬分界**：声明式配置（git 版本化·人写·重启生效）⟷ 运行时控制态（gitignored·机器写·热变，`.quay/worker-control.json`）——控制态**保持独立**，⛔ 不并入配置文件（机器改人的源文件 = CLAUDE.md 11b 同族）。

**事件触发补充约束（§2.2）**：事件是「提前唤醒」⛔ 不是「替代轮询」——必须保留兜底轮询周期，否则事件源一挂 driver 静默停摆（`cmd_liveness` 零调用者的现成反例）。

**⊢ 排期注记**：本任务属下一阶段（架构地基），⛔ 现在只立案不派发——`depends_on` 即 SPEC §0 的排期锁（AC142 系列收口），不是输出依赖。

## Plan

1. 五处声明式配置（roles/registry/CLI/env/字面量）合并到声明式配置一侧。
2. `.quay/worker-control.json` 保持独立（⛔ 不并进配置文件）。
3. 事件触发接线（`slot-free-trigger`/`suite-state-trigger` 消费者改接 driver 环）+ 兜底轮询保留。

## Acceptance Criteria

判据正本在 `orchestration/manager-phase-goal.md` `### AC155`（⛔ 取假形态不在此复制）。

- [ ] AC1：五处声明式配置合并，仍存两份以上并发解析 ⇒ 假。
- [ ] AC2：控制态（worker-control.json）不并进 git 版本化配置文件。
- [ ] AC3：事件源不可用时 driver 不静默停摆（兜底轮询仍在）；取假见正本 AC155。

## Definition of Done

- [ ] 配置合并 + 控制态独立 + 事件接线兜底轮询落地；AC1-3 全勾；land 到 develop。

## Retires

- 无

## Touches

- plugin/scripts/drivers.yml（新：声明式配置 kind/filters/profile/cap，落笔方可并 .quay/config.yml）
- plugin/scripts/promotion-driver-launch.sh（8 张 registry 表 → 声明式配置）
- plugin/scripts/worker-driver.ts（CAP_DEFAULT/resolveConcurrency → 声明式配置）
- plugin/scripts/cap-from-gate.ts（FIXED_EFFECTIVE_CAP 第三份并发解析消除）
- plugin/scripts/slot-free-trigger.ts（事件消费者改接 driver 环）
- plugin/scripts/suite-state-trigger.ts（事件消费者改接 driver 环）
- plugin/test/cap-from-gate-config-budget.test.mjs（test）
- plugin/test/worker-driver.test.mjs（test）
- tasks/gap-ac155-config-merge-control-state-split-event-polling.md（自身）
