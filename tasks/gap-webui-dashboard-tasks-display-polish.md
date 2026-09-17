---
id: gap-webui-dashboard-tasks-display-polish
title: Web UI 展示层三处小修复合并（favicon 缺失 / Tasks 默认排序 / Dashboard 双列不等高拉伸留白）
status: done
labels:
  - gap
  - webui
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

依据 2026-09-17 对 `.quay/quay-access.log`（近 7 天，8324 条请求）的统计 + chrome-devtools 对生产实例 `100.78.206.100:4173` 的实测截图/源码核实，三个独立的展示层小缺陷，改动范围小、互不冲突、不需要产品决策，合并一个任务集中改：

**① favicon 缺失（`packages/quay/src/serve.ts`）**
`grep -n "favicon" packages/quay/src/serve.ts` 零命中——没有任何 favicon 路由/静态资源。近 7 天日志里 `/favicon.ico` 被请求 27 次，全部 404；浏览器控制台在 Dashboard 页面加载时报 1 条 404 error。修：加一个静态 favicon 响应（哪怕是 204 No Content 也够，消掉 404 噪音）。

**② `/tasks` 默认排序是"无排序"（`packages/quay/src/serve-task.ts:138-167`）**
`sortKey`（来自 `?sort=`）为空时走 `else { tasks = filtered; }`——即 provider 返回的原始顺序（实测是近似 id 序，历史任务如 `ARCH-M103-xxx` 排最前，57 天前更新）。已有 `sortKey === "updated"` 分支（按 `updatedAt` 降序），只是不是默认值。当前任务库 2243 条中 2171 done、0 ready/todo，多数人打开 `/tasks` 是想看"最近发生了什么"。修：把默认（无 `sort` 参数时）改成走 `updated` 那条排序逻辑；`id`/`status` 两个显式排序选项不变，导航栏"Default"链接的行为也要同步核实（它目前应该对应"无 sort 参数"，改完后要确认它渲染出的顺序与新默认一致，不要出现"Default"文字链接和实际默认顺序对不上的情况）。

**③ Dashboard "工作进展"两列不等高时，矮的一列底部留白像渲染失败（`packages/quay/src/serve-dashboard.ts:1235`）**
`renderWorkProgressRow` 用 `display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr)`，左列 `${goalCard}${taskCard}`、右列 `${testsCard}${fanCard}` 各自包一层 `display:flex;flex-direction:column`。CSS Grid 默认 `align-items:stretch`，当左列内容（阶段目标卡+任务台账卡）比右列内容（测试卡+FAN-IN 卡）矮时，grid 会把左列的 flex 容器拉伸到与右列等高——多出的空间出现在左列最后一张卡片（任务台账卡）下方，视觉上是一大块空白灰色区域，和"卡片没渲染完/挂了"是同一形态。**根因是 grid 的默认 stretch 行为，不是 `renderTaskCard`（`serve-dashboard.ts:840-889`）自己的 miniList 有固定高度**——已核实 `miniList` 只渲染实际条数、没有为凑够 `MINI_LIST_N=10` 而补空行。修：给 `.dash-grid` 的这个用法加 `align-items:start`（或给左列容器加 `align-self:start`），让矮列保持自身高度、不被拉伸；同时确认这不会破坏其它已依赖 stretch 撑满背景色的地方（如有，改成显式 `min-height` 或背景延伸的替代写法）。

## Acceptance Criteria

- [x] `curl -s -o /dev/null -w '%{http_code}' http://<host>/favicon.ico` 不再是 404（200 或 204 均可）
- [x] 近一次访问日志中，`/favicon.ico` 请求不再触发 404（新验收窗口内采样确认，而非历史日志）
- [x] `curl -s 'http://<host>/tasks' | grep -o 'href="/task/[^"]*"' | head -5` 与 `curl -s 'http://<host>/tasks?sort=updated' | grep -o 'href="/task/[^"]*"' | head -5` 输出的任务 id 顺序一致
- [x] `node --experimental-strip-types --test packages/quay/test/gap-webui-dashboard-tasks-display-polish.test.mjs` 全绿，其中至少一条用例构造"左列内容明显短于右列"的两组卡片数据，断言渲染出的 HTML/CSS 不再让左列容器发生 stretch（如断言 `align-items:start` 或等价写法出现在 `.dash-grid` 内联样式或其容器规则里）
- [x] `scripts/test.sh` 全绿（含本任务新增用例）

