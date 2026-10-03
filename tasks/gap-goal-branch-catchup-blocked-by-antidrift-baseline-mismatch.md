---
id: gap-goal-branch-catchup-blocked-by-antidrift-baseline-mismatch
title: goal 分支的追平落地被 anti-drift 的 BASELINE-MISMATCH 结构性阻断：落后 develop 的 merge
  target 先被判死，§4.4 的 step 2b 永远无法完成
status: todo
labels: []
parent: null
children: []
extra: {}
goal_ac: AC-322
---
## Proposal

把 `anti-drift-touches-check.ts` 的 BASELINE-MISMATCH 前置接到**它已经实现、却永远到不了**的两线基准上：当 `--merge-target` 解析为本项目的 `goal/*` 线（branch-model 的 goal 角色）时，基线判据从「merge target 必须含 develop 的 tip」放宽为「该分支可以是 develop 的后代或祖先线」，让落后 develop 的 goal 分支走完 fan-in step 2b 的追平 merge，再由 `computeTaskOwnedFiles` 两线基准判定 task 是否真的越出声明的 `## Touches`。⛔ 不动的三处：`--merge-target develop` 的既有行为、真正外来分支的 fail-closed、以及「线角色判不出时 fail-closed」的姿态（硬规则 3b：读不懂 ≠ 合格）。配套补一条 `detectDefaultBranch` 解析出 `develop` 的取假夹具——本缺陷只在真实仓库形态下出现，现有夹具（`detectDefaultBranch` 为 null）看不见它。

## Contract

**被阻塞的机制**：`orchestration/SPEC-goal-branch-2026-10-03.md` §4.4 裁定③ 的「每次任务落地顺带追平 develop」——`plugin/scripts/worker-fan-in.ts` 的 fan-in step 2b（`mergeTarget !== "develop"` 时追加一次 `git merge develop`）。

**为什么它是死的（2026-10-03 生产实测，主检出 `/data/home/yale/work/quay`，由 `gap-ac322-goal-branch-catchup-landing-real-reading` 的演练取到）**：

1. `anti-drift-touches-check.ts` 的 BASELINE-MISMATCH 前置（`anti-drift-touches-check.ts:354`）用 `classifyBranch(worktree, mergeTarget, defaultBranch)` 要求 **merge target 含 develop 的 tip**（`develop` 是 `mergeTarget` 的祖先）；不含即 exit 3，且这一步在 `computeActualFiles` **之前**执行。
2. 而 step 2b 存在的唯一理由，正是 goal 分支**不含** develop 的 tip（落后了才需要追平）。
3. ⇒ 二者互斥：**goal 分支落后 ⇒ step 2b 会真的造出追平 merge 提交，然后被 BASELINE-MISMATCH 判死；goal 分支不落后 ⇒ step 2b 是 no-op（`Already up to date`），追平这一步永远不会真的发生。**
4. 更硬的一半：goal 分支由 `ensureGoalBranch` 从**当时**的 `develop` tip 分叉（`branch-model.ts:1139`），而其自身的激活记录提交随后经 doc→develop 同步进入 develop ⇒ **goal 分支一诞生就落后 develop**，任何 landing 都撞 BASELINE-MISMATCH。

**原始读数**（演练 GOAL-902；`goal/GOAL-902` = `571c566621ec087649c3c987465627be64750b10`，从当时的 develop tip 建出）：

```
$ git -C <drill-wt> log --oneline -1
97f4e5a59 Merge branch 'develop' into task/gap-goal902-drill-catchup-landing   ← step 2b 真的造出了追平 merge
$ node --experimental-strip-types plugin/scripts/anti-drift-touches-check.ts \
    --task gap-goal902-drill-catchup-landing --worktree <drill-wt> --merge-target goal/GOAL-902
BASELINE-MISMATCH: merge target 'goal/GOAL-902' is not a continuation of the project's default branch
'develop' — 'goal/GOAL-902' (571c5666) is NOT a continuation of the project's default branch 'develop'
(12970aed) — it is 5 commit(s) behind and shares only an old merge base, so a task diff against it is
meaningless.
  ... no declaration of ## Touches can satisfy it. This is a BASELINE defect, not an out-of-declared write.
  Remedy: `quay init --force --adopt-branch-model` ...
exit=3
```

`git merge-base --is-ancestor develop goal/GOAL-902` ⇒ 1（即「goal 分支不含 develop」，正是判据要拒的状态）。

**为什么基线检查在这里是误报**：`gap-goal-branch-antidrift-two-line-base`（done）已经为这个场景实现了 `computeTaskOwnedFiles(worktree, mergeTarget, "develop")`（两线基准：HEAD 中既不可从 mergeTarget 到达、也不可从 develop 到达的提交所改的文件）——它正是为「goal 分支追平了 develop」而写的。但 BASELINE-MISMATCH **在它之前**返回，两线基准**永远没有被调用到**。两者的夹具差异是关键：两线基准任务的夹具里 `detectDefaultBranch` 返回 null（无 remote / 分支名 develop 不被识别），基线检查退化而不触发；**本仓库里它解析出 `develop`，于是每次都触发**——即该缺陷只在真实仓库形态下出现，合成夹具看不见它。

