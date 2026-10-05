---
id: gap-goal-branch-landing-judged-against-develop-not-merge-target
title: 落地判定 computeLandingState 一律拿 develop 当基准——经 goal 分支成功落地的任务被记成
  exited-not-landed 并计入重试（4/4 次真实落地读到）
status: todo
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

- [ ] `plugin/test/worker-driver.test.mjs`（该文件已有 `computeLandingState` 的用例）新增用例（临时仓库，建 `develop` 与 `goal/GOAL-901` 两条分支，落地提交只在后者）：① 以 `goal/GOAL-901` 为目标判落地 ⇒ verified；② 缺省（develop）判同一提交 ⇒ failed 且文案含 `develop`（既有行为不变）；③ 落地提交两条分支上都没有 ⇒ 两种目标下都是 failed，文案点名所用的分支。
- [ ] 取假：把本任务的核心改动临时回退（用 `cp` 备份恢复，⛔ 不用 `git checkout --`）后，上面新增用例至少 1 条变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [ ] 5b 邻近扫描：在 `plugin/scripts/` 内 grep `isShaAncestorOfBranch`、`computeLandingState` 的其它调用点与把 `"develop"` 当作落地基准的判定（含 `:4123`、`:4324` 两处调用），把命中数与前 3 条贴进 Evidence，逐条判断是否同样要取解析出的合并目标；需要且在 Touches 内的一并改。
- [ ] `node --test plugin/test/worker-driver.test.mjs` 退出 0。

## DoD

真实落地判据：落地之后，一个任务经 goal 分支成功落地时，`.quay/worker-outcome.jsonl` 里它的最终 outcome 是 completed 而不是 exited-not-landed，且 `worker-round.jsonl` 的 `exited_not_landed_stops` 里没有该任务的 `own-defect-counted`。生产读数需要一个新的 goal 分支落地才能取到；落地时可能尚未有，完成记录里须写明该读数是否已取得。

## Touches

- plugin/scripts/worker-driver.ts
- plugin/test/worker-driver.test.mjs
- tasks/gap-goal-branch-landing-judged-against-develop-not-merge-target.md