## Definition of Done

三处修复都在真实运行的 `quay serve` 实例上用 curl/浏览器复核过（不是只过单测 fixture）：favicon 请求不再 404、`/tasks` 默认视图确认按更新时间排序、Dashboard 页面在"工作进展"两列内容长度不等时截图确认矮列不再被拉伸出空白背景块。

## Evidence

真实实例（不是 fixture）：`quay serve` 起在临时 workspace（`providers.native.tasks_dir` 与 `QUAY_NATIVE_TASKS_DIR` 都指向真实的 `/home/yale/work/quay/tasks`，2243 条），用**本任务 worktree 的源码**跑，端口 `127.0.0.1:43485`。浏览器 = `google-chrome --headless=new`（本机无 playwright/puppeteer 包）。

**① favicon**：`curl -o /dev/null -w '%{http_code} %{content_type}'` → `/favicon.ico` = `200 image/svg+xml; charset=utf-8`、`/favicon.svg` = 同；负控制：未路由路径 `/no-such-route-xyz` = `404`（证明新增的是一条具体路由，不是"这台服务器不再 404 了"）。

**② 默认排序**：同一实例上
`curl /tasks | grep -o 'href="/task/[^"?]*' | head -5` = `gap-webui-task-detail-flat-body-needs-structure, gap-webui-dashboard-cards-poll-cost-eval, gap-webui-dashboard-tasks-display-polish, gap-webui-board-transient-columns-drowned-by-history, gap-ac281-scheduler-ms-carrier-field`
`curl /tasks?sort=updated | ...` = **同一序列**（5/5 逐项相同）。修复前该视图首位是 `ARCH-M103-001`（57 天前）。
⚠️ AC 的逐字命令（`grep -o 'href="/task/[^"]*"'`）两侧**字符串不等**，差异只在每条 href 尾部的 `?from=` 回链参数（`?from=%2Ftasks` vs `?from=%2Ftasks%3Fsort%3Dupdated`）——那不是任务 id；判据点名的对象是「输出的任务 id 顺序」，去 query 后逐项相同。负控制：`?sort=id` 仍是 id 升序（`ARCH-M103-001…`，与默认序**相反**），证明该比较确实对顺序敏感。

**③ 工作进展两列**：把真实 dashboard 的 HTML 存盘，在同一个文件上用 headless Chrome 注入一段测量脚本，**同一份真实数据**下只改那一处标记做 A/B：

| | 容器背景 | align-items | 两列高度 | 矮列下方 602px 处被涂成的颜色 |
|---|---|---|---|---|
| 修复后 | `rgba(0,0,0,0)` | `start` | `[942, 342]` | `BODY rgb(243,242,242)`（页面底色） |
| 修复前（控制） | divider 色 `srgb .125 .117 .113 / 0.4` | `normal`(stretch) | `[942, 942]` | `DIV srgb .125 .117 .113 / 0.4`（灰块） |

两版 `pageH` 都是 2081、`containerH` 都是 944 ⇒ 修复不改变行高/页面高度，只改变**空出来的那块被涂成什么**。截图目视确认：修复后矮列（测试/FAN-IN）下方是与页面同色的空白，修复前是那块深灰矩形；两列内部 2px 分隔线仍在（divider 已移到列容器上）。

**同时登记（未做，超出本任务范围）**：`renderTopRow`（同文件 `:1217`）是**同形缺陷**——右列（系统资源+DRIVER）比左列（循环脉搏）矮，容器仍 full-bleed divider ⇒ 顶部那一行仍有同一个灰块（上面的 A/B 截图里可见）。未随本任务一并修的原因是可机械验证的：`gap-dashboard-grid-autofit-columns-vs-card-count.test.mjs`（**不在本任务 `## Touches` 里**）用 `top.content.indexOf('<div style="display:flex;flex-direction:column;gap:2px">')` 精确匹配右列容器的整串属性，把 divider 背景移到列上就会打红那条断言，而改它又会撞 anti-drift HARD FAIL。⇒ 需要单独立案（连同该测试的更新）。

### 续做轮（2026-09-17）：修 fan-in 全量 suite 红

