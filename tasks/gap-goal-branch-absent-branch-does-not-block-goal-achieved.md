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

- [x] `plugin/test/goal-driver-criterion-worktree.test.mjs`（该文件已有 branch-mode goal 夹具）新增用例：① active ∧ `branch: true`、全部 AC achieved、sufficiency covered，但 `goal/<id>` 不存在且账本无 landed 并入结果 ⇒ 一轮之后 goal 仍是 active，`closeBlocks` 含 `blocked-branch-absent` 并点名该 goal；② 同样的 goal 但账本里有 landed 的并入结果 ⇒ 不拦，被翻为 achieved；③ 分支存在时既有的 `blocked-unmerged-branch` / clear 行为不变；④ 非 branch-mode 的 goal 不受影响。
- [x] 取假：把本任务的核心改动临时回退（用 `cp` 备份恢复，⛔ 不用 `git checkout --`）后，上面新增用例至少 1 条变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [x] 5b 邻近扫描：`grep -rln 'blocked-unmerged-branch\|blocked-failing-ac' plugin packages orchestration` 目前命中 `plugin/scripts/goal-driver.ts`、`plugin/test/goal-driver-criterion-worktree.test.mjs`、`plugin/test/goal-driver-s03.test.mjs`、`plugin/test/goal-driver-s07.test.mjs`、`orchestration/SPEC-goal-branch-2026-10-03.md`（其中 s03 / s07 只含 `blocked-failing-ac`，`blocked-unmerged-branch` 只在前三处）；逐个判断是否枚举了 close-block 的取值集合、新增状态后是否需要同步，把结论贴进 Evidence；需要且在 Touches 内的一并改。
- [x] `node --experimental-strip-types plugin/scripts/goal-driver-task-boundary-check.ts` 退出 0（DIR-131；⚠️ 注释里出现该类字样也会被判红）。
- [x] `node --test plugin/test/goal-driver-criterion-worktree.test.mjs plugin/test/goal-driver-s03.test.mjs plugin/test/goal-driver-s07.test.mjs` 退出 0。

## DoD

真实落地判据：落地之后，一个 branch-mode goal 在分支缺失且从未并入时不再被翻成 achieved，goal-round 的 `closeBlocks` 读数里能看到 `blocked-branch-absent`。生产读数需要一个这样的 goal 才能取到（cantus 的 GOAL-002 已经 achieved，不再是对象）；落地时可能没有，完成记录里须写明该读数是否已取得。

## Evidence

**实现（`plugin/scripts/goal-driver.ts`）**：`GoalCloseBlockVerdict` 加第五态 `blocked-branch-absent`；`GoalBranchMergeState` 加 `absent` 态（分支缺失——含两次 git 调用之间被删——⛔ 不再折进 `settled`）；消费侧 (`runGoalRound` pass 2) 用 `readGoalMergeResults` 的 `outcome === "landed"` 集合（按需只读一次）区分「从未创建 / 被误删」与「并入后已被删」，前者落 `blocked-branch-absent` 并拒绝关闭，`flips` 记 `ok:false` / reason `blocked-branch-absent: goal/<id>`。⛔ 与 `blocked-unmerged-branch` 是两个方向（那条带 `branchTip`，本条没有 tip 可带）。

**AC1 — 新用例 + 不空转证明**
- `branch-absent-①`：`closeBlocks` 一条 `{goal:"GOAL-920", verdict:"blocked-branch-absent", acs:[], cause:null}`（断言无 `branchTip` 键）、goal 读完盘仍是 `active`、`flips` 一条 `ok:false` 且 reason 逐字 `blocked-branch-absent: goal/GOAL-920`；同夹具里非 branch-mode 的 GOAL-921 照常翻 `achieved`、closeBlock `clear`（④）。
- 不空转证明（本前置的对象被证明存在）：同一轮 `goalBranchBackfills` 里 GOAL-920 一条 `action:"unreadable"`（夹具不建 landing baseline ⇒ 补建修不好），且直接量 `git rev-parse --verify --quiet goal/GOAL-920` 仍非 0。若哪天补建变成无条件能修好，这条会先红。
- `branch-absent-②`：同形态但账本预置一条 landed `goal-merge-result` ⇒ 分支仍缺失、补建读数为空数组（结构上不许再造分支），goal 被翻 `achieved`、`closeBlocks` 为 `clear`（⛔ 不拦「并入后已删」这个正常终态）。
- ③ 分支存在的既有行为不变：既有用例「branch-mode goal 在 goal/<id> 并入 develop 之前不得被翻 achieved」（三臂：并入前 `blocked-unmerged-branch` ∧ 仍 active；并入后下一轮才翻 `achieved`；非 branch-mode 同条件照常翻）逐字未改，本轮全绿。

**AC2 — 取假（`cp` 备份回退；⛔ 未用 `git checkout --`）**
把 `goalBranchMergeState` 的两处 `return { state: "absent" };` 改回 `return { state: "settled" };`（= 本任务之前的行为）后重跑同一文件：
```
✖ branch-absent-①: ... (2322.39637ms)
  AssertionError [ERR_ASSERTION]: 分支缺失且从未并入 ⇒ ⛔ 不得被翻成 achieved
  + actual - expected
  + 'achieved'
  - 'active'
      at .../plugin/test/goal-driver-criterion-worktree.test.mjs:810:12
ℹ tests 14   ℹ pass 13   ℹ fail 1
```
⇒ 新增用例 1 条变红，且红的形态**正是被修的缺陷本身**（分支缺失的 goal 被翻成 `achieved`）。
`cp` 备份恢复后重跑：
```
ℹ tests 14   ℹ pass 14   ℹ fail 0
```

