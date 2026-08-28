---
id: gap-ac151-two-level-driver-layer-landing
title: AC151 两级分层落地（Layer 0 driver-runtime + Layer 1a/1b，⛔ 非 kernel+N 平级 plugin）
status: done
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

**来源**：manager 2026-08-23 架构裁定（判据正本 `orchestration/manager-phase-goal.md` `### AC151`，⛔ 不在此复制；设计正本 `orchestration/SPEC-unified-driver-architecture-2026-08-23.md` §2.1）。

**⊢ 为什么是本阶段的阶段 0**：AC143 要加 manager-kind，而它与 promotion/worker 结构不同（无任务池、无选择、无「spawn 执行者再复核其自述」）。分层未做就加它 ⇒ 要么空段要么另起一套。故分层必须先于 AC143。

**分层结构（判据在 phase-goal，⛔ 不在此复制图）**：Layer 0（driver-runtime：supervisor/loop/trigger/stopCondition/heartbeat/controlPlane/notify/profile/ResultVocab）三种 driver 共享；Layer 1a（task-processing：source/filters/select/act/verify）promotion/worker 继承；Layer 1b（routine：routines/schedule/collect/report）manager-kind 继承。

**⊢ 排期注记**：本任务属下一阶段（架构地基），⛔ 现在只立案不派发——`depends_on` 即 SPEC §0 的排期锁（AC142 系列收口），不是输出依赖。manager 建议顺序：AC152+AC153 先 → 再 AC151。⛔ AC151/AC152/AC153 三者都动 kernel/filter 同一片区域，**不并发**，按 AC152→AC153→AC151 单条推进（Touches 互斥过滤落地前靠此注记防互撞）。

## Plan

1. Layer 0 driver-runtime 落地（主循环骨架 reap/派发/判停、round 心跳、控制面、事件订阅、出站通知、profile 解析、ResultVocab）。
2. supervisor（respawn/pid 记账/8 张 registry 表）从 `promotion-driver-launch.sh` 港进 TS kernel（⛔ 人已裁定非可选、非迁移期并存）；`packages/quay/src/cli/driver.ts` 由 `spawnSync` 薄壳变真正实现入口。
3. promotion/worker 改继承 Layer 0 + 1a（⛔ 不各写一遍循环/心跳/判停）。

## Acceptance Criteria

判据正本在 `orchestration/manager-phase-goal.md` `### AC151`（⛔ 取假形态不在此复制）。

- [x] AC1：存在 Layer 0 与 Layer 1a/1b 两级；promotion/worker 继承 0+1a，manager-kind 继承 0+1b；取假见正本 AC151（manager-kind 出现空候选池/选择/verify 三段，或 1b 重实现 Layer 0 循环/心跳/判停 ⇒ 假）。

## Definition of Done

- [x] Layer 0 + 1a/1b 两级落地 + supervisor 港进 TS + 两 driver 改继承；AC1 全勾；land 到 develop。

## Retires

- 无

## Touches

- plugin/scripts/driver-runtime.ts（新：Layer 0 kernel）
- plugin/scripts/promotion-driver.ts（改继承 Layer 0 + 1a）
- plugin/scripts/worker-driver.ts（改继承 Layer 0 + 1a）
- plugin/scripts/promotion-driver-launch.sh（supervisor/respawn/pid 记账港进 TS kernel；删除）
- plugin/scripts/capability-catalog.sh（六表注册 driver-runtime.ts、退役 promotion-driver-launch.sh）
- docs/proposals/quay-product-outline.md（新脚本注册授权：DELIVERY-INVENTORY 计数 driver-runtime.ts +1 / promotion-driver-launch.sh -1 净零，快照无需改）
- packages/quay/src/cli/driver.ts（spawnSync 薄壳变真正实现入口）
- plugin/test/driver-runtime.test.mjs（新 test）
- plugin/test/worker-driver.test.mjs（test）
- plugin/test/driver-cli.test.mjs（改写：测 CLI→kernel 路径）
- plugin/test/promotion-driver-launch.test.mjs（删除：被 driver-runtime.test.mjs 取代）
- CLAUDE.md（driver liveness 指针由 launch.sh 更新为 driver-runtime.ts）
- tasks/gap-ac151-two-level-driver-layer-landing.md（自身）
