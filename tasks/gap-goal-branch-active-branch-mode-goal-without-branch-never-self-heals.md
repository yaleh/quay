---
id: gap-goal-branch-active-branch-mode-goal-without-branch-never-self-heals
title: active ∧ branch:true 的 goal 若 goal/<id> 不存在，没有任何 driver 补建——任务静默落
  develop（cantus GOAL-002 读到）
status: ready
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

- [x] `plugin/test/goal-driver-criterion-worktree.test.mjs`（该文件已有 branch-mode goal 夹具）新增用例：① active ∧ `branch: true` 而 `goal/<id>` 不存在、且无 landed 的并入结果 ⇒ 一轮之后该分支存在且指向当时的 develop tip，读数记「driver 补建」；② 同样的 goal 但账本里有 landed 的并入结果、分支已删 ⇒ 不补建；③ 非 branch-mode 的 goal ⇒ 不受影响；④ 已存在分支 ⇒ 幂等，不移动 tip。
- [x] 取假：把本任务的核心改动临时回退（用 `cp` 备份恢复，⛔ 不用 `git checkout --`）后，上面新增用例至少 1 条变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [x] 5b 邻近扫描：grep `ensureGoalBranch` 与 `goalBranchRefExists` 在 `plugin/scripts/goal-driver.ts`、`packages/quay/src/goal-store.ts` 的其它使用点，把命中数与前 3 条贴进 Evidence，逐条判断是否存在其它「分支该在而不在」的静默分支；需要且在 Touches 内的一并改。
- [x] `node --experimental-strip-types plugin/scripts/goal-driver-task-boundary-check.ts` 退出 0（DIR-131；⚠️ 注释里出现该类字样也会被判红）。
- [x] `node --test plugin/test/goal-driver-criterion-worktree.test.mjs` 退出 0。

## DoD

真实落地判据：落地之后，一个 active ∧ `branch: true` 而分支缺失的 goal 在 goal-driver 的下一轮得到分支，其后派发的任务按 `goal_ac` 解析为 goal 分支而不是 develop。生产读数由 GOAL-028 的 AC-321（branch-mode goal 的任务只经其 goal 分支落地）在有这类 goal 的项目里取得；cantus 的 GOAL-002 是现成的对象，但它依赖 cantus 的 driver 已加载含本修复的版本，落地时可能尚未满足，完成记录里须写明。

## Touches

- plugin/scripts/goal-driver.ts
- plugin/scripts/driver-runtime.ts
- plugin/test/goal-driver-criterion-worktree.test.mjs
- tasks/gap-goal-branch-active-branch-mode-goal-without-branch-never-self-heals.md

## Evidence

### AC1/2 — 新增用例（`node --test plugin/test/goal-driver-criterion-worktree.test.mjs`，exit 0）

```
✔ AC-backfill-①: active ∧ branch:true 而 goal/<id> 不存在、账本无 landed 并入结果 ⇒ 一轮后分支补建到 develop tip，读数记 driver 补建 (1594.562495ms)
✔ AC-backfill-②: 账本有 landed 的并入结果、分支已删 ⇒ 不补建（并入后已删 ≠ 从未创建） (1512.127648ms)
✔ AC-backfill-③④: 非 branch-mode goal 不补建；分支已存在 ⇒ 幂等且不移动 tip (4907.951967ms)
ℹ tests 12
ℹ pass 12
ℹ fail 0
```

夹具 `mkBranchlessFixture` 是**真 git 仓库**：base 提交后只建 `develop`，⛔ 不建 `goal/GOAL-901`；断言读 `git rev-parse` 的直接量（⛔ 不采信读数自述）。② 的 landed 并入结果经 `appendLandedMergeResult` 写进 `.quay/gate-events.jsonl`（形状 = `readGoalMergeResults` 读回的）。④ 先补建、再把分支推前一个提交（tip ≠ develop tip）⇒ 次轮断言 tip 未动，否则「不移动」是空转。

### AC2 — 取假（核心改动临时回退；`cp` 备份恢复，⛔ 未用 `git checkout --`）

`cp plugin/scripts/goal-driver.ts $BK/` 后把调用点回退成 `const goalBranchBackfills: GoalBranchBackfillReading[] = [];` ⇒ 3 条新用例里 **2 条变红**（② 断言的正是「不补建」，回退后同样不补建，属预期；① 与 ③④ 变红即证明断言**能取假**，⛔ 非恒真）：

```
✖ AC-backfill-①: ... AssertionError [ERR_ASSERTION]: 必须有一条补建读数，实测=[]
✖ AC-backfill-③④: ... AssertionError [ERR_ASSERTION]: 同轮的 branch-mode goal 照常补建（负控制）
ℹ tests 3
ℹ pass 1
ℹ fail 2
```

`cp $BK/goal-driver.ts` 恢复后（`grep -c NEGCTL` = 0，`backfillMissingGoalBranches(dataRoot, records)` 调用点 = 1）逐条复跑 **3 pass / 0 fail**。

