---
id: gap-goal-branch-goal-flips-achieved-before-its-branch-merges
title: branch-mode goal 在 goal 分支并入 develop 之前就被 goal-driver 翻成 achieved，随后 quay
  goal merge 因非 active 被拒——死结（GOAL-904 演练读到）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on: []
goal_ac: AC-325
---
## Proposal

**机制**（2026-10-04 在 GOAL-904 合并演练中读到，生产直接量）：branch-mode goal 的 `achieved` 翻转（`plugin/scripts/goal-driver.ts` `goalFlipDecision`，写入点 `writeGoalStatus(…"achieved"…)`）只看 I2（全部 AC achieved）与 sufficiency 判据（`covered`）与既有 close-block（`goalCloseBlockFromRecords`，只有「achieved 的 AC 当前判据失败」一种），**不看它的 goal 分支是否已并入 develop**。`orchestration/SPEC-goal-branch-2026-10-03.md` §4.7 的生命周期是「pre-merge AC 全部达成 → 人触发并入 → 并入后再判 post-merge AC → achieved」，它默认 goal 至少带一条 post-merge AC；一个 AC 全是 pre-merge 的 branch-mode goal 在并入之前就满足 I2 与 sufficiency，于是被提前翻成 `achieved`。

**生产读数**（GOAL-904，`goals/GOAL-904-*.md` statusLog）：`from: active to: achieved actor: goal-driver reason: "I2: all ACs achieved + sufficiency covered"`；同一时刻 `git rev-parse refs/heads/goal/GOAL-904` 存在，`git merge-base --is-ancestor goal/GOAL-904 develop` 为假（未并入）。随后 `quay goal merge GOAL-904 …` 被拒：`merge refused (goal-not-active): GOAL-904 status is "achieved" — only an active goal can be merged`。

**后果（死结）**：goal 已 `achieved` ⇒ `quay goal merge` 拒绝（只允许 active）⇒ 分支永远并不进去；人手工重开（`achieved → active` 是人的决定）下一轮又被翻回 `achieved`；GOAL-028 的 AC-325「goal 的 achieved 晚于并入」也因此无法被一个只含 pre-merge AC 的 goal 满足。

**修法（方向，实现者可调）**：给 `goalFlipDecision`（或其调用处）加一条 close-block：该 goal 的 frontmatter 为 `branch: true`，且 `goal/<id>` 分支仍存在、又不是 develop 的祖先 ⇒ 不翻，本轮读数记 `closeBlocks` 一条 `blocked-unmerged-branch`（点名 goal 与分支 tip）。分支不存在（已并入后被删，或从未创建）或已是 develop 的祖先 ⇒ 不拦，行为与现状一致。⛔ 不动 I2、不动 sufficiency 判据；⛔ goal-driver 只读 git 引用，不读本仓落地载体（DIR-131，注释里出现 fan-in 字样也会被判红）。非 branch-mode 的 goal 行为逐字不变。

<!-- dedup-ref -->相关但机制不同：`gap-goal-branch-human-merge-verb-and-execution`（done）建立了人工并入请求与执行，本任务修的是 goal 在并入之前被提前翻成 achieved。

## AC

