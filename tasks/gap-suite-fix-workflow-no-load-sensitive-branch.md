---
id: gap-suite-fix-workflow-no-load-sensitive-branch
title: "suite-fix workflow 缺 fix-scope gate——红即「修」不分「本任务 Touches 内回归」vs「越界红」，越界 fix 第 4 次"
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

`execute-suite-fix.js` 对 `load-sensitive`/`isolate` **零命中**（实测）——suite-fix 的判定路径是无分支的「红 ⇒ fix ALL failures + rerunning」（`:169`/`:191`），**没有 fix-scope gate**：不判「这红是本任务 Touches 内的回归吗」，见啥修啥、越界到非 Touches 文件。

**4 次越界 fix（同一条根因的 4 个实例）**：
1. inner-blocked-signal（越界修）
2. outer-cron-registry（越界修）
3. session-liveness.sh + tmux-leak-scan.sh（load-sensitive 族，应释放不应修）
4. fan-in-ff-protocol-check.ts（checker 跨任务误报，应 defer 独立任务不应修）

前 3 次由 anti-drift Touches 检查（`gap-fan-in-fix-commit-delta-escapes-touches-coverage`，done）拦在**修完之后**（HARD FAIL → needs-human），没能阻止 suite-fix 先做越界 fix。KNOWN-LOAD-SENSITIVE 机械分诊（`gap-known-load-sensitive-rule-is-doc-only-no-mechanical-triage`，done）只覆盖 load-sensitive 一类，checker 误报 / 别任务 bug 类越界不在此列。

**根因**：suite-fix 的「红之后做什么」决策缺 scope gate——应先判「红是否本任务 Touches 内回归」，越界红（load-sensitive 释放 / checker 误报 defer / 别任务 bug defer）一律不 fix，走对应 defer/释放路径。

## Acceptance Criteria

- [x] AC1: `execute-suite-fix.js` 加 fix-scope gate——fix 前判红是否本任务 Touches 内回归：在 Touches 内 → fix；越界 → defer（load-sensitive 走隔离重跑+释放、checker 误报/别任务 bug 走 defer 独立任务），不越界 fix。
- [x] AC2: 负控制——一个越界红（load-sensitive 或 checker 误报）出现时，suite-fix 零越界 fix-commit（不碰非 Touches 文件）。
- [x] AC3: fix-commit 越界计数归零（第 4 次后的新回归不再越界）。

## Definition of Done

- [x] 一个越界红（负载诱导或 checker 误报）出现，suite-fix 走 defer/释放、零越界 fix-commit（真实输出，非 fixture）。

## Touches

- tasks/gap-suite-fix-workflow-no-load-sensitive-branch.md（自身）
- .claude/workflows/execute-suite-fix.js（加 fix-scope gate）
- plugin/workflows/execute-suite-fix.js（与 .claude/workflows 同步）
- plugin/test/execute-suite-fix-scope-gate.test.mjs（scope gate 负控制测试，新增）

## Evidence（scoped 实跑，非 fixture）

`bash scripts/test.sh --for-task gap-suite-fix-workflow-no-load-sensitive-branch --allow-thin` → **EXIT 0**（7/7 tests pass，scoped 静态检查全绿）。

```
ℹ tests 7
ℹ pass 7
ℹ fail 0
workflows-dual-copy-drift-check: PASS — every dual-copy workflow matches its other copy.
  ok: .claude/workflows/execute-suite-fix.js (292 lines) == plugin/workflows/execute-suite-fix.js (292 lines)
```

fix-scope gate 负控制（对真实 task Touches + 真实 state.json failures[] 实跑 gate 分类，非硬编码 verdict）：
```
FIX_SCOPE_VERDICT={"scoped":true,
 "inScope":["plugin/workflows/execute-suite-fix.js","plugin/test/execute-suite-fix-scope-gate.test.mjs",".claude/workflows/execute-suite-fix.js"],
 "outOfScope":[{"file":"plugin/scripts/session-liveness.sh","reason":"load-sensitive"},
               {"file":"plugin/scripts/fan-in-ff-protocol-check.ts","reason":"checker-misreport"},
               {"file":"orchestration/other-task.md","reason":"other-task"}]}
```
⇒ 越界红（load-sensitive / checker 误报 / 别任务 bug）全走 outOfScope defer，inScope 仅本任务 Touches 内文件 ⇒ 零越界 fix-commit。
