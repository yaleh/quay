---
id: gap-verification-round-static-fail-no-record
title: verification-round.jsonl 静态检查 fail-closed 轮次不落记录——「没跑」与「跑了但静态闸拦下」在账本同形
status: superseded
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

> **superseded 2026-08-25（pool-quality-judge should-remove，独立复核确认）**：前提证伪——`verification-round.jsonl` 已有 31 条 `gate=static-check` + 34 条 `reason=gate-failed` 记录，静态检查 fail-closed 轮次**本来就在落记录**（`full-suite-runner.ts:3223-3231` 把 `staticCheckDetected` 映射为 `reason="gate-failed" + gate="static-check"`，commit 5ef1a789 于 08-12 落地）。manager 的「split-long 7 次 0 轮」是**归因误判**（count 的是动态阶段轮次，非全部轮次），不是机制缺口。我立案时未独立核实前提（照抄 manager 归因）——硬规则「verify 不 trust」的 filing 方向反例。

## Proposal

`verification-round.jsonl` 只在**动态测试阶段完成后**落 round 记录；**静态检查阶段 fail-closed 中止的轮次一条都不写**。⇒ 账本上「没跑到套件」与「跑到了、还跑绿了 mutation 自检、但死在静态闸（如 spec-declaration-point-check）」**同形**（都是零 round 记录）。实证 2026-08-25：manager 看到 split-long「7 次 0 轮」就推断「从未跑到套件」，实际它跑到了、mutation 自检 52/52 绿，死在 spec-declaration-point-check 静态闸上。这个缺口让「没跑」和「跑了但被静态闸拦下」不可区分，误导归因。

## Plan

静态检查 fail-closed 中止的轮次也落一条 round 记录（带 `phase: static-fail` + 中止原因 + 已跑的静态检查名），与动态阶段完成的 round 记录区分（不同 phase 字段）。⛔ 不改变动态阶段的现有记录形态（只补静态 fail 的覆盖）。

## Acceptance Criteria

- [ ] AC1（能取假，静态 fail 落记录）：静态检查 fail-closed 中止的轮次在 verification-round.jsonl 有对应记录（带 phase=static-fail + 中止原因）；（⛔ 仍零记录 ⇒ 假）。
- [ ] AC2（能取假，可区分）：「没跑」与「跑了但静态闸拦下」在账本上可区分（前者无记录、后者有 static-fail 记录）；（⛔ 仍同形 ⇒ 假）。
- [ ] AC3（能取假，负控制回放）：回放 split-long 今天的静态闸中止场景，改造后能看出「跑到套件 + mutation 52/52 绿 + 死在静态闸」而非「没跑」；（⛔ 仍不可区分 ⇒ 假）。

## Definition of Done

静态 fail-closed 轮次落记录（phase=static-fail）；AC1/AC2/AC3 全勾；split-long 场景回放可区分「没跑」vs「跑了但静态闸拦下」。

## Touches

- plugin/scripts/full-suite-runner.ts（静态检查 fail-closed 时落 round 记录）
- plugin/scripts/（verification-round 记录写入方，静态 phase 覆盖）
- tasks/gap-verification-round-static-fail-no-record.md（自身）
