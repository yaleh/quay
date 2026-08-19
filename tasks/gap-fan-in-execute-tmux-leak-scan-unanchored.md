---
id: gap-fan-in-execute-tmux-leak-scan-unanchored
title: "fan-in-execute.js:180 的 `/tmux-leak-scan: FAIL/` 正则未 ^ 锚定——同缺陷第二份（5b 实例），匹配测试描述文本假阳性"
status: todo
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

`plugin/workflows/fan-in-execute.js:180`（及其 `.claude/workflows/` 镜像）的 `/tmux-leak-scan: FAIL/` 正则【没有加 `^` 锚定】，会匹配到测试描述文本行里字面出现的这串字符（如 `✔ AC5 e2e — a 'tmux-leak-scan: FAIL' residual line flips red` 这类通过测试的描述），触发「leak-residual」假阳性——每次 suite-fix relaunch 都要手工解释掉这个假阳性（ac101 fan-in 3 次 fix-scope agent 全部要手工排查同一处）。

这是已修好的 `gap-tmux-leak-scan-pattern-unnchored-self-match-phantom-red` 的【同一缺陷】——但该任务 Touches 只改了 `plugin/scripts/full-suite-runner.ts:483`（加 `^` 锚定），【没覆盖】`fan-in-execute.js` 里的第二份同款未锚定正则。**硬规则 5b 实例**（在一处修好 X ≠ X 只在那一处）。

## Acceptance Criteria

- [ ] AC1: `fan-in-execute.js` 的 `/tmux-leak-scan: FAIL/` 加 `^` 锚定（`/^tmux-leak-scan: FAIL/`），两份文件（plugin/workflows/ + .claude/workflows/）同步。
- [ ] AC2: 负控制落在生产载体——`✔` 内嵌 `tmux-leak-scan: FAIL` 描述文本的行不触发 leak-residual 误判（读真实 suite-fix 分类，非 fixture）。
- [ ] AC3: scoped 绿 + 真实末轮 tmux-leak-scan clean 不被误判。

## Definition of Done

- [ ] 锚定后 leak-residual 假阳性消除（真实 suite-fix 不再手工解释它），scoped 绿。

## Touches

- tasks/gap-fan-in-execute-tmux-leak-scan-unanchored.md（自身）
- plugin/workflows/fan-in-execute.js（:180 正则加 ^ 锚定；双拷贝同步 .claude/workflows/fan-in-execute.js）
- plugin/test/fan-in-execute-paths.test.mjs（leak-residual 假阳性负控制）
