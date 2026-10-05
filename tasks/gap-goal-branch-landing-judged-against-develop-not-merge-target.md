---
id: gap-goal-branch-landing-judged-against-develop-not-merge-target
title: 落地判定 computeLandingState 一律拿 develop 当基准——经 goal 分支成功落地的任务被记成
  exited-not-landed 并计入重试（4/4 次真实落地读到）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on: []
goal_ac: AC-323
---
## Proposal

**机制**（2026-10-05，GOAL-905 第二次合并演练读到，生产直接量）：`plugin/scripts/worker-driver.ts:1352` `computeLandingState` 在 fan-in 落地后用 `:1357` `isShaAncestorOfBranch(root, landedSha)` 判落地——该函数的分支参数缺省为 `"develop"`（`:1333`），这里**没有传**。落到 `goal/<id>` 的任务其落地提交按设计不在 develop 上，于是判成 `landedSha <sha> is not develop tip/ancestor` ⇒ failed ⇒ 下游 `computeOutcome` 记 `exited-not-landed`。SPEC-goal-branch §4.3 的派发接线把 fan-in 的落点改成了 `resolveTaskMergeTarget`（`:4454`），没有同步改这条落地判定。

**生产读数**（`.quay/worker-outcome.jsonl`）：迄今真实发生的 **4 次 goal 分支落地全部被记成 exited-not-landed**——GOAL-904 的演练任务（2026-10-03T17:19:00Z，`landedSha 774f9c137`）、GOAL-905 的三个任务 a/b/c（2026-10-05T15:52:44Z `00a5c1716`、16:05:36Z `fc81059fc`、16:13:52Z `a8f8e89a4`），reason 逐字都是 `landedSha <sha> is not develop tip/ancestor`。`.quay/worker-round.jsonl` 的 `exited_not_landed_stops` 里，a/b/c 都有 `count-and-retry | own-defect-counted`；其中 a **第一次尝试就落地了**，仍被记了一次「自己的缺陷」。这些任务的最终状态都是 done，所以没有被重派；但落地被计成失败。

**后果**：（1）成功落地进入 exited-not-landed 序列与重试计数，污染落地率类读数；（2）【未验证的风险】一个任务若前几次是真失败、最后一次在 goal 分支上成功落地，成功那次也被计入「自己的缺陷」，计数可能在成功的那一次触顶。

**修法（方向，实现者可调）**：把【同一个解析函数】`resolveTaskMergeTarget`（`:1799`）的结果传进 `computeLandingState`，让 `isShaAncestorOfBranch` 对该目标分支判祖先；目标为 develop 时行为逐字不变。`verifiedBy` / `failedReason` 的文案里把「develop」换成实际目标分支名，免得下一次读到「is not develop tip/ancestor」而误以为是落在 develop 之外。⛔ 不要在这里另写一份分支解析。

<!-- dedup-ref -->相关但机制不同：`gap-goal-branch-dispatch-wiring-and-task-fan-in`（done）接通了派发与 fan-in 的落点，本任务补它漏掉的落地判定。

## AC

- [x] `plugin/test/worker-driver.test.mjs`（该文件已有 `computeLandingState` 的用例）新增用例（临时仓库，建 `develop` 与 `goal/GOAL-901` 两条分支，落地提交只在后者）：① 以 `goal/GOAL-901` 为目标判落地 ⇒ verified；② 缺省（develop）判同一提交 ⇒ failed 且文案含 `develop`（既有行为不变）；③ 落地提交两条分支上都没有 ⇒ 两种目标下都是 failed，文案点名所用的分支。
- [x] 取假：把本任务的核心改动临时回退（用 `cp` 备份恢复，⛔ 不用 `git checkout --`）后，上面新增用例至少 1 条变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [x] 5b 邻近扫描：在 `plugin/scripts/` 内 grep `isShaAncestorOfBranch`、`computeLandingState` 的其它调用点与把 `"develop"` 当作落地基准的判定（含 `:4123`、`:4324` 两处调用），把命中数与前 3 条贴进 Evidence，逐条判断是否同样要取解析出的合并目标；需要且在 Touches 内的一并改。
- [x] `node --test plugin/test/worker-driver.test.mjs` 退出 0。

