---
id: gap-git-graph-cross-column-edges-drawn-as-fixed-stubs-not-anchored
title: git-history 的跨列斜线全是悬空残桩：serve-git.ts:378 终点写成 y(i)+rowH*0.65
  的固定短桩而非目标父提交所在行的 y ⇒ 178 条线里只有 11 条（恰好=11 条垂直列线）两端锚定、167
  条跨列边全断，侧枝来龙去脉无法追踪；且列对拍测试 7/7 全绿却漏验了边的绘制。并修 main{max-width:900px} 导致的 44/500
  行文本截断
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

**现象（2026-09-09 对生产实例 `/git-history` 实测，服务已确认为最新代码）**：图上的**跨列斜线全部是悬空残桩**——只有垂直主线是连的，侧枝的来龙去脉完全断掉，开发者无法顺藤摸瓜。

逐元素量化（遍历渲染后 SVG 的全部 `<line>`，判端点是否落在某个节点中心 ±3px 内）：

| 读数 | 值 |
|---|---|
| 节点数（圆点 + 菱形） | 500 |
| 渲染的线段总数 | 178 |
| **两端都锚定在节点上** | **11** |
| **只有一端锚定（另一端悬空）** | **167** |
| 两端都不锚定 | 0 |

**11 这个数字不是巧合——它正好等于列数 11**：那 11 段是垂直列线（`line.git-svg-column`，画得对），而**全部 167 条跨列斜线（`line.git-svg-edge`）无一例外是残桩**。

**根因（`packages/quay/src/serve-git.ts:378`，一行）**：

```js
g.append("line").attr("class", "git-svg-edge")
  .attr("x1", trunkX + e.fromCol * laneGap).attr("y1", y(i))
  .attr("x2", trunkX + e.toCol * laneGap).attr("y2", y(i) + rowH * 0.65)   // ← 固定短桩
```

终点的 y 写的是 `y(i) + rowH * 0.65`（`GIT_GRAPH_ROW_H = 24` ⇒ 恒为当前行下方 15.6px），而**不是目标父提交所在行的 y**。所以每条跨列边都只画到 65% 行高就断掉，另一端悬在半空。实测样本 `x1=56,y1=48 → x2=120,y2=63.6`：起点 48 是节点（行高 24 的整数倍），终点 63.6 = 48+15.6，不对应任何行。

**不是漏画**：数据里共 631 条边，其中 453 条是同列边，被 `if (e.fromCol === e.toCol) return` 有意跳过、由垂直列线承担——这部分是对的。真正画出来的 178 条里，167 条跨列边全断。

**修复所需数据已在 payload 里**：行对象带 `parentHashes`，边在服务端按父顺序构造（`serve-git.ts:128` 的 `pi === 0 ? "parent" : "merge"`），所以客户端建一个 `hash → 行号` 映射即可把终点改成 `y(目标行)`；更干净的做法是服务端在边里直接补 `toRow`。

**判据侧的教训（本条立案的第二个动因）**：`gap-git-graph-adopt-git-column-algorithm-and-decorate-labels` 的对拍测试**全绿**（7/7），而生产上 167/178 条边悬空。原因是那套 AC 只验了列**分配**（AC1 与 `git log --graph` 逐条对拍，确实 500/500 相同），**没有任何一条验边的绘制**。这是同一区域第三次出现「判据通过而生产是坏的」（前两次：对空集的全称判断恒真、被「全标 develop」的退化标注平凡满足）。因此本任务的 AC 必须把「边两端锚定」变成机械判据，且**不能被「少画几条边」或「画到任意节点上」满足**。

**同时修掉一处已量化的排版缺陷**：`packages/quay/src/serve-render.ts:76` 的 `main { max-width: 900px }` 是**裸 `main` 选择器、全站生效**。git-history 页的 SVG 宽 1288px 而容器可视仅 868px，实测 **44/500 行（9%）文本被截断**需横滚才能读全；而横滚会把图形列一起滚走，读文本时失去列的上下文。实测把可用宽度放到 1288px 后**截断行数归零**（`wouldClipIfFull: 0`）。1920px 视口下当前浪费 1020px 宽度。⛔ 修法必须是**页面级覆盖**，不得改动全站共享的 900px。

## Plan

1. **边的终点锚定到目标行**：客户端渲染前建 `hash → rowIndex` 映射（一次遍历）；对每条跨列边，用它对应的 `parentHashes[pi]` 查出目标行号，终点取 `y(目标行)`。若目标父提交不在当前窗口内，边画到窗口边界并**显式标记为截断**（不得与正常边同形）。可选更干净：服务端在 `GitGraphEdge` 上补 `toRow`，客户端直接用。
2. **边锚定的机械判据**：见 AC1–AC4，覆盖「两端都锚定」「锚到正确的那一行」「边数不缩水」「负控制能取假」四个方向。
3. **连线风格改为圆角正交 + 按列分色**（人 2026-09-09 指出：更早版本的线型与配色是对的，错的只是它的分支模型）。线型复用旧版 `lanePath()` 的转折写法（`H … Q … V … Q … H`，半径 `min(6, laneGap/2)`），但**参数从"泳道的 fork/merge 行"改成"边的起止（列, 行）"**——旧函数按泳道取参，新模型没有泳道，只能借用它的转折惯用法，不能直接调用。色板与 `--color-lane-N` 令牌从 `303a94950^` 恢复。
4. **页面级放宽容器**：在 git-history 页的 `<style>` 里覆盖本页的 `main`/`#git-graph` 可用宽度到足以容纳 SVG（约 1300px，或视口宽减边距取较小者），**不动 `serve-render.ts:76` 的全局 900px**。

