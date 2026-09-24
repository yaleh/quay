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

实现期的两处修正（都由【读浏览器 DOM】而非【回读 CSS】发现，细节见 `## Evidence`）：title 的 clamp 必须挂在单元格【内层元素】上（挂在 `<td>` 上会让它失去 `table-cell`，行高 2 行而第三行仍被画出半截字）；`position:sticky` 单写是【失效】的——基表 `table{overflow:hidden}`（圆角裁剪）让表格成为自己单元格的最近滚动容器，必须同时给 `.goal-table` 加 `overflow:visible`。

## AC

- [x] `node --experimental-strip-types --test packages/quay/test/gap-webui-goal-list-full-id-status-title.test.mjs` exit 0：渲染 `/goal` 与 `/goal?kind=criterion`，断言 `.goal-table` 样式不含 `table-layout:fixed`、页面无带百分比宽度的 `<col>`；id/status/goal 单元格为 `white-space:nowrap` 且不带 `text-overflow:ellipsis`；每个 id 单元格带 `title` 属性且等于完整 id（逐行断言，先打印前 3 行实际内容再引用计数，行数 ≥ 1）。
- [x] 同一测试：title 单元格带 line-clamp:2 且 `title` 属性 = 完整标题；`/goal` 页含放宽 main 的规则，`/tasks` 页 HTML 不含该规则（负控制：其它页仍 900px）。
- [x] 同一测试：表格被 `overflow-x:auto` 容器包裹，且 `@media (max-width:900px)` 下 id 列为 `position:sticky`。
- [x] `node --experimental-strip-types --test packages/quay/test/gap-webui-goal-list-tab-split-goal-ac.test.mjs packages/quay/test/gap-webui-goal-list-sort-and-column-set.test.mjs packages/quay/test/serve-goal-zh-chrome.test.mjs` exit 0（旧测试里对 fixed 布局/列宽的断言改写为新口径，而不是删除断言）。
- [x] 真浏览器读数脚本（命令写进 DoD 证据；headless Chrome/CDP 或 Playwright 均可）：对生产 `/goal` 与 `/goal?kind=criterion`，在 1440 与 900 两个视口逐**数据行**断言 id 与 status 单元格 `scrollWidth <= clientWidth`，输出行数与违例数；本任务落地前的基线（旧提交）上同一脚本违例数 > 0（负控制，证明脚本能取假），落地后违例数 = 0。

## DoD

在运行中的生产 serve 上真实操作，不是 fixture：贴出 1440 与 900 两个视口下 `/goal` 两个页签的截图路径，以及上述脚本的读数（行数、违例数）——落地后违例 0、落地前基线违例 > 0。验收对象是「数据行 id/status 在真实浏览器里完整可见」，单元测试断言 CSS 字符串只是必要而不充分。

## Evidence

证据目录：`.quay/full-id-width-evidence/`（脚本 + 4 份 JSON 读数 + 13 张截图 + `READINGS.md` 汇总）。

**脚本**（AC5 正本，逐数据行量 `scrollWidth <= clientWidth`；按**表头文本**定位列，不按新 class——否则旧构建上找不到单元格、恒报 0，脚本就无法取假）：

    export LD_LIBRARY_PATH=/tmp/pw-verify/syslibs/usr/lib/x86_64-linux-gnu
    node .quay/full-id-width-evidence/read-goal-cols.mjs <baseUrl> <viewportW> <outJson> [shotPrefix]

**落地前基线** = 运行中的生产 serve（cwd `/data/home/yale/work/quay`，端口 10539，旧提交）：

| 页签 | 行数 | id/status 单元格数 | 违例 @1440 | 违例 @900 |
|---|---|---|---|---|
| `/goal` | 27 | 54 | **50** | **50** |
| `/goal?kind=criterion` | 178 | 534 | **518** | **518** |

样例（1440px，正是人所报现象）：`id row=GOAL-020 sw=100 cw=43`（渲染成 `G…`）、`status row=GOAL-001 sw=92 cw=78`（渲染成 `achi…`）、`goal row=AC-187 sw=100 cw=69`（渲染成 `GO…`）。同时读到 `table-layout=fixed`、`main max-width=900px`、表宽 868px。

**落地后** = 任务自身代码起的真 serve（worktree，端口 14831）：

| 页签 | 行数 | id/status 单元格数 | 违例 @1440 | 违例 @900 |
|---|---|---|---|---|
| `/goal` | 27 | 54 | **0** | **0** |
| `/goal?kind=criterion` | 178 | 534 | **0** | **0** |

机制读数：`table-layout=auto`；`main max-width` 1382.4px @1440 / 864px @900；两视口 `documentElement.scrollWidth == 视口宽`（页面不被撑宽，超出的表格由 `.table-wrap` 滚动）。@1440 criteria 表 1757px 在 1350px 容器内；@900 goals 表 877px 在 832px 容器内 —— 都在容器内滚动。

**sticky @900 的浏览器半边**：`/goal?kind=criterion` 上把 `.table-wrap` 滚到 `scrollLeft=300`——修 `overflow` 前 id 单元格 left=−266（跟着滚动、声明失效），修后 left=34=容器左缘（钉住）。截图 `fixed-criterion-900-scrolled.png`、反例 `probe-sticky-before-overflow-fix-900.png`。

**截图**：`baseline-old-goal-1440.png`（`G…`/`achi…`/两侧大片空白，即所报缺陷）、`baseline-old-goal-900.png`、`baseline-old-criterion-1440.png`（`A…`/`GO…`）、`baseline-old-criterion-900.png`、`fixed-goal-1440.png`、`fixed-goal-900.png`、`fixed-criterion-1440.png`、`fixed-criterion-900.png`、`fixed-goal-900-scrolled.png`、`fixed-criterion-900-scrolled.png`；实现取舍的两张反例：`probe-clamp-on-td-bleeds-900.png`（clamp 挂 `<td>`：第三行出血）、`probe-clamp-inner-element-900.png`（挂内层：干净 2 行）。

**两条负控制**（同一脚本能取假）：① 生产旧代码上违例 50/518 > 0；② `/tasks` 页不含放宽 main 的规则（AC2 测试内）。

## Touches

- packages/quay/src/serve-goal.ts
- packages/quay/test/gap-webui-goal-list-full-id-status-title.test.mjs
- packages/quay/test/gap-webui-goal-list-tab-split-goal-ac.test.mjs
- packages/quay/test/gap-webui-goal-list-sort-and-column-set.test.mjs
- packages/quay/test/serve-goal-zh-chrome.test.mjs
- packages/quay/test/gap-webui-list-table-no-overflow-container.test.mjs
- tasks/gap-webui-goal-list-full-id-status-title-and-real-width-ac.md

⚠️ `gap-webui-list-table-no-overflow-container.test.mjs` 是落地时补进 Touches 的第 6 个测试文件：它原先把 `/goal` 钉在 `table-layout:fixed` + `text-overflow:ellipsis` 上（正是本任务要反转的机制），不改它必红。改动是**重定口径**（改断言为 auto 布局 / 不 ellipsize），该文件的核心滚动容器断言（`assertAllTablesWrapped`）原样保留。
