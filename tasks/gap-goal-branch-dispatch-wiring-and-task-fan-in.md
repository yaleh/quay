---
id: gap-goal-branch-dispatch-wiring-and-task-fan-in
title: 派发接线：按 goal_ac 解析任务的 mergeTarget，worktree 从 goal 分支分叉、fan-in 追平 develop
  后落回 goal 分支、用该 goal 自己的锁
status: ready
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

⚠️ `dispatch-worktree-setup.sh` 受 sh-census 棘轮约束（零余量），对它的改动须行数中性。**实现期结论**：`--base` 入口本已存在（`dispatch-worktree-setup.sh:61,84`）且对任意 ref 通用，故本任务对脚本本体【零行改动】——接线只在 worker-driver 侧把解析出的 mergeTarget 作为 `--base` 传入。

## AC

- [x] `plugin/test/worker-driver.test.mjs` 新增 `resolveTaskMergeTarget` 用例：无 goal_ac ⇒ develop；goal 为 draft ⇒ develop；active + branch:true 但分支不存在 ⇒ develop；全部满足 ⇒ `goal/<id>`。
- [x] 同一测试文件新增端到端用例（临时仓库）：带 goal_ac 指向 branch-mode goal 的任务，worktree 从 `goal/GOAL-901` 分叉（`plugin/test/dispatch-worktree-setup.test.mjs` 覆盖 `--base goal/GOAL-901` 的分叉点自检通过）；fan-in 合入 goal 分支与 develop 后落到 `goal/GOAL-901`；develop 的 first-parent 链上没有该任务的翻 done 提交；使用的锁文件是 `fan-in.goal-GOAL-901.lock`。
- [x] 同一测试文件新增未标注读数用例：无 goal_ac 且 Touches 与 branch-mode goal 在飞任务重叠 ⇒ 记录含 `goal-branch-untagged-overlap`；不重叠 ⇒ 不含。
- [x] 非 goal 任务路径不变：`node --test plugin/test/worker-driver.test.mjs plugin/test/dispatch-worktree-setup.test.mjs plugin/test/fan-in-driver-mechanical-orchestration.test.mjs` 退出 0。
- [x] 取假：把本任务的核心改动临时回退（用 `cp` 备份恢复，⛔ 不用 `git checkout --`）后，上面新增用例至少 1 条变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [x] `bash scripts/test.sh --for-task gap-goal-branch-dispatch-wiring-and-task-fan-in` 退出 0，且确实执行了 ≥1 个测试文件（非 thin；在 `## Evidence` 贴出被执行的测试文件名）。

## DoD

真实落地判据：为 branch-mode goal 服务的任务从 goal 分支开工、落回 goal 分支，develop 上看不到它们，直到 goal 并入。生产读数由 GOAL-028 的 AC-321（这类落地不在 develop first-parent 链上）在第一个试点 goal 上取得。

## Evidence

实现提交：`cc669bee4`（任务分支 `task/gap-goal-branch-dispatch-wiring-and-task-fan-in`）。

**AC1 / AC1b（resolveTaskMergeTarget 四态 + 非 branch-mode）** — `plugin/test/worker-driver.test.mjs`：
```
✔ AC1 — resolveTaskMergeTarget：无 goal_ac / draft goal / branch 不存在 ⇒ develop；全满足 ⇒ goal/<id> (51.676817ms)
✔ AC1b — 非 branch-mode（branch:false）与未声明 branch 均 ⇒ develop (49.29883ms)
```
（真 git 仓夹具：`goal/GOAL-901` 分支的存在性是活的 `git rev-parse --verify` 读，⛔ 不是 stored flag。）