上一轮 fan-in 的全量 suite **只红一个文件**：`packages/quay/test/web-ui-browser.test.mjs`（`# fail 1`）。真因是**本任务 ② 的预期契约变更本身**，不是环境抖动，也不是本任务无关的 flake：

该文件有 **8 条**断言隐含以「`/tasks` 无 `?sort=` ⇒ 插入序 ⇒ 第 1 页含 WUI-*」为前提。② 把默认视图改为 updatedAt DESC 后，fixture 中**最后播种**的 ZPG-01..25 成了"最近更新"、占满第 1 页（`PAGE_SIZE=20`），WUI-*/SORT-*/LBL-* 全部落到第 2 页 ⇒ 8 条全红（`# fail 1` 是文件级计数）。

**修法：改输入，不改谓词**——把这 8 条断言的**主语**还原成它们本来要测的东西（"该 fixture 可见"/"过滤语义"），给它们一个显式确定性排序，使其不再把"默认序 = 插入序"当隐含契约：

- 新增 `const listById = await get(port, "/tasks?sort=id")`，清单页的"行/标题/href"断言（5 条）改用它；原 `const list = await get(port, "/tasks")` **保留原样**给页面 chrome（title/h1/筛选与排序导航）断言 —— 那部分零改动、零风险。
- `listTodo`：`/tasks?status=todo` → `/tasks?status=todo&sort=id`（32 条 todo fixture 远超 `PAGE_SIZE=20`）。
- 两处**已失效的注释**同步修正：本文件 `:221`（原文 "Seeded LAST so that in insertion-order (default, no sort)…"）与 `packages/quay/test/serve.test.mjs:287`（原文 "Default (?sort=id) alphabetical order would be…"）。
- 默认序契约本身**不在本文件重复**——由本任务自己的用例（断言 `/tasks` 与 `/tasks?sort=updated` 同序）单点钉住，符合"单一正本"原则。

**负控制（区分性，⛔ 非恒绿）**：只把 `listById` 的 URL 从 `?sort=id` 改回 `/tasks`、**谓词一字不动** ⇒ 8 条里**恰好 6 条**重新变红（另 2 条的修复在 `listTodo` 那处，该控制有意不涉及）⇒ 证明"绿"来自输入排序，而不是谓词被放宽。三文件复跑：`web-ui-browser.test.mjs` EXIT=0、`serve.test.mjs` EXIT=0、`gap-webui-dashboard-tasks-display-polish.test.mjs` EXIT=0。

**5b 扫描（修一个 ≠ 只此一个；以"默认序"为谓词扫全仓 test/src，命中 6 处）**：
- **仍为真（CLI 面，本变更未触及）**：`packages/quay/src/cli/help.ts:75`、`packages/quay/src/cli/task-list.ts:116`、`packages/quay/test/cli.test.mjs:1408` —— 本变更只动 web 面 `serve-task.ts`，CLI `--sort` 的默认仍是插入序，这三处不是漂移。
- **已失效（web 面，本变更的尾部）**：`packages/quay/test/web-ui-browser.test.mjs:221`、`packages/quay/test/serve.test.mjs:287` —— 两条均已在本轮修正。
- 另逐一核对全部 11 个含 `await get(port, "/tasks")`（无 sort）的文件：其余 9 个只断言"存在性/导航/CSS 偏移"，不断言顺序；唯二对顺序敏感的是 `serve.test.mjs:295`（显式 `?sort=updated`）与 `:842`（排的是**标签导航** `freq-common` vs `zzz-rare-*`，不是任务行）⇒ 均不受本变更影响。
- 声明纪律：本轮新增修改的两个测试文件已同步登记进 `## Touches`（anti-drift 要求"声明 = 实际"，否则视为 declaration too narrow）。
⇒ 该缺陷类在本仓**全量清完**，无剩余未处理的 web 面"默认序"断言。

## Touches

- packages/quay/src/serve.ts
- packages/quay/src/serve-task.ts
- packages/quay/src/serve-dashboard.ts
- packages/quay/test/gap-webui-dashboard-tasks-display-polish.test.mjs
- packages/quay/test/web-ui-browser.test.mjs
- packages/quay/test/serve.test.mjs
- tasks/gap-webui-dashboard-tasks-display-polish.md
