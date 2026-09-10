---
id: gap-git-graph-lane-chip-rendered-once-regardless-of-span
title: git-history 每条泳道（含 trunk）无论跨多少行，右侧文本列只画一次分支名 chip；trunk 的那一次还画在整页最顶端 ⇒
  滚动到非页首任意位置时屏幕上找不到任何分支标签，这与「develop 标签和其它分支不一样」的观感是同一机制，不是 develop 专属
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
  - gap-git-graph-lane-path-inverts-and-duplicates-per-devmerge
---
## Proposal

**用户反馈（2026-09-08）**：「在右侧的文本中看到 develop 分支标签，和其它分支标签一样」——现状 develop 与其它分支的 chip 确实不对称，但根因比"trunk 缺 chip"更通用。

**现状（读代码 + 生产实例核对）**：全部三处 chip 渲染都是「**每个泳道实例只画一次**，与它跨多少行无关」：

1. trunk（`serve-git.ts` 客户端脚本）：`appendChip(g, trunkX - 6, y(tMin) - 8, trunk.ref, "var(--color-neutral-700)")`——画在**整页最顶端**（`tMin` = 最旧提交的行号 = 页面最上方），只画一次。
2. 折叠态泳道：`appendChip(grp, textX, yy + 3, b.ref, laneColorById[b.id])`——画在摘要行，一个泳道一行，天然只有一次。
3. 展开态泳道：`appendChip(grp2, textX, y(laneBot) - 6, b.ref, color)`——只画在**折叠控件那一行**（`laneBot` = 该泳道的合并行），泳道本身跨越的其它行（`git-svg-muted` 纯文字）没有 chip。

**问题**：develop 目前恒定横跨全页（500 条提交、上千像素），它唯一的 chip 在页面绝对顶端；用户实际关心的"最近发生了什么"通常在页面**底部**（最新提交），那里屏幕上一个分支标签都没有——这正是此前修过的「折叠控件掉到视口外」缺陷（`gap-git-graph-fold-control-lands-offscreen-and-row-hit-zone-dead`，已 done）的**同构问题**，只是这次落在 chip 而非交互控件上。且这不是 develop 独有：任何展开态、跨度足够大的泳道（例如此前实测 25/31 提交的分支）同样只有一次 chip，滚动到该泳道中段一样看不到标签。

**依赖**：`gap-git-graph-lane-path-inverts-and-duplicates-per-devmerge`（下称 P2）会取消 trunk 的特权代码路径、把 develop 改造成与其它泳道同构的一条"泳道"，本任务的实现应该写在 P2 落地之后的统一渲染路径上，否则会在即将被删除的 `trunk` 特例代码上做无用功。

## Plan

1. 在 `serve-git.ts` 的客户端渲染脚本里加一个纯函数（如 `computeChipStride(items, strideRows)`），给定按行排好序的 `items`（每项带它所属的泳道 id，trunk 视为一个特殊 id），返回「哪些行需要画 chip」——规则：同一泳道 id 的连续区间内，起始行必画，此后每满 `strideRows` 行再画一次，直到区间结束。
2. render() 里用这个函数替换当前「trunk 顶部画一次 / 展开泳道底部画一次」的写法；trunk 与其它泳道走**同一条**调用路径，不再有 trunk 专属的 `appendChip` 调用。
3. `strideRows` 取一个使 `strideRows * GIT_GRAPH_ROW_H` 明显小于常见视口高度的值（如 20 行 ≈ 520px，视口通常 ≥720px），保证任意滚动位置附近都能看到至少一个 chip。

## AC

- [x] AC1 `computeChipStride` 对一个 50 行、全部属于同一泳道 id、`strideRows=20` 的 fixture 返回 3 个 chip 行（行 0、20、40），不是 1 个：`node --test packages/quay/test/gap-git-graph-lane-chip-rendered-once-regardless-of-span.test.mjs` 退出码 0。
- [x] AC2 负控制：测试内显式实现旧逻辑（每个泳道只在首行或末行画一次），对同一 fixture 断言 chip 数 = 1 ⇒ 判据能区分新旧。
- [x] AC3 生产读数：`curl -s http://127.0.0.1:4174/git-history` 渲染后，用 node 解析 SVG，develop（或当时的主线 ref）对应的 chip 元素数 > 1（当前生产值为 1）。
- [x] AC4 任意滚动位置覆盖：给定生产页面的总行数与 `strideRows`，同一泳道 id 相邻两个 chip 行的行号之差 ≤ `strideRows`，且 `strideRows * ROW_H` 小于一个保守视口高度常量（如 700px）——测试断言该不等式成立，而非只断言 chip 数量。
- [x] AC5 chip 渲染路径统一：`grep -n "appendChip(g, trunkX" packages/quay/src/serve-git.ts` 无输出（trunk 专属调用点已消失，与其它泳道共用同一渲染函数）。

## DoD

生产实例 `/git-history` 上，用 Playwright 分别滚动到页面顶部、中部、底部三个位置截图/取 DOM，三处都至少能看到一个分支 chip（不只是页面绝对顶端那一次）。把 `strideRows` 逻辑改回「每泳道一次」会让 AC3/AC4 变红。

## Touches

- packages/quay/src/serve-git.ts（chip 渲染改为按行程跨度重复；移除 trunk 专属 chip 调用点）
- packages/quay/test/gap-git-graph-lane-chip-rendered-once-regardless-of-span.test.mjs（本任务的回归测试）
- tasks/gap-git-graph-lane-chip-rendered-once-regardless-of-span.md
