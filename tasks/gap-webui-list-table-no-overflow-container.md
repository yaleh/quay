---
id: gap-webui-list-table-no-overflow-container
title: 列表页表格没有详情页那条横向滚动规则（serve-render.ts:444 只覆盖 .detail-page），且散文列无宽度上限 ⇒
  /goal 桌面端整页横向溢出 385px、移动端 tbody 1402px 撑爆 390 视口，/live /board /needs-human
  表头被压成竖排单字
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
  - gap-webui-detail-page-head-drops-pagestyles
  - gap-webui-goal-list-sort-and-column-set
---
**type:** execution

## Proposal

**现象（2026-09-08 对生产实例逐路由实测 `documentElement.scrollWidth` vs `clientWidth`，15 条路由枚举）**：

桌面 1440 宽下，**唯一**整页横向溢出的是 `/goal`：`scrollWidth = 1825` vs `clientWidth = 1440`
（**溢出 385px**），越界元素 122 个，最深越界者是 `table`（右边界 1825）。其余 14 条 == 1440。

移动 390 宽下（枚举 17 条路由）越界的 tbody 实测宽度：

- `/goal` **1402**、`/tests` **740 / 490**（越界元素 11843 个）、`/live` **822**、`/manager` 392
- `/journal` 449（`<code>` 块，332/386/357）、`/sessions` 418

**根因（读 CSS，不是推断）**：`packages/quay/src/serve-render.ts:444` 有且只有一条横向滚动兜底——

    @media (max-width: …) { .detail-page table { display: block; overflow-x: auto; -webkit-overflow-scrolling: touch; } }

它以 `.detail-page` 作用域限定，**而列表页的 `<body>` 没有 `detail-page` 类**（只有三个详情页有）。
于是「表格宽于容器就横向滚动」这条兜底**只覆盖了详情页，从未覆盖任何一个真正宽表的列表页**。
桌面端则连这条兜底都没有（媒体查询里）。

**第二个成因（同页实测，与上一条独立）**：`/goal` 表格的 `origin` 列是**整段散文**
（`packages/quay/src/serve-goal.ts:67` 直接 `escapeHtml(ext.origin)`，无宽度上限、无截断）。
实测该列 394px、`criterion` 列 417px，把行高顶到 **109–156px**；59 行 ⇒ 整页 **15,213px**。
表格总宽 1538 > `<main>` 容器 870 ⇒ 溢出到视口外。

**为什么这是一条机制而不是「几个页面各自调宽度」**（硬规则 5b）：`/goal` `/live` `/board` `/needs-human`
`/tests` 的症状各不相同（有的整页溢出、有的表头竖排单字、有的行高 400px），但都来自同一处缺失：
**没有一个所有表格共用的「宽于容器就滚动 / 散文列就收窄」的规则**，每个页面各写各的。
`/live` 12 列挤在 945px 里，表头「待落地时长」被压成**每行一个汉字**竖排；`/board` 的「执行」「落地」、
`/needs-human` 的「阻碍原因」同病。而同一屏两侧各有约 250px 视口是空着的——
容器 `max-width` 对数据密集页一刀切，也在这条机制里。

**修法方向**：在 `serve-render.ts` 提供**一个**共享的表格外壳（如 `renderTable()` 或一条不限定
`.detail-page` 的 `.data-table` 规则），统一给出：① 宽于容器即 `overflow-x:auto`（桌面与移动同规则）；
② 散文列 `max-width` + `text-overflow`/多行钳制，完整内容走 `title`/详情页；
③ 数据密集页可选一档更宽的容器上限。然后把上述 5 个列表页接上去——**不是只修被报出来的 `/goal`**。

## Acceptance Criteria

- [x] AC1 生产载体读数、枚举而非抽查：对**全部**页面路由在 1440 与 390 两个视口各测一次，断言
      `documentElement.scrollWidth == clientWidth` 对每一条成立。失败时打印
      `(路由, 视口, scrollWidth, clientWidth, 最深越界元素)` 清单与条数。
      取假：改动前 `/goal@1440` = `1825 vs 1440`，`/goal@390` tbody 1402，`/journal@390` 449，`/sessions@390` 418。
- [x] AC2 兜底规则不再以 `.detail-page` 为界：断言渲染出的 CSS 里，横向滚动规则的选择器**不含**
      `.detail-page` 限定，且列表页 HTML 里每个 `<table>` 的最近可滚动祖先的 `overflow-x` 解析为 `auto|scroll`。
      打印无滚动祖先的表格清单与条数。
- [x] AC3 散文列被钳制：断言 `/goal` 表格的最大行高 **< 60px**，且表格总宽 <= `<main>` 容器宽。
      取假：改动前实测行高 109/156px、表格 1538 > 容器 870。
- [x] AC4 表头不再竖排单字（`/live` `/board` `/needs-human` 三页）：断言每个 `<th>` 的
      `boundingRect.height / lineHeight` **<= 2**（即最多折两行）。打印越界表头清单与条数。
      取假：改动前 `/live` 的「待落地时长」实测折 5 行。
- [x] AC5 修的不只是被报出来的那一个（硬规则 5b 的直接落实）：在提交信息里给出
      `grep -rn "<table" packages/quay/src/serve-*.ts` 的命中数与清单，并逐条说明它是否已接入共享外壳；
      未接入者必须给出理由，不得留空。
- [x] AC6 `bash scripts/test.sh --for-task gap-webui-list-table-no-overflow-container` 退出码 0。

## Definition of Done

在**真实运行的实例**上，`/goal` `/live` `/board` `/needs-human` `/tests` 五页在 1440 与 390 两个视口各截一图，
均无整页横向滚动条、表头不竖排、宽表在自己的容器内横向滚动；AC1 的前后读数对照表贴进提交信息。
**「加了一条 CSS + 单测绿」不算达成**——必须是这十张截图与那张读数对照表。

## Touches

- `packages/quay/src/serve-render.ts`
- `packages/quay/src/serve-goal.ts`
- `packages/quay/src/serve-live.ts`
- `packages/quay/src/serve-board.ts`
- `packages/quay/src/serve-needs-human.ts`
- `packages/quay/src/serve-tests.ts`
- `packages/quay/test/gap-webui-list-table-no-overflow-container.test.mjs`
- `tasks/gap-webui-list-table-no-overflow-container.md`
