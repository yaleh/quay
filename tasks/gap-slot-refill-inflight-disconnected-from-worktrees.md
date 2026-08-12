---
id: gap-slot-refill-inflight-disconnected-from-worktrees
title: slot-refill in_flight=0 而 worktree+telemetry 有在飞任务 ⇒ 仪器不一致
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**实证（manager 2026-08-12 实测 + outer 复核）**：`git worktree list` 有 2 个在飞任务 worktree（`gap-suite-state-trigger-retriggers-while-runner-alive` + `gap-verification-round-counter-overwrites-not-sums`），telemetry `inProgress` 同列这 2 条——但 `slot-refill --json` 报 `in_flight_count=0` / `occupied_slots=0`。

**影响**：任何基于 in_flight 的判断全偏——slot-refill 报 `should_refill=true`（5 空槽）而实际 2 槽已占；补派/槽位账/并发闸基于错误读数。

**同类前科**：`gap-inbox-counter-disconnected-from-files`（counter 报 delivered=0 而目录实有 6 封，沉默失败）——「计数器与其源断开，报零而不是报错」同族。

**选定机制**：定位 `slot-refill.ts` 的 in_flight 计数源（读 telemetry `inProgress`？读 worktree？还是别的），修到与 worktree+telemetry 一致；或改读可靠源（telemetry inProgress 是权威——内层每次 --task-start 写）。负控制：无在飞时仍报 0。

**验证锚**：(a) 有在飞 worktree+telemetry ⇒ slot-refill in_flight≥1；(b) 无在飞 ⇒ 0；(c) `--for-task` scoped 门绿。

## Plan

1. 读 `plugin/scripts/slot-refill.ts` 的 in_flight 计数路径，定位它读什么源（telemetry / worktree / 别处）。
2. 对照 telemetry `inProgress`（权威：--task-start 写入）找出差异。
3. 修 + 单测（构造有/无在飞两态）。
4. 回归：slot-refill 既有测试 + `--for-task` scoped。

## AC

- [x] AC1: 有在飞任务（worktree+telemetry）⇒ slot-refill `in_flight_count` ≥ 实际数
  - 证据：`slot-refill.ts` 不传 `--in-flight` 时改读 telemetry `--slot-status`（reconcile-aware：kept real-in-flight + closed-but-live + non-task subagents）。受控 fixture（真 git 仓库 + `task/<id>` open worktree + `--task-start` 事件）实跑 `slot-refill.ts --root … --cap 5 --json` ⇒ `in_flight_count=1`（telemetry kept 1）、`occupied_slots=1`。见 `## Evidence`
- [x] AC2: 无在飞 ⇒ 0（负控制不回归）
  - 证据：裸 workspace（无 `.workflow-events`）实跑 ⇒ `in_flight_count=0` / `occupied_slots=0` / `slots_free=5`，`measurement_source="telemetry-slot-status"`。见 `## Evidence`
- [x] AC3: `should_refill` / `occupied_slots` 与 in_flight 一致（不再报 5 空槽而实际 2 槽被占）
  - 证据：受控 fixture 修前 `occupied_slots=0`/`slots_free=5`/`should_refill=true` 且 `recommended=[gap-inflight]`（推荐已占任务）；修后 `occupied_slots=1`/`slots_free=4`/`should_refill=false`/`recommended=[]`（不再推荐在飞任务）。见 `## Evidence`
- [x] AC4: 新测试覆盖 (a)(b)(c)；`--for-task` scoped 门绿
  - 证据：新增 6 测试（`parseSlotStatusOutput` 纯解析 / 有在飞 E2E / 无在飞负控制 / 显式路径不变 / subagents 占槽 / telemetry 读失败不静默）；worktree 内 `bash scripts/test.sh --for-task gap-slot-refill-inflight-disconnected-from-worktrees` 退出 0——53 测试全绿 + 全部 scoped 静态检查通过。见 `## Evidence`
- [x] AC5: 既有 slot-refill 测试全绿
  - 证据：同一次 `--for-task` scoped 运行，既有 47 条 slot-refill 测试全绿（含 AC1/AC2/AC3/AC5/AC7/仲裁/排序/not-yet-flipped/C8 全簇）。见 `## Evidence`

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：有在飞 worktree 时 slot-refill in_flight 读数贴出（见 Evidence）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/slot-refill.ts（in_flight 计数源修正——不传 --in-flight 时读 telemetry --slot-status reconcile-aware 权威源）
- plugin/test/slot-refill.test.mjs（有/无在飞两态 + 显式路径不变 + telemetry 读失败不静默）
- tasks/gap-slot-refill-inflight-disconnected-from-worktrees.md（自身：勾 AC + 贴证据）

