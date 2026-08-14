---
id: gap-checker-mutation-cases-4-checkers
title: checker-mutation-check 4 个 checker 注册但缺 mutation case（cap-counts/fan-in-workflow/per-task-suite-record/rhythm-consumer）——develop 恒红挡 fan-in
status: todo
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**（4 个 checker 已注册进 checker-mutation-check 但缺 mutation case——2026-08-14 12:0xZ 由 ac63 fan-in 全量 suite 捕到）**。

**实测（inner 子代理在 ac63 workflow 全量 suite 中捕到，outer 复跑确认）**：`checker-mutation-check --list` 报 **uncovered: cap-counts-subagents-check fan-in-workflow-check per-task-suite-record-check rhythm-consumer-check**（4 个，全 `NO` mutation case）。**clean develop tip bd4612e5 同样红** ⇒ 非 ac63 引入（ac63 只改 pre-existing .ts + task.md，不加进 uncovered 集）。

**4 个 checker 的归属任务**（各自落地时注册进了 run_static_checks 但没补 mutation case）：
```
cap-counts-subagents-check       AC76 落   （gap-c24-4-5-7-no-landing 触及其 C24-4/5/7 落点）
fan-in-workflow-check            AC78 落   （gap-ac78-fan-in-workflow-a6-check）
per-task-suite-record-check      AC72 落   （gap-ac72-cert-mechanism-retire；ac63 在飞会改它）
rhythm-consumer-check            AC73 落   （gap-ac73-catalog-rhythm-consumer-check）
```

**影响**：develop 上 `checker-mutation-check` 红 ⇒ 全量 suite 红 ⇒ **挡 ac63 的 fan-in，也挡后续 workflows-dual-copy 的 fan-in**（全量 suite 会红）。**这是既有的欠账（前次已记录）**，不是本批引入——但现在是 fan-in 的阻塞源。

**判据1**：4 个 checker 各补一个 mutation case（每 checker 一个 fixture：正确态绿 + 一个破环注入红 + 恢复绿——照 checker-mutation-cases/ 既有形态如 adr016-screen-use-check）。
**判据2（能取假）**：现状 `--list` 报 4 个 uncovered（真样本，回放必须红）；补后 4 个全 `pass`。
**判据3**：`checker-mutation-check --selftest` 仍全 PASS（不破坏机制自身的自检）。
**判据4**：既有测试全绿 + `--for-task` scoped 门绿；clean develop tip 不再被 mutation-check 报 uncovered。

**不覆盖**：不改 4 个 checker 的核心判据逻辑（只加 mutation fixture）；不回溯历史（AC47 历史 done 不当证据）。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 checker-mutation-check.sh（--list/--run/--selftest 契约）+ 一个既有 mutation case（adr016-screen-use-check 形态）。
2. 判据1：4 个 checker 各补 mutation case（cap-counts / fan-in-workflow / per-task-suite-record / rhythm-consumer）。
3. 判据2 能取假：现状 4 uncovered 回放红 + 补后全绿。
4. 判据3：--selftest 仍 PASS。
5. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：4 个 checker（cap-counts / fan-in-workflow / per-task-suite-record / rhythm-consumer）各补 mutation case。
- [ ] AC2 判据2 能取假：现状 4 uncovered 回放红；补后全绿。
- [ ] AC3 判据3：--selftest 仍全 PASS。
- [ ] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] checker-mutation-check 4 个 uncovered checker 补齐 mutation case（每 checker 正确态绿 + 破环红 + 恢复绿），--list 不再报 uncovered，--selftest 仍 PASS，clean develop tip 的 checker-mutation-check 全绿——ac63 / workflows-dual-copy 的 fan-in 不再被它挡。

## Touches

- plugin/scripts/checker-mutation-cases/cap-counts-subagents-check.sh (new)
- plugin/scripts/checker-mutation-cases/fan-in-workflow-check.sh (new)
- plugin/scripts/checker-mutation-cases/per-task-suite-record-check.sh (new)
- plugin/scripts/checker-mutation-cases/rhythm-consumer-check.sh (new)
- plugin/scripts/checker-mutation-check.sh（若需要注册表更新）
- tasks/gap-checker-mutation-cases-4-checkers.md（自身）

## Evidence

（落地后回填）
