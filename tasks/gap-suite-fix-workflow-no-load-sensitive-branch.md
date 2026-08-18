---
id: gap-suite-fix-workflow-no-load-sensitive-branch
title: "suite-fix workflow 缺 KNOWN-LOAD-SENSITIVE 分支——机械分诊已做（done）却未接进 fix-vs-release 决策，红即「修」导致越界 fix 第 3 次"
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

KNOWN-LOAD-SENSITIVE 机械分诊（`gap-known-load-sensitive-rule-is-doc-only-no-mechanical-triage`，done——机器可读族清单 `@load-sensitive <kind>` + 红窗自动分区 + 自动隔离重跑）已落地，但 `execute-suite-fix.js` 对 `load-sensitive`/`isolate` **零命中**（实测 `grep -icE "load-sensitive|isolate"` = 0）——suite-fix 的判定路径仍是无分支的「红 ⇒ fix ALL failures + rerunning」（`:169` non-verification terminal、`:191` real red round），**没有**「known-load-sensitive 红 ⇒ 隔离重跑 ⇒ 绿则放行不修」的分支。

实证（inner 实测，第 3 次越界 fix）：`c19f149b`「全量 suite 三处 load-sensitive 红」改 3 个**非 Touches** 文件（session-liveness.sh / tmux-leak-scan.sh / session-liveness-helpers.mjs），前 2 次 inner-blocked-signal / outer-cron-registry。anti-drift Touches 检查（`gap-fan-in-fix-commit-delta-escapes-touches-coverage`，done）拦住了越界（HARD FAIL → needs-human），**但拦在修完之后**——没能阻止 suite-fix 先做越界 fix。

**两个 done 任务各自覆盖了「检测」，但中间的「决策」缺一块**：机械分诊（识别 known-load-sensitive）+ anti-drift（拦越界）都只做「查」，suite-fix workflow 的「红之后做什么」这条决策路径没接上分诊结论。

## Acceptance Criteria

- [ ] AC1: `execute-suite-fix.js` 加「known-load-sensitive 红」分支——hit 到 known-load-sensitive 家族红时先隔离重跑，绿则放行（load-sensitive-release-check）不 fix；隔离仍红才进 fix 路径。
- [ ] AC2: 负控制——一个 known-load-sensitive 红（负载诱导）出现时，suite-fix 零越界 fix-commit（不碰非 Touches 文件）。
- [ ] AC3: fix-commit 越界计数归零（第 3 次后的新回归不再越界）。

## Definition of Done

- [ ] 一个负载诱导的 known-load-sensitive 红，suite-fix 走隔离重跑 + 放行、零越界 fix-commit（真实输出，非 fixture）。

## Touches

- tasks/gap-suite-fix-workflow-no-load-sensitive-branch.md（自身）
- .claude/workflows/execute-suite-fix.js（加 known-load-sensitive 分支）
- plugin/workflows/execute-suite-fix.js（与 .claude/workflows 同步）
- plugin/test/execute-suite-fix-*.test.mjs（分支负控制测试）
