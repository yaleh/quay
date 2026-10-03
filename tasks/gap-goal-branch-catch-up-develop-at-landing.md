---
id: gap-goal-branch-catch-up-develop-at-landing
title: goal 分支落地的追平：fan-in 落回 goal 分支前合入追平时刻的 develop（AC-322 承载）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-322
---
## Proposal

**为什么上一版没成立（AC-322 的既有认领已 done，判据仍非通过）**：AC-322 此前的承载任务 `gap-goal-branch-antidrift-two-line-base` 只修了追平的一个**前提**——anti-drift 的 diff 基准（`computeActualFiles` 的两线基准，见其 `plugin/scripts/anti-drift-touches-check.ts` 改动），它自己的 `## DoD` 就写明「生产读数由 GOAL-028 的 AC-322 在第一个试点 goal 上取得；本任务落地时该 AC 读 exit 3 是正确的」。该任务落地后（develop `a2c10e80`）实测 `node packages/quay/bin/quay.js goal gate AC-322 --dry-run` 仍读 `NOT-EVALUATED: no goal record carries branch: true yet`（exit 3）。**追平（把当时的 develop 合进 goal 分支的落地树）这一步本身从未被交付**，判据没有任何可核对的对象，故为**空转**而非通过——这正是「修得不彻底」的形态：前提修好了，本体没做。

**机制**（`orchestration/SPEC-goal-branch-2026-10-03.md` §4.4 裁定③）：机械 fan-in 的「合入 mergeTarget」一步，在 mergeTarget 是 `goal/<GOAL-NNN>` 时扩为**两次合并，都在任务自己的 worktree 里**：先 `git merge goal/<id>`，再 `git merge develop`（追平）。追平放在任务 worktree 而不是单独对 goal 分支做的理由（SPEC §4.4）：goal 分支没有自己的工作树可以做 merge 提交；放进任务 worktree 后，追平后的那棵树恰是被该任务全量 suite 验证过、随后被 ff 到 goal 分支的同一棵树——没有一棵未经验证的中间树。

**修法（方向，实现者可调）**：`plugin/scripts/worker-fan-in.ts` 的 fan-in 步骤 2（现为单个 `git merge <mergeTarget>`，约 `:1795`）在 `mergeTarget !== "develop"` 时改为：合并 `mergeTarget` 后**再合并 `develop`**（两次 `git merge --no-edit`）；`mergeTarget === "develop"` 路径逐步零行为变化。追平须留下**可核对的 merge 提交**：AC-322 的判据把「该次落地内合入 develop 的 merge 提交时间」当作追平时刻；若 develop 已在祖先里而被 fast-forward、不产生 merge 提交，判据退化为「该次落地最早提交时间」——实现须确认**两条路径**都使 develop 的当时 tip 成为落地提交的祖先，并在 Evidence 对两条各贴一次实跑读数。

**范围边界**：
<!-- dedup-ref -->
派发接线（`resolveTaskMergeTarget`、worktree 分叉点 `--base`、goal 分支锁）归既有任务 `gap-goal-branch-dispatch-wiring-and-task-fan-in`，本任务不重复那部分；本任务把「追平」这一步独立承载，给 AC-322 一个唯一、可验证的归属。两条任务都可能改 `plugin/scripts/worker-fan-in.ts`，由 Touches 重叠串行化，不并行。

## AC

- [ ] `plugin/scripts/worker-fan-in.ts` 的 fan-in 在 `--merge-target <非 develop 分支>` 时先合入该分支、再合入 `develop`；`--merge-target develop` 的既有行为逐字不变（同一夹具断言该路径与改动前逐元素等价）。
- [ ] 新增 `plugin/test/worker-fan-in-catch-up.test.mjs`（basename 与被测脚本成对）：临时 git 仓库构造 `develop`、`goal/GOAL-901` 与一个从 goal 分支分叉的任务分支，develop 在分叉后前进；跑 fan-in 落回 `goal/GOAL-901` ⇒ 断言**落地提交以追平时刻的 develop tip 为祖先**（`git merge-base --is-ancestor <devTip> <landing>`，devTip 取追平前的 `git rev-parse develop`），且落地历史里存在一个以 develop 侧提交为父的 merge 提交；退化路径（develop 已是祖先、无 merge 提交）单独一条用例断言同样成立。
- [ ] 取假：用 `cp` 备份把核心改动临时回退（⛔ 不用 `git checkout --`）后，上面新增用例至少 1 条变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [ ] 回归：`node --test plugin/test/fan-in-execute-paths-s03.test.mjs plugin/test/fan-in-execute-paths-s04.test.mjs` 退出 0（非 goal 路径不受影响）。
- [ ] 5b 邻近扫描：grep fan-in 路径上其它「假定只合入一次 mergeTarget」的点（至少含 `plugin/scripts/fan-in-ts-typecheck-gate.ts` 与 worker-fan-in 的 delta 基准），把命中数与前 3 条贴进 Evidence，逐条判断追平后是否仍正确；需要且在 Touches 内的就改，否则在 Evidence 写明理由。
- [ ] `bash scripts/test.sh --for-task gap-goal-branch-catch-up-develop-at-landing` 退出 0，且确实执行了 ≥1 个测试文件（非 thin；在 `## Evidence` 贴出被执行的测试文件名）。

## DoD

真实落地判据：branch-mode goal 的一个任务落到 `goal/<id>` 后，该落地提交以**追平时刻的 develop tip** 为祖先——生产读数由 GOAL-028 的 AC-322（`quay goal gate AC-322`，exit 0）在第一个试点 goal 上取得。本任务落地使「追平」这一步存在并被合成夹具验证；在 branch-mode 派发接线与人的试点跑起来之前，AC-322 读 exit 3 是正确的——⛔ 不把合成夹具的绿当作 AC-322 的通过，也不把该 AC 的通过留给「下一个任务」。

## Touches

- plugin/scripts/worker-fan-in.ts
- plugin/scripts/fan-in-ts-typecheck-gate.ts
- plugin/test/worker-fan-in-catch-up.test.mjs
- tasks/gap-goal-branch-catch-up-develop-at-landing.md

## Evidence
