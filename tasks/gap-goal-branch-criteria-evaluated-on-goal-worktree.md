---
id: gap-goal-branch-criteria-evaluated-on-goal-worktree
title: branch-mode goal 的判据在 detached 判据 worktree 上求值——否则 goal 代码只在 goal 分支上时永远判不过（B1）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal-branch-gate-event-evaluation-root
  - gap-goal-branch-data-model-and-lifecycle
goal_ac: AC-324
---
## Proposal

**机制**（`orchestration/SPEC-goal-branch-2026-10-03.md` §5 B1，裁定⑩㉒）：AC 判据的 cwd 恒为主检出的 git root（`packages/quay/src/goal-store.ts:1789` 注释「Criterion cwd = the git root」，求值点 `:1799`、`:2069`、`:2450`）。主检出跟随 develop。goal 的代码只在 `goal/<id>` 上 ⇒ 判据看不到 ⇒ AC 永不 achieved ⇒ goal 永不并入——**死锁**。I5 复验（`:1789` 所在函数）同样在主检出上跑，会把 goal 分支上已达成的 AC 全报成失败并触发假 gap。

**修法（已裁定⑩）**：每个 branch-mode goal（active、分支存在、尚未并入）一个判据 worktree，路径取配置解析出的 worktree 基目录下的 `goal-<GOAL-NNN>`（⛔ 不在 /tmp；记录 realpath），**detached HEAD** 于 `goal/<id>` tip；每轮求值前 `git checkout --detach goal/<id>` 刷新，刷新与求值串行。该 goal 的 AC（含 I5 复验）以它为 cwd；**gate 事件仍追加到主 root 的账本**（evaluationRoot 记录 worktree）。goal-driver 负责创建、刷新、删除这个 worktree（裁定㉒）。并入后（分支不存在）回到主检出求值。

## AC

- [ ] 新增 `plugin/test/goal-driver-criterion-worktree.test.mjs`（临时仓库）：branch-mode goal 下一个判据为 `test -f only-on-goal-branch.txt` 的 AC，该文件只提交在 `goal/GOAL-901` 上 ⇒ 求值 pass，事件 `payload.evaluationRoot` = 判据 worktree 的 realpath，且事件写在主 root 的 `.quay/gate-events.jsonl` 而不是 worktree 里；同一判据挂在非 branch-mode goal 下 ⇒ 在主 root 求值并失败。
- [ ] 同一测试文件覆盖 I5：branch-mode goal 并入前，一个已 achieved、依赖 goal 分支文件的 AC 不被报为 achieved-but-failing。
- [ ] 同一测试文件覆盖刷新：goal 分支前进一个提交后，下一轮求值看到新提交（判据 worktree 的 HEAD 等于新 tip）。
- [ ] `node --experimental-strip-types plugin/scripts/goal-driver-task-boundary-check.ts` 退出 0（goal-driver 不出现 task 写路径与本仓 fan-in 载体引用——DIR-131；注意注释里出现该类词也会被判红）。
- [ ] 取假：把本任务的核心改动临时回退（用 `cp` 备份恢复，⛔ 不用 `git checkout --`）后，上面新增用例至少 1 条变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [ ] 实测并记入 Evidence（§9.2 残留 5）：在临时仓库里把 `goal/GOAL-901` 检出到另一个 worktree 后执行 `git push . <sha>:refs/heads/goal/GOAL-901`，贴出是否被拒的输出——用以确认判据 worktree 必须 detached。
- [ ] `bash scripts/test.sh --for-task gap-goal-branch-criteria-evaluated-on-goal-worktree` 退出 0，且确实执行了 ≥1 个测试文件（非 thin；在 `## Evidence` 贴出被执行的测试文件名）。

## DoD

真实落地判据：goal 的代码只在 goal 分支上时，其 pre-merge AC 能在并入前被判为 pass，并在主账本留下带 worktree 求值根的事件。生产读数由 GOAL-028 的 AC-324 在第一个试点 goal 并入后取得。

## Touches

- packages/quay/src/goal-store.ts
- plugin/scripts/goal-driver.ts
- plugin/test/goal-driver-criterion-worktree.test.mjs
- tasks/gap-goal-branch-criteria-evaluated-on-goal-worktree.md
