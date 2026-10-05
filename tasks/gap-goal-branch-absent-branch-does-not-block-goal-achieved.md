---
id: gap-goal-branch-absent-branch-does-not-block-goal-achieved
title: branch-mode goal 的分支不存在时「并入前不得 achieved」的 close-block 不生效——从未并入的 goal
  照常被翻成 achieved（cantus GOAL-002 读到）
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

**机制**（2026-10-05，cantus 项目只读核实，生产直接量）：branch-mode goal 的「并入前不得 achieved」close-block `blocked-unmerged-branch`（`plugin/scripts/goal-driver.ts:964` `goalCloseBlockFromRecords`，文档 `:916`）要求 `goal/<id>` **仍存在**且不是 develop 的祖先才拦。分支**不存在**时没有任何东西拦——I2（全部 AC achieved）与 sufficiency 一满足，goal 照常被翻成 `achieved`。

**生产读数**：cantus 的 GOAL-002（`branch: true`）statusLog 为 `draft → active`（yale）、`active → achieved`（goal-driver，reason「I2: all ACs achieved + sufficiency covered」）；同一时刻 `git branch --list 'goal/*'` 为空（分支被该项目的一个守卫误删），它名下三个任务（AC-008/009/010）都直落 develop，账本里没有该 goal 的 `goal-merge-result`。也就是说一个 branch-mode goal 在**从未并入**、分支又不存在的情况下被判完成，隔离的承诺无声地落空。

**修法（方向，实现者可调）**：close-block 增加一个**独立的**状态 `blocked-branch-absent`（⛔ 不并入 clear / not-evaluated，也不并入 `blocked-unmerged-branch`；类型 `:921`、读数形状 `:3383` 起须同步）：该 goal 为 active ∧ `branch: true` ∧ `goal/<id>` 不存在 ∧ **账本里没有该 goal 且 outcome 为 landed 的 `goal-merge-result` 事件**（`packages/quay/src/goal-merge.ts:321` `readGoalMergeResults`）⇒ 不翻，读数点名该 goal。
- ⚠️ 必须区分「从未创建 / 被误删」与「并入后已被 quay 自己删除」：并入成功后分支被删而 goal 仍 active 直到 achieved，此时有 landed 的并入结果 ⇒ **不得**拦。
- 与已立的 `gap-goal-branch-active-branch-mode-goal-without-branch-never-self-heals`（自动补建分支）是前后两道：补建在每轮先做，本任务是翻转判定里的兜底（补建被 `blocked`、或分支刚被删而本轮补建尚未发生时，仍不翻）。
- goal-driver 受 DIR-131 约束：只读 git 引用与 goal 侧事件，⛔ 不写 task、注释里不要出现 fan-in 字样。

## AC

- [ ] `plugin/test/goal-driver-criterion-worktree.test.mjs`（该文件已有 branch-mode goal 夹具）新增用例：① active ∧ `branch: true`、全部 AC achieved、sufficiency covered，但 `goal/<id>` 不存在且账本无 landed 并入结果 ⇒ 一轮之后 goal 仍是 active，`closeBlocks` 含 `blocked-branch-absent` 并点名该 goal；② 同样的 goal 但账本里有 landed 的并入结果 ⇒ 不拦，被翻为 achieved；③ 分支存在时既有的 `blocked-unmerged-branch` / clear 行为不变；④ 非 branch-mode 的 goal 不受影响。
- [ ] 取假：把本任务的核心改动临时回退（用 `cp` 备份恢复，⛔ 不用 `git checkout --`）后，上面新增用例至少 1 条变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [ ] 5b 邻近扫描：`grep -rln 'blocked-unmerged-branch\|blocked-failing-ac' plugin packages orchestration` 目前命中 `plugin/scripts/goal-driver.ts`、`plugin/test/goal-driver-criterion-worktree.test.mjs`、`plugin/test/goal-driver-s03.test.mjs`、`plugin/test/goal-driver-s07.test.mjs`、`orchestration/SPEC-goal-branch-2026-10-03.md`（其中 s03 / s07 只含 `blocked-failing-ac`，`blocked-unmerged-branch` 只在前三处）；逐个判断是否枚举了 close-block 的取值集合、新增状态后是否需要同步，把结论贴进 Evidence；需要且在 Touches 内的一并改。
- [ ] `node --experimental-strip-types plugin/scripts/goal-driver-task-boundary-check.ts` 退出 0（DIR-131；⚠️ 注释里出现该类字样也会被判红）。
- [ ] `node --test plugin/test/goal-driver-criterion-worktree.test.mjs plugin/test/goal-driver-s03.test.mjs plugin/test/goal-driver-s07.test.mjs` 退出 0。

## DoD

真实落地判据：落地之后，一个 branch-mode goal 在分支缺失且从未并入时不再被翻成 achieved，goal-round 的 `closeBlocks` 读数里能看到 `blocked-branch-absent`。生产读数需要一个这样的 goal 才能取到（cantus 的 GOAL-002 已经 achieved，不再是对象）；落地时可能没有，完成记录里须写明该读数是否已取得。

## Touches

- plugin/scripts/goal-driver.ts
- plugin/test/goal-driver-criterion-worktree.test.mjs
- plugin/test/goal-driver-s03.test.mjs
- plugin/test/goal-driver-s07.test.mjs
- orchestration/SPEC-goal-branch-2026-10-03.md
- tasks/gap-goal-branch-absent-branch-does-not-block-goal-achieved.md
