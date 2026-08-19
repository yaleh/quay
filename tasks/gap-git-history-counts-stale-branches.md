---
id: gap-git-history-counts-stale-branches
title: "git history 图表 lane 被陈旧分支污染——readGitHistory 用 --branches --source 把全部本地分支算进 lane（含已废弃分支）"
status: done
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

- [x] AC1: 选 ① 或 ② 并落地——① 则补清理纪律 + 清当前 2 陈旧分支；② 则 readGitHistory 只算最近 N 天有提交的分支。
  **选 ②**。`readGitHistory`（observation.ts）改为两段式：先用 `git for-each-ref refs/heads --format=%(refname:short)%09%(committerdate:unix)` 枚举分支 tip 提交时刻，只保留 tip 在 `GIT_HISTORY_ACTIVE_WINDOW_SEC`（= 24h，新常量）内的分支，再 `git log <活跃分支…> --source`。N=1 天的依据：fast-mode 任务寿命 <1h（实测 149/164 fan-in 分支 <1h）、停摆罕见超过 ~5h，故 24h 是「活跃」的舒适上界；finding 点名的陈旧分支 tip 距今 2.25 天，被干净排除。陈旧分支的提交本就在主线上可达，重打 `--source` 标签后仍显示（不掉提交、只消幻影 lane）。
- [x] AC2: 负控制——陈旧分支不再污染 lane 数（真实图表 lane = 活跃分支数）。
  真库实测（`readGitHistory("/home/yale/work/quay")`）：lane = `["develop","task/gap-dispatch-brief-dod-check-timing","task/gap-full-suite-state-stale-no-writer","task/gap-git-history-route-registered-twice"]`（4 条活跃分支），`verify-suite-fix-baseline` / `worktree-agent-a54ced0d00b0285bc` / `master`（tip 均 >24h）全部不在 lane 集合中。hermetic 负控制测试 `packages/quay/test/observation.test.mjs`：造「已合并但 tip 30 天前」的 `verify/stale` 分支，断言其不成为 lane、而主线仍在、且陈旧提交仍显示（重打标签）。

## Definition of Done

- [x] `git log --branches --source` 的 lane 数等于活跃分支数（真实输出）。
  真库输出：lane 数 = 4 = 活跃分支数（tip 在 24h 内的 4 条分支）；陈旧分支 0 条入 lane。见 AC2 证据同一条命令。

## Touches

- packages/quay/src/observation.ts（readGitHistory 两段式：只算活跃分支）
- packages/quay/test/observation.test.mjs（新建：负控制 + 全陈旧降级）
- packages/quay/test/serve-handlers.test.mjs（AC2/AC4 fixture 时间戳改近期，避开活跃窗口）
- tasks/gap-git-history-counts-stale-branches.md（自身：勾 AC + 贴证据）
