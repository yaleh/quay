---
id: gap-suite-lane-budget-structural-guarantee-broken-buckets-no-lock
title: 单飞锁看门狗让槽不让 lane——FULL_SUITE_LOCK_HOLD_MAX_S 超时释放槽位但 suite 继续占满 16 lanes ⇒
  S+1 双倍超订（漏口②；漏口① buckets 不取锁已由 serial-lowconc AC3 覆盖）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
  depends_on:
    - gap-suite-serial-lowconc-classification-recheck
---
**type:** execution

> **⛔ 防重复（manager 核实）**：本条原立案含两个漏口——漏口①（`--buckets` 不取锁 ⇒ lane 预算失效，M bucket 2-3x 超订）**已由 `gap-suite-serial-lowconc-classification-recheck` AC3 覆盖**（人 2026-08-25 裁定「统一收口」，代码已写在 serial-lowconc worktree `scripts/test.sh:1414` 的 `full_suite_lock_acquire`，只差落地）。本条**只保留漏口②**，⛔ 不让实现方从零重写漏口①。

## Proposal

`full-suite-runner.ts` 的 lane 公式「Σ lane ≤ nproc×oversub structurally」的**第二个漏口**（漏口①已由 serial-lowconc AC3 覆盖）：

**漏口②（本条）**：锁持有看门狗 `FULL_SUITE_LOCK_HOLD_MAX_S=1800`（`scripts/test.sh:657-663`）超 30 分钟释放槽位、而**让出槽位的 suite 继续用它的 16 lanes 跑**。注释原文已明确接受这个代价（"accepts the contention risk of a (S+1)-th suite joining"），**但 lane 公式没跟着改**——新进来的那个也照样取 16 lanes。

⇒ 2 个 suite × 16 lanes 跑在 16 核上 = 2 倍超订。这与漏口①叠加：漏口①（M bucket）修好后，漏口②（full 桶看门狗）仍是残留的超订源。

**实测背景（manager 直接量）**：full bucket 毛墙钟 786s→1674s（+113%），净执行 763→1011（+33%），lock_wait 中位 0→429s——full 桶 85% 是排队。看门狗让槽不让 lane 是排队之外的第二个超订来源。

## Plan

1. 看门狗让出槽位时**同时让出 lane**（不再「只让槽不让 lane」的双倍超订）。方向留实现方，⛔ 不代拍。

## Acceptance Criteria

- [ ] AC1（能取假，看门狗让 lane）：看门狗让出槽位时同时让出 lane（不再只让槽不让 lane 的双倍超订）；（⛔ 只让槽不让 lane ⇒ 假）。
- [ ] AC2（能取假，单跑不退化）：恢复后单 suite 独占时 lane 仍取满 16（⛔ 因修复而把单跑也限死 ⇒ 假——「S=1 时取满」是公式原意，不该被破坏）。

## Definition of Done

看门狗让槽同时让 lane；AC1-AC2 全勾；单跑不退化。

## Touches

- scripts/test.sh（看门狗让槽同时让 lane）
- plugin/scripts/full-suite-runner.ts（lane 预算公式 / 看门狗逻辑）
- plugin/test/full-suite-runner.test.mjs（看门狗让 lane + 单跑不退化负控制）
- tasks/gap-suite-lane-budget-structural-guarantee-broken-buckets-no-lock.md（自身）

## Needs-Human

**执行 2026-08-28T18:04:13.189Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
