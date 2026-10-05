---
id: gap-goal-branch-active-branch-mode-goal-without-branch-never-self-heals
title: active ∧ branch:true 的 goal 若 goal/<id> 不存在，没有任何 driver 补建——任务静默落
  develop（cantus GOAL-002 读到）
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on: []
goal_ac: AC-321
---
## Proposal

**机制**（2026-10-05 在 cantus 项目只读核实）：`goal/<id>` 只在「把 goal 写成 active」或「把 `branch` 第一次设为 true」的那一次写入里创建（`packages/quay/src/goal-store.ts:3040-3056` 的 `ensureGoalBranch` 调用点，条件 `enteringActive || branchJustSet`），之后**没有任何 driver 事后补建**。于是一个 active ∧ `branch: true` 却没有 `goal/<id>` 的 goal 会一直这样——激活由不带这段代码的旧 CLI 完成、分支被手工删了、或创建被 `blocked` 后只打了一行 stderr。此时 `resolveTaskMergeTargetDetail`（`plugin/scripts/worker-driver.ts:1761`）对它的任务返回 `develop`，reason=`branch-absent`，**所有任务静默落 develop**，isolation 的全部价值失效，而没有任何读数提示。

**生产读数**（cantus，2026-10-05，只读）：GOAL-002 `status: active`、`branch: true`，statusLog 只有 `draft → active`（actor yale）；`git branch --list 'goal/*'` 为空；只读解析 `gap-eval-m5-decision-adr`（goal_ac=AC-010）⇒ `mergeTarget: develop (branch-absent)`。该项目的 CLI（`which quay` → 插件缓存 0.11.0）不含 `ensureGoalBranch`，与「用旧 CLI 激活」一致；具体是哪个 CLI 写的激活我没有核实。

**修法（方向，实现者可调）**：goal-driver 每轮对每个 goal 做幂等的「补建」：status 为 active ∧ `branch: true` ∧ `goal/<id>` 不存在 ∧ **没有该 goal 的 `goal-merge-result` 且 outcome 为 landed 的事件** ⇒ 调 `ensureGoalBranch`（Core，`packages/quay/src/branch-model.ts:1119`），本轮读数记一条「由 driver 补建」并带分支 tip。
- ⚠️ 必须区分「从未创建」与「并入后已被删」：并入成功后 `goal/<id>` 被删而 goal 仍 active 直到 achieved，此时**不得**补建（否则又造出一条分支）。判据取已落账的并入结果事件（`packages/quay/src/goal-merge.ts:321` `readGoalMergeResults`，goal 侧可读，不含本仓 fan-in 载体路径）。
- goal-driver 受 DIR-131 约束：只读 git 引用与 goal 侧事件，⛔ 不写 task、⛔ 注释里不要出现 fan-in 字样（会被边界检查判红）。
- 已知残留窗口：补建之前派发的任务已经落了 develop，本任务不追溯（那是另一个问题）。

<!-- dedup-ref -->相关但机制不同：`gap-goal-branch-goal-flips-achieved-before-its-branch-merges`（done）修的是并入前提前 achieved；本任务修的是分支根本不存在。

## AC

- [ ] `plugin/test/goal-driver-criterion-worktree.test.mjs`（该文件已有 branch-mode goal 夹具）新增用例：① active ∧ `branch: true` 而 `goal/<id>` 不存在、且无 landed 的并入结果 ⇒ 一轮之后该分支存在且指向当时的 develop tip，读数记「driver 补建」；② 同样的 goal 但账本里有 landed 的并入结果、分支已删 ⇒ 不补建；③ 非 branch-mode 的 goal ⇒ 不受影响；④ 已存在分支 ⇒ 幂等，不移动 tip。
- [ ] 取假：把本任务的核心改动临时回退（用 `cp` 备份恢复，⛔ 不用 `git checkout --`）后，上面新增用例至少 1 条变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [ ] 5b 邻近扫描：grep `ensureGoalBranch` 与 `goalBranchRefExists` 在 `plugin/scripts/goal-driver.ts`、`packages/quay/src/goal-store.ts` 的其它使用点，把命中数与前 3 条贴进 Evidence，逐条判断是否存在其它「分支该在而不在」的静默分支；需要且在 Touches 内的一并改。
- [ ] `node --experimental-strip-types plugin/scripts/goal-driver-task-boundary-check.ts` 退出 0（DIR-131；⚠️ 注释里出现该类字样也会被判红）。
- [ ] `node --test plugin/test/goal-driver-criterion-worktree.test.mjs` 退出 0。

## DoD

真实落地判据：落地之后，一个 active ∧ `branch: true` 而分支缺失的 goal 在 goal-driver 的下一轮得到分支，其后派发的任务按 `goal_ac` 解析为 goal 分支而不是 develop。生产读数由 GOAL-028 的 AC-321（branch-mode goal 的任务只经其 goal 分支落地）在有这类 goal 的项目里取得；cantus 的 GOAL-002 是现成的对象，但它依赖 cantus 的 driver 已加载含本修复的版本，落地时可能尚未满足，完成记录里须写明。

## Touches

- plugin/scripts/goal-driver.ts
- plugin/test/goal-driver-criterion-worktree.test.mjs
- tasks/gap-goal-branch-active-branch-mode-goal-without-branch-never-self-heals.md
