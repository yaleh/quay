---
id: gap-git-history-counts-stale-branches
title: "git history 图表 lane 被陈旧分支污染——readGitHistory 用 --branches --source 把全部本地分支算进 lane（含已废弃分支）"
status: ready
labels:
  - gap
  - defect
  - webui
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

`readGitHistory`（observation.ts:629）用 `git log --branches --source`，把当前【所有本地分支】都算进 lane，不分是否活跃。现存两个早该删的陈旧分支：`verify-suite-fix-baseline`（08-16，验证分支未清理）+ `worktree-agent-a54ced0d00b0285bc`（agent 派发遗留）。这两条不清理，图表 lane 数会持续被污染，未来任何同类遗留都会重演「分支数远多于活跃分支」的观感。

**两选一（判断权在 outer/inner）**：① 产品层补分支清理纪律（fan-in/派发收尾时删已合并/已废弃分支）；② 图表只算「最近 N 天有提交」的分支而非全部本地分支。

## Acceptance Criteria

- [ ] AC1: 选 ① 或 ② 并落地——① 则补清理纪律 + 清当前 2 陈旧分支；② 则 readGitHistory 只算最近 N 天有提交的分支。
- [ ] AC2: 负控制——陈旧分支不再污染 lane 数（真实图表 lane = 活跃分支数）。

## Definition of Done

- [ ] `git log --branches --source` 的 lane 数等于活跃分支数（真实输出）。

## Touches

- tasks/gap-git-history-counts-stale-branches.md（自身）