**AC3 — 5b 邻近扫描（逐处结论）**
```
plugin/scripts/goal-driver.ts                         blocked-unmerged=12  blocked-failing=11
plugin/test/goal-driver-criterion-worktree.test.mjs   blocked-unmerged=6   blocked-failing=0
plugin/test/goal-driver-s03.test.mjs                  blocked-unmerged=0   blocked-failing=5
plugin/test/goal-driver-s07.test.mjs                  blocked-unmerged=0   blocked-failing=4
orchestration/SPEC-goal-branch-2026-10-03.md          blocked-unmerged=2   blocked-failing=0
```
1. `plugin/scripts/goal-driver.ts` — 词表正本（类型 + 读数形状注释 + 轮日志）。**已改**。
2. `plugin/test/goal-driver-criterion-worktree.test.mjs` — branch-mode close-block 的臂集合。**已改**（① ② 为新用例，③ 由既有用例承载）。
3. `plugin/test/goal-driver-s03.test.mjs` — 只测**纯函数** `goalCloseBlockFromRecords`（台账那半边）。新态是在**消费方** `runGoalRound` 组合出来的（与 `blocked-unmerged-branch` 完全同一处、同一手法），该函数的返回值域**未变**（仍是 clear / blocked-failing-ac / not-evaluated）⇒ 三条 deepEqual 臂与 `notEqual(...,'blocked-failing-ac')` 的语义都不受影响。**无需改**（实测绿）。
4. `plugin/test/goal-driver-s07.test.mjs` — closeBlocks 的 `blocked-failing-ac`/`clear` 对照，夹具用 `writeGoalFile` **不带 `branch: true`** ⇒ 非 branch-mode，结构上到不了新态。**无需改**（实测绿）。
5. `orchestration/SPEC-goal-branch-2026-10-03.md:195-196` — **它枚举了**：「分支不存在（从未创建 / 并入后已删）⇒ 不拦」正是本任务推翻的那条 ⇒ 已成过时描述。**已改**：拆成两种（有 landed 并入结果 ⇒ 不拦；没有 ⇒ `blocked-branch-absent`），写明补建是每轮先跑的第一道、本前置是兜底，并补上判据指针。
6. 追加发现（同一 5b 手法的第二个实例）：轮日志的 `closeBlocked=` / `closeNotEvaluated=` 在加 `blocked-unmerged-branch` 时**没同步**（整行漏掉一个取值）⇒ 拦截真的发生了却在日志里读不出来。随本次一并补 `closeUnmergedBranch=` / `closeBranchAbsent=`（无任何消费者断言该字符串）。
7. 另一条 5b 检查：`grep -rn 'GoalBranchMergeState'` 全仓 ⇒ 除定义处外只有**一个**消费者（`runGoalRound`），本次改动未遗漏第二处消费点。

**AC4 — DIR-131 边界检查**
```
$ node --experimental-strip-types plugin/scripts/goal-driver-task-boundary-check.ts
goal-driver-task-boundary-check: PASS — goal-driver.ts has no task-write call sites
(task_write/lifecycle_*/fs.write-to-tasks) and no OWN-REPO fan-in/落地率 carrier reads outside the target-probe exempt span
exit=0
```

**AC5 — 三个测试文件**
```
$ node --test plugin/test/goal-driver-criterion-worktree.test.mjs plugin/test/goal-driver-s03.test.mjs plugin/test/goal-driver-s07.test.mjs
ℹ tests 23   ℹ pass 23   ℹ fail 0     exit=0
```

**DoD — 落地读数（本条按 DoD 要求写明取没取到）**
- **落地时本仓拿不到该读数**：本工作区**没有** active ∧ `branch: true` 的 goal（`git branch --list 'goal/*'` 为空；5 条 GOAL-90x 全部 `retired`/`achieved`）⇒ 本前置在当前生产上的**对象数 = 0**，`closeBlocks` 里自然读不到 `blocked-branch-absent`。这与 DoD 预告的「落地时可能没有」一致，故在此如实记「未取到」，不做等效物冒充。
- **能取到的生产直接量（真 goal store，只读）**：用新实现对 `/data/home/yale/work/quay` 的真实 goals 逐条取读数——`GOAL-904`/`GOAL-905`（`achieved` ∧ `branch:true` ∧ 分支不存在）在新实现下得 `{state:"absent"}` **且**账本里 `readGoalMergeResults` 有它们的 landed 并入结果 ⇒ 走「并入后已删」那一支（放行），**证明本次改动不会在真实数据上造出新死结**（这是必须先证的那一半）；`GOAL-901/902/903`（`retired`）同为 `absent` 但无 landed，因非 active 不在关闭判定射程内。
- 落地后可取的形态：下一轮 goal-round 的 `closeBlocks` 出现 `blocked-branch-absent`，且轮日志多出 `closeBranchAbsent=1`（本次新增的计数就是为让它可读）。

## Touches

- plugin/scripts/goal-driver.ts
- plugin/test/goal-driver-criterion-worktree.test.mjs
- plugin/test/goal-driver-s03.test.mjs
- plugin/test/goal-driver-s07.test.mjs
- orchestration/SPEC-goal-branch-2026-10-03.md
- tasks/gap-goal-branch-absent-branch-does-not-block-goal-achieved.md
