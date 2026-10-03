---
id: gap-goal-branch-ac-phase-field-and-split-evaluation
title: AC 的 phase 字段（pre-merge / post-merge）与 goal-driver 分相求值——post-merge AC
  并入前不求值、不进 gap
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal-branch-criteria-evaluated-on-goal-worktree
goal_ac: AC-324
---
## Proposal

**机制**（`orchestration/SPEC-goal-branch-2026-10-03.md` §4.7，裁定⑭⑮）：只能在并入后判的 AC（要生产跑一段时间才有读数的那类）在判据 worktree 上恒为 not-evaluated；若计入并入前置条件，goal 永远并不进去；若计入 gap 计算，gap-filing 会对一个结构上还不可能通过的 AC 立任务。

**修法**：
1. AC 记录新增 `phase: pre-merge | post-merge`，缺省 pre-merge；由立 AC 的人或 agent **显式声明，⛔ 不按判据文本关键词推断**（硬规则 2）。缺省取 pre-merge 是因为误分类不对称：该标 post-merge 而没标 ⇒ 卡住且可见；反过来 ⇒ 静默丢掉隔离。
2. goal-driver：branch-mode goal 并入前只求值 pre-merge AC；post-merge AC 读数记 not-evaluated、理由 `pre-merge-phase`，且 ⛔ 不进 gap 计算。并入后（分支不存在）照常求值全部 AC。
3. 辅助读数：pre-merge AC 在判据 worktree 上以载体缺席（exit 3）收场 ⇒ goal-round 记一条 `maybe-post-merge` 提示。
4. I2（achieved ⟺ 全部 AC achieved）⛔ 不改。

## AC

- [x] `packages/quay/test/goal-store.test.mjs` 新增用例：`phase` 可写可读，非法值被拒，缺省读作 pre-merge。
- [x] `plugin/test/goal-driver-criterion-worktree.test.mjs` 新增用例：branch-mode goal 并入前，post-merge AC 读数为 not-evaluated（理由 `pre-merge-phase`）且不出现在 gaps 里；并入后同一 AC 被求值；pre-merge AC 以 exit 3 收场时产生 `maybe-post-merge` 提示。
- [x] 同一测试文件新增用例：achieved 判定仍要求全部 AC（含 post-merge）达成——只有 pre-merge 全达成时 goal 不被写为 achieved。
- [x] `node --experimental-strip-types plugin/scripts/goal-driver-task-boundary-check.ts` 退出 0（goal-driver 不出现 task 写路径与本仓 fan-in 载体引用——DIR-131；注意注释里出现该类词也会被判红）。
- [x] 取假：把本任务的核心改动临时回退（用 `cp` 备份恢复，⛔ 不用 `git checkout --`）后，上面新增用例至少 1 条变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [x] `bash scripts/test.sh --for-task gap-goal-branch-ac-phase-field-and-split-evaluation` 退出 0，且确实执行了 ≥1 个测试文件（非 thin；在 `## Evidence` 贴出被执行的测试文件名）。

## DoD

真实落地判据：带「生产积累类」AC 的 branch-mode goal 能在其余 AC 达成后进入可并入状态，且不会被立出假 gap 任务。生产读数由 GOAL-028 的 AC-324 在第一个试点 goal 并入后取得。

## Evidence

实现提交 `de6518107`（分支 `task/gap-goal-branch-ac-phase-field-and-split-evaluation`）。

- **AC1** — `node --experimental-strip-types --test packages/quay/test/goal-store.test.mjs`，新增 3 条全绿：`✔ AC-phase-1`（`--phase post-merge` 写入并经 get 回读；缺省 pre-merge；省略保留）、`✔ AC-phase-2`（非法值 CLI exit 2 且不落变更；store API 同样 fail-closed）、`✔ AC-phase-3`（GOAL 记录不得携带 phase）。
- **AC2** — `plugin/test/goal-driver-criterion-worktree.test.mjs` 的 `✔ AC-phase-split`：并入前 post-merge AC（AC-905）读数 `not-evaluated` / 理由 `pre-merge-phase`、且不在 `gaps` 里（pre-merge 兄弟 AC-906 仍在 gaps 内作负控制，证明 gaps 非空转）；`phaseSplit.maybePostMerge=["AC-906"]`（该 pre-merge AC 判据 exit 3）；删掉 `goal/GOAL-901` 分支后同一 AC 被求值 ⇒ `fail`（⛔ 不再 not-evaluated），本轮 `phaseSplit.excluded=[]`。
- **AC3** — 同文件 `✔ AC-phase-i2`：post-merge AC 未达成时 `goalAchievedFromRecords=false`，且 `goalFlipDecision(..., {verdict:"covered"})===false`（即便 sufficiency covered 也不写 achieved）；改成 achieved 后两者都 true（负控制：判定非恒 false）。
- **AC4** — `node --experimental-strip-types plugin/scripts/goal-driver-task-boundary-check.ts` ⇒ exit 0：`PASS — goal-driver.ts has no task-write call sites (task_write/lifecycle_*/fs.write-to-tasks) and no OWN-REPO fan-in/落地率 carrier reads outside the target-probe exempt span`。
- **AC5 取假（mutation control，`cp` 备份/恢复，⛔ 未用 `git checkout --`）** — 把 `preMergePhaseExcludedAcIds` 临时改成 `return new Set<string>();` 后重跑，`✖ AC-phase-split` 变红：

