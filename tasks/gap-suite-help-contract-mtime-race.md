---
id: gap-suite-help-contract-mtime-race
title: help-contract AC1 mtime 负控制被常驻 driver 活跃写污染——driver 活跃时稳定红，误杀所有 fan-in
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`plugin/test/help-contract-incompatible-behaviors.test.mjs` 的 AC1 断言「所有 `-check.ts --help` exit 0 + 打印 usage + **zero .quay mtime change**」。其负控制假设「测试期间 `.quay/` 静止」，但生产环境**常驻 driver（promotion/worker）每轮 tick 持续写 `.quay/`** ⇒ before/after mtime 对比被 driver 活跃产物污染，driver 活跃时稳定红。

**实测（driver development progress 手动复现，主检出稳定失败）**：84 个 `-check.ts` 的 `--help` 全部 exit 0 + 打印 usage（failures 无），但 `.quay` mtime 变了 4 个文件——`checker-cost.jsonl`、`promotion-round.jsonl`、`promotion-driver-liveness.log`、`worker-driver-liveness.log`——全是 promotion/worker driver 每轮 tick 的活跃产物，非任何 checker 的 `--help` 副作用。round 815/816 都因此红。

**代码根因**：`snapshotMtimeSet(quay)`（`:56-90`）递归快照**整个 `.quay/`**，只排除 `node-compile-cache` 目录（Node 编译缓存），**不排除 driver 活跃文件**。`diffMtimeSet` 把任何 mtime 变化计入 `changed`，`assert.deepEqual(changed, [], …)` 断言零变化 ⇒ driver 一写就假红。

**后果**：这是 flaky 根因，会**误杀所有后续 fan-in**——包括已派发的 `gap-suite-classification-lpt-scheduler-ts-ization`（其 fan-in suite 同样撞此假红）。

## Plan

二选一（推荐①，peer 建议）：
1. **排除常驻 driver 活跃文件**：`snapshotMtimeSet`（或 `diffMtimeSet`）排除 `checker-cost.jsonl` / `promotion-round.jsonl` / `*-liveness.log` 等 driver 产物。
2. **只快照「checker 可能写的文件集」**（白名单）而非整个 `.quay/` 目录——更彻底，但需完整枚举 checker 可能写出的文件集。

验证：driver 活跃时跑该测试绿；AC1 仍能抓真实 `--help` 副作用（负控制不退化——排除 driver 文件 ≠ 排除 checker 副作用）。

## Acceptance Criteria

- [ ] AC1（能取假，机制级）：`snapshotMtimeSet` 排除常驻 driver 活跃文件——grep 测试文件含排除逻辑，覆盖 `checker-cost` / `promotion-round` / `liveness`；（⛔ 仍快照全 `.quay/` 不排除 driver 文件 ⇒ 假）。
- [ ] AC2（能取假，生产载体）：driver 活跃时跑 help-contract 测试绿（不再因 mtime 污染红），落地后轮不再出现 AC1 mtime race 红；（⛔ driver 活跃仍红 ⇒ 假）。
- [ ] AC3（能取假，负控制不退化）：注入一个真实 `--help` 副作用（某 checker 在 `--help` 写 `.quay` 文件）时，测试仍能抓出该 side effect——排除 driver 文件 ≠ 排除 checker 副作用，防过度排除；（⛔ 排除后连真副作用也抓不出 ⇒ 假）。

## Definition of Done

`snapshotMtimeSet` 排除 driver 活跃文件；driver 活跃时测试绿；负控制不退化（真副作用仍被抓）；全量 suite 绿。

## Touches

- plugin/test/help-contract-incompatible-behaviors.test.mjs（snapshot 排除 driver 活跃文件）
- tasks/gap-suite-help-contract-mtime-race.md（自身）
