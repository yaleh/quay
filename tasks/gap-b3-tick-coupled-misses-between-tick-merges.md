---
id: gap-b3-tick-coupled-misses-between-tick-merges
title: B3 验证轮起跑条件 tick 耦合漏掉 tick 间 merge——r271 04:38 完成后 51
  分钟无轮次（机器空、边际成本零、develop..integration=33→38 未验证）；B3 条件（收尾≥1 或新 merge 且
  state!=running 且 gate 放行）全满足却没触发 ⇒ 起跑是 tick 轮询的副作用，merge 落在 tick
  之间就漏；处方=验证轮起跑做成事件（merge 落地 ⇒ 检查并起跑），或 suite-state-trigger 增加
  idle-green-有-未验证提交 触发
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

## Proposal

**B3 验证轮起跑条件 tick 耦合漏掉 tick 间 merge：r271 04:38:24 完成后 51 分钟无任何轮次在跑（runner 进程 0、机器空、边际成本为零），同期 develop..integration=33→38 条未验证提交、05:01-05:23 之间多次 merge 落地。B3 条件（本轮收尾 ≥1 或有新 merge 落地 且 state != running 且 resource-gate 放行）看起来全部满足却没触发——起跑是 tick 轮询的副作用，merge 落在 tick 之间就漏。**

### 实证（manager 2026-08-11 05:3x + outer 复核）

- **r271 完成**：04:38:24Z green（3185/0），之后 runner 进程 0、无任何轮次。
- **空转 51 分钟**：04:38 → 05:28 无轮次；develop..integration=33（后 38）未验证；05:01-05:23 多次 merge 落地（quay-init-branch-model cf61e678 等）。
- **B3 条件全满足**：有新 merge 落地 ✓；state=green（非 running）✓；resource-gate GO ✓——却没起跑。
- **根因**：B3 起跑是 tick 轮询到那一格才检查；merge 落 integration 在 tick 之间 ⇒ 下一 tick 若没跑 closure（nyf 少）就「看起来没新东西」⇒ 不检查是否该起验证轮。
- **代价（按 manager 05:22 量化）**：验证滞后是本系统当前最贵的量（中位 3.9h/p90 15h/嫌疑集 35 提交）；空转 51 分钟纯增加它，且机器空的边际成本为零。

### 选定机制方向（实现归 inner，判定归 outer）

**验证轮起跑做成事件**（不靠 tick 轮询副作用）：
1. **merge 落地触发**：integration 有新 merge（fan-in/批量合）⇒ 检查并起跑验证轮（若 state!=running 且 gate 放行）。
2. **suite-state-trigger 增 idle-green-有-未验证 触发**：state=green 且 develop..integration>0 且持续 idle ⇒ 发事件驱动起跑（照 4b2 的模型）。

