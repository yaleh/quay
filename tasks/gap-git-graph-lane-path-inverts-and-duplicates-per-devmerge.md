---
id: gap-git-graph-lane-path-inverts-and-duplicates-per-devmerge
title: git-history 的「分支泳道」模型假设 no-ff fan-in（从合并提交第二父反推分支），但本仓库 fan-in 实际是
  ff——develop 最近 500 条 first-parent 链里 85 个合并提交全是「into task/id」的 dev-merge、真正
  task→develop 的 no-ff 合并为 0 条；结果图上 29-31 条「泳道」全是 develop 自身历史的碎片、套着已删分支的名字（4
  条实测经 git merge-base 核验为 develop 祖先），此前诊断的倒画/退化圆角/同名裂分只是这个错误重建的表征
status: done
labels:
  - gap
  - webui
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-git-graph-omits-inflight-branches-and-summary-table-disjoint
---
## Proposal

**用户诉求（2026-09-08）**：「在图中显示这段时间有活动的所有分支，而不是仅有 trunk.ref 及其分支（实际上，我倾向缺省不设置 trunk.ref）」。

**根因排查（比原诊断更深一层，2026-09-08 复核仍成立）**：`layoutGitGraph` 的分支重建算法假设的是 **no-ff fan-in**——从主干上一个合并提交的第二父往回走，就是那条被合并分支的专属提交。这个假设在**本仓库不成立**：

```
git log develop --first-parent -n 500 --pretty='%P\x1f%s'
  合并提交（≥2 父）总数:                    85
  其中 subject 形如「Merge branch 'develop' into task/<id>」
  （即 dev-merge，被 ff 带上主干的同步提交）:  83
  真正「Merge branch 'task/<id>' into develop」的 no-ff 合并:  0
```

也就是说，主干上几乎全部"合并提交"的第二父指向的是 **develop 自己的旧历史**，不是某条 task 分支。逐条核对页面上被画出来的"泳道"，结论是硬的：

| 泳道声称的名字 | 实际装的提交 | `git merge-base --is-ancestor <hash> develop` |
|---|---|---|
| `doc/spec-store-commit-unification` | `翻 gap-meta-call-resident-suite-driver-kind-spawn-per-tas done` | **YES**（develop 祖先） |
| `task/gap-store-commit-unification-stage1` ×3 | `…ac197/ac198/ac199-*` | **YES**（develop 祖先，3 条均验证） |

四条泳道声称的两个分支名（`doc/spec-store-commit-unification`、`task/gap-store-commit-unification-stage1`）**都已被删除**，泳道上的提交实际全部可达自 develop——**图上的"分支泳道"是 develop 历史的碎片，套着从已删分支的 dev-merge subject 里捡回来的名字**。这个错误重建解释了此前诊断的全部几何异常：13/31 倒画（"泳道"比它自己的"合并点"更老，因为它本来就不是一条独立的历史）、退化圆角、21/29 跨度 <30px（碎片天然短）、同名裂成 3-4 条（一条真实 task 分支做 N 次 dev-merge 就产生 N 个假泳道）。

**用户提出的方向是对的，而且应该比"去掉 trunk.ref"更彻底**：不是把 trunk 的名字换成可配置项，而是**取消 trunk 作为特殊类型**——`develop`/`master` 只应是"排序时排第一的普通泳道"，不应有专属的重建算法、专属的字段（`GitGraphLayout.trunk`）、专属的 chip 渲染路径。

**数据层的好消息**：`readGitHistory` 的 `--source` + 已有的 mainline 再归因（`gap-git-graph-trunk-ref-resolves-to-head-not-mainline` 已落地）**已经正确产出了分区**——每条提交的 `.ref` 要么是 mainline，要么是仍然独占它的活 ref。`layoutGitGraph` 不需要重建，只需要**按这个分区直接分组**；旧的"从合并提交第二父反推"算法应该降级为**兜底**，只在提交找不到任何 ref 归属时才启用（真正的历史级 no-ff 合并、分支已删除且没有活 ref 信息可用的情况——这类情况在别的用 no-ff 工作流的仓库里仍然存在，不能整个删掉，只是不能再抢在 ref 分区之前跑）。

## Plan

1. **`GitGraphBranchLane` 加 `kind: 'mainline' | 'live' | 'reconstructed'`**；`GitGraphLayout` 去掉 `trunk` 顶层字段，`branches` 数组包含全部泳道（mainline 排序第一，其余按现有排序规则）。
2. **`layoutGitGraph` 改为两阶段**：
   - 阶段一（ref 分区，权威）：按 `history.commits` 的 `.ref` 字段分组，每个不同的 `.ref` 值产出一条泳道；mainline ref 的那条标 `kind: 'mainline'`，其余标 `kind: 'live'`（无论是否已合并——已合并的 `merge` 非空，未合并的 `open: true`，复用 `gap-git-graph-omits-inflight-branches-and-summary-table-disjoint` 已落地的 open 泳道判定）。
   - 阶段二（历史级重建，兜底）：**只处理阶段一之后仍未被任何泳道认领的提交**——即合并提交的第二父链上，没有任何一环携带独立 `.ref` 归属的那部分。这类提交只可能来自真正的 no-ff 合并 + 分支已删除 + 已经不在任何活 ref 的窗口内，标 `kind: 'reconstructed'`。
