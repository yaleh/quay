---
id: gap-goal031-preview-merge-and-postmerge-verify
title: GOAL-031 ③：预览试用、quay goal merge、并入后生产读数核验
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal031-selfhost-evidence-and-arch-layer-review
goal_ac: AC-345
---
**type:** execution

## Proposal

GOAL-031 的第三块，也是最后一块：在 AC-343/344 均已达成的前提下，起预览实例供人试用，确认后发起 `quay goal merge`，并入后核验生产读数与合并形态（AC-345）。

## Plan

1. `quay goal preview GOAL-031 start --port <n>`，确认预览起得来、跑的是 goal 分支自己的代码（可复用 Task ②产出的自举身份探针技巧快速抽查一次，不要求重新造一整套）。
2. 人在预览上试用后，`quay goal merge GOAL-031 --reason "…"`——这只是记录一条 HUMAN 合并请求事件，真正的 merge 由 worker-driver 执行（SPEC-goal-branch §4.7），本任务只需确认事件写入成功、且不是 `--override`（AC-343/344 均应已达成，不需要越过未满足项强推）。
3. 等待（或在本任务的后续轮次里核验）worker-driver 完成 `goal/GOAL-031 → develop` 的机械 fan-in。
4. 并入后：主检出追平 develop；核对 develop 上 `grep -c 'status === "needs-human"' plugin/scripts/goal-driver.ts` = 1；核对 `goal/GOAL-031` 以恰好一个合并提交进入 develop 的 first-parent 链（与 AC-345 criterion 的检查逻辑一致，可直接复用那段 bash 自查）。
5. 核对 GOAL-031 与 AC-343/344/345 的 staleness/achieved 状态在合并后正确收敛（`quay goal check --staleness`）。

## Acceptance Criteria

- [ ] `quay goal preview GOAL-031 status` 显示 running，且跑的是分支自己的代码（不是 `serve-runs-foreign-code`）
- [ ] `.quay/gate-events.jsonl` 含一条 `GOAL-031` 的 `goal-merge-request` 事件，无 `--override`
- [ ] develop 上 `grep -c 'status === "needs-human"' plugin/scripts/goal-driver.ts` 等于 1
- [ ] `goal/GOAL-031` 以恰好一个合并提交进入 develop 的 first-parent 链，该合并提交的第二父提交 = 分支 tip（同 AC-345 criterion 的检查逻辑）
- [ ] `quay goal check --staleness` 对 GOAL-031 不报任何新鲜度分歧

## Definition of Done

GOAL-031 以恰好一个合并提交进入 develop；develop 上 `needs-human` 裸字面量计数修复为 1；AC-343/344/345 在并入后全部可判定为真（由各自 criterion 独立核验，本任务不代替判定，只负责把分支推进到可判定的状态）。

## Touches

- tasks/gap-goal031-preview-merge-and-postmerge-verify.md
