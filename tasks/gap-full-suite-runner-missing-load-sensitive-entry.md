---
id: gap-full-suite-runner-missing-load-sensitive-entry
title: full-suite-runner.test.mjs 缺 @load-sensitive-entry → AC4 分级闸红挡所有 full-suite fan-in（develop 全库 rot）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`429fdc7bd "fix: full-suite-runner.test.mjs 纳入 load-sensitive 族（child-spawn）"` 给该文件加了 `@load-sensitive child-spawn` + KNOWN-LOAD-SENSITIVE 注释，但**漏了 `// @load-sensitive-entry <date> <reason>` 记录行**。`known-load-sensitive.test.mjs:322` AC4 分级闸（gap-suite-tiering-kind-heavy-not-a-mechanism）对 serial-group family member 要求「(1) @load-sensitive-entry 记录 + (2) 机制 kind」，缺 entry 即 fail-closed ⇒ `full-suite-runner.test.mjs` 每次 full-suite 都红（fail 3，全在 known-load-sensitive --check-exit）。

**实证**：`git show develop:plugin/test/full-suite-runner.test.mjs | grep -c '@load-sensitive-entry'` = 0（有 `@load-sensitive child-spawn` 无 entry）。full-suite-state 06:26 转 red（scope=worktree，retire-governance 的 fan-in 撞上），但根因是 develop 全库缺 entry，非单任务 delta——任何 full-suite 都红（同 .halt AC7 rot 类）。

## Plan

给 `full-suite-runner.test.mjs` 补 `// @load-sensitive-entry <date> <reason>`（date/reason 引 429fdc7bd 的分类理由「triage 判 other-task defer 而非 isolate-rerun」）。⛔ 不撤 KNOWN-LOAD-SENSITIVE 分类（分类正确，只缺 entry 记录）。

## Acceptance Criteria

- [ ] AC1（能取假）：develop 的 full-suite-runner.test.mjs 含 `@load-sensitive-entry <date> <reason>`；（⛔ 仍无 entry ⇒ 假）。
- [ ] AC2（能取假）：`known-load-sensitive --check-exit` 通过、full-suite 转绿，fail 3 → 0。

## Definition of Done

entry 记录补上；AC1-AC2 全勾；develop 全库 suite 绿；full-suite fan-in 不再因缺 entry 红。

## Touches

- plugin/test/full-suite-runner.test.mjs（补 @load-sensitive-entry）
- tasks/gap-full-suite-runner-missing-load-sensitive-entry.md（自身）