## Contract

measure   slot_refill_inflight_consistent = `node --no-warnings --experimental-strip-types plugin/scripts/slot-refill.ts --root "$PWD" --cap 5 --json` 的 stdout 中 measurement_source 与 in_flight_count/occupied_slots
band      slot_refill_inflight_consistent = "telemetry-slot-status"（不传 --in-flight 时 in_flight_count 与 worktree+telemetry 一致；非静默 0）
invariant bare_invocation_measures = 1（不传 --in-flight/--closed-but-live ⇒ 读 telemetry --slot-status，in_flight_count ≥ 实际在飞）
invariant negative_control_zero = 1（无在飞 ⇒ in_flight_count=0 / occupied_slots=0）
invariant explicit_input_unchanged = 1（inner 传 --in-flight 路径字节不变，measurement_source="explicit-input"）
invariant never_silent_zero = 1（telemetry 读失败 ⇒ measurement_source="degraded-no-telemetry" + measurement_error 贴出，不静默报 0）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/slot-refill.ts --root "$PWD" --cap 5 --json`（贴 measurement_source / in_flight_count / occupied_slots）
control   有在飞 ⇒ in_flight_count≥实际；无在飞 ⇒ 0；occupied 与 in-flight 一致；显式路径不变；读失败不静默
resume    测量默认 / 纯解析 / 测试分步提交，任一步完成即写盘

## Evidence（内层实现 2026-08-12）

**修前缺陷复现（受控 fixture：真 git 仓库 + `task/gap-sx-inflight` open worktree + `--task-start` 事件，`--cap 5 --json` 不传 `--in-flight`）**：

```
{'in_flight_count': 0, 'closed_but_live_count': 0, 'occupied_slots': 0, 'slots_free': 5, 'should_refill': True, 'recommended': ['gap-sx-inflight']}
```

—— 计数源断开：读 0 却推荐一个**已在飞**的任务（double-dispatch 风险）。

**修后同一 fixture**：

```
{'measurement_source': 'telemetry-slot-status', 'measurement_error': None, 'in_flight_count': 1, 'closed_but_live_count': 0, 'subagents_in_flight': 0, 'occupied_slots': 1, 'slots_free': 4, 'should_refill': False, 'recommended': []}
```

—— AC1/AC3：`in_flight_count=1`（telemetry kept 1，≥实际）、`occupied_slots=1`、`slots_free=4`、不再推荐在飞任务（touches-overlap 自拒）。

**负控制（裸 workspace，无 `.workflow-events`）**：

```
{'measurement_source': 'telemetry-slot-status', 'measurement_error': None, 'in_flight_count': 0, 'occupied_slots': 0, 'slots_free': 5, 'should_refill': False}
```

—— AC2：无在飞 ⇒ 0，负控制不回归。

**显式路径不变（inner tick 传 `--in-flight gap-sx-inflight`）**：

```
{'measurement_source': 'explicit-input', 'in_flight_count': 1, 'occupied_slots': 1, 'slots_free': 4, 'should_refill': False, 'recommended': []}
```

—— AC5 字节兼容：inner 自维护集合仍是权威，仅新增 `measurement_source` 溯源字段。

**telemetry 读失败不静默（`.workflow-events` 置为文件 ⇒ telemetry CLI ENOTDIR）**：

```
{'measurement_source': 'degraded-no-telemetry', 'measurement_error': 'Command failed: … fast-mode-telemetry.ts --slot-status …', 'in_flight_count': 0, 'occupied_slots': 0, 'slots_free': 5, 'should_refill': False}
```

—— 降级为空 BUT `measurement_source` + `measurement_error` 贴出，0 不再静默。

**`--for-task` scoped 门（worktree 内 `bash scripts/test.sh --for-task gap-slot-refill-inflight-disconnected-from-worktrees`）**：退出 0——53 测试全绿（既有 47 + 新增 6）、全部 scoped 静态检查通过（test-framework-policy / test-isolation / test-impl-census / task-contract / superseded-capability / judgment-consumer / tick-core-static / delivery-inventory-drift-gate）。

## Dispatch review

reviewer: outer
at: 2026-08-12
changed: manager 实测——slot-refill `--json` 报 in_flight_count=0/occupied_slots=0 而 worktree+telemetry 有 2 个在飞任务（计数器与源断开、报零不报错，与 gap-inbox-counter-disconnected-from-files 同族）。立案：不传 --in-flight 时改读 telemetry `--slot-status`（reconcile-aware 权威源），负控制无在飞仍报 0。实现归 inner
