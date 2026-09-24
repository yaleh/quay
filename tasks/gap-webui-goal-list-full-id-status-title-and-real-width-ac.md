---
id: gap-webui-goal-list-full-id-status-title-and-real-width-ac
title: /goal 列表 id/status 被截成 `G…`/`achi…`、标题单行截断：改自适应列宽 + 放宽 main + 窄屏横向滚动，并把
  AC3 从「表头不截」补成「数据行 id/status 不截」（两个视口实测）
status: ready
labels:
  - gap
  - defect
  - webui
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**现象（人 2026-09-24 走查生产 `/goal`，headless Chrome 1440px 与 900px 截图）**：Goals 页签 id 显示 `G…`、status 显示 `achi…`、标题单行截断；Criteria 页签 id 显示 `A…`、goal 列显示 `GO…`。同一时刻 `/tasks` 的 id 与标题完整可读（自动布局，标题换行）。人明确指出的痛点：「在 goal 页看不到完整的 id 和标题」。

**根因（读源码，非推测）**：
1. `serve-goal.ts:162,167` 的 `GOAL_COL_WIDTHS` / `CRITERIA_COL_WIDTHS` 给 id 仅 5%（≈43px，`GOAL-020` 需约 75px）、status 9%（≈78px，装不下 `achieved`/`superseded`）。
2. `serve-goal.ts:170` `.goal-table{table-layout:fixed}` + 全部单元格 `white-space:nowrap;overflow:hidden;text-overflow:ellipsis`。
3. `serve-render.ts:105` `main{max-width:900px}` 使 1440 屏上表格仍只有约 868px，两侧各空约 280px。
4. id 单元格没有 `title` 属性（title 单元格有），截断后悬停也看不到全称。
5. 窄屏（900px）列宽不变、表格无横向滚动，仍全部截断。
6. 既有 AC3（`gap-webui-goal-list-tab-split-goal-ac`）只量**表头** `scrollWidth`，且只在 1440 量，没有拦住 1–2 的数据行截断（判据只覆盖了表头，数据行 id/status 从未被量过）。

<!-- dedup-ref -->相关（不同机制、已完成）：`gap-webui-goal-list-tab-split-goal-ac` 引入了 fixed 布局与其 AC3；本任务反转该布局取舍，其测试里对 fixed 布局/列宽的钉死断言改为新口径，不是删除。

**方案**：
a) `.goal-table` 改 `table-layout:auto`，删去 `<colgroup>` 百分比宽度；id / status / goal 列 `white-space:nowrap`（不 ellipsis）；title 列允许换行并 `-webkit-line-clamp:2`（全文保留在 `title` 属性）。
b) 仅 `/goal` 列表页把内容宽度放宽到 `min(1400px,96vw)`——通过 `goalTableStyles()` 内的规则完成，不动 `serve-render.ts`，其它页仍是 900px。
c) id 单元格补 `title` 属性（= 完整 id）。
d) ≤900px：表格外包 `overflow-x:auto` 容器，id 列 `position:sticky;left:0`。
e) 验收从「表头不截」补成「数据行 id/status 不截」，1440 与 900 两个视口都量。

## AC

- [ ] `node --experimental-strip-types --test packages/quay/test/gap-webui-goal-list-full-id-status-title.test.mjs` exit 0：渲染 `/goal` 与 `/goal?kind=criterion`，断言 `.goal-table` 样式不含 `table-layout:fixed`、页面无带百分比宽度的 `<col>`；id/status/goal 单元格为 `white-space:nowrap` 且不带 `text-overflow:ellipsis`；每个 id 单元格带 `title` 属性且等于完整 id（逐行断言，先打印前 3 行实际内容再引用计数，行数 ≥ 1）。
- [ ] 同一测试：title 单元格带 line-clamp:2 且 `title` 属性 = 完整标题；`/goal` 页含放宽 main 的规则，`/tasks` 页 HTML 不含该规则（负控制：其它页仍 900px）。
- [ ] 同一测试：表格被 `overflow-x:auto` 容器包裹，且 `@media (max-width:900px)` 下 id 列为 `position:sticky`。
- [ ] `node --experimental-strip-types --test packages/quay/test/gap-webui-goal-list-tab-split-goal-ac.test.mjs packages/quay/test/gap-webui-goal-list-sort-and-column-set.test.mjs packages/quay/test/serve-goal-zh-chrome.test.mjs` exit 0（旧测试里对 fixed 布局/列宽的断言改写为新口径，而不是删除断言）。
- [ ] 真浏览器读数脚本（命令写进 DoD 证据；headless Chrome/CDP 或 Playwright 均可）：对生产 `/goal` 与 `/goal?kind=criterion`，在 1440 与 900 两个视口逐**数据行**断言 id 与 status 单元格 `scrollWidth <= clientWidth`，输出行数与违例数；本任务落地前的基线（旧提交）上同一脚本违例数 > 0（负控制，证明脚本能取假），落地后违例数 = 0。

## DoD

在运行中的生产 serve 上真实操作，不是 fixture：贴出 1440 与 900 两个视口下 `/goal` 两个页签的截图路径，以及上述脚本的读数（行数、违例数）——落地后违例 0、落地前基线违例 > 0。验收对象是「数据行 id/status 在真实浏览器里完整可见」，单元测试断言 CSS 字符串只是必要而不充分。

## Touches

- packages/quay/src/serve-goal.ts
- packages/quay/test/gap-webui-goal-list-full-id-status-title.test.mjs
- packages/quay/test/gap-webui-goal-list-tab-split-goal-ac.test.mjs
- packages/quay/test/gap-webui-goal-list-sort-and-column-set.test.mjs
- packages/quay/test/serve-goal-zh-chrome.test.mjs
- tasks/gap-webui-goal-list-full-id-status-title-and-real-width-ac.md