## DoD

真实落地判据：落地之后，一个任务经 goal 分支成功落地时，`.quay/worker-outcome.jsonl` 里它的最终 outcome 是 completed 而不是 exited-not-landed，且 `worker-round.jsonl` 的 `exited_not_landed_stops` 里没有该任务的 `own-defect-counted`。生产读数需要一个新的 goal 分支落地才能取到；落地时可能尚未有，完成记录里须写明该读数是否已取得。

## Touches

- plugin/scripts/worker-driver.ts
- plugin/test/worker-driver.test.mjs
- tasks/gap-goal-branch-landing-judged-against-develop-not-merge-target.md

## Evidence

### Implementation

- branch `task/gap-goal-branch-landing-judged-against-develop-not-merge-target`, commit `f646c026a`.
- `plugin/scripts/worker-driver.ts`: `computeLandingState(root, taskId, landedSha, branch = "develop")` — the new 4th param is the branch whose ancestry is tested; `isShaAncestorOfBranch(root, landedSha, branch)` + `verifiedBy` / `failedReason` now name `branch` instead of the literal "develop". `branch` is read only when `landedSha != null`; default `"develop"` keeps the old behaviour byte-for-byte.
- `plugin/scripts/worker-driver.ts` (finish path, `runOneWorker`): passes `resolveTaskMergeTarget(taskId, rootDir)` (the SAME resolver the fan-in wiring at the `mergeTarget:` site uses — no second branch parser) as the branch when `landedSha != null`, else `"develop"`.

### AC1 — new test (three arms) green

```
$ node --experimental-strip-types --test --test-name-pattern="gap-goal-branch-landing-judged-against-develop-not-merge-target" plugin/test/worker-driver.test.mjs
✔ gap-goal-branch-landing-judged-against-develop-not-merge-target — computeLandingState 基准分支由参数给出，缺省 develop 行为不变 (74.332457ms)
ℹ tests 1
ℹ pass 1
ℹ fail 0
```

Arms: ① `computeLandingState(root, task, landedSha, "goal/GOAL-901")` ⇒ `verified`, `verifiedBy` names `goal/GOAL-901`; ② `computeLandingState(root, task, landedSha)` (default develop) ⇒ `failed`, reason `/not develop tip\/ancestor/`; ③ a commit on neither branch (`git commit-tree`) ⇒ `failed` under both targets, reason naming the branch used (`develop` / `goal/GOAL-901`).

### AC2 — negative control (取假)

Backed up with `cp` (not `git checkout --`), reverted the core change (hardcoded develop), ran the new test ⇒ RED; restored from the `cp` backup ⇒ GREEN; md5 identical.

```
$ cp <worktree>/plugin/scripts/worker-driver.ts /tmp/wd-negctl-backup.<pid>.ts
$ sed -i 's|isShaAncestorOfBranch(root, landedSha, branch)|isShaAncestorOfBranch(root, landedSha)|; ...' <worktree>/plugin/scripts/worker-driver.ts
--- diff (reverted vs backup) ---
1369c1369
<     const ancestor = isShaAncestorOfBranch(root, landedSha, branch);
---
>     const ancestor = isShaAncestorOfBranch(root, landedSha);
1371c1371
<     if (ancestor === false) failedParts.push(`landedSha ${landedSha} is not ${branch} tip/ancestor`);
---
>     if (ancestor === false) failedParts.push(`landedSha ${landedSha} is not develop tip/ancestor`);
1376c1376
<         verifiedBy: `landedSha is ${branch} tip/ancestor ∧ ...`,
---
>         verifiedBy: `landedSha is develop tip/ancestor ∧ ...`,
$ node --experimental-strip-types --test --test-name-pattern="gap-goal-branch-landing-judged-against-develop-not-merge-target" plugin/test/worker-driver.test.mjs
✖ gap-goal-branch-landing-judged-against-develop-not-merge-target — ... (54.530681ms)
ℹ tests 1 / pass 0 / fail 1
  AssertionError [ERR_ASSERTION]: goal target: landing commit is goal/GOAL-901 tip ⇒ verified (⛔ not exited-not-landed)
$ cp /tmp/wd-negctl-backup.<pid>.ts <worktree>/plugin/scripts/worker-driver.ts   # restore
--- md5 ---
before:  6d155c161775bc460c756b48b2a56ed8
after:   6d155c161775bc460c756b48b2a56ed8   (identical)
$ node --experimental-strip-types --test --test-name-pattern="gap-goal-branch-landing-judged-against-develop-not-merge-target" plugin/test/worker-driver.test.mjs
✔ gap-goal-branch-landing-judged-against-develop-not-merge-target — ... (74.332457ms)  # green after restore
```

