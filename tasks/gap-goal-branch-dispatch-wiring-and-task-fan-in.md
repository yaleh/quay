---
id: gap-goal-branch-dispatch-wiring-and-task-fan-in
title: 派发接线：按 goal_ac 解析任务的 mergeTarget，worktree 从 goal 分支分叉、fan-in 追平 develop
  后落回 goal 分支、用该 goal 自己的锁
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal-branch-antidrift-two-line-base
  - gap-goal-branch-data-model-and-lifecycle
  - gap-goal-branch-criteria-evaluated-on-goal-worktree
  - gap-goal-branch-done-means-landed-on-merge-target
goal_ac: AC-321
---
## Proposal

**机制**（`orchestration/SPEC-goal-branch-2026-10-03.md` §4.3、§4.4、§4.6、§4.9，裁定①③⑥⑰）：fan-in 的 `mergeTarget` 全链路已支持（`plugin/scripts/worker-fan-in.ts:1557`），但生产派发从不传（`plugin/scripts/worker-driver.ts:4238`），永远落 develop。

**修法**：
1. 单一解析函数 `resolveTaskMergeTarget(task)`：`goal_ac` → AC 的 `goal` → 该 GOAL 为 active ∧ `branch: true` ∧ `goal/<id>` 存在 ⇒ `goal/<id>`，否则 develop。**同一结果三处共用**：worktree 分叉点（`dispatch-worktree-setup.sh --base`）、fan-in 的 mergeTarget、fan-in 锁文件。
2. mergeTarget 为 goal 分支时，fan-in 在任务 worktree 里先 merge `goal/<id>` 再 merge develop（追平），之后的验证步骤不变。
3. 锁：goal 分支落地持 `<git-common-dir>/fan-in.goal-<GOAL-NNN>.lock`（经 `acquireFanInLock({ lockFile })`，`worker-fan-in.ts:980`），持有者仍是 driver 的非分离子进程（ADR-034）；锁事件增加 `lock` 字段区分锁域。
4. 派发记录（`.quay/worker-round.jsonl`）写入解析出的 mergeTarget。
5. 未标注读数（裁定⑰，只报告不阻塞）：任务无 `goal_ac` 而其 `## Touches` 与某个 branch-mode goal 的在飞任务重叠 ⇒ 在该轮记录写一条 `goal-branch-untagged-overlap`。

⚠️ `dispatch-worktree-setup.sh` 受 sh-census 棘轮约束（零余量），对它的改动须行数中性。

## AC

- [ ] `plugin/test/worker-driver.test.mjs` 新增 `resolveTaskMergeTarget` 用例：无 goal_ac ⇒ develop；goal 为 draft ⇒ develop；active + branch:true 但分支不存在 ⇒ develop；全部满足 ⇒ `goal/<id>`。
- [ ] 同一测试文件新增端到端用例（临时仓库）：带 goal_ac 指向 branch-mode goal 的任务，worktree 从 `goal/GOAL-901` 分叉（`plugin/test/dispatch-worktree-setup.test.mjs` 覆盖 `--base goal/GOAL-901` 的分叉点自检通过）；fan-in 合入 goal 分支与 develop 后落到 `goal/GOAL-901`；develop 的 first-parent 链上没有该任务的翻 done 提交；使用的锁文件是 `fan-in.goal-GOAL-901.lock`。
- [ ] 同一测试文件新增未标注读数用例：无 goal_ac 且 Touches 与 branch-mode goal 在飞任务重叠 ⇒ 记录含 `goal-branch-untagged-overlap`；不重叠 ⇒ 不含。
- [ ] 非 goal 任务路径不变：`node --test plugin/test/worker-driver.test.mjs plugin/test/dispatch-worktree-setup.test.mjs plugin/test/fan-in-driver-mechanical-orchestration.test.mjs` 退出 0。
- [ ] 取假：把本任务的核心改动临时回退（用 `cp` 备份恢复，⛔ 不用 `git checkout --`）后，上面新增用例至少 1 条变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [ ] `bash scripts/test.sh --for-task gap-goal-branch-dispatch-wiring-and-task-fan-in` 退出 0，且确实执行了 ≥1 个测试文件（非 thin；在 `## Evidence` 贴出被执行的测试文件名）。

## DoD

真实落地判据：为 branch-mode goal 服务的任务从 goal 分支开工、落回 goal 分支，develop 上看不到它们，直到 goal 并入。生产读数由 GOAL-028 的 AC-321（这类落地不在 develop first-parent 链上）在第一个试点 goal 上取得。

## Touches

- plugin/scripts/worker-driver.ts
- plugin/scripts/worker-fan-in.ts
- plugin/scripts/dispatch-worktree-setup.sh
- plugin/test/worker-driver.test.mjs
- plugin/test/dispatch-worktree-setup.test.mjs
- tasks/gap-goal-branch-dispatch-wiring-and-task-fan-in.md
