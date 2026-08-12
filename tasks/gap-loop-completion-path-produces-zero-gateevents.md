---
id: gap-loop-completion-path-produces-zero-gateevents
title: loop 完成任务路径不产生 GateEvent（meter is runnable, not asserted 的实破）——ad-arm1
  archguard TASK-81 全程零 gate 事件，同机 CLI 路径 TEST-002 有 4
  条（dod/promote/acceptance/complete pass）；.quay/gate-events.jsonl 在 loop
  workspace 不存在
status: done
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra: {}
---
**type:** execution

> **翻 done（outer 2026-08-12）**：fan-in 分支 2cc67f78 经 r311-green 验证（3346 pass/0 fail），代码在 develop。A组 裁定剩余 2 条 + loop-completion AC16③ 路径。

## Proposal

**实测（manager 2026-08-11 16:3x，ad-arm1/archguard TASK-81 刚 done，逐项验过再报，本条 AC 已过度声明三次先核实）**：

TASK-81 走完 `ready → 建 task/TASK-81 分支 → 提交证据 → fan-in merge(f0ad34cb) → status done`，全程在真实第三方项目 archguard 上、aarch64 机器、quay 0.4.0 从构建产物安装。**分支+fan-in 通路真的通了**。但：

**`.quay/gate-events.jsonl` 不存在，gate-log 零事件**（`ls` 报 No such file）。对照：同台机器手跑 CLI 的 TEST-002，gate-log 有 4 条（dod/promote/acceptance/complete pass）。**同一 workspace，CLI 路径产生 gate 事件，loop 路径零 gate 事件** ⇒ **loop 的完成路径绕过了 gate 引擎**（或用了不写事件的另一条路径）。

**根因方向**：`quay complete <task>`（QENG lifecycle.ts:123）前置 `status=="ready"`，跑 acceptance gate，pass 时写 `complete` pass 事件。loop 的 fan-in/complete 若直接用状态翻转（如 `task edit --status done`）而不经 `quay complete`，则不写 GateEvent。**「meter is runnable, not asserted」是 QENG 的设计声明，而这里 loop 完成任务时那个 meter 根本没被调用**。

### 验证锚