### AC3 — 5b 邻近扫描

```
$ grep -rn "isShaAncestorOfBranch" plugin/scripts/        # count=2
plugin/scripts/worker-driver.ts:1333:export function isShaAncestorOfBranch(root, sha, branch = "develop")   # definition
plugin/scripts/worker-driver.ts:1369:    const ancestor = isShaAncestorOfBranch(root, landedSha, branch);   # the single call — now passes `branch`

$ grep -rn "computeLandingState(" plugin/scripts/          # call sites
plugin/scripts/worker-driver.ts:1356  # definition
plugin/scripts/worker-driver.ts:4135  const landing = computeLandingState(rootDir, taskId, null);              # adopt-orphan finish
plugin/scripts/worker-driver.ts:4343  const landing = computeLandingState(rootDir, taskId, landedSha, mergeTargetBranch);  # the bug site — fixed
```

Per-hit judgment:
- `:4135` (adopt-orphan finalize): `landedSha` is the literal `null` ⇒ the `branch` param is structurally never read (status-based fallback path). No change needed; plumbing a branch here would be dead code. (Its status fallback reads `readTaskStatus`, a distinct mechanism governed by `gap-driver-filters-readtaskstatus-stale-main-checkout`; the adopt path carries no fan-in landedSha to judge.)
- `:4343`: **fixed** — this is the bug site.

Other `"develop"`-as-landing-baseline candidates in `plugin/scripts/`:
- `worker-fan-in.ts:2312` `runMechanicalFanIn`: reads `git rev-parse <mergeTarget>` — already parameterized by `mergeTarget` ⇒ correct, no change.
- `worker-fan-in.ts:2597/2603` `runGoalMergeFanIn`: merges `goal/<id>` INTO `develop`; `mergeTarget: "develop"` is the design target of the goal→develop final fan-in (not a per-task landing) ⇒ correct, no change.
- `task-status-drift-check.ts:756` `classifyBranch`: takes a `landing` parameter (default `master`), a different consumer (task-status drift, not the worker landing judge) ⇒ out of scope.

⇒ Only `:4343` needed the resolved merge target; the other sites are either structurally null, already parameterized, correct-by-design, or a different mechanism. All changes stay within Touches.

### AC4 — full test file exits 0

```
$ node --experimental-strip-types --test plugin/test/worker-driver.test.mjs
ℹ tests 121
ℹ pass 121
ℹ fail 0
EXIT=0
```

### DoD — production reading

**NOT YET OBTAINED.** The DoD's production reading (a goal-branch task's final outcome = `completed`, absent from `exited_not_landed_stops`' `own-defect-counted`) requires a *new* goal-branch landing, and the running driver still loads the pre-fix code (the fix lives on the task branch, not yet merged to develop). The production evidence available is the **pre-fix** defect reading (`.quay/worker-outcome.jsonl`), which matches the Proposal verbatim:

```
2026-10-05T15:52:44.402Z gap-goal905-drill-docs-a => exited-not-landed | landedSha 00a5c17164c59c94d5cdedad537a8469484a8ec4 is not develop tip/ancestor
2026-10-05T16:05:36.072Z gap-goal905-drill-docs-c => exited-not-landed | landedSha fc81059fcb180f39e898014042dd926ebfb13313 is not develop tip/ancestor
2026-10-05T16:13:52.090Z gap-goal905-drill-docs-b => exited-not-landed | landedSha a8f8e89a4414012a45525dfd4f76ca0572ce5fcb is not develop tip/ancestor
```

Mechanism evidence for the fix is the AC1 unit test (goal target ⇒ verified) plus the AC2 negative control (reverting the fix turns that same case red). The production reading must be re-taken after this lands and the next branch-mode goal task fans in.
