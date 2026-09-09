---
id: gap-git-graph-edge-fold-bends-at-child-for-first-parent-edges
title: git-history 跨列边折角固定在子节点端：kind="parent" 的边（分支收口回父分支）方向应在父节点端拐弯，反了
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

**用户报告（2026-09-09，读 web `/git-history` 截图）**：合并折线（红色菱形合并提交的第二父指向侧支）方向正确；但分支折线——侧支最老的一条提交往回连到它 fork 出来的那个父提交——方向反了：现状是"先沿父分支所在列往上走一段（与父分支线重叠），到子节点高度才拐向子节点列"，正确应为"先在子节点自己列里往下走到父节点高度，再拐进父节点列"。用户明确表态：**不关心是否与父分支线视觉重叠，只要折角方向对**。

**代码定位与根因**：`packages/quay/src/serve-git.ts:442-449` 的 `edgePath(fromX, fromY, toX, toY)`：
```js
function edgePath(fromX, fromY, toX, toY) {
  var r = Math.min(6, laneGap / 2);
  var sign = toX >= fromX ? 1 : -1;
  return "M " + fromX + "," + fromY +
    " H " + (toX - sign * r) +
    " Q " + toX + "," + fromY + " " + toX + "," + (fromY + r) +
    " V " + toY;
}
```
无论边的语义类型（`GitGraphEdge.kind`，`:78`，`pi===0?"parent":"merge"`，`assignGitColumns`/`layoutGitGraph` 已经算好），一律"先横（在子节点高度 fromY 拐）再竖（落到父节点 toY）"。调用点 `:502`：`.attr("d", edgePath(trunkX + e.fromCol*laneGap, y(i), trunkX + e.toCol*laneGap, y(e.toRow)))`。

`assignGitColumns`（`:130-155`）是标准 `git log --graph` 列分配算法：一条提交的**第一父**（`kind==="parent"`）如果跨列，语义上就是"这条分支自身的谱系在此收口，汇回一条已经存在、且会继续往下延伸的谱系"；**第二父及以上**（`kind==="merge"`）跨列则永远是"当前这个合并提交伸出去抓一条侧支的尖端"。这是两种不同方向的拓扑关系，理应用不同的折角位置表达——现状对两者一视同仁地"先横再竖"，对 `merge` 是对的（已用生产数据核实：目标列在 `toRow` 之前本就不存在，折角落在子节点端不会有方向上的错觉），对 `parent` 是错的（折角本该落在父节点端）。

**已用运行中的生产实例数值验证**（访问 `http://100.78.206.100:4173/git-history`，读 `#git-graph-data` 的真实 `rows/edges` 并核对渲染出的 `<path d>`）：
- 当前 500 条提交窗口共 193 条跨列边：`kind==="merge"` 133 条、`kind==="parent"` 60 条。
- 例：`f6fa174`（`row=3, fromCol=1 → toCol=6, toRow=37, kind="parent"`）渲染为 `M 56,96 H 130 Q 136,96 136,102 V 912`——横向拐角发生在子节点行（`fromY=96`），随后一路垂直落到第37行的父节点，即"先横再竖"；按用户的判断这是反的，父节点端才应该是拐角处。
- 曾考虑过"只在子节点自身列后续不再使用时才翻转"（`colMax[fromCol]===row`）这个基于减少视觉重叠的判据，用生产数据核过：`kind==="parent"` 的 60 条边里它只覆盖 15 条，漏掉 45 条（含 `f6fa174` 本身，`colMax[1]=476`——列1后来被完全不相关的另一条分支复用，重叠判据因此不触发，但方向依然是反的）。**用户已明确表态不关心重叠**，故弃用该判据。