- [x] `plugin/test/goal-driver-criterion-worktree.test.mjs` 新增用例（临时仓库，该文件已有 branch-mode goal 夹具）：branch-mode goal，全部 AC 为 pre-merge 且已 achieved，sufficiency 为 covered，`goal/<id>` 存在且不是 develop 祖先 ⇒ 一轮之后 goal 仍是 `active`，`closeBlocks` 含 `blocked-unmerged-branch` 并点名该 goal；把分支并入 develop（或删除分支）后下一轮 goal 被翻为 `achieved`；同一夹具里**非** branch-mode 的 goal 在同样条件下照常被翻为 `achieved`（不受影响）。
- [x] 取假：把本任务的核心改动临时回退（用 `cp` 备份恢复，⛔ 不用 `git checkout --`）后，上面新增用例至少 1 条变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [x] 5b 邻近扫描：在 `plugin/scripts/goal-driver.ts` 与 `packages/quay/src/goal-store.ts` 内 grep 其它把 goal 状态写成 `achieved` 的写入点（含 supersedes 的级联写），把命中数与前 3 条贴进 Evidence，逐条判断是否会让 branch-mode goal 在分支未并入时变成 achieved；会且在 Touches 内的一并改，其余在 Evidence 写明理由。
- [x] `node --experimental-strip-types plugin/scripts/goal-driver-task-boundary-check.ts` 退出 0（DIR-131；⚠️ 注释里出现该类字样也会被判红）。
- [x] `orchestration/SPEC-goal-branch-2026-10-03.md` 的 §4.7 增补这条规则与它的来源（GOAL-904 演练读到的提前 achieved），`grep -c 'blocked-unmerged-branch' orchestration/SPEC-goal-branch-2026-10-03.md` 至少为 1。
- [x] `node --test plugin/test/goal-driver-criterion-worktree.test.mjs` 退出 0。

## DoD

真实落地判据：落地之后，人对 GOAL-904 把状态重开为 active，它在并入之前不再被 goal-driver 翻回 achieved；并入完成、分支被删之后的下一轮才翻为 achieved，且该 achieved 晚于并入提交。生产读数由 GOAL-028 的 AC-325（develop 上的 goal 合并提交之前有人工请求、且 goal 的 achieved 晚于合并提交）在 GOAL-904 的并入完成后取得。

## Touches

- plugin/scripts/goal-driver.ts
- orchestration/SPEC-goal-branch-2026-10-03.md
- plugin/test/goal-driver-criterion-worktree.test.mjs
- tasks/gap-goal-branch-goal-flips-achieved-before-its-branch-merges.md

## Evidence

### AC1/AC6 — 新增用例 + 整文件绿
`node --test plugin/test/goal-driver-criterion-worktree.test.mjs`（worktree 内实跑）：

```
✔ branch-mode goal 在 goal/<id> 并入 develop 之前不得被翻 achieved（closeBlocks=blocked-unmerged-branch + 点名分支 tip）；并入后下一轮才翻；非 branch-mode 同条件照常翻 (2644ms)
ℹ tests 9
ℹ pass 9
ℹ fail 0
```

该用例三臂：① 并入前 `closeBlocks` 里 GOAL-910 一条 `{verdict:"blocked-unmerged-branch", branchTip:<goal/GOAL-910 tip>, goal:"GOAL-910"}`，goal 文件仍 `status: active`，flips 里一条 `ok:false` 的 `blocked-unmerged-branch: goal/GOAL-910 @ <sha>`；② `git merge --ff-only goal/GOAL-910` 并入 develop 后【下一轮】goal 翻 `achieved`（flips `ok:true`）且 closeBlock 回 `clear`；③ 同夹具里非 branch-mode 的 GOAL-911 同条件照常 `achieved`，其 `clear` 条目【不含】`branchTip` 键（负控制：拦截只针对 branch-mode 的未并入分支）。

### AC2 — 取假（cp 备份回退 ⇒ 红；cp 恢复 ⇒ 绿）
`cp plugin/scripts/goal-driver.ts <bak>` 备份后，把 `goalBranchMergeState` 临时改成恒返回 `{state:"settled"}`（= 回退本任务核心改动），跑新用例：

```
✖ branch-mode goal 在 goal/<id> 并入 develop 之前不得被翻 achieved …
  AssertionError [ERR_ASSERTION]: 实测={"goal":"GOAL-910","verdict":"clear","acs":[],"cause":null}
ℹ pass 0
ℹ fail 1
```

red 的直接原因：回退后 GOAL-910 的 closeBlock 是 `clear` 而非 `blocked-unmerged-branch`——即旧行为会给并入前的 branch-mode goal 放行（提前 achieved）。
用 `cp <bak> plugin/scripts/goal-driver.ts` 恢复后再跑 ⇒ `ℹ tests 9 / pass 9 / fail 0`（即上引 AC1/AC6 的绿输出）。⛔ 全程未用 `git checkout --`。

