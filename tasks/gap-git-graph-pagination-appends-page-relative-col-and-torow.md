---
id: gap-git-graph-pagination-appends-page-relative-col-and-torow
title: 滚动加载后图崩：分页行携带页内相对的 col 与 toRow，合并后布局失效
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

**现象（2026-09-09 用 Playwright 实测生产实例，服务已确认非陈旧进程）**：静态首屏正常，**一次滚动加载之后图就崩了**——竖线横穿提交文字（截图 `scroll-boundary.png`）。

| 判据 | 加载前 | 一次滚动加载后 |
|---|---|---|
| 渲染行数 | 500 | 999 |
| 边数 | 175 | 342 |
| **边两端脱锚** | **0** | **144** |
| **用到列数 / 最大列号** | **11 / 10** | **18 / 32** |
| **列线侵入文本区** | 0 | **7 条**（x = 264/328/344/504/520/536/552，而 textX = 220） |

**根因（`serve-git.ts` 的 `loadOlder()` 合并那一行）**：

```js
next.rows.forEach(function (r) { if (!have[r.hash]) { data.rows.push(r); added++; } });
```

分页返回的行被**原样 push**，而每页的 `col` 与 `edges[].toRow` 都是服务端**相对该页自身行数组**算出来的。合并后三个缺陷连锁发生：

**① `toRow` 失效 ⇒ 144 条边脱锚**。第二页某行的 `toRow: 3` 本意是「该页第 3 行」，合并后却指向整个数组的第 3 行（属于第一页）。边画到了错误的行上。

**② `col` 不连续 ⇒ 列数 11→18、最大列 32**。活跃列 + 回收是**跨全序列有状态**的算法——某列何时释放、被谁复用，取决于它之前的全部历史。每页独立算，第二页不知道第一页还占着哪些列，于是另开新列。实测边界处（第 497–505 行）列号从 1 直接跳到 5。

**③ 列线画进文本区 ⇒ 肉眼可见的「乱」**。图形区宽度按初始 11 列布好（textX = 220），列数涨到 32 后第 11 列之后的 x 落到 264…552，全部越过 textX，竖线压在提交信息上。

②③ 是 ① 的下游：只要列号是页内相对的，列数就会累加膨胀；膨胀了就必然越界。

**判据侧的盲区（本条立案的第二个动因）**：`gap-git-graph-adopt-git-column-algorithm-and-decorate-labels` 的列号对拍测试通篇用 `LIMIT = 500`，**只验证初始窗口**；`gap-git-graph-cross-column-edges-drawn-as-fixed-stubs-not-anchored` 的锚定判据同样只在首屏取值。两条 AC 都是绿的，而滚动一次就 144 条边脱锚。这是同一区域第四次「判据通过而生产是坏的」，共同形状是**判据取样的状态空间比生产窄**——前三次是空集/退化标注/只验算法不验渲染，这次是只验第一页不验分页后。

**相关（机制不同，不重复）**：`gap-git-graph-pagination-mainline-lane-empty-before-page`（done）修的是分页页脊柱恒空；`gap-git-graph-scroll-loader-self-chain-blocked-by-loadingolder-flag`（done）修的是自链死代码；本条修的是**合并后布局量失效**，三者是分页链上的不同环节。

## Plan

**正解：分页只传数据、不传布局；布局在客户端对合并后的全序列重算一次。**

1. **`/git-history.json` 只返回原始提交**（`hash / t / subject / parents / parentHashes / decorations`），**不再返回 `col` 与 `edges[].toRow`**——这两个量在页内没有意义，传过去只会被误用。
2. **客户端合并后重算布局**：复用已有的纯函数 `assignGitColumns(commits: {hash, parentHashes}[]): Map<string, number>`（`serve-git.ts:127`，其签名恰好只需要 hash 与 parentHashes），对整个 `data.rows` 重跑一次，得出全局一致的 `col`，并据此重建每条边的 `toRow`。
   **⛔ 不得在客户端另写一份列分配实现**——本仓库禁双份实现。可行做法：`gitGraphClientScript()` 用 `assignGitColumns.toString()` 把同一份函数体注入客户端脚本，保证只有一个定义。
