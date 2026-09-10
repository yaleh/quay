---
id: gap-git-graph-ref-partition-collapses-all-topology-to-one-lane
title: git-history 的 ref 分区模型在 ff fan-in 下结构性只产出 1 条泳道，与 git log --graph 同窗口的 36
  条并发轨道相比丢掉全部拓扑（500 条提交里 441 条即 88% 在侧线被拍平）；且 live 分支取数的 --since 下界绑在主线 15
  小时窗口上，7 天内有独有提交的 4 条 ref 全被滤掉
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

**用户诉求（2026-09-08）**：「在图中显示这段时间有活动的所有分支」。**当前实测结果与诉求相反：页面只渲染 1 条泳道。**

**实测（2026-09-08，对当前检出起的干净实例 `127.0.0.1:4180`——生产 4173 当时跑的是陈旧进程，读数不作数）**：

| 维度 | `git log --graph --oneline --decorate --all`（同 500 条窗口） | 页面 |
|---|---|---|
| 并发轨道数 | **36** | **1** |
| 合并提交 | 208，每个第二父画一条侧线 | 208 个菱形，**0 条侧线**（`path.git-svg-lane` = 0） |
| first-parent 链 | 59 条 | — |
| 侧线上的提交 | **441 条（占 500 的 88%）** | 全部拍平到同一条竖线 |
| 泳道 | 27 个 refs/heads 的 tip 各有 decoration | `[{kind:'mainline', ref:'develop', n:500}]` |

**成因一（模型）**：`layoutGitGraph` 阶段一按 `.ref` 分区，而 `readGitHistory` 的 mainline 再归因把所有 develop 可达的提交标成 `develop`。本仓库 fan-in 是 ff ⇒ 所有已落地的 task 分支提交都 develop 可达 ⇒ 全部落进同一个分区。阶段二（历史级重建）只处理「未被认领」的提交，而**没有未被认领的** ⇒ 恒不产出。**在 ff 工作流下这个模型结构上只能产出 1 条泳道**，不是数据巧合。

**成因二（取数窗口，原建议②并入本任务）**：`observation.ts:2532` 给 live 分支取数加了 `--since=${windowFloorSec}`，下界 = **主线批次最旧提交时间**（当时 ≈15 小时）。7 天活跃窗口内有独有提交的 4 条 ref，最新独有提交分别是 2026-09-02 11:14 / 09-03 02:01 / 09-03 15:47 / 09-07 15:45，**全部早于该下界 ⇒ 0 条 live 泳道**。该下界随主线提交密度浮动：**仓库越忙，下界越近，能看到的活跃分支越少**——反向激励。

**关键认识（为什么「主干」这个概念在本仓库不成立）**：窗口内 develop 的 first-parent 链只有 59 条，其中 **33 条是同一条 task 分支的 dev-merge**（全部是 `Merge branch 'develop' into task/gap-deliver-verification-trigger-orphaned-after-land-path-migration`）。ff fan-in 每次把上一版 develop 推到第二父 ⇒ **develop 的 first-parent 链 = 最后一条 fan-in 的 task 分支自己的历史，不是主线**；真正的历史层层嵌套在侧线上，这正是 36 条轨道的来源。旧模型（first-parent 当 trunk）与新模型（ref 分区）都假设存在一个「主干」，而该概念在 ff 工作流下没有稳定答案。`git log --graph` 不做这个假设，它只画拓扑。

**精确根因：此前的「假泳道」错在命名取反，不在拓扑。** 这是 `gap-git-graph-lane-path-inverts-and-duplicates-per-devmerge`（done）过度纠正的地方——它把命名错误连同拓扑一起删了。git 约定 `Merge branch 'A' into B` ⇒ **A（带引号）= 第二父**、**B（`into` 后、不带引号）= 第一父**。逐条验证：

```
subj:  Merge branch 'develop' into task/gap-deliver-verification-trigger-orphaned-...
       quoted='develop'   into='task/gap-deliver-verification-trigger-orphaned-...'
第二父 = 15f1e0e02（develop 的旧 tip）
```

⇒ 第二父轨道的**正确名字是带引号的 `develop`**。而 `serve-git.ts:521` 的 `branchNameFromMergeSubject` 注释写着 "pick the non-mainline name"，**专门挑非 mainline 的那个（`task/X`）**——它要命名的正是第二父轨道，取反了。**⇒ 拓扑可以安全恢复，只要命名规则改对。**

## Plan