## Plan

1. 让 BASELINE-MISMATCH 的判据与两线基准**共存**：当 `mergeTarget` 是本项目的 `goal/*` 线（branch-model 的 goal 角色）时，基线检查应按「goal 分支可以是 develop 的后代或祖先线」判定，而不是要求它含 develop 的 tip；判不出时 fail-closed 的姿态逐字保留（硬规则 3b：读不懂 ≠ 合格）。
2. 补齐取假夹具：`plugin/test/anti-drift-touches-check.test.mjs` 现在**只覆盖了 `detectDefaultBranch` 为 null 的形态**——补一条 `detectDefaultBranch` 解析出 `develop` 的形态，断言「追平了 develop 的 goal 分支 landing ⇒ exit 0」（当前该形态必然红）。
3. 端到端复读：在真实 store 上重跑一次含追平的 goal 分支落地（`gap-ac322-goal-branch-catchup-landing-real-reading` 的演练配方），直到 `quay goal gate AC-322 --dry-run --json` 读 exit 0。
4. 把 AC-322 演练 worktree 里**已经写绿**的判据夹具并入本任务（见 Touches）：`packages/quay/test/ac322-criterion-catchup.test.mjs`，逐字绑定 `goals/AC-322-*.md` 判据原文、覆盖 exit 0/1/3 三态。

## Acceptance Criteria

- [ ] AC1（机制上可共存）：`--merge-target <goal 分支>` 且该分支落后 develop 时，anti-drift **不再**返回 exit 3 BASELINE-MISMATCH，而是走 `computeTaskOwnedFiles` 两线基准；`--merge-target develop` 的既有行为逐字不变；真正的外来分支（非本项目 goal 线、非 develop 后代）仍 fail-closed 报 BASELINE-MISMATCH。
- [ ] AC2（取假且覆盖真实形态）：`plugin/test/anti-drift-touches-check.test.mjs` 新增一条 `detectDefaultBranch` 解析出 `develop` 的夹具——落后 develop 的 `goal/*` merge target ⇒ exit 0；用 `cp` 备份把该修复临时回退（⛔ 不用 `git checkout --`）后该条转红，恢复后回绿；贴两次实跑输出。
- [ ] AC3（AC-322 生产读数）：在真实 store 上完成一次含追平的 goal 分支落地（step 2b 造出追平 merge 提交）后，`node packages/quay/bin/quay.js goal gate AC-322 --dry-run --json --root /data/home/yale/work/quay` ⇒ `"verdict":"pass"`、`"cause":null`；贴原始 JSON、`echo $?`、追平 merge 提交 SHA 与 flip 提交的逐字 subject。
- [ ] AC4（判据夹具落地且非空转）：并入 `packages/quay/test/ac322-criterion-catchup.test.mjs`——判据文本从 `goals/AC-322-*.md` 运行时提取、以 `/bin/sh` 在临时仓库上跑，覆盖「无 branch-mode goal ⇒ exit 3」「落地缺 develop tip ⇒ exit 1 且 `CAUSE=landing-missed-develop-catch-up`」「落地含追平 merge ⇒ exit 0」；`node --test packages/quay/test/ac322-criterion-catchup.test.mjs` 全绿；贴执行的文件名。
- [ ] AC5（scoped 门绿）：`bash scripts/test.sh --for-task gap-goal-branch-catchup-blocked-by-antidrift-baseline-mismatch` 退出 0 且执行 ≥1 个测试文件。

## Definition of Done

真实落地判据：**落后 develop 的 `goal/*` 分支能完成一次含追平的 landing**——step 2b 造出的追平 merge 提交留在落地历史里，且该落地被 anti-drift / typecheck / scoped / suite 全链放行、ff 回 goal 分支。生产读数是 **AC-322 判据在主检出上读 exit 0**（`goal/GOAL-902` 演练之外的一条新 goal 分支，含真实追平 merge），不是「夹具绿了」。⛔ 不算数：只让夹具绿、只让 BASELINE-MISMATCH 闭嘴而不验证两线基准仍在拦真越界。

## Touches

- plugin/scripts/anti-drift-touches-check.ts
- plugin/test/anti-drift-touches-check.test.mjs
- packages/quay/test/ac322-criterion-catchup.test.mjs
- tasks/gap-goal-branch-catchup-blocked-by-antidrift-baseline-mismatch.md

（说明：最后一条是 self-touch；第三条夹具已由 AC-322 演练写好并跑绿，落在演练 worktree `/home/yale/work/quay-worktrees/gap-ac322-goal-branch-catchup-landing-real-reading/packages/quay/test/ac322-criterion-catchup.test.mjs`，其判据把「缺追平」钉成 exit 1——⛔ 本任务不重写它，只在它不存在时从该路径取来。）
