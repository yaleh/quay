---
id: gap-suite-bucket-reattribution-untracked-regression
title: suite-bucket-reattribution.jsonl 被误分类为运行时产物去跟踪——它是 AC121 的 230 行判定记录（数据资产），去跟踪后每个 worktree suite 必红（4 次红实证）
status: ready
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`gap-quay-runtime-files-tracked-but-shouldnt`（我立案，已 done）的 AC1 把 `.quay/suite-bucket-reattribution.jsonl` 误列进「5 个明显运行时产物」→ `git rm --cached` + `.gitignore:286` 去跟踪。**这是误分类**——该文件是 AC121 的一次性判定记录（数据资产），不是运行时产物。我读码/读 git 复核（manager 报，非采信）：

- `git show 70ea6af7:.quay/suite-bucket-reattribution.jsonl` 完整取回 **230 行**，每行 `{file, judgment, mechanism, signal}`——AC121 任务体自己写「判定落机械可核记录」（`gap-ac121:31`）；
- `suite-bucket-select.ts:45/:144` 把它当**输入读**，测试 `suite-bucket-select.test.mjs:52-54` 断言 `reattr.size > 0`（"the reattribution map must be present in this repo"）；
- 全仓搜**零生产者**（负控制：同搜法对 verification-round.jsonl 得 3 个生产者 ⇒ 搜法有效）——它是 commit 里的一次性数据，非运行时写；
- 去跟踪后主检出 + 各 worktree 均无此文件 ⇒ `git worktree add` 出来的新 worktree 结构上拿不到 ⇒ **每个 worktree 的 suite 必红**。

**影响（manager 报，git 实读）**：01:14 首次失败至今，13 次 fan-in suite 启动 8 次 fail≥1，其中 `suite-bucket-select.test.mjs:52` 4 次。这是「跑了但不落地」的真因——不是没跑、不是锁、不是 ff，是 develop 上一条公共红、每个 worktree merge develop 后都继承。**这是我立案的 gap-quay-runtime-files-tracked-but-shouldnt 的回归，我认账**：分类「明显运行时产物 vs 数据资产」时没查该文件的读取侧（谁把它当输入读）。

## Plan

恢复（manager 定位，落笔方复核）：
1. `git show 70ea6af7:.quay/suite-bucket-reattribution.jsonl` 取回 230 行 → 写回 `.quay/suite-bucket-reattribution.jsonl` + `git add` 重新跟踪；
2. 撤掉 `.gitignore:286` 那条 `**/.quay/suite-bucket-reattribution.jsonl`；
3. 修正 `gap-quay-runtime-files-tracked-but-shouldnt` 的 AC1——该文件从「5 个明显运行时产物」移除，标注「数据资产（AC121 判定记录），误分类已更正」。

## Acceptance Criteria

- [ ] AC1（能取假，文件恢复跟踪）：`.quay/suite-bucket-reattribution.jsonl` 重新 tracked（230 行在、`git ls-files` 命中、`.gitignore:286` 移除）；（⛔ 仍缺失/仍 gitignored ⇒ 假）。
- [ ] AC2（能取假，负控制 suite 绿）：恢复后 `suite-bucket-select.test.mjs:52` 的 `reattr.size > 0` 断言过（worktree 能拿到该文件）；（⛔ 仍红 ⇒ 假）。
- [ ] AC3（能取假，修正原任务）：`gap-quay-runtime-files-tracked-but-shouldnt` 的 AC1 修正（该文件从「5 个明显运行时产物」移除 + 标注数据资产误分类）；（⛔ 仍列在运行时产物 ⇒ 假）。

## Definition of Done

文件恢复跟踪 + gitignore 撤除 + 原任务 AC1 修正；AC1-AC3 全勾；suite-bucket-select.test.mjs 不再红。

## Touches

- .quay/suite-bucket-reattribution.jsonl（git show 70ea6af7 恢复 + 重新跟踪）
- .gitignore（:286 撤除 suite-bucket-reattribution 忽略）
- tasks/gap-quay-runtime-files-tracked-but-shouldnt.md（AC1 修正误分类）
- tasks/gap-suite-bucket-reattribution-untracked-regression.md（自身）