**AC2（goal 分支 e2e）** — 同一文件；断言：`buildWorkerPrompt` 指名 `--base goal/GOAL-901`；`resolveTaskMergeTarget` ⇒ `goal/GOAL-901`；`fanInLockFileForMergeTarget` ⇒ `<repo>/.git/fan-in.goal-GOAL-901.lock`；`runMechanicalFanIn` landed；`goal/GOAL-901` 上有 `docs/feature.md` 且任务 `status: done`；`develop` 上无该实现（`git cat-file -e develop:docs/feature.md` 非 0）；`goal/GOAL-901` 非 develop 祖先；`git log --first-parent --format=%s develop` 不含 `driver 机械 fan-in`；`readFanInLockHold(...).lock === "fan-in.goal-GOAL-901.lock"`：
```
✔ AC2 — e2e：goal 分支任务的 worktree 从 goal/<id> 分叉、fan-in 落 goal/<id>、develop 看不到它、锁是 goal 锁 (1182.65743ms)
```
`plugin/test/dispatch-worktree-setup.test.mjs` 的 `--base goal/GOAL-901` 分叉点自检：
```
✔ goal-branch base — a worktree cut from goal/GOAL-901 passes `--base goal/GOAL-901` (exit 0 + fork-point PASS) (49.423587ms)
```

**AC3（未标注重叠读数）** — 同一文件：重叠 ⇒ 1 条 `kind: "goal-branch-untagged-overlap"`（goal=GOAL-901，overlap=[plugin/scripts/shared.ts]）；不重叠 ⇒ `[]`；已标注任务不进入该域；对端落 develop ⇒ 无读数：
```
✔ AC3 — 未标注读数：无 goal_ac 且 Touches 与 branch-mode goal 在飞任务重叠 ⇒ goal-branch-untagged-overlap (38.950443ms)
```

**AC4（非 goal 任务路径不变，三文件全跑）**：
```
$ node --test plugin/test/worker-driver.test.mjs plugin/test/dispatch-worktree-setup.test.mjs plugin/test/fan-in-driver-mechanical-orchestration.test.mjs
ℹ tests 158
ℹ pass 158
ℹ fail 0
EXIT=0
```

**AC5（取假）** — `cp` 备份 `plugin/scripts/worker-driver.ts` 到 `.quay/ac5-backup/worker-driver.ts.bak`（md5 `e986937b2dfb77790df3206c5f426315`），把解析链的第一步 `const goalAc = frontmatterGoalAc(taskFm);` 临时改成 `const goalAc = null;`（即核心解析被回退），跑新增用例：
```
$ node --test --test-name-pattern="AC1 —|AC2 —" plugin/test/worker-driver.test.mjs
✖ AC1 — resolveTaskMergeTarget：无 goal_ac / draft goal / branch 不存在 ⇒ develop；全满足 ⇒ goal/<id>
    actual 'no-goal-ac' != expected 'goal-not-active'
✖ AC2 — e2e：goal 分支任务的 worktree 从 goal/<id> 分叉、fan-in 落 goal/<id>、develop 看不到它、锁是 goal 锁
    AssertionError: 创建 prompt 必须指名 goal base
ℹ pass 12
ℹ fail 2
EXIT=1
```
`cp` 恢复（md5 与备份一致 `e986937b2dfb77790df3206c5f426315`）后同命令绿：
```
✔ AC1 — resolveTaskMergeTarget：… (51.676817ms)
✔ AC1b — 非 branch-mode（branch:false）与未声明 branch 均 ⇒ develop (49.29883ms)
✔ AC2 — e2e：… (1182.65743ms)
✔ AC3 — 未标注读数：… (38.950443ms)
ℹ tests 20 · pass 20 · fail 0
EXIT=0
```

**AC6（scoped 门，非 thin）**：
```
$ bash scripts/test.sh --for-task gap-goal-branch-dispatch-wiring-and-task-fan-in
ℹ tests 147 · pass 147 · fail 0 · EXIT=0
$ bash scripts/test.sh --for-task gap-goal-branch-dispatch-wiring-and-task-fan-in --paths-only
plugin/test/dispatch-worktree-setup.test.mjs
plugin/test/worker-driver.test.mjs
plugin/test/worker-fan-in.test.mjs
```

## Touches

- plugin/scripts/worker-driver.ts
- plugin/scripts/worker-fan-in.ts
- plugin/scripts/dispatch-worktree-setup.sh
- plugin/test/worker-driver.test.mjs
- plugin/test/dispatch-worktree-setup.test.mjs
- tasks/gap-goal-branch-dispatch-wiring-and-task-fan-in.md
