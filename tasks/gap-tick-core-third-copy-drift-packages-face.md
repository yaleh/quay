---
id: gap-tick-core-third-copy-drift-packages-face
title: tick-core 第三份副本（packages/quay/plugin/loop，npm 打包面）漂移 + 检查器覆盖缺口
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：manager 投立案（硬规则 5b：修好一处≠修好全部）。B9 退役标注时发现 tick-core 有**三份**副本：`orchestration/`（源）、`plugin/loop/`（laid-down）、`packages/quay/plugin/loop/`（npm 打包面）。`tick-core-static-check` 的 drift pair 只配 `orchestration→plugin/loop` 两份，**第三份结构性看不见**。

**证据（实测）**：`packages/quay/plugin/loop/` 四份全漂（orchestrator-tick-core / fast-mode-tick-core / manager-tick-core / manager-loop-tick 均 `cmp` 不一致）——其中 orchestrator-tick-core 的 B9 第三触发器还是**未退役的旧文本**（写「manager 22:0x outer 补 → 跑 ready-pool-check --apply」），与源/plugin-loop 两份都漂。

**代价（manager 2026-08-23 第二实例，⛔ 同一「第三份」形态）**：判准④ 正本 2026-08-16 把读数从 `halt:` 改 `project.status` 并明文「⛔ 不要找 halt: 字段」，同日 `.claude/workflows/manager-tick-core.js` 内嵌清单也改了（其更正注释自嘲「同一文件、同一错误、第二次」），但漏了**第三处** `orchestration/manager-tick-core.md:48` 仍教 `halt:` ⇒ manager 复发 9 次、readings agent 读漂指针连续报 `notEvaluated`。**后果不只是「两份文件不一致」**：新鲜上下文 agent 读到漂指针后【把已退役做法当正本执行】⇒ 稳定产出错误读数、且伪装成 `notEvaluated` 这种看起来合规的形态——比「不整齐」严重得多。

## Plan

1. 同步 `packages/quay/plugin/loop/` 四份 tick-core 与 `orchestration/` 源（或与 `plugin/loop/` 保持一致）。
2. 扩 `tick-core-static-check` 的 drift pair 覆盖第三份（⛔ 否则下次又结构性看不见）。

## Acceptance Criteria

- [ ] AC1：`packages/quay/plugin/loop/` 四份 tick-core 与源一致（`cmp` 逐字节，⛔ 漂移 ⇒ 假）。
- [ ] AC2：`tick-core-static-check` 把第三份纳入 drift pair（⛔ 只配两份、第三份看不见 ⇒ 假）。

## Definition of Done

- [ ] 四份 packages/quay/plugin/loop/ 副本同步到与源 cmp 逐字节一致 + tick-core-static-check 扩第三份覆盖；AC1-2 全勾；land 到 develop。

## Retires

- 无（补检查覆盖 + 同步）

## Touches

- packages/quay/plugin/loop/orchestrator-tick-core.md（同步）
- packages/quay/plugin/loop/fast-mode-tick-core.md（同步）
- packages/quay/plugin/loop/manager-tick-core.md（同步）
- packages/quay/plugin/loop/manager-loop-tick.md（同步）
- plugin/scripts/tick-core-static-check.ts（drift pair 扩第三份）
- tasks/gap-tick-core-third-copy-drift-packages-face.md（自身）
