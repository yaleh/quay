---
id: gap-git-graph-adopt-git-column-algorithm-and-decorate-labels
title: git-history 改用 git 的活跃列+回收算法：取消泳道对象与 fork/merge/open 分类（同窗口 git 只用 6
  列而页面炸出 25 条泳道+5 个窗口外分叉标记）、标签改为只在 ref tip 内联的 %D decoration（当前 develop 标签重复 6
  次）、删除折叠展开等全部交互、纵轴改新在上，并以 git log --graph 的列号逐条对拍为判据
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
  - gap-git-graph-pagination-mainline-lane-empty-before-page
---
## Proposal

**用户诉求（2026-09-09，两轮观察后确认的最终形态）**：页面对齐 `git log --graph --oneline --decorate` 的语义；去掉全部交互操作（折叠/展开）；分支标签放进右侧文本一起排版且**只出现在 ref 指向的那个提交上**；保留滚动加载；纵轴改为新的在上。

**当前偏离（2026-09-09 对生产实例实测，服务已确认为最新代码、非陈旧进程）**：

| | `git log --graph`（同窗口） | 页面 |
|---|---|---|
| 提交占用列数 | **6**（最大列号 5，519 提交） | 25 条泳道 |
| develop 标签 | 只在 tip（全窗口仅 3 个提交带 `%D`） | **6 个**，等间距约 519px |
| 悬空/未合并标记 | **0**（git 从不画） | 「窗口外分叉」**5 个**；`fork==null` **15/25**、`merge==null` **5/25** |

**两个根因**：

1. **标签周期重复**：`gap-git-graph-lane-chip-rendered-once-regardless-of-span`（done）按 `strideRows` 每约 519px 重画一次泳道名。那是把「develop 标签和其它分支一样」误解成「滚到哪都看得见」的产物；用户实际要的是 git decorate 语义——**标签只在 ref tip**。
2. **模型仍以「分支对象」为单位**：每条轨道被分类为 fork/merge/open，窗口边界截断就产生「窗口外分叉」标记与「未并入 develop」的观感。而 git 只画**边**——边被窗口截断就画到边界为止，不做任何标注。

**方案（用户已确认全部三个决策点）**：布局层换成**活跃列 + 回收**（DoltHub 三规则 / pvigier 直分支 / git `graph.c` 同族），输出模型从「泳道对象数组」改为「每提交一行 + 该行的边集合」，取消泳道对象及其分类字段。滚动加载保留；纵轴新的在上。

**判据的关键改进**：以 `git log --graph` 自身作机械对拍基准，已验证可行——

```
git log --graph --all --pretty=format:'%x01%H'
图形区 = 哨兵 \x01 之前的部分（提交内容绝无污染）
列号   = 图形区中 '*' 的下标 / 2
```

实测 519/519 条提交全部解析成功。这条专治本区域反复出现的失效判据：P2 的 AC7 对空集恒真、A 的 AC3 被「全标 develop」平凡满足、F 的 AC5 在「具名数归零」后变成 `5 ≤ 0` 不成立却已被勾。**列号逐条 diff 无法被退化解满足**——塌成一列或炸成上百列都会立刻暴露。

**被本任务取代/反转的既有任务**：`gap-git-graph-stride-chip-overlaps-commit-row-text`（ready）的 AC3 明文要求「不许删掉 chip，chip 数仍 = ceil(跨度/strideRows)」，会把用户明确不要的周期重复锁进回归测试，本任务落地后须作废并改写；`gap-git-graph-lane-chip-rendered-once-regardless-of-span`（done）的 stride 行为被本任务反转，其测试文件需同步更新。

## Plan

