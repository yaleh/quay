---
id: gap-inner-heartbeat-fields-shrunk-no-minimal-contract
title: .quay/inner-wakeup-heartbeat.json 字段收缩——本轮只写 3
  键（ts/reason/delaySeconds），此前
  runIds/blocked/budgetHit/effectiveCap/agentDispatches 全消失；A3 前提=这是唯一回答「inner
  需要什么」的产物，缺 blocked[] ⇒ 无法判 inner 是否卡住（硬规则 6
  缺键=未查≠无阻塞）；处方=心跳字段集最小契约检查，防静默退化成一行自由文本
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**`.quay/inner-wakeup-heartbeat.json` 字段收缩：本轮（05:20）只写 3 个键（ts/reason/delaySeconds），此前 runIds/blocked/budgetHit/effectiveCap/agentDispatches 全部消失。A3 的前提是【这是唯一回答「inner 需要什么」的产物】——少了 blocked[]，无法从它判断 inner 是否卡住；按硬规则 6 缺键=未查、不等于无阻塞。**（manager 本轮用 slot-status 与 worktree 列表独立补齐，但这是绕法不是机制。）

### 实证（manager 2026-08-11 05:3x + outer 复核）

- **本轮心跳**（05:20）：`{"ts":..., "delaySeconds":1500, "reason":"tick heartbeat — dispatched quay-init-branch-model; prereq-gates needs-human; leaked worktree cleaned"}`——**3 键**。
- **此前心跳**：含 runIds/blocked/budgetHit/effectiveCap/agentDispatches（05:0x 及之前）。
- **后果**：A3 用该产物答「inner 是否卡住/需要什么」——缺 blocked[] 则无法判卡住（硬规则 6：缺键=未查，不等于无阻塞）。
- **观测退化**：心跳退化成一行自由文本（reason 散文），结构化字段消失 ⇒ 上层判断只能靠别的来源（slot-status/worktree）补齐，但那是绕法不是机制。

### 选定机制方向（实现归 inner，判定归 outer）

**给心跳字段集加最小契约检查**，防静默退化成一行自由文本：
1. **最小字段契约**：心跳必须含 ts/runIds/blocked/budgetHit/effectiveCap/agentDispatches/delaySeconds 等结构化键（至少 blocked[] + runIds）；缺任一 ⇒ 报「心跳字段缺失」（照 tick-core 缺值=未查的纪律）。
2. **退化成散文即红**：reason 散文可补充但不可替代结构化字段；检查器对缺键判不合规。

**验证锚**：修后 (a) 心跳含最小字段集（blocked[]/runIds/effectiveCap 等）；(b) 缺键 ⇒ 检查器报；`--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录本轮 3 键心跳 vs 此前全字段（runIds/blocked/budgetHit/effectiveCap/agentDispatches）+ 硬规则 6 缺键=未查（本任务 Proposal 已含）
- [ ] AC2: **最小契约**——心跳必须含结构化键（blocked[]/runIds/effectiveCap 至少）；缺 ⇒ 检查器报
- [ ] AC3: **散文不替代**——reason 散文可补充不可替代结构化字段
- [ ] AC4: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 修后实跑：心跳字段集检查器对缺键判不合规（贴输出）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/inner-wakeup-heartbeat-check.ts（最小字段契约 + 缺键判不合规）
- plugin/test/inner-wakeup-heartbeat-check.test.mjs（新增缺键用例）
- plugin/scripts/inner-wakeup-heartbeat.ts 或写入方（补结构化字段）
- tasks/gap-inner-heartbeat-fields-shrunk-no-minimal-contract.md（自身：勾 AC + 贴证据）

## Contract

measure   heartbeat_field_count = `python3 -c "import json; print(len(json.load(open('.quay/inner-wakeup-heartbeat.json'))))"` 的 stdout 数字
band      heartbeat_field_count >= 7（ts/runIds/blocked/budgetHit/effectiveCap/agentDispatches/delaySeconds）
invariant blocked_field_present = 1（blocked[] 必须在场——A3 判卡住的前提）
invariant prose_does_not_replace = 1（reason 散文不可替代结构化字段）
invoke    `python3 -c "import json; d=json.load(open('.quay/inner-wakeup-heartbeat.json')); print(sorted(d.keys()))"`（贴心跳键集）
control   心跳含结构化字段；缺键判不合规；散文不替代
resume    契约检查 / 写入方补字段 / 测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-11
changed: manager 05:3x——心跳本轮只写 3 键（ts/reason/delaySeconds），此前 runIds/blocked/budgetHit/effectiveCap/agentDispatches 全消失；A3 前提被破坏（缺 blocked[] 无法判卡住，硬规则 6 缺键=未查）。处方：最小字段契约检查。实现归 inner，判定归 outer
