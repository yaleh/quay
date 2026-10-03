---
id: gap-goal-branch-antidrift-two-line-base
title: goal 分支任务的 anti-drift 比较基准只计任务自身变更——追平合入的 develop 变更不得被判越界
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
goal_ac: AC-322
---
## Proposal

**机制**（`orchestration/SPEC-goal-branch-2026-10-03.md` §4.4、裁定③）：落到 `goal/<GOAL-NNN>` 的任务，在自己的 worktree 里先 `git merge goal/<id>` 再 `git merge develop`（每次落地顺带追平）。而 `plugin/scripts/anti-drift-touches-check.ts:405` 的 diff 基准是 `<mergeTarget>...HEAD`：mergeTarget = goal 分支时，追平带进来的 develop 变更全部出现在这个 diff 里 ⇒ 每次追平都被判「写出 Touches 之外」而硬失败。这是 goal 分支接线前必须先修的前提，对现有路径零行为变化。

**修法（方向，实现者可调）**：mergeTarget ≠ develop 时，被检查的文件集只取任务自身的变更——HEAD 中既不可从 mergeTarget 到达、也不可从 develop 到达的提交所改的文件（追平 merge 提交里的冲突解决如何计入，由实现者取证后决定并写进 Evidence）。mergeTarget = develop 时行为逐字不变。

## AC

- [ ] 新增 `plugin/test/anti-drift-touches-check.test.mjs`（basename 与被测脚本成对），在临时 git 仓库里构造 develop、`goal/GOAL-901` 与一个先后合入两者的任务分支，覆盖并断言：① develop 改了 Touches 之外的文件 X、任务只改 Touches 内的 Y，`--merge-target goal/GOAL-901` ⇒ 通过且输出不含 X；② 任务自己改了 Touches 之外的 Z ⇒ 失败且点名 Z；③ `--merge-target develop` 的既有行为（同一夹具）与修改前一致。
- [ ] 取假：把本任务的核心改动临时回退（用 `cp` 备份恢复，⛔ 不用 `git checkout --`）后，上面新增用例至少 1 条变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [ ] `node --test plugin/test/fan-in-execute-paths-s03.test.mjs plugin/test/fan-in-execute-paths-s04.test.mjs plugin/test/touches-parser-parity.test.mjs` 退出 0（现有消费方不受影响）。
- [ ] 5b 邻近扫描：grep fan-in 路径上其它以 mergeTarget 为 diff 基准的点（至少含 `plugin/scripts/fan-in-ts-typecheck-gate.ts`），把命中数与前 3 条贴进 Evidence，逐条判断是否需要同样的基准；需要且在 Touches 内的就改，否则在 Evidence 写明理由。
- [ ] `bash scripts/test.sh --for-task gap-goal-branch-antidrift-two-line-base` 退出 0，且确实执行了 ≥1 个测试文件（非 thin；在 `## Evidence` 贴出被执行的测试文件名）。

## DoD

真实落地判据：goal 分支上的任务在追平 develop 后能通过 anti-drift，而写出 Touches 的任务仍被拦下。生产读数由 GOAL-028 的 AC-322（每次 goal 分支落地都含追平时刻的 develop）在第一个试点 goal 上取得；本任务落地时该 AC 读 exit 3 是正确的。

## Touches

- plugin/scripts/anti-drift-touches-check.ts
- plugin/scripts/fan-in-ts-typecheck-gate.ts
- plugin/test/anti-drift-touches-check.test.mjs
- tasks/gap-goal-branch-antidrift-two-line-base.md