1. **取数层**（`observation.ts`）：行序改用 git 的**发射顺序**，不再自己按时间排序——列分配算法依赖「父提交必在子提交之后」这个不变式，而实测 git 发射序与纯时间序不一致（60 条里 1 条错位）。同时取 `%D` 供标签使用。
2. **布局层**（替换 `layoutGitGraph`）：活跃列表 + 回收——无子提交→开新列；有 branch child→占最左 branch child 的列；只有 merge child→从最左子提交向右找空闲列；**分支结束即释放列供复用**（这正是当前缺失的一半，也是 git 只用 6 列而我们炸出 25 条的原因）。输出 `rows: [{hash, col, edges: [{fromCol, toCol, kind}]}]`，不再有泳道对象；`fork`/`merge`/`open`/`overflow` 与「窗口外分叉」标记一并删除。
3. **标签**：只用 `%D` decoration，内联进文本列、排在 hash 与 subject 之间；删除 stride 重复逻辑与全部浮动 chip。
4. **渲染层瘦身**：删除 `expanded{}`（当前 8 处）、「点击展开」摘要行（4 处）、「▲ 折叠」控件（5 处）、`rect.git-svg-hit`（1 处）、`appendChip`（4 处）。一行一提交，行高固定。
5. **保留滚动加载**：`/git-history.json` 端点与 sentinel 保留；新模型下分页须保证脊柱不为空（沿用 `gap-git-graph-pagination-mainline-lane-empty-before-page` 的不变式）。

## AC

- [x] AC1 **列号对拍（核心，退化解不可满足）**：对生产仓库同一窗口，我方每个提交的列号与 `git log --graph --all --pretty=format:'%x01%H'` 哨兵解析出的列号**逐条相等**，不一致数 = 0：`node --test packages/quay/test/gap-git-graph-adopt-git-column-algorithm-and-decorate-labels.test.mjs` 退出码 0。
- [x] AC2 负控制：测试内显式跑一版「不回收列」的分配（每个第二父都开新列），断言 AC1 的不一致数 > 0 ⇒ 判据能取假，不是恒真。
- [x] AC3 **标签只在 ref tip**：页面渲染出的标签集合与 `git log --pretty=format:'%H%x01%D'` 中 `%D` 非空的提交集合**逐条相等**；且 `develop` 标签出现次数 = 1（当前 6）。
- [x] AC4 **交互机件归零**：`packages/quay/src/serve-git.ts` 中 `expanded\[` / `点击展开` / `折叠` / `git-svg-hit` / `appendChip` 的 `grep -c` **全部为 0**（当前分别 8 / 4 / 5 / 1 / 4）。
- [x] AC5 **悬空标记归零**：渲染后含「窗口外分叉」的文本数 = 0（当前 5）；且布局输出的类型定义中不再有 `fork` / `merge` / `open` 字段。
- [x] AC6 **纵轴方向**：SVG 中 y 最小的那一行对应的提交 = `git log -1 --pretty=%H`（最新提交）。
- [x] AC7 **滚动加载未被打回**：Playwright 滚到底部后保持不动 15s，SVG 行数至少增长两次（沿用已 done 的 `gap-git-graph-scroll-loader-self-chain-blocked-by-loadingolder-flag` 判据）。

- [x] AC8（**新增，防回归覆盖被静默删除**）本次重写删除了 9 个既有回归测试（模型耦合所致）。对每一个被删测试，其中**与新模型仍然相关**的断言必须已在 `packages/quay/test/gap-git-graph-adopt-git-column-algorithm-and-decorate-labels.test.mjs` 中重新落位；判据：被删测试里出现过的每个 `test(`/`it(` 标题，要么能在新测试文件中找到语义对应项，要么在任务体里逐条列出「因模型取消而不再适用」的理由。删除数 9 与「已重新落位 + 已列明不适用」之和必须相等，不允许有既没落位也没说明的缺口。

## DoD

生产 `/git-history` 与 `git log --graph --oneline --decorate --all` 并排比对：列结构逐条一致（AC1 不一致数 = 0，读数取自**真实生产页面**而非 fixture）、标签只在 ref tip、页面无任何点击控件、无「窗口外分叉」标记、最新提交在最上、滚到底部能连续加载。把列分配改回「不回收列」会让 AC1/AC2 变红。截图与列号 diff 各留一份为证。

## 删除测试的断言去向（AC8）

本次重写删除 9 个既有回归测试（泳道模型耦合）。逐条去向：已重新落位 3 + 已列明不适用 6 = 9，无缺口。

