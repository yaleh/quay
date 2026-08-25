---
id: gap-b0-retirement-precondition-checker-call-surface
title: B0·退役前置检查——枚举 outer 执行核引用的全部 checker，逐个确认留存调用面或显式退役（防孤儿静默产生，唯一有时限批次）
status: ready
labels:
  - gap
  - feature
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

outer 将随 inner 退役、cron/loop 换外部触发的短会话 ⇒ 会从下面抽走一部分 checker 的调用面。SPEC（`orchestration/SPEC-methodology-layer-architecture-2026-08-25.md` §2.3b）实测归属：109 个 checker 里 static-gate 注册表 45、outer 执行核 12、manager 6、driver 4、workflows 6、其它载体 54、只剩 .md 提及 6 + 零引用 1（真死代码仅 7）。**outer 引用的 12 个逐个核实后：7 个同时在注册表（安全）、4 个有留存调用面（test-framework-policy/drive-contract/monitor-mount/drive-target）、只有 1 个真正绑死退役层——`outer-anchor-check.ts`（仅 outer-cron-registry.ts 引用，同属退役层）。**

⇒ 风险面比预期小（仅 1 个需处置），**但必须写成退役的【前置检查】而非事后清理**：没有这个前置，孤儿是静默产生的。判据形如「退役 outer 前，枚举其执行核引用的全部 checker，逐个确认存在留存调用面或显式退役」。

## Plan

写一个退役前置检查器（或脚本）：读 `orchestration/orchestrator-tick-core.md` 的执行核，枚举其引用的全部 checker/脚本；对每个，判定其是否在 static-gate 注册表或有其它留存调用面；只被退役层引用的 ⇒ 报「缺留存调用面」。当前唯一命中 = `outer-anchor-check.ts`，处置它（随 outer-cron-registry 一起退役，或迁移调用面）。⛔ manager 侧 6 个 checker 的迁移不在本任务（manager 退役形态未定，§3.7）。

## Acceptance Criteria

- [ ] AC1（能取假，前置检查存在）：存在一个退役前置检查器，枚举 outer 执行核引用的全部 checker 并逐个判定留存调用面（grep 到该检查器的调用/注册）；（⛔ 无前置检查 ⇒ 假）。
- [ ] AC2（能取假，负控制）：造一个只被退役层引用的 checker，前置检查必须红（fail-closed）；（⛔ 不红 ⇒ 假）。
- [ ] AC3（能取假，留存调用面清零）：无留存调用面的 checker 数 N→0（当前 N=1：`outer-anchor-check.ts`）——该文件或随退役层显式退役、或迁移调用面；（⛔ 仍有 N>0 ⇒ 假）。

## Definition of Done

退役前置检查器落地 + 注册；AC1/AC2/AC3 全勾；`outer-anchor-check.ts` 处置（显式退役或迁移）；前置检查在 outer 退役时作为必须步骤。

## Touches

- plugin/scripts/（退役前置检查器，读 tick-core 枚举 + 判定留存调用面）
- orchestration/orchestrator-tick-core.md（退役步骤引用该前置）
- plugin/scripts/outer-anchor-check.ts（显式退役或迁移，与 outer-cron-registry.ts 一起）
- tasks/gap-b0-retirement-precondition-checker-call-surface.md（自身）
