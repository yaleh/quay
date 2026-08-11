---
id: gap-loop-completion-path-produces-zero-gateevents
title: loop 完成任务路径不产生 GateEvent（meter is runnable, not asserted 的实破）——ad-arm1 archguard TASK-81 全程零 gate 事件，同机 CLI 路径 TEST-002 有 4 条（dod/promote/acceptance/complete pass）；.quay/gate-events.jsonl 在 loop workspace 不存在
status: todo
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**实测（manager 2026-08-11 16:3x，ad-arm1/archguard TASK-81 刚 done，逐项验过再报，本条 AC 已过度声明三次先核实）**：

TASK-81 走完 `ready → 建 task/TASK-81 分支 → 提交证据 → fan-in merge(f0ad34cb) → status done`，全程在真实第三方项目 archguard 上、aarch64 机器、quay 0.4.0 从构建产物安装。**分支+fan-in 通路真的通了**。但：

**`.quay/gate-events.jsonl` 不存在，gate-log 零事件**（`ls` 报 No such file）。对照：同台机器手跑 CLI 的 TEST-002，gate-log 有 4 条（dod/promote/acceptance/complete pass）。**同一 workspace，CLI 路径产生 gate 事件，loop 路径零 gate 事件** ⇒ **loop 的完成路径绕过了 gate 引擎**（或用了不写事件的另一条路径）。

**根因方向**：`quay complete <task>`（QENG lifecycle.ts:123）前置 `status=="ready"`，跑 acceptance gate，pass 时写 `complete` pass 事件。loop 的 fan-in/complete 若直接用状态翻转（如 `task edit --status done`）而不经 `quay complete`，则不写 GateEvent。**「meter is runnable, not asserted」是 QENG 的设计声明，而这里 loop 完成任务时那个 meter 根本没被调用**。

### 验证锚

修后 (a) loop 完成任务路径产生与 CLI 一致的 GateEvent（gate-events.jsonl 有记录，gate-log 可读）；(b) ad-arm1 archguard 下一条 loop 完成任务 gate 事件可见；(c) 不回归 CLI 路径；(d) `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 ad-arm1 archguard TASK-81 零 gate 事件 + 同机 CLI TEST-002 4 条事件对照（gate-events.jsonl 存在性差异）
- [ ] AC2: **loop 完成路径写 GateEvent**——loop 完成任务（fan-in + status done）经与 CLI 一致的 gate 引擎，写 `complete` pass 事件
- [ ] AC3: **gate-log 可读**——loop 完成的 GateEvent 在 `quay gate-log <task>` 可见
- [ ] AC4: **CLI 不回归**——CLI 路径 gate 事件照常
- [ ] AC5: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：ad-arm1 下一条 loop 完成任务 gate-events.jsonl 有记录 + gate-log 可见
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- packages/quay/src/gate/lifecycle.ts（loop 完成路径经 gate 引擎写事件）
- plugin/scripts/fan-in-merge / loop 完成路径（若绕 gate）
- plugin/test/gate-event-store.test.mjs（loop 完成路径 GateEvent 用例）
- tasks/gap-loop-completion-path-produces-zero-gateevents.md（自身：勾 AC + 贴证据）

## Contract

measure   loop_gate_event_count = `ssh ad-arm1 'wc -l ~/work/archguard/.quay/gate-events.jsonl'` stdout 数字
band      loop_gate_event_count ≥ 1（loop 完成任务后 gate-events.jsonl 非空）
invariant loop_uses_gate_engine = 1（loop 完成路径经与 CLI 一致的 gate 引擎）
invoke    `ssh ad-arm1 'cd ~/work/archguard && quay gate-log <TASK-8X>'`（贴 gate 事件）
control   loop 完成写事件；gate-log 可读；CLI 不回归；既有不回归
resume    复现固化 / 修 loop 完成路径 / 测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-11
changed: manager 实测 ad-arm1/archguard TASK-81——loop 完成路径零 GateEvent（gate-events.jsonl 不存在），同机 CLI TEST-002 4 条；「meter is runnable, not asserted」实破，loop 完成任务时 meter 没被调用。实现归 inner，判定归 outer