| 被删测试 | 去向 |
|---|---|
| gap-git-graph-branch-name-fallback-to-trunk-ref | 重新落位：分支名只在 ref tip → 新测试 AC3「标签只在 ref tip」 |
| gap-git-graph-drops-commits-while-overflowcount-reports-zero | 重新落位：侧枝/提交不丢 → pagination 测试 AC3「第二父不丢」；overflow 计数因泳道模型取消而不适用 |
| gap-git-graph-omits-inflight-branches-and-summary-table-disjoint | 重新落位：图与标签集合一致 → 新测试 AC3「%D 对拍」；汇总表/在飞分类不适用 |
| gap-git-graph-fold-control-lands-offscreen-and-row-hit-zone-dead | 不适用：折叠/展开交互删除（新测试 AC4 断言交互机件归零） |
| gap-git-graph-lane-path-inverts-and-duplicates-per-devmerge | 不适用：泳道几何（lanePath）删除，由列+边模型取代 |
| gap-git-graph-lane-visual-encoding-and-fixed-width | 不适用：泳道颜色编码删除 |
| gap-git-graph-row-key-collides-on-multiclaimed-commits | 不适用：泳道行键删除；新模型每提交一行，无多认领 |
| gap-git-graph-trunk-ref-resolves-to-head-not-mainline | 不适用：mainline/trunk 概念删除 |
| gap-git-history-lane-identity-and-row-layout-overlap | 不适用：泳道身份/行布局删除 |

## Touches

- packages/quay/src/serve-git.ts（layoutGitGraph 替换为活跃列+回收；输出改每行边集；删除全部交互与 chip 机件；标签内联进文本列）
- packages/quay/src/observation.ts（行序改用 git 发射顺序；取 %D decoration）
- packages/quay/test/gap-git-graph-adopt-git-column-algorithm-and-decorate-labels.test.mjs（本任务的回归测试，含 git 列号对拍 + AC8 重新落位的断言）
- packages/quay/test/gap-git-graph-lane-chip-rendered-once-regardless-of-span.test.mjs（stride 行为被反转，断言同步更新）
- packages/quay/test/gap-git-graph-ref-partition-collapses-all-topology-to-one-lane.test.mjs（泳道对象取消，断言重写）
- packages/quay/test/gap-git-graph-reconstructed-lanes-all-named-mainline-ref.test.mjs（泳道命名概念取消，断言重写）
- packages/quay/test/gap-git-graph-pagination-mainline-lane-empty-before-page.test.mjs（分页脊柱不变式的等价断言）
- packages/quay/test/gap-git-graph-scroll-loader-self-chain-blocked-by-loadingolder-flag.test.mjs（滚动自链断言随渲染层调整）
- packages/quay/test/observation.test.mjs（行序与 %D 取数用例）
- packages/quay/test/serve-handlers.test.mjs（路由与 payload 形状用例）
- packages/quay/test/gap-webui-tests-page-unpaginated-tables.test.mjs（git-history 泳道汇总表删除 ⇒ 本测试 AC4 表格清单移除 serve-git.ts 条目）
- docs/analysis/test-file-baseline.txt（删除 9 个泳道模型测试 ⇒ 测试文件基线快照同步更新）
- packages/quay/test/gap-git-graph-branch-name-fallback-to-trunk-ref.test.mjs（模型耦合，随泳道命名概念取消而删除）
- packages/quay/test/gap-git-graph-drops-commits-while-overflowcount-reports-zero.test.mjs（模型耦合，删除；分页覆盖由 AC7 与上面两个测试承接）
- packages/quay/test/gap-git-graph-fold-control-lands-offscreen-and-row-hit-zone-dead.test.mjs（折叠交互取消，随之删除）
- packages/quay/test/gap-git-graph-lane-path-inverts-and-duplicates-per-devmerge.test.mjs（泳道几何概念取消，随之删除）
- packages/quay/test/gap-git-graph-lane-visual-encoding-and-fixed-width.test.mjs（泳道视觉编码取消，随之删除）
- packages/quay/test/gap-git-graph-omits-inflight-branches-and-summary-table-disjoint.test.mjs（泳道 open/在飞分类取消，随之删除）
- packages/quay/test/gap-git-graph-row-key-collides-on-multiclaimed-commits.test.mjs（泳道行键概念取消，随之删除）
- packages/quay/test/gap-git-graph-trunk-ref-resolves-to-head-not-mainline.test.mjs（trunk 概念取消，随之删除）
- packages/quay/test/gap-git-history-lane-identity-and-row-layout-overlap.test.mjs（泳道身份概念取消，随之删除）
- tasks/gap-git-graph-adopt-git-column-algorithm-and-decorate-labels.md