## AC

- [x] AC1 **边两端都锚定**：渲染后遍历全部带 `git-svg-edge` class 的元素（**不限标签**：`line` 或 `path` 皆可，选择器写 `.git-svg-edge`），两端坐标都必须落在某个节点中心 **±1px** 内；不满足数 = 0（当前 167）：`node --test packages/quay/test/gap-git-graph-cross-column-edges-drawn-as-fixed-stubs-not-anchored.test.mjs` 退出码 0。
- [x] AC2 **锚到正确的那一行（防"落在任意节点上"）**：对每条跨列边，断言其终点 y **等于**该边对应 `parentHashes[pi]` 所在行的 `y(rowIndex)`；不等数 = 0。这条比 AC1 强——落在某个节点上不够，必须落在**它的父提交**那一行。
- [x] AC3 **边数不缩水（防"少画几条边"满足 AC1/AC2）**：`.git-svg-edge` 的元素数（**不限标签**）= 数据中 `fromCol !== toCol` 的边数（当前 178）；两者不等即判失败。
- [x] AC4 **负控制**：测试内显式还原 `y(i) + rowH * 0.65` 的旧写法，断言 AC1 的不满足数 > 0 ⇒ 判据能取假，不是恒真。
- [x] AC5 **窗口外父提交显式化**：父提交不在当前窗口内的边，必须带一个可区分的标记（如 `stroke-dasharray` 或独立 class），且其条数与「`parentHashes` 落在窗口外」的边数相等——不与正常边同形（硬规则 3b）。
- [x] AC6 **文本不再截断**：1440px 视口下，`#git-graph` 可视宽度 ≥ SVG 宽度，被截断的提交文本行数 = 0（当前 44/500）。
- [x] AC7 **不动全局样式**：`grep -n "max-width: 900px" packages/quay/src/serve-render.ts` 仍命中裸 `main` 规则（全站 900px 未被改动），加宽是 git-history 页自己的覆盖。

- [x] AC8 **正交圆角连线（不是斜线）**：每个 `.git-svg-edge` 的几何只由水平段、垂直段与圆角转折构成——若用 `<path>`，其 `d` 只允许 `M`/`H`/`V`/`Q`/`Z` 命令，**不得出现 `L` 或带斜率的隐式 lineto**；圆角半径 > 0（不得退化成直角或 `Q x,y x,y`）。负控制：还原成直连斜线应使该断言失败。
- [x] AC9 **按列分色**：列线与边按列号取色，色板复用 `303a94950^` 中被删除的 `GIT_GRAPH_LANE_PALETTE`（8 个已做过对比度校验的 hex）与 `gitGraphLaneTokenCss()` 的 `--color-lane-N` 机制——**从 git 历史恢复，不要重新造一套**。断言：渲染后列线的不同描边色数 = `min(8, 实际列数)`（当前列数 11 ⇒ 应为 8），且相邻两列颜色不同。负控制：全部改回单色应使不同色数 = 1。
- [x] AC10 **色板逐值一致**：恢复的 8 个 hex 与 `git show 303a94950^:packages/quay/src/serve-git.ts` 中的 `GIT_GRAPH_LANE_PALETTE` 逐项相等（防止"随便挑 8 个颜色"绕过 AC9 的对比度保证）。

## DoD

生产 `/git-history` 上，任取一个菱形（合并提交），它的两条连线都能**从菱形中心沿圆角正交折线连到对应父提交的圆点/菱形中心**——肉眼可顺着侧枝追踪来龙去脉；配合一次 Playwright 读数：`.git-svg-edge`（不限标签）中两端未锚定数 = 0、终点行号错配数 = 0、边数等于数据中的跨列边数（三个读数取自**真实生产页面**而非 fixture）。1440px 视口下截断行数 = 0；连线为圆角正交折线而非斜线，且相邻列颜色可区分。把终点改回 `y(i) + rowH * 0.65` 会让 AC1/AC2/AC4 变红。

## Touches

- packages/quay/src/serve-git.ts（边终点改为目标行的 y；连线改圆角正交；恢复 GIT_GRAPH_LANE_PALETTE 与 gitGraphLaneTokenCss 并按列取色；窗口外父提交的截断标记；git-history 页级容器宽度覆盖）
- packages/quay/test/gap-git-graph-cross-column-edges-drawn-as-fixed-stubs-not-anchored.test.mjs（本任务的回归测试：锚定/行号/边数/负控制）
- packages/quay/test/gap-git-graph-adopt-git-column-algorithm-and-decorate-labels.test.mjs（同页渲染断言，边渲染改动后需同步）
- tasks/gap-git-graph-cross-column-edges-drawn-as-fixed-stubs-not-anchored.md