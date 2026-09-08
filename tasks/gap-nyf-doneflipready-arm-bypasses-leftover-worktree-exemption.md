---
id: gap-nyf-doneflipready-arm-bypasses-leftover-worktree-exemption
title: notYetFlipped 的 doneFlipReady 臂绕过 leftover-worktree 豁免 —— worktree
  敞着、产出未进 develop 却判 landed，任务永久出池
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`plugin/scripts/ready-pool-check.ts:990` 的返回式是
`return doneFlipReady || (allChecked && !hasLeftoverWorktree)`
—— leftover-worktree 豁免**只挂在 `allChecked` 那一臂**，`doneFlipReady`
（= `workLandedReady || commitTraceReady`）完全绕过它。于是一个 worktree 仍敞着、产出根本没进 develop 的任务，
只要 `taskWorkLanded` 取真就判 not-yet-flipped 并永久离开 ready 池 ——
正是该文件注释自己警告的「a false "landed" makes a task disappear from the pool FOREVER」。

生产实证（2026-09-08 主检出实跑，非 fixture）：`gap-mechanical-fan-in-loses-per-phase-accounting`
以 `ref=develop` 干跑 `taskWorkLanded` 返回 **true**，而
`git cat-file -e develop:plugin/test/suite-accounting.test.mjs` 为 **ABSENT**，
worktree `task/gap-mechanical-fan-in-loses-per-phase-accounting` 敞着且 `develop..HEAD = 3` 提交未落。
根因是 touch-file 信号是**存在性**读法：该任务 6 条 Touches 里 4 条是它**编辑**的既有文件
（`full-suite-runner.ts` / `suite-accounting.ts` / `worker-driver.ts` / `worker-driver.test.mjs`，develop 中本来就在），
于是「文件存在」被读成「本任务的改动已落地」—— 典型代理量偏离（硬规则 4b）。
`gap-perfile-failure-rate-baseline-step-change` 同形（`perfile-failure-rate.ts` 341 行 + 测试 136 行 develop 中缺席，
`taskWorkLanded` 仍取真）。

## Plan

1. 把 leftover-worktree 豁免提到**所有臂之上**：worktree 敞着 ⇒ fan-in 未完成 ⇒ 无论哪个 landed 信号取真都必须留在池里
   （worktree 是 `git worktree list` 的直接量，landed 信号是代理量；直接量优先，硬规则 4b）。
   形如 `if (hasLeftoverWorktree) return false;` 前置于三臂判定。
2. 加固 touch-file 的 landed 信号：文件**存在**不等于本任务改动落地 —— 对编辑既有文件的任务，
   存在性零信息。至少让「Touches 中存在 develop 里缺席的文件」一票否决 landed（fail-closed 朝可派发）。
3. 单测：构造「worktree 敞着 + 全勾 + taskWorkLanded 取真」的样本，断言 `notYetFlipped === false`（可派发）；
   改动前该用例必须先红。
4. 复查同一原则其它适用点（硬规则 5b）：grep `doneFlipReady` / `hasLeftoverWorktree` 全部命中并贴计数与前 3 条。

## AC

- [ ] 单测：worktree 敞着 + `allChecked` + `workLanded` 取真 ⇒ `notYetFlipped === false`（改动前先红，贴红输出，排除恒真）
- [ ] 单测：worktree 敞着 + `commitTraceReady` 取真 ⇒ `notYetFlipped === false`（commit-trace 臂同样受豁免约束）
- [ ] 回归：worktree 已删 + `allChecked` + landed ⇒ `notYetFlipped === true`（原行为不退化，双向可翻）
- [ ] 单测：Touches 含一个 develop 中缺席的文件 ⇒ landed 信号不得取真（贴用例与断言）
- [ ] `node --test plugin/test/ready-pool-check.test.mjs` 全绿，贴 pass/fail 计数
- [ ] `doneFlipReady` / `hasLeftoverWorktree` 全仓命中数与前 3 条实际内容贴进提交（硬规则 5b 产物）

## DoD

生产载体读数：改动落地后对主检出实跑 `ready-pool-check.ts --json`，
`gap-mechanical-fan-in-loses-per-phase-accounting` 与 `gap-perfile-failure-rate-baseline-step-change`
离开 `excluded` 的 not-yet-flipped 集合、重新进入 `ready`/`candidates`（贴 JSON 前后两次读数）。
⛔ 单测绿必要非充分，必须读生产载体（硬规则 4 推论三）。

## Touches

- plugin/scripts/ready-pool-check.ts
- plugin/test/ready-pool-check.test.mjs
- tasks/gap-nyf-doneflipready-arm-bypasses-leftover-worktree-exemption.md

## Verification

负控制：删掉 worktree 后同一样本判定必须翻回 `true`；保留 worktree 则为 `false` ——
一个参数翻转结论就翻，排除恒真/恒假（硬规则 4 / 推论四）。