**方案：判据改为纯粹按 `kind` 分流，不看列的存活区间**：
```js
function edgePath(fromX, fromY, toX, toY, bendAtParent) {
  var r = Math.min(6, laneGap / 2);
  if (bendAtParent) {
    // kind==="parent" 的跨列边：这条分支自身的谱系在此收口、汇回一条会继续往下延伸的谱系——
    // 折角落在【父节点】端：子节点先在自己列里垂直走到父节点的高度，再横向拐入父节点列。
    var hs = toX >= fromX ? r : -r;
    return "M " + fromX + "," + fromY +
      " V " + (toY - r) +
      " Q " + fromX + "," + toY + " " + (fromX + hs) + "," + toY +
      " H " + toX;
  }
  var sign = toX >= fromX ? 1 : -1;
  return "M " + fromX + "," + fromY +
    " H " + (toX - sign * r) +
    " Q " + toX + "," + fromY + " " + toX + "," + (fromY + r) +
    " V " + toY;
}
```
调用点改为：
```js
var bendAtParent = e.kind === "parent";
g.append("path")...attr("d", edgePath(trunkX + e.fromCol*laneGap, y(i), trunkX + e.toCol*laneGap, y(e.toRow), bendAtParent))
```
端点（起止坐标）完全不变，仍只用 `M/H/V/Q`（无 `L`），圆角半径仍 `>0`——不影响 `gap-git-graph-cross-column-edges-drawn-as-fixed-stubs-not-anchored.md`（status: done）里已落地的 AC1/AC2/AC3/AC5/AC8/AC9/AC10（端点锚定、边数不缩水、正交圆角、按列分色）。

## AC

- [x] AC1 `kind==="merge"` 的跨列边折角位置不变（回归防护）：对本仓库当前 `readGitHistory`+`layoutGitGraph` 生产窗口，执行真实 `gitGraphClientScript()`（复用 `gap-git-graph-cross-column-edges-drawn-as-fixed-stubs-not-anchored.test.mjs` 的 vm+d3-mock 执行手法），对每条 `kind==="merge"` 的边解析 `d`，断言**第一个绘制命令是 `H`**；不满足数 = 0；`kind==="merge"` 边总数 > 0（非退化判据）。
- [x] AC2 `kind==="parent"` 的跨列边折角翻到父节点端（本任务的核心断言）：同一生产窗口，对每条 `kind==="parent"` 的边解析 `d`，断言**第一个绘制命令是 `V`**；不满足数 = 0；`kind==="parent"` 边总数 > 0（非退化判据）。
- [x] AC3 负控制：显式还原成"永远 `bendAtParent=false`"（即改动前的行为），重跑 AC2 的判据，断言不满足数 > 0——证明 AC2 的判据真的能取假，不是恒真断言。
- [x] AC4 端点不变：对全部跨列边（含 merge 和 parent 两类），解析 `d` 的起点/终点，断言起点 = `(trunkX+fromCol*laneGap, y(row))`、终点 = `(trunkX+toCol*laneGap, y(toRow))`，误差 ≤ 1px，不满足数 = 0——证明本次改动没有破坏已有的端点锚定行为（sibling done 任务的 AC1/AC2 不能被本次改动带红）。
- [x] AC5 命令集与圆角约束保持：对全部跨列边的 `d`，只允许出现 `M/H/V/Q` 字母（无 `L`），且每条边至少含一个非退化 `Q`（控制点与终点不重合，半径 `>0`）——复用 `edgePathViolation` 判据手法，不满足数 = 0。
- [x] AC6 判据不依赖硬编码的具体 commit hash/行号（本仓库持续在提交，钉死某一行数据的判据会随仓库演化失效）——AC1/AC2/AC3/AC4/AC5 全部基于"这一类边"的通用条件（`e.kind`），不是某一条具体边。

## DoD

生产实例 `/git-history`（`http://100.78.206.100:4173/git-history` 或等价 `quay serve` 实例）重新加载后，用 AC2 描述的全称检查直接对生产窗口跑一遍：`kind==="parent"` 的跨列边中，首命令非 `V` 的数 = 0，且该窗口 `kind==="parent"` 边总数 > 0（不是因为窗口里恰好没有这类边而空过）。AC1（merge 折角不变）与 AC4（端点不变）同样在生产窗口跑通，证明本次改动是**方向翻转**而非新增/替换其中一类边的绘制。改动限定在 `edgePath` 函数体与其调用点的一个新增布尔参数，不涉及 `assignGitColumns`/`layoutGitGraph`/列分配/颜色/文本布局等其它逻辑。

## Touches

- packages/quay/src/serve-git.ts（`edgePath` 加 `bendAtParent` 参数与新分支；调用点按 `e.kind==="parent"` 传参；更新 `:438-441`/`:486-489` 处描述折角规则的注释）
- packages/quay/test/gap-git-graph-edge-fold-bends-at-child-for-first-parent-edges.test.mjs（本任务的回归测试：AC1-AC6，复用 `gap-git-graph-cross-column-edges-drawn-as-fixed-stubs-not-anchored.test.mjs` 的 vm+d3-mock 执行与 `pathEndpoints` 解析手法）
- tasks/gap-git-graph-edge-fold-bends-at-child-for-first-parent-edges.md