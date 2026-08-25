---
id: gap-ac143-observability-ledger-closing-driver
title: AC143 观测/账本/收尾面驱动化——outer 纯机械 A/B 段收进 driver（新 kind 或并入既有 kind）
status: todo
labels:
  - gap
  - feature
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac155-config-merge-control-state-split-event-polling
---
**type:** execution

## Proposal

outer 执行核里**纯机械**的 A/B 段（A1/A3/A6/A9/A10/A18/A21 读数 · B1/B2/B6 收尾留痕 · B12/B17 自查审计）收进 driver（新 kind 或并入既有 kind，落笔方定）。扩展成本已实测（manager 直读 promotion-driver-launch.sh）：kind 派发是 registry 表驱动（`KIND_DRIVER[]`/`KIND_VERBS[]`/`KIND_PREFIX[]`）⇒ 加一个 kind = 表里加一行 + 写该 driver 的 `.ts`（AC139-2 单一真相源红利）。**分层必须先于 AC143**（phase-goal :33-35：manager-kind 结构不同于 promotion/worker，分层前加只会三空段或另起一套）⇒ `depends_on` AC155。

## Plan

落一个 outer 机械面 driver（kind），把 A1/A3/A6/A9/A10/A18/A21 + B1/B2/B6 + B12/B17 收进去；outer 执行核对应段标「已驱动化」指针。

## Acceptance Criteria

- [ ] AC1（能取假，生产载体）：该 driver 的生产载体在其落地后 ≥N 轮有记录（能产出 ≠ 已产出，硬规则④推论三）；（⛔ N 轮无记录 ⇒ 假）。
- [ ] AC2（能取假，无双真相源）：driver 落地后 outer tick-log 里不再出现该步骤的手动调用记录（同 AC135 形态）；（⛔ 仍出现手动调用 ⇒ 假）。
- [ ] AC3（能取假，registry 表驱动）：新 kind 经 `KIND_DRIVER[]` 等 registry 表加一行接入（grep 到）；（⛔ 另起一套承载 ⇒ 假）。

## Definition of Done

outer 机械 A/B 段收进 driver kind；AC1/AC2/AC3 全勾；outer 执行核对应段标退役指针。

## Touches

- plugin/scripts/driver-runtime.ts / driver-*.ts（新 kind 或并入既有）
- plugin/scripts/promotion-driver-launch.sh（registry 表加行）
- orchestration/orchestrator-tick-core.md（对应段标已驱动化）
- tasks/gap-ac143-observability-ledger-closing-driver.md（自身）