### AC3 — 5b 邻近扫描（`grep -n`；命中数 + 前 3 条）

- `ensureGoalBranch` @ `plugin/scripts/goal-driver.ts`：**8** — `:80`（本任务新增导入）、`:3255`（新读数注释）、`:3270`（新函数注释）为前 3；**唯一可执行调用点 = `:3306` `ensureGoalBranch(root, gid)`（新加的 `backfillMissingGoalBranches` 内）**。
- `goalBranchRefExists` @ `plugin/scripts/goal-driver.ts`：**5** — `:80`（导入）、`:1021`（`goalBranchMergeState` 的 `settled` 早退）、`:3299`（新补建谓词的幂等早退）为前 3。
- `ensureGoalBranch` @ `packages/quay/src/goal-store.ts`：**2** — `:97`（导入）、`:3053`（**唯一创建调用点**，条件 `enteringActive || branchJustSet`，即 Proposal 指名的「只此一次」）。
- `goalBranchRefExists` @ `packages/quay/src/goal-store.ts`：**3** — `:97`（导入）、`:257`（`resolveCriterionRoot` 回退主检出）、`:2533`（`branch` 字段锁）为前 3。

逐条判断「分支该在而不在」的静默分支：

- `goal-driver.ts:1021`（`goalBranchMergeState` 对缺失分支返 `settled`）：**不新增缺陷**——补建在本轮 pass 1 之前完成（`:3615`），此后「从未创建」的 active branch-mode goal 已不存在；剩下的缺失只可能是「并入后已删」，`settled` 正是它的正确判决（不拦关闭）。
- `goal-driver.ts:3333`（`syncGoalCriterionWorktrees` 对缺失分支走 `no-branch`/`removed`）：**不新增缺陷**——补建**先于**它执行（`:3615` 在 `:3616` 上一行），故 `no-branch` 只剩「并入后已删」与「非 active 的 branch-mode goal」两种合法形态。
- `goal-driver.ts:3626`（`branchModeGoalIds`）：补建后同样收敛，⛔ 无需改动。
- `goal-store.ts:257`（`resolveCriterionRoot` 缺失分支 ⇒ 回退主检出）：**同一回退，但落点在 store 侧**，round 之外（直接 `quay gate` 一条 goal AC）仍可命中；本任务是 **round-scoped 修复**，且在该函数（**读路径**）上补建会把「读」变成「写」——⛔ 不做。记为观察项，不改。
- `goal-store.ts:2533` / `:3053`：前者是 `branch` 字段锁、后者是单一创建点，均非「缺失分支」问题，⛔ 不改。

结论：**Touches 内无需第二处改动**。

### AC4 — DIR-131 边界

```
goal-driver-task-boundary-check: PASS — goal-driver.ts has no task-write call sites (task_write/lifecycle_*/fs.write-to-tasks) and no OWN-REPO fan-in/落地率 carrier reads outside the target-probe exempt span
exit=0
```

### AC5 — 目标测试文件

`node --test plugin/test/goal-driver-criterion-worktree.test.mjs` ⇒ exit 0（12 pass / 0 fail，见 AC1/2）。

### 附带修正（既有夹具的载体补全）

`AC-phase-split` 用例原先用「删掉 `goal/<id>`」模拟「已并入」。补建谓词按任务要求以**已落账的 landed 并入结果**为判据，故该夹具的模拟不完整（只描述了「分支没了」这一半事实）⇒ 现在先 `appendLandedMergeResult(tmp, GOAL)` 再删分支。这是把夹具对齐生产载体（worker-fan-in 先落账、后删分支），⛔ 不是放宽断言。

### 实现落点

- `plugin/scripts/goal-driver.ts`：新增 `backfillMissingGoalBranches(root, goals)`（`:3287`，幂等；谓词 = active ∧ `branch:true` ∧ 无 ref（`:3299`）∧ 无 landed 并入结果 ⇒ `ensureGoalBranch`（`:3306`））+ `GoalBranchBackfillReading`（`:3252`）+ `GoalRoundReadings.goalBranchBackfills`（`:3368`）；调用点 `:3615` 在 `syncGoalCriterionWorktrees`（`:3616`）**之前**。
- `plugin/scripts/driver-runtime.ts`：Layer 0 补 `ensureGoalBranch` / `readGoalMergeResults` 与两个类型的 re-export（⛔ goal-driver 不写 Core 源码树字面量，AC-262 ⇒ 经 Layer 0 取符号）。

### DoD 生产读数（落地时状态，按 DoD 要求写明）

本任务在 **quay 仓库内**完成：补建逻辑落在 goal-driver 的下一轮，判据由真 git 仓库夹具端到端验证。DoD 点名的**生产读数**（GOAL-028 的 AC-321：branch-mode goal 的任务只经其 goal 分支落地）需要在**有这类 goal 的第三方项目**里、且该项目的 driver 已加载含本修复的版本后才取得到——cantus 的 GOAL-002 是现成对象，但它依赖 cantus 部署侧的 quay 版本更新，**本任务完成时该读数尚未取得**。
