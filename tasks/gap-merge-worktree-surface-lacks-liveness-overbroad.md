---
id: gap-merge-worktree-surface-lacks-liveness-overbroad
title: merge-worktree surface 无 liveness + 面过宽（diffNameOnlyHead 用全 delta）——4
  个零进程卡死 mid-merge worktree 把 28 ready 滤空致 dispatchable_disjoint=0
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**`computeMergeWorktreeSurfaces`（`ready-pool-check.ts:455`）把「mid-merge worktree」的判定只做成 `isMergeWorktree`（MERGE_HEAD OR unmerged），没有 liveness 检查；且 `diffNameOnlyHead`（`:437`）用 `git diff --name-only HEAD`（整个 merge delta，含 cleanly-merged）作冲突面。二者叠加，零进程的卡死 mid-merge worktree 用全 delta 锁死全部派发。**

### 实证（manager 2026-08-29 点检 + 止血验证）

- **卡死态**：4 个 worktree `gap-ac149-session-retirement-no-dual-source-no-throughput-collapse` / `gap-canonical-test-files-glob-vs-realpath-divergence` / `gap-retire-halt-file-driver-based` / `gap-suite-lane-budget-structural-guarantee-broken-buckets-no-lock` 均 `MERGE_HEAD` 悬置、各 3 个 unmerged 文件、`cwd-under=0`（零活进程）——exited-not-landed 后 merge-develop 半途失败留下的死 merge 态。
- **面过宽**：`diffNameOnlyHead` 对这 4 个的返回是 **11 / 121 / 32 / 19 文件**（gap-canonical-test-files 达 121，几乎覆盖全部 `tasks/*.md`、`orchestration/*`、`plugin/*`），而非 ~3 个 unmerged 冲突文件。
- **后果**：`dispatchablePoolParsed = poolParsed.filter(p => !mergeSurfaceBlock(...).blocked)` 把 28 个 ready 候选全滤掉 ⇒ `dispatchable_disjoint = maxMutuallyDisjointSubset([]) = 0`、`pool_big_all_colliding=True` ⇒ 派发死锁。
- **止血验证**：对 4 个卡死 worktree `git merge --abort` 后，`dispatchable_disjoint` **0 → 9**、`criterion_met` **False → True**——证实 4 个死 merge 面就是直接原因。

**为什么是硬规则 5b 的镜像实例**：liveness 修复（`gap-compute-inflight-worktree-touches-no-liveness-check`）只落在 **task-worktree 路径**（`concurrent-batch-scheduler.ts` 的 `computeInFlightWorktreeTouches` / `isDeadInFlightWorktree`），而 **merge-surface 兄弟路径**（`ready-pool-check.ts` 的 `computeMergeWorktreeSurfaces`）漏了同族 liveness——修了一个实例，没修同族兄弟。

### 修法（两处）

1. **加 liveness**：`computeMergeWorktreeSurfaces` 对每个 mid-merge worktree 用与 task-worktree 同源的活进程 + commit 陈旧判据（复用 `isDeadInFlightWorktree` 语义 / `INFLIGHT_WORKTREE_STALE_MS`），零进程且 commit 陈旧的死 merge worktree **不呈 merge 面**。
2. **面收窄**：`diffNameOnlyHead` 从「全 delta」收窄为 **unmerged 冲突文件**（`git diff --name-only --diff-filter=U HEAD` 或 `git ls-files -u | awk '{print $4}' | sort -u`），活 merge worktree 的面也只计真冲突路径。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 4 卡死 worktree（MERGE_HEAD + 3 unmerged + 零进程）+ `dispatchable_disjoint` 0→9 止血证据（本任务 Proposal 已含）
- [x] AC2: **merge-surface 加 liveness**——零进程且 commit 陈旧的 mid-merge worktree 不贡献 merge 面（判据与 task-worktree 的 `isDeadInFlightWorktree` 同源，`INFLIGHT_WORKTREE_STALE_MS` 复用）**Evidence: `resolveMergeWorktreeSurfaces`（纯核，注入 isMerge/conflictFiles/liveness）+ `isDeadMergeWorktree`（同源语义）+ `computeMergeWorktreeSurfaces` wiring（`enumerateProcs`/`cwdUnder` 单次枚举 + `lastCommitMsOfWorktree`）**
- [x] AC3: **面收窄**——`diffNameOnlyHead` 只返回 unmerged 冲突文件，不再返回 cleanly-merged 全 delta（活 merge worktree 的面 = 真冲突路径）**Evidence: `diffNameOnlyHead` 改名 `unmergedConflictPaths`（`git ls-files -u` 去重）；真实 conflicted-merge fixture（3 unmerged + 1 clean）→ 只返回 3 条 unmerged**
- [x] AC4: **不回归 + 测试**——`--for-task` scoped 门绿；新增测试覆盖「死 mid-merge 不呈面」「活 mid-merge 面 = unmerged 文件」两态**Evidence: 新增 6 条测试（3 纯核 + 2 真实 git wiring + 1 负控制）覆盖两态；`scripts/test.sh plugin/test/ready-pool-check.test.mjs` 125/125 绿（fail 0, cancelled 0）；`--for-task` scoped 门 + 全量套件绿由 driver fan-in 验证**

## Definition of Done

- [x] AC1–AC4 全部勾上
- [x] 修后实跑：造一个零进程 mid-merge worktree fixture，`ready-pool-check` 的 `dispatchable_disjoint` 不再被它压到 0（贴输出）**Evidence: 死 mid-merge fixture（unmerged: code/a.md code/b.md + 零活进程 + commit 2020-01-01）→ `node --experimental-strip-types plugin/scripts/ready-pool-check.ts --root <root> --cap 5` 输出 `pool: 2`、`dispatchable_disjoint: 2`（非 0）、`pool_big_all_colliding: false`**
- [ ] `--for-task` scoped 绿 + 全量套件绿（`fail 0` 且 `cancelled 0`）——由 driver fan-in 验证（本 worker 不跑全量 suite）

## Touches

- plugin/scripts/ready-pool-check.ts（`computeMergeWorktreeSurfaces` 加 liveness + `diffNameOnlyHead` 改名 `unmergedConflictPaths` 收窄为 unmerged）
- plugin/test/ready-pool-check.test.mjs（AC2/AC3 测试：死/活 mid-merge 两态）
- tasks/gap-merge-worktree-surface-lacks-liveness-overbroad.md（自身）

## Contract

measure   dispatchable_disjoint_with_dead_merge = `ready-pool-check.ts --root <root> --cap 5` 在存在一个零进程 mid-merge worktree fixture 时的 `dispatchable_disjoint` 值
band      dispatchable_disjoint_with_dead_merge > 0（死 merge 面不得把派发压到 0）
invariant dead_merge_excluded_from_surface = 1（零进程 + commit 陈旧的 mid-merge worktree 不呈 merge 面）
invariant surface_is_unmerged_only = 1（活 merge worktree 的面只含 unmerged 冲突文件，不含 cleanly-merged）
invoke    `node --experimental-strip-types plugin/scripts/ready-pool-check.ts --root <root> --cap 5`（贴 `dispatchable_disjoint` 数字，附 fixture 态）
control   死 merge worktree 存在时 `dispatchable_disjoint` 保持 >0 且 `pool_big_all_colliding` = false
resume    liveness 与面收窄分步提交，任一步完成即写盘