```
AssertionError [ERR_ASSERTION]: post-merge AC 并入前必须 not-evaluated，实测={"id":"AC-905","goal":"GOAL-901","status":"active","verdict":"fail","reason":"acceptance failed (exit 1) — criterion wrote no output to stderr/stdout"}
  + actual - expected
  + 'fail'
  - 'not-evaluated'
```

  `cp` 恢复后重跑：`ℹ tests 5 / pass 5 / fail 0`（全绿）。

- **AC6** — `bash scripts/test.sh --for-task gap-goal-branch-ac-phase-field-and-split-evaluation`（⛔ 未加 `--allow-thin`）⇒ exit 0，`ℹ tests 179 / pass 179 / fail 0`。被执行的测试文件（非 thin）含：
  - `packages/quay/test/goal-store.test.mjs`（实跑输出含 `✔ AC-phase-1` / `✔ AC-phase-2` / `✔ AC-phase-3`）
  - `plugin/test/goal-driver-criterion-worktree.test.mjs`（实跑输出含 `✔ AC-phase-split` / `✔ AC-phase-i2`，以及既有 AC1+AC2 / AC3 两条）

- **并入后复验（2026-10-03，`git merge develop` 后分支 = develop + 本实现；merge 提交 `bdf1d23e8`）** — 逐条复跑，结论与上一致：
  - AC1：`env -u QUAY_GOAL_ACCEPTANCE_ACTIVE node --experimental-strip-types --test packages/quay/test/goal-store.test.mjs` ⇒ `ℹ tests 84 / pass 84 / fail 0`。
  - AC2/AC3：`env -u QUAY_GOAL_ACCEPTANCE_ACTIVE node --experimental-strip-types --test plugin/test/goal-driver-criterion-worktree.test.mjs` ⇒ `ℹ tests 5 / pass 5 / fail 0`。
  - AC4：`node --experimental-strip-types plugin/scripts/goal-driver-task-boundary-check.ts` ⇒ exit 0（同上 PASS 行）。
  - AC5：再次取假（`cp` 备份 → `preMergePhaseExcludedAcIds` 返回空集 → `✖ AC-phase-split` 红；`cp` 恢复后 5/5 绿）。
  - AC6：`bash scripts/test.sh --for-task ...`（⛔ 无 `--allow-thin`）⇒ exit 0，`ℹ tests 179 / pass 179 / fail 0`。
  - ⚠️ **环境陷阱（供后来读者）**：worker 会话自身的 shell 携带 `QUAY_GOAL_ACCEPTANCE_ACTIVE=1`（goal 判据重入闸的泄漏），**裸 `node --test packages/quay/test/goal-store.test.mjs` 会假红 8 条**（I5×3、AC4 负控制、AC-242×4）——它们是**拒跑**（`sweepFrozen` ⇒ `refused:true`）而非代码回归，`env -u QUAY_GOAL_ACCEPTANCE_ACTIVE` 下 84/84 全绿。`scripts/test.sh:216` 的入口归一化已 `unset QUAY_GOAL_ACCEPTANCE_ACTIVE`，故 AC6 走 test.sh 不受影响；直调 `node --test` 需前缀 `env -u QUAY_GOAL_ACCEPTANCE_ACTIVE`。

## Touches

- packages/quay/src/goal-store.ts
- packages/quay/src/cli/goal.ts
- plugin/scripts/goal-driver.ts
- packages/quay/test/goal-store.test.mjs
- plugin/test/goal-driver-criterion-worktree.test.mjs
- tasks/gap-goal-branch-ac-phase-field-and-split-evaluation.md