修后 (a) loop 完成任务路径产生与 CLI 一致的 GateEvent（gate-events.jsonl 有记录，gate-log 可读）；(b) ad-arm1 archguard 下一条 loop 完成任务 gate 事件可见；(c) 不回归 CLI 路径；(d) `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 ad-arm1 archguard TASK-81 零 gate 事件 + 同机 CLI TEST-002 4 条事件对照（gate-events.jsonl 存在性差异）
- [x] AC2: **loop 完成路径写 GateEvent**——loop 完成任务（fan-in + status done）经与 CLI 一致的 gate 引擎，写 `complete` pass 事件
- [x] AC3: **gate-log 可读**——loop 完成的 GateEvent 在 `quay gate-log <task>` 可见
- [x] AC4: **CLI 不回归**——CLI 路径 gate 事件照常
- [x] AC5: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [x] AC1–AC5 全部勾上
- [ ] 修后实跑：ad-arm1 下一条 loop 完成任务 gate-events.jsonl 有记录 + gate-log 可见（outer/ad-arm1 验证）
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Evidence（inner 2026-08-11 实现 + 实测）

**实现**：loop 完成路径从「手搓写 `tasks/<id>.md` 的 `status: ready → done`」改为经 QENG-3 gate 引擎：

- `packages/quay/src/gate/lifecycle.ts` 新增 `runCompleteLoop`（QENG-3，与 CLI `runComplete` 同一引擎：`runGate` + `appendGateEvent` + CAS `taskWrite`）。前置 `status==ready`；有 `extra.acceptance` meter 则**跑**（fail ⇒ 留 ready 不硬翻，与 CLI 一致）；无 meter（loop 任务常态——loop 的验收是 verification-round 全量套件）则把外层 1b 传入的 `verifiedBy` 记作验收证据。pass ⇒ 写 `status=done` + 追加 `complete` pass 事件到 `.quay/gate-events.jsonl`。
- `plugin/scripts/loop-complete-task.ts` 新增机件：外层 1b 翻 done 时调用（`--root <repo> --task <id> --verified-by "..."`），经原生 provider `createStore` 读改写 + `runCompleteLoop`，写事件到 `<root>/.quay/gate-events.jsonl`。
- 文档：`plugin/loop/orchestrator-loop-tick.md` 步骤 1b「翻 done」与 `orchestrator-tick-core.md` B1 改为调 `loop-complete-task.ts`，不再手搓直接写文件。
- 机件登记：`capability-catalog.sh` 五字段登记 `loop-complete-task.ts`；`verify-delivery-surface.ts --write-inventory` 重生成快照（scripts 205→206）。

**AC2 实跑证据（tmp workspace 端到端）**：

```
$ node --no-warnings --experimental-strip-types plugin/scripts/loop-complete-task.ts --root <tmp> --task T-SMOKE --verified-by "verification-round-1 green"
PASS — status=done (loop)
$ grep "^status:" <tmp>/tasks/T-SMOKE.md
status: done
$ cat <tmp>/.quay/gate-events.jsonl
{"id":"...","item_id":"T-SMOKE","pipeline_id":"T-SMOKE","gate":"complete","actor":"quay-loop","verdict":"pass","timestamp":"2026-08-11T17:46:38.772Z","payload":{"from":"ready","to":"done","verifiedBy":"verification-round-1 green"}}
```

gate-events.jsonl 从「不存在」→「有 complete pass 事件」。

**AC3 证据（gate-log 可读）**：`plugin/test/gate-event-store.test.mjs` 端到端用例断言 `quay gate-log <id> --json` 返回 complete pass 事件（与 CLI 读同一 `.quay/gate-events.jsonl`）。

**AC4 证据（CLI 不回归）**：`packages/quay/test/lifecycle.test.mjs` 全部 CLI 路径用例（complete fail/pass/precondition、adjudicate、promote、retreat、DIR-102）在 scoped 门中全绿；`runComplete` 未改动。

**AC5 证据（--for-task scoped 门绿，worktree 实跑）**：

```
$ bash scripts/test.sh --for-task gap-loop-completion-path-produces-zero-gateevents --allow-thin
ℹ tests 139   ℹ pass 139   ℹ fail 0   ℹ cancelled 0   (FINAL EXIT=0)
scoped static checks 全 PASS（test-framework-policy-check / test-isolation-check / task-contract-check（band 修复后无违规）/ adr016-screen-use-check / superseded-capability-check / dead-code-after-return-check / strategic-doc-staleness-check / tick-core-static-check / delivery-inventory-drift-gate）
```

**负控制**：todo 任务 → exit 1 + `illegal transition` + 不写事件；带 failing meter → 留 ready + acceptance fail 事件（不硬翻）。

## Touches

- packages/quay/src/gate/lifecycle.ts（loop 完成路径经 gate 引擎写事件——新增 `runCompleteLoop`）
- plugin/scripts/loop-complete-task.ts（新机件：外层 1b 翻 done 的机械完成 + 写 complete pass 事件）
- plugin/loop/orchestrator-loop-tick.md + orchestrator-tick-core.md（1b 翻 done 改经机件）
- plugin/scripts/capability-catalog.sh（登记 loop-complete-task.ts）
- plugin/test/gate-event-store.test.mjs（loop 完成路径 GateEvent 用例，端到端）
- packages/quay/test/lifecycle.test.mjs（A2b runCompleteLoop 5 用例）
- docs/proposals/quay-product-outline.md（DELIVERY-INVENTORY 快照 205→206）
- tasks/gap-loop-completion-path-produces-zero-gateevents.md（自身：勾 AC + 贴证据）

## Contract

measure   loop_gate_event_count = `ssh ad-arm1 'wc -l ~/work/archguard/.quay/gate-events.jsonl'` stdout 数字
band      loop_gate_event_count = ≥ 1（loop 完成任务后 gate-events.jsonl 非空）
invariant loop_uses_gate_engine = 1（loop 完成路径经与 CLI 一致的 gate 引擎）
invoke    `ssh ad-arm1 'cd ~/work/archguard && quay gate-log <TASK-8X>'`（贴 gate 事件）
control   loop 完成写事件；gate-log 可读；CLI 不回归；既有不回归
resume    复现固化 / 修 loop 完成路径 / 测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-11
changed: manager 实测 ad-arm1/archguard TASK-81——loop 完成路径零 GateEvent（gate-events.jsonl 不存在），同机 CLI TEST-002 4 条；「meter is runnable, not asserted」实破，loop 完成任务时 meter 没被调用。实现归 inner，判定归 outer