### AC3 — 5b 邻近扫描（其它把 goal 状态写成 achieved 的写入点）
`grep -n 'writeGoalStatus(scriptRoot[^;]*"achieved"' plugin/scripts/goal-driver.ts` ⇒ **2 命中**：
1. `:3590 writeGoalStatus(scriptRoot, id, "achieved", …, "I2: criterion pass")` — **AC 级**翻转（一条 AC 判据 pass ⇒ 该 AC active→achieved）。对象是 AC 记录，不是 GOAL；不可能让 branch-mode **goal** 提前 achieved。
2. `:3775 writeGoalStatus(scriptRoot, gid, "achieved", …, "I2: all ACs achieved + sufficiency covered")` — **GOAL 级**翻转，**本任务已加分支前置**（`unmerged !== null` ⇒ 不写）。

⇒ goal-driver.ts 内 2/2 已逐条审，唯一能翻 GOAL 的那条已覆盖。

`grep -n '"achieved"' packages/quay/src/goal-store.ts` ⇒ 94 命中（含注释 / 比较 / 类型字面量），其中**写入点**两类：
1. `write()` 的 `nextStatus = status ?? …`（`:2544`）——直接 `quay goal write <id> --status achieved`（人 / CLI 的显式关闭）。与既有 ledger close-block 的射程口径一致（`goalFlipDecision` 旁既有注释明写「人工 / `goal-cli` 的直接关闭不在射程内」）；这是**人的显式决定**，不是 mechanical driver 的提前翻。**goal-store.ts 不在 Touches 内，不改**（对称守卫若要做是另一条 gap）。
2. `:2941-2943` `flipGoal(disposeOld.id, {status: disposeOld.to === "achieved" ? "achieved" : "superseded"})` — supersedes / `disposeOld` **级联写**，仅在 `write()` 激活一条**新** goal 且调用方显式传 `--dispose-old <id> --dispose-to achieved` 时触发（`:2933` 的 active-cap 让位路径）。同样是**人的显式处置**（把旧 goal 记成 achieved 以腾出 active 名额），不是 driver 的自动翻。**不在 Touches 内，不改**。

⇒ 结论：唯一**自动 / 机械**把 GOAL 翻 achieved 的路径是 `goal-driver.ts:3775`，已加前置；goal-store.ts 的两条都是人的显式写入（与既有 close-block 的射程口径一致），故不在本任务 Touches 内修改，理由如上。

### AC4 — DIR-131 边界检查
`node --experimental-strip-types plugin/scripts/goal-driver-task-boundary-check.ts` ⇒ `goal-driver-task-boundary-check: PASS …`，`exit=0`。

### AC5 — SPEC §4.7 增补
`grep -c 'blocked-unmerged-branch' orchestration/SPEC-goal-branch-2026-10-03.md` = **2**（≥1）。增补段落同时记了来源（GOAL-904 演练读到的提前 achieved）与三个对照臂的判据位置。

### 收尾读数
- 预合并：worktree 内 `git merge --no-edit develop` ⇒ `Already up to date`（本分支自 develop 分出，develop = ac50a6b46）。
- scoped 门：`bash scripts/test.sh --for-task gap-goal-branch-goal-flips-achieved-before-its-branch-merges --allow-thin` ⇒ `SCOPED_GATE_EXIT=0`（9/9 pass）。
- scoped-gate 缓存已写：`{"event":"scoped-gate-cache-written", "task":"gap-goal-branch-goal-flips-achieved-before-its-branch-merges", "developSha":"ac50a6b462ad6a58d3cd882410f173b65ad2db53"}`。
- 实现提交：`bf3876f83 fix(goal): branch-mode goal 在 goal 分支并入 develop 前不得被翻 achieved`。
