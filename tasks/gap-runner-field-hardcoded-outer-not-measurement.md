---
id: gap-runner-field-hardcoded-outer-not-measurement
title: "full-suite-runner 的 runner 字段恒写 \"outer\"（无 --runner 旗标）——结构上不可能取假的量 + AC84 判据1 把它当恒真合取项"
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

`full-suite-runner.ts:2532` `runner: "outer" as const` 硬编码恒写 `"outer"`（注释自述「无 --runner 旗标」），而 `pre-verified-round-record.ts` 已有 `--runner` 旗标（default `'outer'`）——同一字段两处实现不一致。**硬规则 4**：`runner` 恒 `"outer"` 是结构上不可能取假的量，不是测量（今晚 inner 跑的 100 轮全被标 `runner=outer`）。注释 `:277-283`「runner 只记录名义层身份，不知道调用者是主会话回合 / workflow / subagent」正是承认该字段已失去判别力。

**更关键的连带缺陷**：AC84 判据1 用 `runner=outer && scope=main` 条数=0 判别「outer 主会话直跑」，其中 `runner=outer` 是恒真合取项，实际只有 `scope` 在起判别作用——判据碰巧结论正确，但写成「按执行者归因」的样子而字段没有执行者信息（a8 2026-08-20 发现）。

**修法提示（a8 2026-08-20 01:59Z，正确来源已在仓库，不用新造）**：同一个 runner 概念在两个载体里一真一假——`.quay/full-suite-state.json` 本轮实写 `runner:"inner"`、`scope:"worktree"`（真测量），而 `full-suite-runner.ts:2532` 的 verification-round 写入点恒写 `runner:"outer" as const`（常量）。**不需要新发明「如何判断真实执行者」——写 state 文件的那条路径已经知道答案（它同时正确写出 `scope:"worktree"`），把 verification-round 的写入点改成读同一来源即可**，比新造判定逻辑省，且两个载体从此不再各说各话。注意：这不推翻硬规则 4 判断（恒 outer 仍是不可取假量），只是修法更省。

## Acceptance Criteria

- [x] AC1: `runner` 字段真实反映执行者——**优先**读 `.quay/full-suite-state.json` 的同一来源（那条路径已如实写 `runner:"inner"` / `scope:"worktree"`，不新造判定逻辑）；次选接 `--runner` 旗标（对齐 `pre-verified-round-record.ts`）；末选给「未评估」第三态（硬规则 3b：无法判定执行者时 `runner=NOT-EVALUATED`，不与 `"outer"` 共用取值）。**（落地：full-suite-runner `base.runner` 从 `"outer" as const` 改为取真值——显式 `--runner` 旗标优先，否则从 scope 的同一来源派生（isGitWorktree(root)：worktree 内跑⇒inner，主检出跑⇒outer）；state 与 verification-round 共用 base.runner。pre-verified-round-record 默认 runner "outer"→"inner"（同 mirror-full-suite-state.ts，fan-in 是 inner 层跑）。未用 NOT-EVALUATED——真实来源已在仓库。）**
- [x] AC2: 负控制落在生产载体——inner fan-in 的一轮 suite，其 state 记录 `runner` 字段 != `"outer"`（读真实 verification-round / state 记录，非 fixture），**或** AC84 判据1 措辞改为只依赖 `scope`（明确不引用恒真 runner 项）。**（勾选：本 fan-in 轮（runId fm-gap-runner-field-hardcoded-outer-not-measurement-1787249842518-3243bo）的真实 verification-round 记录 round 343 写 `runner:"inner"` != `"outer"`、scope=worktree——负控制落在生产载体达成，非 fixture。AC84 判据1 措辞在 orchestration/manager-phase-goal.md，不在本任务 Touches，未改。）**
- [x] AC3: scoped 绿 + AC84 判据 / suite-execution-form-counter 不红。**（勾选：scoped 门 `scripts/test.sh --for-task` 192 绿已跑；本 fan-in 全量 suite 绿（4464 tests / fail 0 / skipped 113），`plugin/test/suite-execution-form-counter.test.mjs passed=true`——@static-tier full 检查不红。其 signal 已由 A19 重写改为 transcript 分类，不读 runner，结构上不受本改动影响。）**

## Definition of Done

- [x] `runner` 字段不再恒 `"outer"`（真实反映执行者或未评估第三态），AC84 判据1 不再把恒真 `runner` 项当判别依据（真实输出，非 fixture）。**（勾选：代码侧落地 commit `7264e3ef`：full-suite-runner 现可取 runner="inner"（--runner / worktree scope 派生），pre-verified-round-record 默认写 "inner"⇒ 字段可取假、AC84 判据1 的 runner=outer 项不再恒真。生产载体真实输出已确认：本 fan-in 轮 verification-round round 343 写 runner="inner"、全量 suite 绿 fail 0。）**

## Touches

- tasks/gap-runner-field-hardcoded-outer-not-measurement.md（自身）
- plugin/scripts/full-suite-runner.ts（runner 字段写真实执行者或未评估第三态，接 --runner 旗标）
- plugin/scripts/pre-verified-round-record.ts（--runner 旗标对齐，若需）
- plugin/test/（runner 字段负控制——非 fixture，读真实 state 记录）
