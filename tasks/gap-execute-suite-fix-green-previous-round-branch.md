---
id: gap-execute-suite-fix-green-previous-round-branch
title: execute-suite-fix Fix agent prompt 缺「上一轮为绿」分支 → 主检出绿时启动不了 worktree 验证
status: done
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**实证（manager 2026-08-12 代码读）**：`.claude/workflows/execute-suite-fix.js` 的 Fix agent prompt
（:95-104）分支不完备——有「真实红轮」与「非验证终态」两支，但**无「上一轮为绿」支**。当主检出
state=green（batch-merge 闸的前置条件）时，Fix agent 读 state=green 落不进 2/3 支 ⇒ 走不到第 4 步
启动 ⇒ 返回 `launched:false` ⇒ **不产出 scope=worktree 的验证记录**（worktree-green 闸的唯一数据源）。

**结构性后果**：正常「主检出绿、想合并」路径下，workflow 结构上产不出 worktree-green 记录——
这是 worktree-green 闸自设立以来 0 条记录的根因（round 45 首次满足靠的是外层直接派 verify-worktree-run，
绕开了 workflow）。

## Plan

1. 在 Fix agent prompt（:95-104）加一支：「若上一轮为绿：仍需在 worktree 启动一轮全量 suite，
   以产出 scope=worktree 的验证记录（batch-merge 闸的唯一数据源）」。
2. 一句话的改动，不动判定逻辑（:51/:148）。

## AC

- [x] AC1: Fix prompt 增加「上一轮为绿」分支——主检出绿时仍启动 worktree 全量 suite
- [x] AC2: 判定逻辑（:51/:148）不变
- [x] AC3: workflow 在主检出绿时能产出 scope=worktree 记录（实测/或 prompt 结构性断言）
- [x] AC4: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 改动 diff + 触发路径说明贴出（见 Evidence）
- [ ] 既有测试全绿

## Touches

- .claude/workflows/execute-suite-fix.js（Fix prompt :95-104 加分支）
- tasks/gap-execute-suite-fix-green-previous-round-branch.md（自身）

## Evidence

**改动 diff（.claude/workflows/execute-suite-fix.js）**——Fix agent prompt 增加「上一轮为绿」分支（第 4 支），原第 4/5 支顺延为 5/6：

```diff
 3. 若上一轮是非验证终态（static-check/aborted/timeout/截断）：修掉阻塞它的东西（静态检查红先修静态检查；resource-gate WAIT/single-flight lock 则等待）。
-4. 然后【启动】全量 suite：${launchCmd} —— 前台 Bash 跑（&+disown 立即返回），然后轮询 state.json 最多 ~20s 直到 state=running 出现（短促确认），再返回。禁止 Bash(run_in_background:true)。
-5. 若 suite 已经在跑（state=running），直接返回，不重复启动。
+4. 若上一轮为绿（state=green）：仍需在 worktree 启动一轮全量 suite，以产出 scope=worktree 的验证记录（batch-merge 闸的唯一数据源）。
+5. 然后【启动】全量 suite：${launchCmd} —— 前台 Bash 跑（&+disown 立即返回），然后轮询 state.json 最多 ~20s 直到 state=running 出现（短促确认），再返回。禁止 Bash(run_in_background:true)。
+6. 若 suite 已经在跑（state=running），直接返回，不重复启动。
```

**触发路径说明**：`execute-suite-fix.js` 的 Fix agent prompt 原先只有「真实红轮」「非验证终态」两支，缺「上一轮为绿」支。主检出 state=green（batch-merge 闸前置条件）时，Fix agent 读 state=green 落不进这两支 ⇒ 走不到启动步 ⇒ 返回 `launched:false` ⇒ 不产出 scope=worktree 验证记录（worktree-green 闸唯一数据源）。新增第 4 支后，主检出绿时仍显式要求在 worktree 启动一轮全量 suite 产出 `scope=worktree` 记录。判定逻辑 `isRealRedRound` / `isNonVerificationTerminal` 及脚本内 `state==='green' break`（:51/:148）未动（diff 仅触及 prompt 文本块）。

**AC2 判定逻辑不变**：`git diff -U0` 过滤新增/删除行，命中 `isNonVerificationTerminal|isRealRedRound|state.*green.*break|scope =|scope:` 的行数为 0。

**AC3 prompt 结构性断言**：`red-on-omission-audit.ts` 的 `scope_worktree_gate` 不变式（fan-in 消费者要求 execute-suite-fix 含 `scope=worktree` + `state==='green'`）——运行 `node --no-warnings --experimental-strip-types plugin/scripts/red-on-omission-audit.ts --root $PWD` ⇒ `✓ scope_worktree_gate` + `red-on-omission-audit: band satisfied (uncov=0, all invariants true)`，EXIT=0。

**AC4 scoped 门**：`bash scripts/test.sh --for-task gap-execute-suite-fix-green-previous-round-branch --allow-thin` ⇒ EXIT=0。touch→test 解析 0/2（workflow JS prompt 改动无直接映射测试，thin fail-closed 由 `--allow-thin` 显式承认，全量 suite 在 fan-in 仍完整运行）；scoped 静态检查全绿：task-contract-check（no violations）、superseded-capability-check（PASS）、tick-core-static-check（PASS，AC3 src:N 41/41·54/54·44/44）。

**工作流语法**：`node --check .claude/workflows/execute-suite-fix.js` ⇒ SYNTAX OK。
