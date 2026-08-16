---
id: gap-ac81-anchor-check-canonical-live-byte-mismatch
title: AC81 判据4 outer-anchor-check 恒报 VIOLATED——canonical prompt 829b vs live 578b 字节不符，对账不一致（registry verify 却说 OK）
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**（inner 2026-08-16 立案——每 tick AC81 判据4 报 VIOLATED，但按 prompt 规则「三条全真则不动」不触发重建，差异被报告为 follow-up。实测：`outer-anchor-check.ts --layer inner --stdin` canonical 828/829b vs live 578b，byte 不符；而 `outer-cron-registry.ts --verify` 四判据全真（anchorMatches=true）。两个检查器对同一锚给出【相反】判据4 → 对账不一致，必须裁决谁对。）**

**现象**：`outer-anchor-check.ts` 读 canonical（`plugin/loop/fast-mode-loop-tick.md` 里的 inner tick prompt 段）比对 live cron prompt，字节不符（828 vs 578）。而 `outer-cron-registry.ts --verify` 说 anchorMatches=true（cron 存储 prompt sha == registry）。**两条读法对「锚是否正确」给出相反答案 ⇒ 至少一条错了（或读的是不同的正本）。**

**先行澄清（必须）**：①canonical 提取读的是 fast-mode-loop-tick.md 的哪一段（`outer-anchor-check.ts` 提取逻辑）？②registry 的 anchorMatches 比对的是什么（registry 存的 prompt hash vs CronList 的？）？③live cron prompt 到底是多少字节（578b 是我喂 stdin 的实际 text）？——三条合起来裁决：是 canonical 文档段过时（prompt 正本被改短/改长），还是 cron 创建时用了与正本不同的 prompt，还是 outer-anchor-check 提取了错误的段。

**判据1**：AC81 判据4 不再每 tick 报 VIOLATED（canonical 与 live 一致，或检查器修正）。
**判据2（能取假）**：改坏任一（canonical 或 live）仍报 VIOLATED；两条检查器（registry verify + anchor-check）对判据4 给出一致的读法。
**判据3**：既有测试全绿；`--for-task` scoped 门绿。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 outer-anchor-check.ts 提取逻辑 + outer-cron-registry.ts anchorMatches 逻辑 + 实测 live/canonical 字节。
2. 裁决：canonical 段过时（更新文档）或 cron prompt 过时（重建 cron）或检查器提取 bug（修）。
3. 落地 + 测试（负控制）。
4. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：AC81 判据4 不再恒 VIOLATED。
- [ ] AC2 判据2 能取假：改坏任一仍 VIOLATED；两检查器判据4 一致。
- [ ] AC3 判据3：既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] AC81 判据4 对账一致（canonical/live 一致或检查器修正），不再每 tick 报 VIOLATED。

## Touches

- plugin/scripts/outer-anchor-check.ts（如需，提取逻辑）
- plugin/scripts/outer-cron-registry.ts（如需，anchorMatches 逻辑）
- plugin/loop/fast-mode-loop-tick.md（如需，canonical prompt 段更新）
- tasks/gap-ac81-anchor-check-canonical-live-byte-mismatch.md（自身）