**验证锚**：修后 (a) 有 merge 落地且 state!=running ⇒ 自动起跑（非等 tick）；(b) 无未验证提交不误起；(c) `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 r271 后 51 分钟空转实证（runner 0、merge 落地、B3 条件全满足、develop..integration 33→38）（本任务 Proposal 已含）
- [x] AC2: **merge 触发起跑**——integration 新 merge 落地且 state!=running 且 gate 放行 ⇒ 自动起验证轮（不靠 tick）
- [x] AC3: **idle-green 触发**——state=green 且 develop..integration>0 且持续 idle ⇒ 事件驱动起跑
- [x] AC4: **既有不回归**——无未验证提交不误起；`--for-task` scoped 门绿

## Definition of Done

- [x] AC1–AC4 全部勾上
- [x] 修后实跑：构造「merge 落地 + state=green + gate GO」⇒ 自动起跑（贴输出）
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/suite-state-trigger.ts（idle-green-有-未验证 触发）
- plugin/scripts/full-suite-runner.ts 或外层接线（merge 落地 ⇒ 起跑）
- orchestration/orchestrator-tick-core.md（B3 起跑触发补事件分支）
- tasks/gap-b3-tick-coupled-misses-between-tick-merges.md（自身：勾 AC + 贴证据）

## Contract

measure   idle_green_round_started = `node --no-warnings --experimental-strip-types plugin/scripts/suite-state-trigger.ts --json` 构造「green + develop..integration>0」后的事件
band      idle_green_round_started = 有事件（idle-green 触发起跑）
invariant no_pending_no_trigger = 1（无未验证提交不误起）
invariant event_not_tick = 1（起跑由事件驱动，非 tick 轮询副作用）
invoke    `tail -3 .quay/suite-state-events.jsonl`（贴 idle-green 事件）
control   merge 落地即起；idle-green 起；无未验证不误起
resume    事件触发 / idle-green / 测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-11
changed: manager 05:3x——r271 后 51 分钟空转（机器空、边际成本零、33→38 未验证、B3 条件全满足没起跑）；验证滞后是本系统最贵的量。根因=B3 tick 耦合，merge 落 tick 间就漏。处方：merge 落地触发 + idle-green 触发。实现归 inner，判定归 outer

## Evidence（inner 2026-08-11，实现完成）

**实现（分步提交，Contract resume 三步各一 commit，均在 `task/gap-b3-tick-coupled-misses-between-tick-merges` 分支）**：
- `d90e1666` 事件触发（merge 落地 ⇒ 起跑）AC2——suite-state-trigger Monitor 观测 git：integration HEAD 前移（fan-in/批量合落地）且 state != running 且 develop..integration>0 ⇒ 发 `SUITE-MERGE-PENDING` 事件并驱动起跑（runMonitor spawn），不靠 tick；含共享 git 观测基建 `readGitVerificationState`（fail-open）与 `--json` 输出。
- `573dbf2d` idle-green 触发 AC3——state=green 且 develop..integration>0 且自终态 finishedAt 持续 idle ≥ 阈值（默认 2 min，`--idle-green-min` / env `QUAY_SUITE_IDLE_GREEN_MS` 可调）⇒ 发 `SUITE-IDLE-GREEN` 事件并驱动起跑（照 4b2 的模型）。
- `6d4791e3` 测试 + B3 起跑触发补事件分支——suite-state-trigger.test.mjs 新增 9 条（AC2 纯函数 + runOnce 真实 git fixture、AC3 纯函数 + runOnce 真实 git fixture、Contract measure `--json`、resolveIdleGreenMs 默认 2min）；orchestration + plugin/loop 两份 orchestrator-tick-core.md 的 B3 起跑条件补事件分支（`SUITE-MERGE-PENDING` / `SUITE-IDLE-GREEN` 驱动起跑，`event_not_tick` 恒 1）。

**AC2 实跑（merge 落地 ⇒ 起跑，不靠 tick）**——`--json` 两轮（真实 git fixture：develop + integration 分支、integration 领先）：
- 第一轮（基线，无新 merge）：`mergePending: false`（establish baseline，不误起）。
- 新 merge 落地后再跑：`mergePending: true`，事件 `{"event":"SUITE-MERGE-PENDING","pendingCount":2,"integrationHead":"2d2392f3..."}`。

**AC3 实跑（idle-green 事件）**——`--json` 构造 green + develop..integration>0 + idle（Contract measure）：
```
--- CLI exit: 0
idleGreen: true | mergePending: false
SUITE-IDLE-GREEN event: {"event":"SUITE-IDLE-GREEN","at":"2026-08-11T08:42:13.583Z","early":false,"stopSignal":false,"state":{...green...},"pendingCount":3,"idleMs":2583}
--- tail -3 .quay/suite-state-events.jsonl ---
{"event":"SUITE-IDLE-GREEN","at":"...","early":false,"stopSignal":false,"state":{...},"pendingCount":3,"idleMs":2583}
```

**AC4 负控制（无未验证提交不误起）**——green+idle 但 integration==develop（无未验证提交）：`idleGreen: false | mergePending: false`。

**scoped 门（`bash scripts/test.sh --for-task gap-b3-tick-coupled-misses-between-tick-merges --allow-thin`）**：104 tests / 0 fail / 0 cancelled，exit 0。选择集：`plugin/test/full-suite-runner.test.mjs` + `plugin/test/suite-state-trigger.test.mjs`；tick-core-static-check PASS（AC3 src:N 100%、AC4 pointer OK）。

**DoD 待外层**：全量套件绿由外层 verification-round 验证（本 inner 不跑全量）。
