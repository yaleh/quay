---
id: gap-goal-branch-goal-flips-achieved-before-its-branch-merges
title: branch-mode goal 在 goal 分支并入 develop 之前就被 goal-driver 翻成 achieved，随后 quay
  goal merge 因非 active 被拒——死结（GOAL-904 演练读到）
status: todo
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

- [ ] `plugin/test/goal-driver-criterion-worktree.test.mjs` 新增用例（临时仓库，该文件已有 branch-mode goal 夹具）：branch-mode goal，全部 AC 为 pre-merge 且已 achieved，sufficiency 为 covered，`goal/<id>` 存在且不是 develop 祖先 ⇒ 一轮之后 goal 仍是 `active`，`closeBlocks` 含 `blocked-unmerged-branch` 并点名该 goal；把分支并入 develop（或删除分支）后下一轮 goal 被翻为 `achieved`；同一夹具里**非** branch-mode 的 goal 在同样条件下照常被翻为 `achieved`（不受影响）。
- [ ] 取假：把本任务的核心改动临时回退（用 `cp` 备份恢复，⛔ 不用 `git checkout --`）后，上面新增用例至少 1 条变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [ ] 5b 邻近扫描：在 `plugin/scripts/goal-driver.ts` 与 `packages/quay/src/goal-store.ts` 内 grep 其它把 goal 状态写成 `achieved` 的写入点（含 supersedes 的级联写），把命中数与前 3 条贴进 Evidence，逐条判断是否会让 branch-mode goal 在分支未并入时变成 achieved；会且在 Touches 内的一并改，其余在 Evidence 写明理由。
- [ ] `node --experimental-strip-types plugin/scripts/goal-driver-task-boundary-check.ts` 退出 0（DIR-131；⚠️ 注释里出现该类字样也会被判红）。
- [ ] `orchestration/SPEC-goal-branch-2026-10-03.md` 的 §4.7 增补这条规则与它的来源（GOAL-904 演练读到的提前 achieved），`grep -c 'blocked-unmerged-branch' orchestration/SPEC-goal-branch-2026-10-03.md` 至少为 1。
- [ ] `node --test plugin/test/goal-driver-criterion-worktree.test.mjs` 退出 0。

## DoD

真实落地判据：落地之后，人对 GOAL-904 把状态重开为 active，它在并入之前不再被 goal-driver 翻回 achieved；并入完成、分支被删之后的下一轮才翻为 achieved，且该 achieved 晚于并入提交。生产读数由 GOAL-028 的 AC-325（develop 上的 goal 合并提交之前有人工请求、且 goal 的 achieved 晚于合并提交）在 GOAL-904 的并入完成后取得。

## Touches

- plugin/scripts/goal-driver.ts
- orchestration/SPEC-goal-branch-2026-10-03.md
- plugin/test/goal-driver-criterion-worktree.test.mjs
- tasks/gap-goal-branch-goal-flips-achieved-before-its-branch-merges.md
