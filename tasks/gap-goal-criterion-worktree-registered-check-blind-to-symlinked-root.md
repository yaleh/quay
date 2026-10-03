---
id: gap-goal-criterion-worktree-registered-check-blind-to-symlinked-root
title: 判据 worktree 的「已登记」判定用 path.resolve 比较，符号链接 root（/home/yale →
  /data/home/yale）下永远判未登记——worktree 建好后再也刷新不了（GOAL-904 演练读到，连续 failed）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on: []
goal_ac: AC-324
---
## Proposal

**机制**（2026-10-04 在 GOAL-904 合并演练中读到，生产直接量）：`plugin/scripts/goal-driver.ts:3130` `criterionWorktreeRegistered` 用 `path.resolve(wtPath)` 与 `git worktree list --porcelain` 登记的路径逐一比较。`path.resolve` **不解析符号链接**：本机 `/home/yale` 是指向 `/data/home/yale` 的符号链接，`goalCriterionWorktreeDir(root, goalId)` 以别名 root 给出 `/home/yale/work/quay-worktrees/goal-GOAL-904`，而 git 登记的是真实路径 `/data/home/yale/work/quay-worktrees/goal-GOAL-904`。比较永远不等 ⇒ 判「未登记」⇒ `ensureGoalCriterionWorktree`（`:3146`）走 `git worktree add`，目录已存在而失败，prune 后重试仍失败 ⇒ 处置读数 `state: "failed"`。第一次创建时目录不存在，`add` 成功（登记成真实路径）；此后每一轮都是 failed，**判据 worktree 再也不会刷新到 goal 分支的新 tip**。

**生产读数**（`.quay/goal-round.jsonl` 的 goal-ring.criterionWorktrees，GOAL-904，连续三轮 17:32/17:37/17:41Z）：`state: failed`、`reason: worktree add failed: Preparing worktree (detached HEAD 774f9c137) fatal: '/home/yale/work/quay-worktrees/goal-GOAL-904' already exists`；同一时刻 `git worktree list --porcelain` 登记 `/data/home/yale/work/quay-worktrees/goal-GOAL-904`，`readlink -f` 别名路径得到同一个真实路径；worktree HEAD 停在 `224e83d78`（创建时的 tip），而 `goal/GOAL-904` 已前进到 `774f9c137`。

**后果**：branch-mode goal 的 pre-merge AC（含 live-probe）在 goal 分支前进之后一直在**旧树**上求值；预览实例读到旧树。SPEC §5 B1 的方案在任何符号链接 root 的主机上，第一次落地之后就失效。`plugin/test/goal-driver-criterion-worktree.test.mjs` 用 `/tmp` 真实路径，覆盖不到这条。

**修法（方向，实现者可调）**：登记比较两侧都取 realpath（`fs.realpathSync`，目标目录不存在时回退到「其存在的最近祖先的 realpath + 余下路径」，⛔ 不能因 ENOENT 抛出）。同族别处：本函数之外凡把 `git worktree list` 的输出与别名路径比较的点（`goal-driver.ts`、`packages/quay/src/goal-preview.ts`、`packages/quay/src/goal-store.ts`）一并核对。

<!-- dedup-ref -->相关但机制不同：`gap-goal-branch-criteria-evaluated-on-goal-worktree`（done）建立了判据 worktree 的创建与刷新，本任务修的是它在符号链接 root 下的「已登记」判定。

## AC

- [ ] `plugin/test/goal-driver-criterion-worktree.test.mjs` 新增用例（临时目录里建真实目录与指向它的符号链接，以**符号链接路径**作 root）：创建判据 worktree 后让 `goal/GOAL-901` 前进一个提交，再跑一次处置，断言读数 `state` 为 `refreshed`（不是 `failed`）、worktree HEAD 等于新 tip；同一用例在以真实路径作 root 时行为一致。
- [ ] 取假：把比较改回 `path.resolve`（用 `cp` 备份恢复，⛔ 不用 `git checkout --`）后，上面符号链接用例变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [ ] 5b 邻近扫描：在 `plugin/scripts/goal-driver.ts`、`packages/quay/src/goal-preview.ts`、`packages/quay/src/goal-store.ts` 内 grep 把 `git worktree list` 输出或 `worktree` 路径与别名路径做相等比较的点，把命中数与前 3 条贴进 Evidence，逐条判断是否同样要取 realpath；需要且在 Touches 内的一并改。
- [ ] `node --test plugin/test/goal-driver-criterion-worktree.test.mjs` 退出 0。
- [ ] `node --experimental-strip-types plugin/scripts/goal-driver-task-boundary-check.ts` 退出 0（goal-driver 不出现 task 写路径与本仓 fan-in 载体引用——DIR-131）。

## DoD

真实落地判据：落地之后，goal-driver 对 branch-mode goal 的判据 worktree 在 goal 分支前进后的下一轮读数为 `refreshed`，worktree HEAD 追上 `goal/<id>` tip，而不是连续 failed。生产读数由 GOAL-028 的 AC-324 在下一个 branch-mode goal 的任务落到 goal 分支之后取得：该 goal 的 `criterionWorktrees` 读数里 `state` 不得连续 ≥2 轮为 `failed`。

## Touches

- plugin/scripts/goal-driver.ts
- packages/quay/src/goal-preview.ts
- packages/quay/src/goal-store.ts
- plugin/test/goal-driver-criterion-worktree.test.mjs
- tasks/gap-goal-criterion-worktree-registered-check-blind-to-symlinked-root.md
