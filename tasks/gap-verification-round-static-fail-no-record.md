---
id: gap-verification-round-static-fail-no-record
title: 静态闸 fail 记录对 spec-declaration-point-check 失败不触发 + 记录无 taskId 归因——今天 split-long 真实失败 0 记录（31 历史记录全 taskId=None）
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

> **前提修正（2026-08-25，pool-quality-judge should-remove → manager 复核 → 撤回 supersede）**：本任务曾被我误判「前提证伪」而 supersede（f8fbf237）。manager 复核后撤回：机制**存在且历史上工作过**（31 条 `gate=static-check` 记录，08-12~08-24，`full-suite-runner.ts:3223-3231`，commit 5ef1a789），但**今天（08-25）split-long 真实撞到的 spec-declaration-point-check 失败，一条记录都没落**。我两次都没把「机制存在」与「机制今天触发了」分开验——第一次照抄 manager 归因没核实前提，第二次信了 judge 的「31 条存在=前提证伪」没查今天是否真触发。这是硬规则「verify 不 trust」同坑两次。

## Proposal

`full-suite-runner.ts` 的静态闸 fail 记录机制（`isStaticCheckFailureLine` → `staticCheckDetected` → `reason="gate-failed" + gate="static-check"`）**存在且历史工作过**：`verification-round.jsonl` 有 31 条 `gate=static-check` 记录（08-12~08-24）。但两个真实缺口（已核实）：

1. **今天（08-25）该机制对 spec-declaration-point-check 的失败没触发**：`verification-round.jsonl` 今天 0 条 `gate=static-check`、0 条 spec-declaration-point 的 gate-fail 记录；而 split-long 今天确实撞到 `STATIC_CHECK_FAILED: spec-declaration-point-check exit=1`（manager 核实 fan-in suite log，现已轮转）。`isStaticCheckFailureLine` 的正则 `/^STATIC_CHECK_FAILED:/` 本应命中该行，但没产生记录——为何不触发待诊断（可能：该失败走的路径绕过 full-suite-runner 记录 / `testPhaseStarted` 守卫 / pre-verified-suite 路径）。
2. **记录无 taskId 归因**：31 条历史记录 `taskId` 字段**全部 None**——即便产生记录，也无法按 taskId 归因到具体任务。

⇒ 「没跑」与「跑了但静态闸拦下」的不可区分仍在（今天 split-long 那次就是：动态阶段 0 轮 + 静态闸 fail 也 0 记录 ⇒ 账本上彻底「没跑」）。

## Plan

诊断并修复 spec-declaration-point-check 失败不落记录的真实原因（⛔ 先定位根因再改，不要直接加 `phase=static-fail` 别名——那会掩盖「为何该走的路没走」）；并给 `gate=static-check` 记录补 `taskId` 归因。修法由落笔方定，但须覆盖上述两个缺口。

## Acceptance Criteria

- [ ] AC1（能取假，今天失败落记录）：复现 split-long 今天的 spec-declaration-point-check 失败（`STATIC_CHECK_FAILED: spec-declaration-point-check exit=1`），`verification-round.jsonl` 出现对应的 `gate=static-check` 记录（failures[] 含 checker 名）；（⛔ 仍 0 记录 ⇒ 假）。
- [ ] AC2（能取假，taskId 归因）：该记录 `taskId` 非 None（能归因到 split-long 任务）；（⛔ 仍 None ⇒ 假）。
- [ ] AC3（能取假，不回归）：31 条历史记录（08-12~08-24）不变形、机制对其它静态闸（如 direct-to-develop-bypass-check）仍正常落记录（回归用历史记录回放验证）；（⛔ 回归/历史记录变形 ⇒ 假）。

## Definition of Done

spec-declaration-point-check 失败落 `gate=static-check` 记录 + 记录带 taskId；AC1/AC2/AC3 全勾；split-long 场景回放可区分「没跑」vs「跑了但静态闸拦下」且可归因到任务。

## Touches

- plugin/scripts/full-suite-runner.ts（静态闸 fail 记录触发路径 + taskId 归因）
- plugin/scripts/（verification-round 记录写入方，静态 phase 覆盖 + taskId 字段）
- tasks/gap-verification-round-static-fail-no-record.md（自身）
