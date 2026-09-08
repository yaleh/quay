---
id: gap-git-graph-omits-inflight-branches-and-summary-table-disjoint
title: git-history 的泳道只由「主干合并提交的父链」反推 ⇒ 只画已合并分支，5 条在飞 worktree 分支的 38
  条提交一条不画；同页汇总表另用 --source 活 ref 分组，两套分支模型的名字集合交集为空
status: done
labels:
  - gap
  - webui
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**现象（2026-09-08 用 Playwright MCP 对生产实例 `/git-history` 实测，两次独立加载复算）**：

- 图（`serve-git.ts` `layoutGitGraph`）的分支泳道是从**主干合并提交的父链反推**出来的，因此只包含**已合并（通常已被 fan-in 删除）**的分支。
- 表（`serve-git.ts:761` `groupCommitsByBranch`，按 `--source` 活 ref 分组）只包含**仍存在**的分支。
- 两者的分支名集合实测 **交集为空**（`nameSetOverlap: []`）：表里 7 条全是仍挂着 worktree 的在飞分支，图上 15 个名字全是已合并删除的分支。同一页面上「分支」一词指两拨完全不同的对象。
- 直接后果：**5 条在飞分支的 38 条提交在图上一条都没画**。用户看图形成的印象是「大多数分支没合并回」，而真值恰恰相反——图上 29/29 条泳道**都有**合并连线（渲染层 29 条 `path.git-svg-lane` 的 `d` 串全部以 `H <trunkX>` 结尾），真正没合并回的那几条根本没被画出来。
- 汇总表还缺一列最要紧的信息：这条分支是**已合并**还是**在飞**。

**期望**：泳道模型统一为「已合并泳道 ∪ 活 ref 未合并泳道」。未合并者画成从 fork 点出发、顶端不收口的**开放泳道**（虚线或箭头），带 `open: true` / `merge: null`。汇总表改用同一份 `layout.branches`，加「状态：已合并 / 在飞」一列，并按泳道颜色打点与图对齐。

**相关（机制不同，不重复）**：`gap-git-history-branch-summary-wrong-numbers`（done）修的是某一条分支的数字算错，不涉及两套模型并存；`gap-git-history-counts-stale-branches`（done）管的是陈旧分支该不该进泳道，不管在飞分支缺席。

## AC

- [x] AC1 `layoutGitGraph` 对一个含「已合并分支 + 未合并活分支」的 fixture 返回的 `branches` 同时含两者，未合并者带 `open: true` 且 `merge === null`：`node --test packages/quay/test/gap-git-graph-omits-inflight-branches-and-summary-table-disjoint.test.mjs` 退出码 0。
- [x] AC2 图表同源：渲染后 HTML 中汇总表每行的分支名都能在 `#git-graph-data` 的 `branches[].ref ∪ [trunk.ref]` 中找到，且反向亦然——测试用 node 解析并断言双向差集均为空集。
- [x] AC3 负控制：测试内显式跑一次旧实现（汇总表走 `groupCommitsByBranch`），断言 AC2 的差集 > 0 ⇒ 判据能取假。
- [x] AC4 汇总表含「状态」列，取值域为 {已合并, 在飞}，且 fixture 下「在飞」行数 = 未合并活分支数（不是 0，也不是全部）。
- [x] AC5 生产读数：在至少存在 1 条在飞 worktree 分支时（`git worktree list | grep -c quay-worktrees` ≥ 1），`curl -s http://127.0.0.1:4174/git-history` 的 `#git-graph-data` 满足 `branches.filter(b => b.open).length >= 1`。

## DoD

生产实例 `/git-history` 上，当前正在跑的 worktree 分支（`git worktree list | grep quay-worktrees` 能数到的那些）**在图上可见**，且一眼能与已合并分支区分开；汇总表与图指同一批对象。以一次真实浏览器读数为证：Playwright 取 `#git-graph-data` 里 open 泳道的名字，与 `git worktree list` 的分支名对账，交集非空——而不是只有 fixture 里的 open 泳道。旧的双模型代码路径消失：`grep -n 'groupCommitsByBranch' packages/quay/src/serve-git.ts` 不再出现在汇总表的调用点上。

## Touches

- packages/quay/src/serve-git.ts（layoutGitGraph 增开放泳道；汇总表改用同一份 branches 并添加状态列）
- packages/quay/src/serve.ts（移除 groupCommitsByBranch 的再导出——该函数随双模型退役删除）
- packages/quay/test/gap-git-graph-omits-inflight-branches-and-summary-table-disjoint.test.mjs（本任务的回归测试）
- packages/quay/test/serve-handlers.test.mjs（汇总表状态列与图表同源用例）
- tasks/gap-git-graph-omits-inflight-branches-and-summary-table-disjoint.md
