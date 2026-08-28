---
id: gap-fan-in-workflow-check-oneoff-ls-blind-spot
title: fan-in-workflow-check isMechanicalRunId 盲点——oneoff-ls-* runId 不认，scoped 门全局红挡 worker-driver/fan-in-execute 任务
status: done
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

`fan-in-workflow-check.ts` 的 `isMechanicalRunId`（:184）只认 `wk-prod-*` / `driver-verify-*` / `manager-manual-*`，**不认 `oneoff-ls-*`**。`gap-loop-shipping-ac1b-walk-enoent-race` 于 2026-08-28T15:22:54Z 用 runId `oneoff-ls-1787930114984` 落地（manager one-off 落地路径），且该任务不在 RULED_HISTORICAL_GAPS 表 ⇒ fan-in-workflow-check 的 `a-workflow-call-coverage` + `c-agent-id-real-subagent` 双红。

**影响**：任何 Touches 含 fan-in-execute.js / worker-driver.ts 的任务，scoped 门都被这条**全局红**挡住（fan-in-workflow-check 读主检出 lock events，与具体任务 delta 无关）。实测：gap-fan-in-red-bucket-run-not-recorded 实现全绿（typecheck + worker-driver 93/93 + full-suite buckets 2/2），scoped 门唯一红是 fan-in-workflow-check。

**dedup / 关系**：`4c8ebe4d4`（fan-in-workflow-check 认识 wk-prod-/driver-verify-/manager-manual-）是本 A6 翻转的前半，漏了 `oneoff-ls-*`（manager one-off 落地路径）。代码 :169-171 已注明 oneoff-adr034-*「不再发生」，但 oneoff-ls-* 复现 ⇒ 「won't recur」假设破，oneoff-* 是 recurring 形态，需机械识别非逐个 RULED。

## Plan

**裁决（修法 ①）**：`isMechanicalRunId` 扩认 `oneoff-ls-*`（或统一 `oneoff-*` 前缀，覆盖 oneoff-adr034-* / oneoff-ls-* 及未来 one-off 落地）。⛔ 不选 ②（RULED_HISTORICAL_GAPS 逐个加）——同代码注释「Adding a RULED entry per task would be whack-a-mole」。

1. `isMechanicalRunId` 加 `runId.startsWith("oneoff-")`（覆盖 oneoff-ls-*/oneoff-adr034-*）。
2. 负控制：fan-in-workflow-check 对 oneoff-ls-* runId 不再报 a/c 双红。

## Acceptance Criteria

- [x] AC1（能取假，机械识别）：`oneoff-ls-*` runId 被 `isMechanicalRunId` 认（⛔ 仍不认 ⇒ 假）。
- [x] AC2（能取假，scoped 门解红）：Touches 含 fan-in-execute.js/worker-driver.ts 的任务，scoped 门不再被 fan-in-workflow-check 全局红挡（⛔ 仍红 ⇒ 假）。
- [x] AC3（不误伤）：真 workflow 路径（非机械）仍被 a-workflow-call-coverage 正确红（⛔ 机械误豁免 ⇒ 假）。

## Definition of Done

isMechanicalRunId 扩认 oneoff-*；AC1-AC3 全勾；oneoff-* 落地不再误伤 fan-in-workflow-check。

## Touches

- plugin/scripts/fan-in-workflow-check.ts（isMechanicalRunId 扩认 oneoff-*）
- plugin/test/fan-in-workflow-check.test.mjs（oneoff-ls-* 机械识别 + 真 workflow 不误伤负控制）
- tasks/gap-fan-in-workflow-check-oneoff-ls-blind-spot.md（自身）
