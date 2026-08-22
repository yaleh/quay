---
id: gap-ac129-driver-resident-autonomous-selection
title: AC129 驱动常驻 + 自主选任务（选择环 + selector worker + 判停）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac116-spec-phase2-concurrency-stash
---

**type:** execution

## Proposal

**来源**：manager 投立案（判据正本在 `orchestration/manager-phase-goal.md` `### AC129`，提交 c5ac1235，⛔ 不在此复制，读那一段）。

**缺口性质（判据覆盖缺口，非实现质量）**：SPEC §3.1「组件」列了驱动 7 项（选择环 / selector worker / 记录 / task worker / 并发控制 / 超时 / MCP 面），而 §5 三阶段判据只覆盖后 5 项——「选择环」「selector worker」「驱动常驻」字面缺席。

**证据（能取假）**：`plugin/scripts/worker-driver.ts:171` 逐字 `"no --task given (phase 1 does not yet run the selector worker; pass --task <id>)"`；全文件无 `while` / `setInterval` / `ready-pool-check` 调用（grep 确证）；`selectorReason`（:174）恒为 `"explicit --task selection"`。⇒ 现状是「单次 spawn 脚本」，不是常驻驱动。

**不补的后果**：AC115∧116∧117 全 done 后「谁决定现在跑哪个任务」仍是 inner 的 LLM tick 会话 ⇒ SPEC §2 两条核心收益（①消掉「空槽+池里有货+就是不派」②义务随【任务长度】而非【会话长度】衰减）结构上不成立——决策层没换掉。

**非目标（⛔）**：不重新设计 selector 的语义策略——SPEC §1 设计点1 已裁定「选择仍应是语义的」（selector worker 是 LLM）；本条只要求这条链被接上且能取假，不规定怎么排序候选。

## Plan

1. 驱动加常驻循环：跑完一个 worker 不退出，池非空且未达并发 cap 时自动起下一个。
2. 无 `--task` 时走选择环：调 `ready-pool-check` 取可行集 → 减内存中的在飞集 → 打散 → 交短命 selector worker，`selector_reason` 落真实理由。
3. 判停：`.halt` 存在 / `resource-gate` 报 WAIT / 池空 ⇒ 停止起新 worker，⛔ 不杀在飞。

## Acceptance Criteria

- [x] AC1（常驻）：跑完一个 worker 后不退出，池非空且未达并发 cap 时自动起下一个（现状单次 spawn 后必退出，取假）。
- [x] AC2（自主选任务）：不传 `--task` ⇒ 走选择环（调 `ready-pool-check` 取可行集 → 减在飞集 → 打散 → 交 selector worker）并起 worker，`selector_reason` 落真实理由（不再恒为 `"explicit --task selection"`）。
- [x] AC3（判停，能取假）：`.halt` 存在 / `resource-gate` 报 WAIT / 池空 ⇒ 停止起新 worker，⛔ 不杀在飞；置 `.halt` 后仍起新 worker ⇒ 本条为假。

## Definition of Done

- [x] 常驻循环 + 选择环 + 判停落地；AC1-3 全勾（含置 `.halt` 判停取假）；land 到 develop。

## Retires

- 无（本任务新增机制，不退役既有机件）

## Touches

- plugin/scripts/worker-driver.ts（常驻循环 + 选择环 + 判停）
- plugin/test/worker-driver.test.mjs（AC1-3 单测，含置 `.halt` 判停取假）
- tasks/gap-ac129-driver-resident-autonomous-selection.md（自身）

> **注意**：AC117 land 后，AC129-3 判停判据中 `.halt` 应同步切换为 MCP halt（⛔ 不得两者并存，与 AC117 退役清单一致）。此为落地时序注意，非 `depends_on` 硬前置（AC129 仅 depends_on AC116）。
