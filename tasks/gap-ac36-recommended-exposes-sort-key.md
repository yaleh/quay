---
id: gap-ac36-recommended-exposes-sort-key
title: 'AC36 判据②不可机械核——slot-refill --json 的 recommended 是纯字符串数组，不暴露排序键；位次严格前移+负控制只能人工比对两次运行；处方=recommended 元素改带排序键对象（或另加 ranking 数组），判据②才能机械核对'
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

**AC36 判据②（打 label 任务位次严格前移 + 负控制：不打 label 同族位次不变）在当前 `--json` 输出下【无法机械核对】——`recommended` 是纯字符串数组，不暴露任何排序字段。只能人工比对两次运行，判据② 只能靠自述。**

### 实证（manager 2026-08-10 10:0x + outer 复核 slot-refill --json 顶层键）

- **`--json` 顶层键**（outer 复核）：`cap/base_cap/effective_cap/arbitration/floor_mult/in_flight_count/closed_but_live_count/occupied_slots/slots_free/pool/floor/dispatchable_disjoint/criterion_met/landing_blocked` — **没有任何排序字段**。
- **`recommended` 是纯字符串数组**（`recommended[0]` type = str）：`['gap-crystallization-five-directions', 'gap-ac37-exec-core-ships-with-package', …]` — 打没打 label、blocking_suite 与否、按哪个轴排的，输出里不可见。
- **判据② 原文**：「打了 label 的任务在 `--json` 的 `recommended` 里位次严格前移；负控制：不打 label 的同族任务位次不变」——当前形态下只能**人工跑两次比对**（打 label 前 / 后），无法用检查器机械断言「位次严格前移」且「同族不变」。

**为什么重要**：AC36 是产品化交付阶段的优先级机制，其判据② 是「应用（apply）」环的可机械验证。判据不可机械核 = 这条 AC 只能靠自述（正是 C17 / AC41 判据 3 反对的形态）。AC36 自己就是「应用环」的判据源，它不可验证会让整个链条的验证塌掉。

### 选定机制方向（实现归 inner，判定归 outer）

1. **`recommended` 元素带排序键**：从字符串数组改为对象数组（`{id, deliveryCritical, suiteBlocking, rank}`），或另加 `ranking` 数组（`[{id, axis, position}]`）——机械断言「deliveryCritical 任务位置严格前移」「同族 non-DC 位置不变」。
2. **判据② 机械化**：检查器读 `ranking`，断言 (a) DC 任务在打 label 前 → 后位置严格减小；(b) 同族非 DC 任务位置不变；(c) blocking_suite 仍在 DC 之上。

**验证锚**：修后 (a) `--json` 的 `recommended`（或 `ranking`）暴露每条的排序键（blocking_suite / delivery_critical / id 轴）；(b) 判据② 的「严格前移 + 负控制」可由检查器机械断言；(c) 既有输出不回归。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 recommended 纯字符串数组 + 顶层键无排序字段实证（本任务 Proposal 已含）
- [ ] AC2: **排序键暴露**——`--json` 的 recommended（或新增 ranking）暴露每条排序键（blocking_suite / delivery_critical / id）
- [ ] AC3: **判据② 机械化**——检查器机械断言「DC 任务严格前移 + 同族非 DC 不变 + blocking_suite 之上」
- [ ] AC4: **既有不回归**——`--for-task` scoped 门绿（含 slot-refill 既有测试）
- [ ] AC5: **全量套件绿**——verification-round 验证

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：--json 暴露排序键 + 检查器机械断言位次前移/负控制（贴输出）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/slot-refill.ts（AC2：recommended 带排序键或 ranking 数组）
- plugin/scripts/（AC3：判据② 机械检查器或复用）
- plugin/test/slot-refill.test.mjs（AC2/AC3：排序键暴露 + 机械断言测试）
- orchestration/manager-phase-goal.md（AC36 判据② 正本——本任务 Proposal 已引用）
- tasks/gap-ac36-delivery-critical-priority-axis.md（交叉标注——AC36 自身的可验证性缺口）
- tasks/gap-ac36-recommended-exposes-sort-key.md（自身：勾 AC + 贴证据）

## Contract

measure   recommended_exposes_sortkey = `node --no-warnings --experimental-strip-types plugin/scripts/slot-refill.ts --root "$PWD" --cap 5 --json` 的 stdout 中 recommended[0] 是否对象（含排序键）
band      recommended_exposes_sortkey = true（对象数组或 ranking 数组，暴露每条的轴）
invariant criterion2_mechanical = 1（判据② 由检查器机械断言，非人工比对）
invariant negative_control_preserved = 1（同族非 DC 位置不变）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/slot-refill.ts --root "$PWD" --cap 5 --json`（贴 recommended/ranking 带排序键）
control   排序键暴露；判据② 机械核；负控制不变；既有不回归
resume    排序键暴露 / 判据② 检查器 / 测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: manager 实测——AC36 判据② 不可机械核：recommended 纯字符串数组、顶层键无排序字段，位次前移只能人工比对。立案：recommended 带排序键 + 判据② 机械化。实现归 inner