3. **fork 计算统一**：mainline 泳道显式不需要 `fork`（它是参照系）；`live`/`reconstructed` 泳道的 `fork` 用 `merge-base` 或现有的"从提交往回走到第一个 mainline 提交"逻辑统一计算，不再区分"合并泳道"与"开放泳道"两套 fork 逻辑。
4. **几何修复（原诊断，仍然需要，套用在剩下的真实泳道上）**：折叠摘要行的排序键钉在自己的合并行**之前**，`lanePath` 对 `botY <= topY` fail-closed 报错而非静默倒画。
5. **chip 渲染统一**：与 `gap-git-graph-lane-chip-rendered-once-regardless-of-span`（P0，依赖本任务）共用同一条渲染路径，本任务落地后不应再存在 trunk 专属的 `appendChip` 调用点。

## AC

- [x] AC1 `layoutGitGraph` 返回值不含 `trunk` 顶层字段；对一个「develop 82 条 ff dev-merge + develop 自身 3 条真实提交」的 fixture（模拟本仓库真实形状），`branches` 中恰好一条 `kind: 'mainline'` 泳道装有全部这些提交，不产生任何其它泳道：`node --test packages/quay/test/gap-git-graph-lane-path-inverts-and-duplicates-per-devmerge.test.mjs` 退出码 0。
- [x] AC2 负控制：测试内显式跑一次旧算法（合并提交第二父链优先反推），对同一 fixture 断言产生 > 1 条泳道（复现本仓库实测的碎片化）⇒ 判据能区分新旧。
- [x] AC3 生产读数（最强证据）：对本任务 Proposal 中列出的 4 个已核实的假泳道提交 hash，用 `git merge-base --is-ancestor <hash> develop` 作为独立 oracle（不信任被测代码自己的判断），断言这些 hash 在重写后的 `#git-graph-data` 里都落在 `kind: 'mainline'` 的泳道内，不再单独成一条泳道。
- [x] AC4 兜底路径仍然工作：fixture 造一个真实 no-ff 合并（第二父不可达自任何活 ref/mainline），断言产出恰好一条 `kind: 'reconstructed'` 泳道，装有该分支的专属提交。
- [x] AC5 几何修复：对全部 `path.git-svg-lane` 的 `d` 串，倒画数 = 0、退化圆角（`/Q (\d+),(\d+) \1,\2/`）命中数 = 0——生产读数，不是只在 fixture 里为 0。
- [x] AC6 chip 渲染统一：`grep -n "appendChip(g, trunkX" packages/quay/src/serve-git.ts` 无输出（trunk 专属 chip 调用点消失，为 P0 任务的落地清空前置代码）。
- [x] AC7 一般性泳道正确性（不止 4 个已知样本）：对生产 `#git-graph-data` 里**每一条** `kind !== 'mainline'` 的泳道，抽取它的任一提交 hash，断言 `git merge-base --is-ancestor <hash> develop` 返回**非 0**（即该提交确实不是 develop 的祖先，是真正独立的历史）——这是比 AC3 更强的全称判据，覆盖当前已知样本之外的潜在同类错误。

## DoD

生产实例 `/git-history` 上，用 AC7 描述的全称检查跑一遍：所有非 mainline 泳道的提交都经 `git merge-base --is-ancestor` 独立验证为真正不可达自 develop——0 个假阳性。把阶段二（历史级重建）的优先级改回阶段一之前，会让 AC1/AC3/AC7 重新变红（负控制）。倒画/退化圆角两个几何读数在生产上为 0。

## Touches

- packages/quay/src/serve-git.ts（layoutGitGraph 重写为两阶段：ref 分区优先 + 历史级重建兜底；GitGraphLayout 去 trunk 加 kind；lanePath 几何修复；chip 渲染统一）
- packages/quay/test/gap-git-graph-branch-name-fallback-to-trunk-ref.test.mjs（端到端断言随两阶段模型改为「重归因的已删分支提交折叠进唯一 mainline 泳道，不再产出幽灵 task/A·task/B 泳道」）
- packages/quay/test/gap-git-graph-fold-control-lands-offscreen-and-row-hit-zone-dead.test.mjs（fixtureLayout 前置 2→3、longestBranch 过滤 mainline、hit-rect 计数改为按 lateral 泳道）
- packages/quay/test/gap-git-graph-lane-path-inverts-and-duplicates-per-devmerge.test.mjs（本任务的回归测试：ff-dev-merge-heavy fixture + 真实 no-ff fixture + 几何 fixture）
- packages/quay/test/gap-git-graph-lane-visual-encoding-and-fixed-width.test.mjs（AC2 六分支 fixture 改 distinct ref 成 6 条 lateral 泳道；颜色断言按 lateral 过滤 mainline）
- packages/quay/test/gap-git-graph-omits-inflight-branches-and-summary-table-disjoint.test.mjs（open 泳道判定逻辑随两阶段模型调整，相邻用例需同步更新）
- packages/quay/test/gap-git-graph-row-key-collides-on-multiclaimed-commits.test.mjs（AC3 branches 计数 2→3；dupHashLayout fixture 改 branches[] 形——无 trunk、各泳道带 kind）
- packages/quay/test/gap-git-graph-trunk-ref-resolves-to-head-not-mainline.test.mjs（trunk 字段移除后，断言改为「mainline 泳道排序第一 + 其 ref 正确解析」）
- packages/quay/test/gap-git-history-lane-identity-and-row-layout-overlap.test.mjs（trunk 顶层字段移除后，lane 计数/行模型断言改为「mainline 泳道 + 侧泳道」）
- packages/quay/test/serve-handlers.test.mjs（AC1/AC2 的 trunk/branches 断言随两阶段模型改为 mainline 泳道断言）
- tasks/gap-git-graph-lane-path-inverts-and-duplicates-per-devmerge.md