3. **`render()` 前按当前最大列号重算图形区宽度与 textX**，使列线的 x 永远小于文本起点（结构上排除侵入文本区，而不是靠初始值恰好够用）。
4. **分页游标从时间戳 `--before` 改为发射序 `--skip`**（实现期间实测发现，`--before` 会重排/丢提交，合并序列永远不等于 `git log --all --topo-order -n <loaded>`，故 AC2 结构上不可满足；`git log --skip` 连续接续才使合并序列逐位等于单次 `-n <loaded>` 走查）。

## AC

- [x] AC1 **多轮加载后仍全锚定**：Playwright 触发 **≥3 次**滚动加载后，`.git-svg-edge`（不限标签）两端未锚定数 = 0（当前一次加载即 144）：`node --test packages/quay/test/gap-git-graph-pagination-appends-page-relative-col-and-torow.test.mjs` 退出码 0。
- [x] AC2 **对拍扩到分页之后（治盲区）**：加载 N 轮后，页面每个提交的列号与 `git log --graph --all -n <已加载条数> --pretty=format:'%x01%H'` 哨兵解析出的列号**逐条相等**，不一致数 = 0。判据必须以**已加载条数**为 n，不得写死 500。
- [x] AC3 **列线永不侵入文本区（结构判据）**：任何时刻（首屏与每轮加载后）`line.git-svg-column` 的最大 x < 提交文本的最小 x；侵入条数 = 0（当前 7）。
- [x] AC4 **负控制**：测试内还原「原样 push 分页行」的旧写法，断言 AC1 的脱锚数 > 0 ⇒ 判据能取假，不是恒真。
- [x] AC5 **无双份布局实现**：`grep -c "export function assignGitColumns" packages/quay/src/serve-git.ts` = 1，且客户端脚本中不存在第二处独立的列分配逻辑（断言客户端脚本里的列分配来自 `assignGitColumns.toString()` 注入或等价的单一来源）。
- [x] AC6 **分页 payload 不再携带页内相对量**：`curl '/git-history.json?before=<t>&limit=100'` 返回的行对象**不含 `col` 字段**，其 `edges` 不含 `toRow`（若为兼容保留字段，则断言客户端忽略它们并重算——二者取一，测试须明确断言所选方案）。
- [x] AC7 **生产读数**：AC1/AC2/AC3 三项均在**真实生产页面**上经多轮滚动加载后取值，不接受仅 fixture 通过（硬规则 4 推论三）。

## DoD

生产 `/git-history` 上，连续滚动加载 3 轮以上，图形始终正常：无竖线穿过文字、边两端全部锚定在节点、列号与 `git log --graph --all -n <已加载条数>` 逐条一致。三个读数取自真实浏览器多轮操作之后，而非首屏。把合并改回「原样 push」会让 AC1/AC2/AC3 同时变红。截图与读数各留一份为证。

## Touches

- packages/quay/src/serve-git.ts（分页 payload 去掉页内相对量；客户端合并后用 assignGitColumns 重算 col 与 toRow；render 前按最大列号重算图形区宽度与 textX）
- packages/quay/src/observation.ts（readGitHistory 增加 skip 发射序游标——git log --skip 连续接续 --all --topo-order）
- packages/quay/src/serve-handlers.ts（`/git-history.json` 返回体形状调整）
- packages/quay/test/gap-git-graph-pagination-appends-page-relative-col-and-torow.test.mjs（本任务的回归测试：多轮加载后的锚定/对拍/不侵入）
- packages/quay/test/gap-git-graph-adopt-git-column-algorithm-and-decorate-labels.test.mjs（列号对拍从写死 500 扩到已加载条数）
- packages/quay/test/gap-git-graph-cross-column-edges-drawn-as-fixed-stubs-not-anchored.test.mjs（锚定判据扩到分页之后）
- packages/quay/test/gap-git-graph-reconstructed-lanes-all-named-mainline-ref.test.mjs（%D 对拍 oracle 加 --topo-order 对齐 readGitHistory，治数据依赖红）
- packages/quay/test/gap-git-graph-stride-chip-overlaps-commit-row-text.test.mjs（内联标签条数 oracle 加 --topo-order 对齐 readGitHistory，治数据依赖红）
- tasks/gap-git-graph-pagination-appends-page-relative-col-and-torow.md
