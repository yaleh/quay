---
id: gap-goal-branch-worktrees-lack-node-modules
title: goal 分支的判据/预览 worktree 与并入临时 worktree 都是裸 git worktree add 建的、没有
  node_modules——预览 serve 起不来、并入时 pre-merge-commit 钩子找不到 yaml 而中止（GOAL-904 演练读到）
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal-criterion-worktree-registered-check-blind-to-symlinked-root
goal_ac: AC-325
---
## Proposal

**机制**（2026-10-04 在 GOAL-904 合并演练中读到，两处生产直接量，同一根因）：goal 分支的三类 worktree 都是裸 `git worktree add` 建的，没有任务 worktree 经 `plugin/scripts/dispatch-worktree-setup.sh` 得到的装配（把主检出的 `node_modules` 符号链接进去，零拷贝）。仓库根没有自己的依赖（`yaml` 等），任何在该 worktree 里跑 node 的东西都 `ERR_MODULE_NOT_FOUND`。

1. **判据 worktree / 预览 worktree**（`plugin/scripts/goal-driver.ts` `ensureGoalCriterionWorktree`，`goalCriterionWorktreeDir`）：`quay goal preview GOAL-904 start` 起的 serve 读 `quay-worktrees/goal-GOAL-904/.quay/preview-serve.log` 逐字：`Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'yaml' imported from …/goal-GOAL-904/packages/quay/src/config.ts`，`quay goal preview … start` 因此 30 秒超时失败。手工 `ln -s <主检出>/node_modules <worktree>/node_modules` 后预览立即起来。
2. **并入用的临时 worktree**（`plugin/scripts/worker-fan-in.ts` `runGoalMergeFanIn`，`mkdtemp` 下的 `wt`）：`goal-merge-result` 事件（GOAL-904，2026-10-03T17:52:40Z）逐字：`Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'yaml' imported from /tmp/goal-merge-GOAL-904-EMKfuu/wt/plugin/scripts/task-schema.ts … Not committing merge; use 'git commit' to complete the merge.`——`git merge --no-ff` 触发的 pre-merge-commit 钩子在没有依赖的 worktree 里崩了，合并被中止。

**修法（方向，实现者可调）**：三类 worktree 在创建（和刷新）时都经**同一处**装配依赖：主检出有 `node_modules` 就符号链接，没有则不建链并如实读出（⛔ 不抛、⛔ 不伪装成成功）。⚠️ 约束：`dispatch-worktree-setup.sh` 会拒绝非 `task/<id>` 分支（detached 的 goal worktree 会被拒），不能原样调用；sh-census 棘轮零余量，改该 .sh 须行数中性；goal-driver 受 DIR-131 约束（不得引用本仓落地载体，注释里出现 fan-in 字样也会被判红）。优先把「符号链接 node_modules」抽成一个被复用的小函数，⛔ 不要在 goal-driver 与 worker-fan-in 各抄一份。

<!-- dedup-ref -->相关但机制不同：`gap-goal-branch-criteria-evaluated-on-goal-worktree`（done）与 `gap-goal-branch-preview-instance`（done）建立了这些 worktree 与预览，本任务补它们的依赖装配；`gap-goal-criterion-worktree-registered-check-blind-to-symlinked-root` 修的是同一函数里的「已登记」判定，两者改同一个文件，故本任务排在它之后。

## AC

- [ ] `plugin/test/goal-driver-criterion-worktree.test.mjs` 新增用例（临时仓库，主检出建一个 `node_modules` 目录）：判据 worktree 创建后与刷新后，`<worktree>/node_modules` 存在且 realpath 等于主检出 `node_modules` 的 realpath；已存在时再次处置不报错、不改动；主检出没有 `node_modules` 时不建链、处置读数如实说明、不抛。
- [ ] `plugin/test/worker-driver.test.mjs` 的 goal-merge e2e 新增用例（临时仓库，主检出建 `node_modules` 目录，并给仓库装一个 `pre-merge-commit` 钩子：当前目录没有 `node_modules` 就非 0 退出）：并入执行的结果是 `landed`，develop 上出现 subject 形如 `merge: goal/GOAL-901 into develop (request …)` 的合并提交。
- [ ] 取假：把本任务的核心改动临时回退（用 `cp` 备份恢复，⛔ 不用 `git checkout --`）后，上面新增用例至少 1 条变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [ ] 5b 邻近扫描：在 `plugin/scripts/` 与 `packages/quay/src/` 内 grep 其它裸 `git worktree add` 的调用点（goal 分支以外的也列出），把命中数与前 3 条贴进 Evidence，逐条判断是否同样需要依赖装配；需要且在 Touches 内的一并改，其余在 Evidence 写明理由。
- [ ] `node --experimental-strip-types plugin/scripts/goal-driver-task-boundary-check.ts` 退出 0（DIR-131：goal-driver 不出现 task 写路径与本仓 fan-in 载体引用；⚠️ 注释里出现该类字样也会被判红）。
- [ ] `node --test plugin/test/goal-driver-criterion-worktree.test.mjs` 与 `node --test plugin/test/worker-driver.test.mjs` 退出 0。

## DoD

真实落地判据：落地之后，对一个 branch-mode goal 执行 `quay goal preview <GOAL> start` 不再需要任何手工装配就能起来，且 `quay goal merge` 触发的并入不再因缺依赖被钩子中止。生产读数由 GOAL-028 的 AC-325/AC-328 在一次真实的 goal 并入与预览之后取得；本任务落地时 GOAL-904 的并入请求仍卡在上一次的红（见 `gap-goal-merge-infra-red-mislabelled-and-rerequest-never-retries`），需人再发一次请求。

## Touches

- plugin/scripts/goal-driver.ts
- plugin/scripts/worker-fan-in.ts
- packages/quay/src/goal-preview.ts
- plugin/test/goal-driver-criterion-worktree.test.mjs
- plugin/test/worker-driver.test.mjs
- tasks/gap-goal-branch-worktrees-lack-node-modules.md
