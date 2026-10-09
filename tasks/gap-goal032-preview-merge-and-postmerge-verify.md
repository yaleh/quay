---
id: gap-goal032-preview-merge-and-postmerge-verify
title: GOAL-032 ③：预览试用、quay goal merge、并入后生产读数核验
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal032-selfhost-and-archguard-evidence
goal_ac: AC-349
---
**type:** execution

## Proposal

GOAL-032 的第三块，也是最后一块：在 AC-347/348 均已达成的前提下，发起 `quay goal merge`，并入后核验生产读数与合并形态（AC-349）。

## Plan

1. `quay goal preview GOAL-032 start --port <n>`（可选，本次改动风险小，若实现者判断没必要起 preview 也可，但若起则按惯例核验跑的是分支代码）。
2. `quay goal merge GOAL-032 --reason "…"`——记录一条 HUMAN 合并请求事件，真正的 merge 由 worker-driver 执行（SPEC-goal-branch §4.7）。
3. 等待（或在本任务的后续轮次里核验）worker-driver 完成 `goal/GOAL-032 → develop` 的机械 fan-in。**若 fan-in 在 suite 步骤红，先判断是否是与 GOAL-030/031 遇到过的同族"全量 suite 并发环境伪影"（可参照 `gap-goal-merge-suite-concurrent-npm-pack-staging-race-blocks-fan-in`/`gap-loop-shipping-worktree-container-snapshot-toctou-race` 的诊断方法：先在隔离 worktree 单独跑失败的测试文件确认是否复现），⛔ 不要不经诊断就重试或改判据。**
4. 并入后：主检出追平 develop；核对 develop 上 `grep -c "parseBinaryVerdict" packages/quay/src/criterion-fidelity.ts plugin/scripts/goal-driver.ts` 两者均 ≥1；核对 `goal/GOAL-032` 以恰好一个合并提交进入 develop 的 first-parent 链（AC-349 criterion 已有该检查逻辑，可直接复用）。
5. 核对 GOAL-032 与 AC-347/348/349 的 staleness/achieved 状态在合并后正确收敛（`quay goal check --staleness`）。
6. ⛔ 本任务不重启任何生产 driver 进程。若实现过程中判断某个改动需要重启生产 goal-driver 进程才能在生产"生效"（区别于"代码已正确落地"），必须在任务体里**只报告**准备情况与影响，**不执行重启**，交回给调用方裁定。

## Acceptance Criteria

- [ ] `.quay/gate-events.jsonl` 含一条 `GOAL-032` 的 `goal-merge-request` 事件，无 `--override`（若需要 override，先核对是哪条 AC 未达成，不盲目越过）
- [ ] develop 上 `grep -c "parseBinaryVerdict" packages/quay/src/criterion-fidelity.ts` 与 `plugin/scripts/goal-driver.ts` 均 ≥1
- [ ] `goal/GOAL-032` 以恰好一个合并提交进入 develop 的 first-parent 链，该合并提交的第二父提交 = 分支 tip
- [ ] `quay goal check --staleness` 对 GOAL-032 不报任何新鲜度分歧
- [ ] 若判断需要生产 driver 重启：仅在任务体里记录「哪个 driver、读哪个配置、重启后行为会怎样变化、当前生产読数现状」，**不执行**

## Definition of Done

GOAL-032 以恰好一个合并提交进入 develop；develop 上两处调用方均已委托给 kernel；AC-347/348/349 在并入后全部可判定为真；全程未重启任何生产 driver 进程。

## Touches

- tasks/gap-goal032-preview-merge-and-postmerge-verify.md
