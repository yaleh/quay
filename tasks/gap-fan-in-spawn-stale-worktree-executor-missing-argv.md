---
id: gap-fan-in-spawn-stale-worktree-executor-missing-argv
title: fresh-process fan-in spawn 用 worktree 的 worker-driver.ts 当执行器——stale worktree 缺新 argv（--mechanical-fan-in）⇒ unknown argument ⇒ parse-mechanical-fan-in fail
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`spawnMechanicalFanIn`（worker-driver.ts:2222）`entry = path.join(opts.worktree, "plugin", "scripts", "worker-driver.ts")`——spawn 用 **worktree 的 worker-driver.ts** 当 fan-in 执行器。当 worktree 陈旧（未 merge develop）时，其 worker-driver.ts 是旧版，缺新加的执行器 argv（如 `--mechanical-fan-in`，b9c219be7 加）⇒ fresh 进程报 `worker-driver: unknown argument: --mechanical-fan-in`（stderr）⇒ 无 JSON 输出（stdout 空）⇒ `parse-mechanical-fan-in` fail（worker-driver.ts:2254「unparseable fresh mechanical fan-in output」）。

**实证 2026-08-29（gap-semantic-layer-observability-resident-prompt）**：worktree 落后 develop 131 提交，其 worker-driver.ts 无 `--mechanical-fan-in` argv（仅 line 1490 有事件串），stderr 末行 `unknown argument: --mechanical-fan-in`。error reason 被 MODULE_TYPELESS_PACKAGE_JSON 警告刷屏（stderr 噪声，红鲱鱼），真失败行（unknown argument）埋在其后。

**同族分工**：与 `gap-fan-in-token-gate-version-mismatch-self-lock`（done）同为 version-mismatch 族，但方向相反——那件是「daemon 旧代码 vs worktree 新代码」，本件是「spawn 机制（b9c219be7 引入）用 worktree 旧代码 vs 主检出新 argv」。那件已闭环，本件是 spawn 机制的新失败形态，单独立案。

## Plan

`spawnMechanicalFanIn` 的执行器 entry 改用 **主检出** 的 worker-driver.ts（`opts.root/plugin/scripts/worker-driver.ts`，与 driver 同版），worktree 只提供任务 delta、不提供执行器代码。fan-in 编排器（执行器）本就是基础设施，应跟 driver 同版；任务 delta（含对 worker-driver.ts 自身的改动）由 suite step（worktree test.sh）验证，不因执行器用主检出版而丢。

## Acceptance Criteria

- [ ] AC1（能取假）：stale worktree（落后 develop、缺新 argv）的 fan-in spawn 成功——entry 用主检出 worker-driver.ts，无 `unknown argument`，fan-in 正常 proceed；（⛔ 仍报 unknown argument ⇒ 假）。
- [ ] AC2（能取假，单测）：worker-driver.test.mjs 断言 entry 路径 = `opts.root`（非 `opts.worktree`）+「stale worktree 缺 argv 仍 spawn 成功」负控制，改掉任一 ⇒ 红。
- [ ] AC3（能取假，回归）：改 worker-driver.ts 自身的任务（delta 含执行器）仍能 fan-in——其 delta 由 suite step（worktree test.sh）验证，不因执行器用主检出版而丢。

## Definition of Done

`spawnMechanicalFanIn` 执行器 entry 改主检出 worker-driver.ts；AC1-AC3 全勾；全量 suite 绿；semantic-layer 类 stale-worktree 任务无需人工 merge 即 fan-in 成功。

## Touches

- plugin/scripts/worker-driver.ts（spawnMechanicalFanIn entry 改 opts.root）
- plugin/test/worker-driver.test.mjs（AC2 单测）
- tasks/gap-fan-in-spawn-stale-worktree-executor-missing-argv.md（自身）
