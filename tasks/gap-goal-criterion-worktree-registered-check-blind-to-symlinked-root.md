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

- [x] `plugin/test/goal-driver-criterion-worktree.test.mjs` 新增用例（临时目录里建真实目录与指向它的符号链接，以**符号链接路径**作 root）：创建判据 worktree 后让 `goal/GOAL-901` 前进一个提交，再跑一次处置，断言读数 `state` 为 `refreshed`（不是 `failed`）、worktree HEAD 等于新 tip；同一用例在以真实路径作 root 时行为一致。
- [x] 取假：把比较改回 `path.resolve`（用 `cp` 备份恢复，⛔ 不用 `git checkout --`）后，上面符号链接用例变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [x] 5b 邻近扫描：在 `plugin/scripts/goal-driver.ts`、`packages/quay/src/goal-preview.ts`、`packages/quay/src/goal-store.ts` 内 grep 把 `git worktree list` 输出或 `worktree` 路径与别名路径做相等比较的点，把命中数与前 3 条贴进 Evidence，逐条判断是否同样要取 realpath；需要且在 Touches 内的一并改。
- [x] `node --test plugin/test/goal-driver-criterion-worktree.test.mjs` 退出 0。
- [x] `node --experimental-strip-types plugin/scripts/goal-driver-task-boundary-check.ts` 退出 0（goal-driver 不出现 task 写路径与本仓 fan-in 载体引用——DIR-131）。

## DoD

真实落地判据：落地之后，goal-driver 对 branch-mode goal 的判据 worktree 在 goal 分支前进后的下一轮读数为 `refreshed`，worktree HEAD 追上 `goal/<id>` tip，而不是连续 failed。生产读数由 GOAL-028 的 AC-324 在下一个 branch-mode goal 的任务落到 goal 分支之后取得：该 goal 的 `criterionWorktrees` 读数里 `state` 不得连续 ≥2 轮为 `failed`。

## Evidence

**修复落点**：`git worktree add` 登记的是**真实路径**（`/data/home/yale/...`），而 `goalCriterionWorktreeDir` 经配置解析出的是**别名**（`/home/yale/...`，指向它的符号链接）。新增 `realpathOrSelf`（`packages/quay/src/goal-store.ts`，`fs.realpathSync` + 最近存在祖先回退，⛔ 不因 ENOENT 抛），`criterionWorktreeRegistered`（`plugin/scripts/goal-driver.ts`）两侧都改用它；`goal-preview.ts` 的 `samePath` 一并统一（5b）。

**AC1/AC4 —— 新用例 + 全文件绿**（`node --test plugin/test/goal-driver-criterion-worktree.test.mjs`，worktree 内实跑）：
```
✔ 符号链接 root：判据 worktree 已登记后分支前进 ⇒ 次轮 refreshed（⛔ 不是 failed），HEAD 追上新 tip；真实路径 root 行为一致 (5997.825633ms)
✔ AC1+AC2: ... (2234.318779ms)
✔ AC3: ... (4071.964109ms)
✔ 判据 worktree 的路径由【配置解析出的】worktree 基目录派生：... (93.599299ms)
✔ AC-phase-split: ... (3544.151851ms)
✔ AC-phase-i2: ... (0.369561ms)
ℹ tests 6
ℹ pass 6
ℹ fail 0
EXIT=0
```
新用例同时断言直接量：`git worktree list --porcelain` 登记的是 `fs.realpathSync(wtPath)`（真实路径），且 link 形态下登记的**不是**别名路径——这就是旧 `path.resolve` 比较失败的机制。

**AC2 —— 取假**（`cp plugin/scripts/goal-driver.ts /tmp/gd.fixed.bak` → 把比较改回 `path.resolve` → 跑 → `cp` 恢复，⛔ 未用 `git checkout --`）：
- 改回 `path.resolve` 后，link 形态红、real 形态仍绿（负控制方向正确；real 形态在 loop 中先跑并通过）：
```
✖ 符号链接 root：... (5763.921849ms)
  AssertionError [ERR_ASSERTION]: link: 第 2 轮 = refreshed（实测 state=failed reason=worktree add failed: Preparing worktree (detached HEAD 9f58cd8)
  fatal: '/tmp/goal-crit-sym-Cw013C/link/wt-ns/goal-GOAL-901' already exists）
  + actual - expected
  + 'failed'
  - 'refreshed'
ℹ tests 1
ℹ pass 0
ℹ fail 1
```
- 恢复后（`md5 daeeba9fcf0f04e65b509ba95e1b2f5d`，与修复版逐字节一致）再跑：
```
✔ 符号链接 root：... (5925.539651ms)
ℹ tests 1
ℹ pass 1
ℹ fail 0
EXIT=0
```

**AC3 —— 5b 邻近扫描**（三文件内，谓词与命中数如下）：
- `grep -rn "worktree list\|porcelain"` → 逐文件命中数 `goal-driver.ts:2` / `goal-preview.ts:0` / `goal-store.ts:0`。前 3 条（共 2 条）：
  1. `plugin/scripts/goal-driver.ts:3128` — 注释（描述 `git worktree list --porcelain` 的登记面）
  2. `plugin/scripts/goal-driver.ts:3137` — `criterionWorktreeRegistered` 的**读取点** ⇒ **本任务修复**
- `grep -rn "worktree" <三文件> | grep -E "===|path\.resolve|realpath|samePath"` → 命中 **3**（均落在 `criterionWorktreeRegistered` 的注释与比较行）。除它之外，三文件内 `worktree` 路径**相等比较**点仅 1 处：`packages/quay/src/goal-preview.ts:95` `samePath`（比较 `previewRoot/.quay` 与主检出 `.quay`，即 worktree 路径 vs 别名路径）——旧实现已取 `realpathSync` 但 ENOENT 回落用 `path.resolve`；**一并改为 `realpathOrSelf`**（在 Touches 内）。
- `goal-store.ts`：**0** 个 worktree-list 比较点；`goalCriterionWorktreeDir`（`:198`）只做纯推导、`evaluationContext`（`:165`）已取 `fs.realpathSync`、`resolveCriterionRoot` 只比分支存在性 ⇒ **无需改**。

**AC5 —— goal-driver 边界检查**：
```
goal-driver-task-boundary-check: PASS — goal-driver.ts has no task-write call sites (task_write/lifecycle_*/fs.write-to-tasks) and no OWN-REPO fan-in/落地率 carrier reads outside the target-probe exempt span
EXIT=0
```

## Touches

- plugin/scripts/goal-driver.ts
- packages/quay/src/goal-preview.ts
- packages/quay/src/goal-store.ts
- plugin/test/goal-driver-criterion-worktree.test.mjs
- tasks/gap-goal-criterion-worktree-registered-check-blind-to-symlinked-root.md
