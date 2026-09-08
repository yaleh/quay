---
id: gap-git-graph-lane-path-inverts-and-duplicates-per-devmerge
title: git-history 折叠摘要行按 mergeT 排序与自己的合并行同刻、tie-break 靠字典序 ⇒ 10/29 条泳道
  botY&lt;topY 倒着画、圆角退化成 Q x,y x,y；同一 task 的每次 dev-merge 各算一次 fork/merge ⇒ 裂成 4
  条同名泳道
status: todo
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

**现象（2026-09-08 用 Playwright MCP 对渲染后 SVG 的 29 条 `path.git-svg-lane` 逐条解析 `d` 串实测，非目测）**：

- **10/29 条泳道的路径是倒着画的**：`d` 形如 `M 104,50 V 24 Q 104,24 104,24 H 60`——起点 y=50 而 `V` 目标 y=24 ⇒ botY < topY，线朝上走。
- 同样这 10 条的圆角命令**退化**成 `Q x,y x,y`：`serve-git.ts:505` 在 `vert < 2r` 时把 r 压到 `Math.max(0, vert/2)`，vert 为负 ⇒ r = 0。
- **21/29 条泳道垂直跨度 < 30px**，视觉上几乎看不出是一条分支。
- **根因**：折叠摘要行的排序键取 `b.mergeT`（`serve-git.ts:563` `visibleRows()` 的 `t: b.mergeT != null ? b.mergeT : b.lastT`），与主干上那条合并提交的 `t` **数值相同**，tie-break 落到 `b.id` vs `c.hash` 的字典序 ⇒ 摘要行可能排到自己的合并行**下面**，于是 `laneTopRow > mergeRow`。这是随机的：换一批 hash 就换一批倒画泳道。
- **只有 6/29 条泳道有分叉连线**，23 条顶端悬空（`fork == null`，分叉点早于 500 条窗口）。悬空的那一头正是用户读成「没接上 / 没合并回」的直接来源——而合并端 29/29 都在。
- **同名泳道重复**：`gap-ac166-second-copy-retirement` 裂成 4 条、`gap-plugin-root-resolution-remaining-callsites` 裂成 3 条——因为每次 `Merge branch 'develop' into task/<id>` 都被 `layoutGitGraph:219` 当作一次独立的 fork/merge 事件。
- 主干 110 条提交里大量是 `Merge branch 'develop' into task/X` 的同步噪声，挤占了真正的落地事件行。

**期望**：① 摘要行排序钉在自己合并行**之前**（而非同刻靠字典序碰运气），并让 `lanePath` 在 `botY <= topY` 时 fail-closed 报错而非静默倒画；② 同一 task id 的多次 dev-merge 聚合成**一条**泳道（chip 上可标次数）；③ fork 悬空时用显式视觉记号（虚线渐隐 / 「窗口外分叉」标记）表达「分叉在窗口之外」，不要让它看起来像断线；④ 主干上的 dev-merge 同步提交折叠成一个记号，不逐条占行。

**相关（机制不同，不重复）**：`gap-git-graph-row-key-collides-on-multiclaimed-commits`（done）修的是 row key 撞车导致的**压字**，不涉及路径方向与泳道裂分。

## AC

- [ ] AC1 `lanePath` 在 `botY <= topY` 时抛错或返回可区分的 `null`（不与合法路径同形），且 `layoutGitGraph` 输出在所有 fixture 上满足「每条泳道 mergeRow > laneTopRow」：`node --test packages/quay/test/gap-git-graph-lane-path-inverts-and-duplicates-per-devmerge.test.mjs` 退出码 0。
- [ ] AC2 负控制：测试内显式跑一次旧排序（摘要行 `t = b.mergeT` 且不做 tie 钉位），断言在同一 fixture 上倒序泳道数 > 0 ⇒ 判据能取假。
- [ ] AC3 渲染后退化圆角数为 0：对全部 `path.git-svg-lane` 的 `d` 跑正则 `/Q (\d+),(\d+) \1,\2/`，命中数 = 0。
- [ ] AC4 同一 task id 的多次 dev-merge 聚合成一条：对一个含 `task/<id>` 被 dev-merge 三次的 fixture，断言 `branches.filter(b => b.ref === 'task/<id>').length === 1`。
- [ ] AC5 `fork == null` 的泳道带显式记号：断言其路径带 `stroke-dasharray`（或同行有「窗口外分叉」文本），且带记号的条数 = `fork == null` 的泳道条数（既不多也不少）。

## DoD

生产实例 `/git-history` 上用 Playwright 解析**全部** `path.git-svg-lane` 的 `d` 串，得到三个读数：倒画泳道数 = 0、退化圆角数 = 0、同名泳道重复数 = 0——三者取自**真实生产页面**而非 fixture（硬规则 4 推论三）。且把排序键改回旧实现后，上述读数重新非零（判据能取假，不是恒真）。

## Touches

- packages/quay/src/serve-git.ts（摘要行排序钉位；lanePath 对 botY<=topY fail-closed；同 task 多次 dev-merge 聚合；fork 悬空记号；主干同步提交折叠）
- packages/quay/test/gap-git-graph-lane-path-inverts-and-duplicates-per-devmerge.test.mjs（本任务的回归测试）
- packages/quay/test/gap-git-graph-row-key-collides-on-multiclaimed-commits.test.mjs（行序/路径几何的相邻用例，聚合后行数会变）
- tasks/gap-git-graph-lane-path-inverts-and-duplicates-per-devmerge.md
