---
id: gap-goal-branch-ac-phase-field-and-split-evaluation
title: AC 的 phase 字段（pre-merge / post-merge）与 goal-driver 分相求值——post-merge AC
  并入前不求值、不进 gap
status: todo
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

- [ ] `packages/quay/test/goal-store.test.mjs` 新增用例：`phase` 可写可读，非法值被拒，缺省读作 pre-merge。
- [ ] `plugin/test/goal-driver-criterion-worktree.test.mjs` 新增用例：branch-mode goal 并入前，post-merge AC 读数为 not-evaluated（理由 `pre-merge-phase`）且不出现在 gaps 里；并入后同一 AC 被求值；pre-merge AC 以 exit 3 收场时产生 `maybe-post-merge` 提示。
- [ ] 同一测试文件新增用例：achieved 判定仍要求全部 AC（含 post-merge）达成——只有 pre-merge 全达成时 goal 不被写为 achieved。
- [ ] `node --experimental-strip-types plugin/scripts/goal-driver-task-boundary-check.ts` 退出 0（goal-driver 不出现 task 写路径与本仓 fan-in 载体引用——DIR-131；注意注释里出现该类词也会被判红）。
- [ ] 取假：把本任务的核心改动临时回退（用 `cp` 备份恢复，⛔ 不用 `git checkout --`）后，上面新增用例至少 1 条变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [ ] `bash scripts/test.sh --for-task gap-goal-branch-ac-phase-field-and-split-evaluation` 退出 0，且确实执行了 ≥1 个测试文件（非 thin；在 `## Evidence` 贴出被执行的测试文件名）。

## DoD

真实落地判据：带「生产积累类」AC 的 branch-mode goal 能在其余 AC 达成后进入可并入状态，且不会被立出假 gap 任务。生产读数由 GOAL-028 的 AC-324 在第一个试点 goal 并入后取得。

## Touches

- packages/quay/src/goal-store.ts
- packages/quay/src/cli/goal.ts
- plugin/scripts/goal-driver.ts
- packages/quay/test/goal-store.test.mjs
- plugin/test/goal-driver-criterion-worktree.test.mjs
- tasks/gap-goal-branch-ac-phase-field-and-split-evaluation.md
