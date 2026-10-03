---
id: gap-goal-branch-ff-merge-source-param
title: ff-merge 的源不再写死 task/<id>——支持把目标分支 ff 到一个指定提交（goal 并入的 --no-ff 合并提交）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
goal_ac: AC-327
---
## Proposal

**机制**（`orchestration/SPEC-goal-branch-2026-10-03.md` §4.7、裁定⑲）：goal 并入 develop 时，要在锁内的临时 worktree 里用 `git merge --no-ff goal/<id>` 造出一个合并提交、跑完验证，再把 develop **ff** 到这个合并提交（develop 仍只做 ff）。而 `packages/quay/src/fan-in/ff-merge.ts` 的源写死为 `refs/heads/task/${task}`（`:562`、`:825`、`:911`、`:980`）——无法以一个合并提交为源。

**修法（方向）**：增加一个源参数（如 `--source-ref <ref|sha>`），缺省仍为 `refs/heads/task/<task>`，现有任务路径逐字不变；ancestry / landed-sha 前后校验对给定的源同样生效；源不是 mergeTarget 的后代时拒绝且不动任何 ref。

## AC

- [ ] `plugin/test/fan-in-ff-merge.test.mjs` 新增用例并断言：① 不传源参数时既有用例全部通过；② 源 = 一个第一父为 develop tip 的合并提交 SHA ⇒ develop 被 ff 到该 SHA，退出 0；③ 源不是 mergeTarget 后代 ⇒ 非 0 退出，且 develop 与源 ref 均未改变。
- [ ] 取假：把本任务的核心改动临时回退（用 `cp` 备份恢复，⛔ 不用 `git checkout --`）后，上面新增用例至少 1 条变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [ ] 5b 邻近扫描：在 `packages/quay/src/fan-in/` 与 `plugin/scripts/worker-fan-in.ts` 内 grep `refs/heads/task/`，把命中数与前 3 条贴进 Evidence，逐条判断是否处在「源」路径上；在源路径上且在 Touches 内的一并参数化。
- [ ] `bash scripts/test.sh --for-task gap-goal-branch-ff-merge-source-param` 退出 0，且确实执行了 ≥1 个测试文件（非 thin；在 `## Evidence` 贴出被执行的测试文件名）。

## DoD

真实落地判据：goal 并入时 develop 能被 ff 到一个经过验证的合并提交，现有任务 fan-in 不受影响。生产读数由 GOAL-028 的 AC-327（每个并入的 goal 在 develop first-parent 上恰为一个提交）在第一个试点 goal 并入后取得。

## Touches

- packages/quay/src/fan-in/ff-merge.ts
- plugin/test/fan-in-ff-merge.test.mjs
- tasks/gap-goal-branch-ff-merge-source-param.md