1. **恢复第二父轨道**：泳道 = 从每个合并提交的第二父出发、沿 first-parent 链走到与主线交汇处的那一段（即 `git log --graph` 画的侧线）。这条走法在旧实现里本身是对的，恢复它，但不沿用旧命名。
2. **命名按可证性分级**（`kind` 字段已存在，正好承载）：该轨道 tip 命中活 ref（`heads`）⇒ 用 ref 名、`kind: 'live'`；否则用合并 subject 的**带引号**那个名字 ⇒ `kind: 'reconstructed'`；两者都拿不到 ⇒ `#<短 hash>` / 「未命名轨道」，**宁可不给名字，也不贴错名字**（fail-visible，不 fail-silent）。
3. **修 `--since` 下界**：`observation.ts:2532` 改成 `min(主线窗口下界, now − GIT_HISTORY_ACTIVE_WINDOW_SEC)`，让活跃分支的可见性不被主线提交密度绑架。
4. **mainline 泳道保留** `kind: 'mainline'`、排序第一，不回退 `gap-git-graph-trunk-ref-resolves-to-head-not-mainline` 已落地的命名修复。

## AC

- [x] AC1 拓扑完备性（结构不变式，非阈值）：对窗口内每一个合并提交，其第二父提交必须出现在某条泳道的 commits 中——孤儿数 = 0；且非 mainline 泳道数 > 0（当前 = 0）。真实仓库输入与 fixture 各跑一遍，`node --test packages/quay/test/gap-git-graph-ref-partition-collapses-all-topology-to-one-lane.test.mjs` 退出码 0。
- [x] AC2 命名取反已修（负控制）：对 fixture 中一个 `Merge branch 'develop' into task/X` 的合并，断言其第二父轨道被命名为 `develop` 而非 `task/X`；同一测试内显式跑旧规则（挑非 mainline 名）并断言它给出 `task/X` ⇒ 判据能区分新旧。
- [x] AC3 不再贴错名字（全称判据）：对生产 `#git-graph-data` 里**每一条** `kind === 'reconstructed'` 的泳道，取其任一提交 hash，用 `git merge-base --is-ancestor <hash> <该泳道 ref>` 作独立 oracle 断言退出码 0；不满足者必须降级为 `#<hash>` 未命名形态 ⇒ 错标计数 = 0。
- [x] AC4 `--since` 下界修正：`readGitHistory` 对当前仓库返回的 commits 中，`ref` 为非 mainline 且属于「7 天内有独有提交的活跃 ref」的条数 > 0（当前 = 0）；测试内把下界改回「主线批次最旧提交时间」应使该计数归零 ⇒ 负控制成立。
- [x] AC5 与 git 对账（点名清单，非魔法比值）：断言实测已知的 4 条活跃 ref（`task/gap-session-liveness-signals-perfile-timeout-flaky`、`worktree-archguard-primitives-doc`、`worktree-dispatch-pref-priority-goal-evidence`、`worktree-slow-tests-analysis`，若届时仍存在且仍有独有提交）全部出现在泳道 ref 集合中；同时断言非 mainline 泳道数 ≤ 窗口内合并提交数（上界，防重复裂分）。

## DoD

生产实例 `/git-history` 上，用 Playwright 读 `#git-graph-data`：泳道数与 `git log --graph --all` 同窗口的轨道数处于同一数量级（不再是 1 vs 36），且 AC3 的全称检查为 0 个错标——两个读数都取自**真实生产页面**而非 fixture。把命名规则改回「挑非 mainline 名」会让 AC2/AC3 变红；把 `--since` 改回主线下界会让 AC4 变红。

## Touches

- packages/quay/src/serve-git.ts（恢复第二父轨道；命名按可证性分级；kind 三态）
- packages/quay/src/observation.ts（--since 下界改为 min(主线下界, now − ACTIVE_WINDOW)）
- packages/quay/test/gap-git-graph-ref-partition-collapses-all-topology-to-one-lane.test.mjs（本任务的回归测试）
- packages/quay/test/gap-git-graph-lane-path-inverts-and-duplicates-per-devmerge.test.mjs（该任务断言「无侧线泳道」，恢复拓扑后需同步更新）
- packages/quay/test/observation.test.mjs（--since 下界用例）
- packages/quay/test/gap-git-graph-branch-name-fallback-to-trunk-ref.test.mjs（no-ff 合并的端到端断言随拓扑恢复更新：已删分支 → #<hash> 未命名泳道）
- packages/quay/test/gap-git-graph-omits-inflight-branches-and-summary-table-disjoint.test.mjs（已合并分支「折叠进 mainline」断言随拓扑恢复更新：保留 ref 的已合并分支是 kind:live 泳道）
- packages/quay/test/gap-git-history-lane-identity-and-row-layout-overlap.test.mjs（同名合并「折叠成一条 mainline」断言随拓扑恢复更新：两条 #<hash> 未命名泳道）
- packages/quay/test/gap-git-graph-drops-commits-while-overflowcount-reports-zero.test.mjs（AC2-mirror 随 --since 下界改为 min(主线下界, 7 天窗口) 更新）
- packages/quay/test/serve-handlers.test.mjs（integration 测试里 --no-ff 已合并分支折叠断言随拓扑恢复更新）
- tasks/gap-git-graph-ref-partition-collapses-all-topology-to-one-lane.md
