---
id: gap-webui-tests-page-unpaginated-tables
title: /tests 两张表零分页共 114,161px（1267 行 + 571 行），而分页机制早已存在于 serve-render.ts 并被
  /board 接线 —— 修好一处不等于只有一处（硬规则 5b）
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
**type:** execution

## Proposal

**现象（2026-09-08 对生产实例 `/tests` 实测 DOM，非目测）**：

- 「历史运行（新→旧）」表：**1267 行**，`getBoundingClientRect().height = 79,848px`
- 「测试时间线」下的 per-file 表：**571 行**，`23,582px`
- 整页 `document.documentElement.scrollHeight = 114,161px`
- 页面上匹配 `Next|Previous|Page size` 的链接数 = **0**

作为对照，同一套 UI 的 `/board` 有完整分页：`Page size: 20 50 100 250` + `Page 1 of 93 (1860 rows)` +
`« Previous / Next »`，实测页高 1,287px。

**根因（机制已存在，只是没接）**：分页原语就在 `packages/quay/src/serve-render.ts` —— `DEFAULT_PAGE_SIZE`
（`:649`）与 `buildHref()`（`:656`），`/board` 已消费它们。`packages/quay/src/serve-tests.ts` 里
`renderPerFileTable`（`:305`）与历史运行表**一次都没调用过这两个原语**，直接把全量记录铺开。

**这是 CLAUDE.md 硬规则 5b 的实例**：`gap-webui-board-no-pagination`（done）解决的是
「`/board` 渲染 1257 行、零分页零筛选」——**它把分页机制建对了，但只接到了被报出来的那一个页面**。
当时若做过「grep 全部列表页，列出还有哪些表未分页」这一步（5b 要求的产物），`/tests` 的 1267 行会当场浮出来。
所以本任务除了给 `/tests` 接线，**还要一次把「哪些表已接/未接」枚举清楚**，否则第三个页面还会重演。

**附带的真实代价**：`/tests` 单页 HTML 实测 **665,105 字节**（全站最大，`/git-history` 466KB 次之，
其余页面 28–75KB）。这不只是滚动体验问题，是每次打开都要传 650KB。

**修法方向**：把 `/tests` 的两张表接到与 `/board` 相同的分页原语上（同样的 query param 形态、
同样的 `Page size` 档位、同样的服务端切片，保持零客户端 JS 取向）；默认页大小对齐 `DEFAULT_PAGE_SIZE`。

## Acceptance Criteria

- [x] AC1 生产载体读数：加载 `/tests`，断言 `document.documentElement.scrollHeight < 20000`。
      取假：改动前实测 **114,161**。
- [x] AC2 分页控件存在且可用：断言页面上 `Page size` 档位链接与 `Next »` 链接**均存在**；
      点击 `Next »` 后断言首行的 round 编号与点击前**不同**（证明真的翻页，不是渲染了个装饰）。
- [x] AC3 服务端切片而非客户端隐藏：断言 `curl "/tests?...&pageSize=20"` 的响应体里 `<tr` 出现次数
      **<= 20 + 表头数**。取假：改动前实测 1267 + 571 行全在响应体里。
- [x] AC4 枚举全部列表表格（硬规则 5b 的产物，缺它视为只修了被报出来的那一个）：在测试或提交信息中给出
      `grep -rn "<table" packages/quay/src/serve-*.ts` 的**命中数与前 3 条实际内容**，并逐条标注
      「已接分页 / 无需分页（行数有上界，注明上界来源）/ 待接」；不得有未标注项。
- [x] AC5 传输量：断言 `/tests` 默认响应体字节数 **< 120,000**。取假：改动前实测 665,105。
- [x] AC6 `bash scripts/test.sh --for-task gap-webui-tests-page-unpaginated-tables` 退出码 0。

## Definition of Done

在**真实运行的实例**上打开 `/tests`，翻到第 2 页并截图，页面高度与响应体字节数的前后读数
（114,161→<20,000；665,105→<120,000）贴进提交信息；同时贴上 AC4 那张「全部表格是否已接分页」的清单。
**「加了分页函数 + 单测绿」不算达成。**

## Touches

- `packages/quay/src/serve-tests.ts`
- `packages/quay/test/gap-webui-tests-page-unpaginated-tables.test.mjs`
- `tasks/gap-webui-tests-page-unpaginated-tables.md`
