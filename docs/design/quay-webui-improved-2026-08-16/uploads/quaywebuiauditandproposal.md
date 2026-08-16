# quay Web UI 现状审计 + 改进方案

调查方式：实际访问 `http://100.78.206.100:4173/`（chrome-devtools MCP，桌面 1440×900 + 移动 375×812 两种视口），逐路由截图存档于
`/tmp/claude-1000/-home-yale-work-quay/65dc5943-107a-4ef5-94d2-4ba5d0d3816c/scratchpad/screenshots/`（`01`–`12`），并逐路由对照
`packages/quay/src/serve.ts` + `packages/quay/src/serve-handlers.ts`（1711 行，全部路由/渲染逻辑所在）+ `packages/quay/src/observation.ts`
（588 行，唯一知道 workspace 观测细节的模块）源码核实。仓库只读，未修改任何代码/任务体/配置。

---

## 一、现状功能描述

### 1.1 技术栈——零前端依赖，纯服务端渲染

`packages/quay/package.json` 的 `dependencies` 只有 `@modelcontextprotocol/sdk` 和 `yaml`，`devDependencies` 只有 `esbuild`。
**没有任何前端框架、没有 CSS 方案、没有构建步骤**：

- 全部 HTML 由 `serve-handlers.ts` 里的一个模板字面量辅助函数 `html` 拼接而成（`serve-handlers.ts:22-24`），逐字节手写转义
  （`escapeHtml`，`:26-30`）。
- 全站样式是**一个函数返回的一整块内联 `<style>`**——`pageStyles()`（`serve-handlers.ts:54-216`，163 行），每个页面的
  `<head>` 里原样内联一份。没有外部 CSS 文件，没有 CSS 变量/自定义属性，颜色全部写死十六进制值。
- **全站 `grep -n "<script"` 结果为零**——没有一行客户端 JavaScript。所有交互（筛选、排序、分页、搜索、标签开关）都是
  `<a href="...">` 链接或 `<form method="GET">`，服务端重新渲染整页。没有 AJAX、没有 WebSocket、没有自动刷新；`/live` 页面
  要看到新的在飞任务必须手动刷新浏览器。
- Node ≥20 原生 `http` 模块（`serve.ts:12`），provider 通过 MCP stdio 子进程通信（`connectProvider`，`serve.ts:44-56`）。

### 1.2 路由清单（对照 `serve-handlers.ts:1621-1711` `handleAllRoutes` 逐条核实）

| 路由 | 处理函数 | 数据来源 | 实测状态 |
|---|---|---|---|
| `/` | `handleTaskList`（`:463-870`，407 行，全文件最大单函数） | Provider ABI `client.taskList()` | ✅ 实测 1018 条任务，51 页 |
| `/task/:id` | `handleTaskDetail`（`:1112-1166`） | Provider ABI `client.taskGet()` | ✅ 实测（DIR-001） |
| `/live` | `handleLive`（`:1252-1274`） | `observation.ts` 读 `.workflow-events/*.jsonl`（fast-mode 遥测）+ `/proc/pressure/cpu` | ✅ 实测：真实在飞任务 `gap-task-telemetry-6-percent-join`，`live_state=running`，并发 1，CPU 压力 1.55 |
| `/journal` | `handleJournal`（`:1276-1294`） | `observation.ts` 读 `orchestration/escalations.md` + `orchestration/tick-log.md` + `git log` | ✅ 实测：三段真实滚动记录 |
| `/board` | `handleBoard`（`:1365-1430`） | 三源 join：Provider ABI（意图）+ `.workflow-events/`（执行）+ 子进程调用 `plugin/scripts/task-status-drift-check.ts --json`（落地） | ⚠️ 实测可用但**耗时 63 秒**（`curl` 实测 `real 1m3.450s`），且**未分页**（1013 行一次性吐出），且**未出现在任何页面导航栏**（全文件 grep `/board` 只有路由自身，无任何 `<a href="/board">`——只能靠直接输入 URL 到达） |
| `/git-history` | `handleGitHistory`（`:1579-1617`） | `git log --all` 服务端渲染 SVG 柱状图（按日提交数） | ⚠️ **代码已存在**（`gap-git-history-svg-server-rendered`，`cb21fc48` 07:13 落地）但**当前跑着的 demo 进程返回 404** —— 见 1.4 |
| `/adr`、`/adr/:id` | `handleAdrList`/`handleAdrDetail`（`:872-927`） | Provider ABI `client.adrList()`/`adrGet()` | ✅ 实测 33 条真实 ADR，含 status/date/supersedes 关系 |
| `/goal`、`/goal/:id` | `handleGoalList`/`handleGoalDetail`（`:948-1045`） | **不经 Provider ABI**，直接读 workspace 根 `goals/` 目录（`createGoalStore`） | ⚠️ 路由/渲染齐全，但 `goals/` 目录**存在且为空**（0 条记录）——实测页面显示 "No goals."（见 1.4） |
| `/doc`、`/doc/:id` | `handleDocList`/`handleDocDetail`（`:1047-1110`） | 直接读 `docs-managed/` 目录（`createDocumentStore`） | ✅ 实测 1 条文档（DOC-001） |

**导航栏不一致**：任务列表页顶部导航是 `live · journal · git-history → · ADRs → · goals → · docs →`（`:852`），而 ADR/goal/doc/live/journal
详情页的导航栏彼此又各不相同（例如 `/adr` 页导航只有 `← tasks · live · journal`，没有到 `/board` 和 `/git-history` 的链接；`/goal`
页导航有 `docs →` 但没有 `/board`）。**没有任何一个页面链接到 `/board`**——这是本次调查发现的一个具体、可复现的导航缺口。

### 1.3 已移除的能力——Web UI 目前是纯只读

`packages/quay/test/serve-adversarial-eval.test.mjs` 头注释记录：`POST .../action/<id>` 路由（任务上的 gate/action 按钮）已被
`gap-web-action-buttons-unused-route-and-open-redirect-delete` 删除。只保留了读取 `?error=`/`?success=` 查询参数显示横幅的展示逻辑
（`serve-handlers.ts:815-817`, `:1136-1137`），但**没有任何表单/按钮会产生这些参数**——banner 渲染代码是死代码路径的孤儿。当前
Web UI **不能执行任何写操作**（不能改任务状态、不能跑 gate、不能编辑任务），所有写操作都必须走 CLI/MCP。这是设计边界，不是缺陷，
但方案部分需要明确尊重这个边界（见 §2.2）。

### 1.4 实测发现的三个具体问题

1. **`/git-history` 在当前运行实例上 404，但源码里已经实现**。原因：该路由由 `cb21fc48`（07:13）合入，而当前跑着的
   `quay serve` 进程是 `05:34` 启动的（`ps aux` 实测 PID 118310，`readlink /proc/118310/cwd` = `/home/yale/work/quay`，
   `--experimental-strip-types` 直接跑 `.ts` 源码、无构建产物）——**Node 进程启动时把路由表加载进内存后不会热重载**，
   所以 05:34 之后 commit 的新路由要等**重启该 `quay serve` 进程**才会生效。这不是代码 bug，是一个操作性发现：
   **当前运行的 demo 实例落后于 HEAD**，本报告涉及 `/git-history` 的观感描述来自代码阅读而非截图。
2. **`/board` 未分页 + 63 秒延迟**：`readBoardLanding()`（`observation.ts:~470-510`）每次请求都 `execFileP("node", [...task-status-drift-check.ts, "--json"], { timeout: 120_000 })` 子进程重新全量扫描 1018 个任务文件，无缓存、无增量。任务列表页
   （`/`）有分页（20/页默认）+ frontmatter-only 优化（`includeBody:false` 省掉 5.7MB→0.3MB 的 MCP 载荷，`:479-483` 注释),
   但 `/board` 完全没有这类优化,是当前最慢的路由。
3. **移动端标签导航的横向滚动 CSS 被内联样式覆盖，实际效果是纵向换行占用 ~12 行**：`.label-nav-wrap` 类
   （`serve-handlers.ts:208-214`）设计意图明确写在注释里（QX-043：「转换成单行可横向滚动的窄条」），CSS 是
   `overflow-x:auto; white-space:nowrap`；但实际渲染处 `serve-handlers.ts:860`
   `<div class="label-nav-wrap"><p class="meta" style="white-space:normal">Label: ...` 用**内联样式把 `white-space` 改回了
   `normal`**，直接抵消了该 class 的设计目的。移动端截图（`10-tasklist-mobile.png`）实测：187+ 个标签的导航在 375px
   视口下换行成约 12 行文字墙，用户必须滚过这堵墙才能看到第一条任务——这正是那条 CSS 规则本要防止的效果。

### 1.5 移动端响应式现状

唯一的响应式断点是 `@media (max-width: 600px)`（`serve-handlers.ts:154-167`），只对**任务列表页的表格**生效：
隐藏 `.col-role`/`.col-labels`/`.col-updated` 三列，只留 id/status/title。**`/board`、`/adr`、`/goal`、`/doc`、`/journal`
的表格都不带这些 class**，故在移动端不会做列裁剪——`/board` 的 4 列表格在 375px 视口下会挤压或依赖通用的
`table { display:block; overflow-x:auto }` 兜底横向滚动（未专门优化）。任务详情页（`/task/:id`）本身是流式文本，移动端
截图（`11-taskdetail-mobile.png`）显示可读，但标题字号（`h1: 1.5rem`）在长标题下吃掉 6 行纯标题空间，无折叠/摘要。

### 1.6 已发现但未修复的既有已知问题（源码自带记录，供参考）

- 任务标题若本身以 `DIR-001:` 开头，详情页会渲染成 `DIR-001: DIR-001: ...`（`t.id` 和 `t.title` 拼接时没有去重前缀）——
  实测截图 `09-taskdetail.png` 可见。这是任务数据本身的写法问题而非渲染 bug，但渲染层可以做去重展示。
- `/goal` 路由虽然完整实现（含 kind/status 过滤、evidence 最近 verdict 展示），但 `orchestration/manager-phase-goal.md`
  实测 **2225 行 / 163KB / 26 个 AC 小节**，文件自己的头注释写着「本文件仍是阶段目标/AC 的唯一活载体」——**真正的阶段目标
  内容仍在这个 prose 文件里，从未迁移进 `goal-store.ts` 背后的 `goals/` 目录**（该目录存在但 0 条记录，实测 `ls` 验证）。
  `/goal` 页面机制完整但**内容源尚未接入**，这是产品与方法论层的一个真实断层，直接关系到本任务②要求的「阶段目标页」设计
  （见 §2.4）。

---

## 二、改进方案

**声明**：以下均为**建议**，未落地任何代码；凡涉及具体实现细节的段落都在描述"应该怎么做"而非"已经这样做"。

### 2.1 兼容 desktop/mobile web

现状只有一个断点（600px）且只对一张表生效，是"能看不难受"级别，远不是"响应式设计"。建议：

- **断点体系**：改用 3 档而非 1 档——`≤480px`（手机竖屏）、`481–960px`（手机横屏/平板）、`>960px`（桌面），复用现有
  `main { max-width: 900px }` 作为桌面上限,平板档把 `main` 撑到 `100%` 但保留 `padding`。
- **统一表格降级策略**：把 `.col-role`/`.col-labels`/`.col-updated` 这套"按需隐藏列"模式抽成通用 class（如
  `.col-secondary`/`.col-tertiary`），套用到 `/board`、`/adr`、`/goal`、`/doc` 全部表格，而不是只有任务列表一张表有优化。
- **先修那个已发现的具体 bug**：`serve-handlers.ts:860` 的内联 `style="white-space:normal"` 与 `.label-nav-wrap`
  的 `white-space:nowrap` 互相矛盾——建议去掉内联覆盖，让标签导航真正变成移动端可横滑的单行窄条（`overflow-x:auto`
  已经写好，只是被覆盖了）。
- **导航模式**：桌面顶部的 `live · journal · git-history → · ADRs → · goals → · docs →` 文字链接条在移动端应折叠成
  一个汉堡菜单或底部 tab bar（尤其在加入 Dashboard/系统状态/Manager 状态等新页面后，链接会更多，纯文字条会进一步挤占首屏）。
- **触控目标尺寸**：现有 `button`/链接的 padding（`0.4rem 1rem` 等）在桌面够用，移动端建议统一到 ≥44px 触控高度
  （WCAG 2.5.5 AAA 参考值），尤其是分页 Previous/Next、标签 toggle 链接这类高频点击元素。
- **视口测试基线**：建议把「桌面 1440×900 + 移动 375×812 各截一次图」纳入这次 UI 改版的验收标准之一（本次审计已建立
  可复用的 chrome-devtools MCP 截图流程，未来改版可以复用同一组 URL 做前后对比）。

### 2.2 更现代的 UI 交互

**现状具体问题点**（均来自实测，不是泛泛而谈）：

1. **零反馈的整页刷新**：筛选/排序/翻页/标签切换全部是整页 `<a href>` 跳转——1018 任务规模下任务列表页每次点击都要
   重新拉取+渲染整页 HTML（虽然已经用 `includeBody:false` 优化了载荷，但仍是整页往返）。`/live`、`/board` 这类"应该
   随时间变化"的页面完全没有自动刷新,用户必须手动按 F5。
2. **长文本墙无结构化导航**：`/journal`（截图 `03-journal.png`，全页约 7448px 高）和任务详情页（长任务体可达数千字）
   都是从上到下一条到底的 markdown 渲染,没有目录（TOC）、没有"回到顶部"、没有可折叠分区。`renderMarkdown()`
   （`serve-handlers.ts:223-345`）只做 ATX 标题/粗体/代码块/列表的字面转换,不生成锚点 id,所以连"跳转到某个 `##` 小节"
   都做不到。
3. **`/board` 的 63 秒等待没有任何加载状态**——纯服务端渲染意味着浏览器在这 63 秒里只能显示"加载中"的浏览器默认转圈,
   没有进度提示,用户很容易以为页面卡死了。
4. **搜索是提交式而非即输即搜**：`/` 页的搜索框是 `<form method="GET">`（`:824-832`）,每次搜索都要点 Search 或回车,
   在 1018 条任务的场景下,一个即输即搜 + 防抖的体验会好得多。
5. **标签导航信息密度过高但无法快速定位**：187 个标签只按"频率+字母"排序、露出前 25 个,其余塞进一个
   `<details>`（`:767-777`）——对于"我知道这个标签存在,想快速跳到它"这类操作,没有搜索框,只能靠人眼在 187 项里找。

**改进方向**（不预设具体框架,但给出选型考量）：

- **渐进增强,而非重写**：鉴于当前架构的核心优势就是"zero client JS = 零构建步骤 = 单文件可读性极高"（这是仓库
  `CLAUDE.md` 反复强调的"单一正本、不手搓"哲学在前端层面的体现）,建议**不要**引入 React/Vue 这类需要构建管线的框架,
  而是有选择地加入：
  - 少量原生 `<script>`（无依赖,内联,几十行级别）实现:自动轮询刷新 `/live`（如 `fetch` + `setInterval` 每 15-30s 刷新
    一个局部 DOM 片段,或最简单地用 `<meta http-equiv="refresh">` 做整页定时刷新,后者零 JS 成本但体验较硬）;
    搜索框防抖 + `fetch` 局部替换表格 body;`/journal`/任务详情页的锚点导航（服务端渲染时给每个 `##` 标题生成 `id`,
    客户端只需要一个 sticky 侧边 TOC,可以纯 CSS 做,不需要 JS）。
  - `<details>`/`<summary>` 这类原生可折叠元素已经在用（标签导航),可以推广到任务详情页的长分区、`/journal` 的历史
    tick 记录,零 JS 成本换取"默认收起,按需展开"。
  - 若确实需要更丰富的实时性（如 `/live` 秒级刷新、`/board` 进度条),再考虑引入一个极小的运行时（如
    htmx 量级的库,~14KB,声明式属性驱动,不需要打包步骤),但这已经突破"zero deps"边界,需要人明确决策——本报告只提出
    这是一个需要决策的岔路口,不代为决定。
- **`/board` 的两个独立问题分别解决**：性能问题（63 秒)建议给 `readBoardLanding()` 加缓存（例如按 workspace 的
  `git HEAD` + 任务文件最大 mtime 做缓存 key,drift checker 结果没变就不重跑子进程),这是后端问题,不是前端交互问题;
  分页问题建议直接复用 `/` 页已有的分页机制（`PAGE_SIZE`/`page` 参数、`bh()` 辅助函数）,不需要发明新模式。

### 2.3 新增 Dashboard 首页

**定位**：不替换现有 `/`（任务列表仍是核心工作台),而是新增 `/dashboard` 或把 `/` 让给 Dashboard、任务列表移到 `/tasks`
——两种路由方案都可行,后者更符合"首页=总览"的直觉,但会是一个破坏性 URL 变更（现有书签/链接失效）,需要与人确认取舍。

**建议的卡片/模块清单**（按信息密度从高到低排列,复用本次调查已确认的真实数据源）：

| 卡片 | 内容 | 数据源 | 备注 |
|---|---|---|---|
| **循环脉搏** | live_state（running/running-unwired/not-running）+ 在飞任务数 + CPU 压力 | 复用 `/live` 现有逻辑（`observation.ts:readLive`） | 已有机制,只是需要摘要化成一张卡片而非独立页面 |
| **任务台账速览** | todo/ready/done/needs-human 四态计数 + 最近更新的 5-10 条任务 | `client.taskList({includeBody:false})` 聚合 | 现有 `/` 页已经算好 status 分组,只是没有摘要卡片 |
| **系统资源** | cpu_stall(avg10/avg300)/mem_avail/loadavg/node_procs/进程预算 | `resource-gate.sh` + `process-budget.sh`（见 §2.4） | 新增,见下 |
| **Manager/Outer/Inner 状态**（如接了三层） | 三层各自的 Cron/Loop 存活 + Monitor 数 + halt 状态 | 见 §2.4,**必须做存在性探测,不能假设三层都在** | 见 §2.5 自适应设计 |
| **最近提交** | 近 N 次 commit 的一句话摘要（复用 `/journal` 的 `readRecentCommits`） | `git log --oneline` | 已有机制 |
| **Git History 缩略图** | `/git-history` 那张 SVG 的一个小尺寸版本（近 7 天） | 复用 `renderGitHistorySvg()`,传更短的 `windowDays` | 代码已存在,只需要一个"迷你版"调用 |
| **ADR 活跃度** | proposed/accepted 状态计数 + 最近一条 ADR | `client.adrList()` | 实测 33 条,accepted 多数、少量 proposed |
| **阶段目标进度** | 当前 phase 的 AC 完成度（若已迁移到 goal store）或指向 prose 文件的链接（若未迁移） | 见 §2.4,**当前 `goals/` 为空,卡片要能诚实展示"未接入"而非静默空白** | 直接关系 1.6 节发现的断层 |

**信息密度/布局建议**：桌面用响应式网格（如 `grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))`,纯 CSS,
不需要 JS）,每卡片是一个 `<section>` + 标题 + 2-4 个关键数字 + 一个"查看详情 →"链接指向对应完整页面（复用现有
`/live`、`/journal`、`/board` 等,Dashboard 不重新实现这些页面的完整逻辑,只做摘要+入口)。移动端网格退化为单列纵向堆叠。

**关键设计原则**（呼应仓库 `CLAUDE.md` 硬规则 6「缺值 = 未查,不是为假」）：任何一张卡片如果它的数据源当前为空/不可用
（如 `goals/` 目录空、没有接 manager、`.workflow-events/` 不存在),必须显式渲染"未接入/无数据"而不是留白或显示 0——
现有 `observation.ts` 的三态模型（`ok`/`empty`/`error`,`observation.ts:49`）已经是这个原则的现成实现,Dashboard 的每张卡片
都应该复用这个三态,而不是发明新的空值语义。

### 2.4 新增/增强页面

#### 2.4.1 系统状态

**展示内容**：直接对照 `resource-gate.sh`（462 行,report 模式实测输出）和 `process-budget.sh` 的字段:

```
cpu_stall(some avg10)=1.76  [limit 60]   ok
cpu_stall(some avg300)=1.35
mem_avail=11859MB             [limit 2048] ok
loadavg=5.19             [limit nproc×2≈32] ok
nproc=16  node_procs=0
swap=0  [nproc-invariant ok]
total_budget=16  budget_in_use=0  budget_available=16
worktree_node_tests=0  caller_scope=main
=> GO: 资源充足，可以跑
```

页面建议展示:PSI CPU 压力（avg10 主判据 + avg300 辅助,标注 60 阈值)、内存可用量、1 分钟 loadavg（标注
`nproc×2` 动态阈值,**不能写死一个数字**——这正是仓库 `CLAUDE.md` 认识论硬规则 4 推论二明确警告过的坑:「在本机等价于
无限制的字面值不是无限制」,系统状态页的阈值展示必须读 `nproc` 而不是抄一个当前机器上算出来的数字)、node 进程预算
占用（`process-budget.sh` 的 `total_budget`/`in_use`/`available`)、GO/WAIT 判决。

**数据来源**：这两个脚本都已经是"跑一次、打印文本"的 CLI 工具,不是常驻服务、不产生 JSON。**实现难度评估**：低——
Web UI 后端只需要 `execFileSync` 调用这两个脚本（`serve-handlers.ts` 已经在用同样的模式调用
`task-status-drift-check.ts --json`,`observation.ts` 也已经在用同样的模式跑 `git log`),把纯文本输出正则解析成字段即可,
不需要给这两个脚本本身加 `--json` 支持（虽然长期看,给它们加 `--json` 输出会更稳,值得作为一个独立小任务提给这两个
脚本的维护者)。刷新方式建议轮询（每 30-60 秒),不需要 WebSocket。

#### 2.4.2 Manager / Outer / Inner 状态

这是本次方案里机制最复杂的一块,细分三个子面板：

**a) Cron/Loop 面板**——回答"三层各自的调度锚点还活不活"：

- Outer/Inner 用 `plugin/scripts/loop-driver-check.sh`（its 判据见脚本头注释）：读 `.quay/loop-driver.jsonl`
  注册表（实测本仓库该文件只有一行 `{"mechanism":"cron","interval":"*/20 * * * *","source":"cold-start"}`）,
  再用**可观测证据**（git HEAD 时间、`tick-log.md` mtime、`.quay/verification-round.jsonl` mtime 等)判定
  `LIVE`/`STALLED`/`DOUBLE-TRIGGER`/`BANNED-MECHANISM` 四态,退出码 0/3/4/5 分别对应。
- Manager 用会话内 `CronList`/`CronCreate`（住在 Claude Code 会话进程里,**磁盘上没有配置文件**,只能靠会话
  transcript 里的历史记录或当前会话自报——这意味着 Web UI **无法从纯文件系统读出 manager 的 cron 状态**,
  除非 manager 自己把自己的心跳写到磁盘上的某个文件（如 `orchestration/tick-log.md` 的 mtime,manager 每轮 tick
  都会写这个文件,可以作为间接证据)。
- **实现难度评估**：中——`loop-driver-check.sh` 本身可以直接 `execFileSync` 调用取退出码+stdout;manager 的存活
  只能走间接心跳文件推断,精度不如 outer/inner,页面必须诚实标注"推断"而非"确认"。

**b) Monitor 面板**——回答"各层挂了哪些观察者、状态如何"：

- `plugin/scripts/session-liveness.sh`（1512 行）是核心机制:对任意一个 Claude Code 会话判断
  `SESSION-GONE`/`SESSION-BACK`/`SESSION-IDLE`/`SESSION-RESUMED`/`REPO-STALL`/`SESSION-OVERDUE`,`--once` 模式
  按目标输出一行（名字/活/pid）。
- `plugin/scripts/observer-registry.sh` + `orchestration/observer-registry.conf`（单一来源登记表,格式
  `name|status|root|tmux-session|note`,实测本仓库注册了 `quay`/`meta-cc`/`archguard` 三个目标,均 `active`）——
  这张登记表存在的理由本身就是一个好例子：2026-08-06 一晚四个独立消费者各自维护自己的目标列表导致「已下线目标复活」
  的 bug,统一成单一登记表后才修复,Web UI 的 Monitor 面板应该**读这同一张表**,而不是自己再发明一份目标清单
  （否则会重蹈同样的覆辙）。
- **实现难度评估**：中——`session-liveness.sh --once` 对每个注册目标跑一次,输出可解析;`observer-registry.sh`
  本身应该有 `--list`/`--audit` 之类的只读子命令可以直接调用（未在本次调查中逐行确认其 CLI 接口全貌,实现前建议
  先读一遍该脚本的参数解析部分）。

**c) 主要观测指标面板**——直接抄 manager 每轮 tick 实际读的字段（`orchestration/manager-tick-log.md` 实测样本）：

```
pool=4 floor=20 deficit=16
release=v0.4.0 develop领先2367提交（diverge）
avg10=0.00 load1=2.49
tmux quay-0 的 claude/outer/inner 三窗 cmd 均=claude（存活）
任务台账 done938/needs-human32/todo17/ready13/superseded6
```

**关键警示**（呼应本任务背景要求 + 仓库 `CLAUDE.md` 硬规则 1/5）：`manager-tick-log.md`（实测 03:23Z 那一轮记录约
40+ 行叙述性文字,不是结构化字段)和 `manager-phase-goal.md`（实测 2225 行 prose)**是自然语言叙事文档,不是机读数据源**。
Web UI 如果要展示这些指标,**正确做法是调用产生这些数字的底层机件本身**（`resource-gate.sh`、
`process-budget.sh`、`slot-refill --json`、`accounting-emit.ts`、`halt-check.sh` 等),而不是写一个 markdown/正则
解析器去"读懂" manager 的叙事性 tick 日志——后者是本仓库 `CLAUDE.md` 反复警告过的"手搓解析 vs 用机件"反模式的直接
翻版（"任何查会话历史/统计用量都先用 meta-cc,不要手搓 python/grep 解析"这条规则的同构问题:任何查系统状态都应该
调用状态本身的权威脚本,不要解析 manager 写给人看的叙事日志）。**实现难度评估**：高——不是因为调用脚本难,而是因为
"pool/floor/deficit"这类字段目前**没有一个专门的、稳定的 `--json` 输出接口**（`slot-refill --json` 存在但本次调查
未逐行确认其字段稳定性/是否所有需要的数字都覆盖),这块工作的前置条件是先给这些底层机件补齐机读输出,Web UI 层
本身反而是最后一步、最简单的一步。

#### 2.4.3 Git History

**已有雏形,且相当完整**：`gap-git-history-svg-server-rendered`（任务见 `git log --oneline -- packages/quay/src/serve-handlers.ts`
命中 `001eb376`/`cb21fc48`)已经交付了 `/git-history` 路由——服务端纯 SVG 渲染（`renderGitHistorySvg()`,
`serve-handlers.ts:1493-1543`),横轴=落地时刻（committer date）、纵轴=当日提交数直方图,`?days=N` 可调窗口,零客户端
JS、零新依赖（无 gitgraph.js/Mermaid/React）。设计上刻意标注「无工时语义」（`:1563` 的说明文字：git 分支寿命
≠任务工时,遥测与 git 仅约 6% 相交)——这是一个值得保留的克制:不要在方案里建议把"耗时"语义加回这张图,除非同时
解决遥测覆盖率的问题。

**实现难度评估**：**几乎为零**——功能已经完整实现,唯一动作是**重启当前跑着的 demo `quay serve` 进程**
（PID 118310,05:34 启动,早于 07:13 该功能落地的时间点)。这是本次审计发现的最高性价比一条:不需要写任何代码,
重启一个进程就能让这个页面在当前 demo 环境里可见。建议顺带把它加入所有页面的顶部导航（目前只有 `/`、`/git-history`
自己、`/goal`、`/doc` 的导航里有它,`/adr`、`/live`、`/journal`、`/board`、任务详情页都没有——见 1.2 节的导航不一致问题）。

#### 2.4.4 阶段目标（和 AC）

**现状核实**（对照 1.6 节发现）：`/goal` 路由/渲染机制已完整实现（kind=phase/criterion 过滤、status 过滤、
最近 verdict+时间展示),但数据源 `goals/` 目录**当前为空**——真正的阶段目标内容仍在 `orchestration/manager-phase-goal.md`
（2225 行)和 `orchestration/outer-phase-goal.md`（实测同样是长 prose 文档,含"目标"、"哪部分是人明说的/哪部分是我推断的"
等叙事性小节)这两个文件里,从未迁移进 goal store。

**方案建议,分两条路径,取舍交给人裁定**：

1. **短期（不改机制,只改展示）**：`/goal` 页面在 `goals/` 为空时,除了当前的"No goals."文本,应该**主动提供一个
   指向 prose 正本的链接**（如 `/goal` 空态时展示"阶段目标当前记录在 `orchestration/manager-phase-goal.md` /
   `orchestration/outer-phase-goal.md`,尚未迁移到结构化存储"),避免用户看到"No goals"就误以为项目没有阶段目标——
   这正是 1.6 节发现的"机制完整但内容源未接入"断层的直接后果,展示层应该诚实反映这个断层而不是掩盖它。
2. **长期（真正推进迁移）**：`goal-store.ts`（488 行）+ 3 个测试 + gate 工厂据任务记录已经落地
   （`f37462ec`,2026-08-09),缺的是**没有任何 open 任务在盯"把 AC 迁进 goal store"这件事本身**（`manager-phase-goal.md`
   自己的头注释原话)。这不是 Web UI 层能解决的问题,但 Web UI 的 `/goal` 页面可以成为**推动迁移的可见压力**——
   一个持续显示"0 条目标,阶段目标仍锁在一个 2225 行文件里"的页面,比藏在文件系统深处的事实更容易被看见、被推动。

#### 2.4.5 ADR

**现状已经相当好**：`/adr`（列表)+ `/adr/:id`（详情,含 `supersedes`/`supersededBy` 双向关系渲染）已完整实现且
对照 `quay-native adr list` CLI 命令读同一个 Provider ABI 表面(`client.adrList()`/`adrGet()`),两者数据源一致,
不存在 CLI 有而 Web 无的情况。实测 33 条 ADR,含 proposed/accepted 状态、日期、supersedes 链。

**建议的增强点**（非新建,是锦上添花）：

- 当前列表按 Provider 返回顺序展示,没有排序/筛选（对比任务列表页有 sort/status/label 多维筛选)——ADR 数量增长后
  （当前 33 条,若干还是 2026-08-06 一天内新增的 axis 系列)会需要按 status 筛选、按 supersedes 关系画一张简单的
  依赖图（复用 `git-history` 已经证明可行的"纯 SVG 服务端渲染"模式,不需要引入图形库）。
- ADR 详情页目前渲染纯 markdown body,没有把 `supersedes`/`supersededBy` 关系可视化成时间线,这在 ADR 数量增长、
  链条变长后会变得难读。

#### 2.4.6 任务列表 / 状态 / 当前开发 / 最近的路径

**现状**：`/` 页已经有相当完整的静态列表能力（筛选/排序/搜索/分页/标签)。**"当前正在开发什么"这个问题目前分散在
两个互不链接的页面**：`/live`（回答"哪个任务正在被跑",基于遥测)和 `/board`（回答"哪个任务声称完成但代码没落地/
代码落地了但状态没关",基于三源 join),但两者都没有和 `/` 的任务列表打通——用户在任务列表页看不出"这条任务此刻
正在被处理"。

**建议**：

- 在任务列表的每一行,如果该任务 id 出现在 `/live` 的在飞列表里,渲染一个醒目的"进行中"标记（复用
  `observation.ts:readLive()` 已经算好的 `inFlight` 数组,做一次 O(n) 的 Set 查找即可,不需要新机制）。
- "最近的路径"（最近完成/最近落地）目前只能靠 `?sort=updated` 间接看("最近改动的任务"),不等于"最近落地的功能"——
  真正的"最近落地"信号是 `/board` 的 `landing` 判定（复用 `task-status-drift-check.ts` 的输出),但该数据源慢
  （63 秒,见 1.4）。**建议**：把 `/board` 的落地判断结果做增量缓存（按 git HEAD 缓存,HEAD 不变则复用上次结果),
  缓存命中后可以安全地把"最近落地"这个信号叠加进任务列表/Dashboard,而不必每次都跑一遍 63 秒的全量扫描。

### 2.5 兼容两层（Outer+Inner）和三层（Manager+Outer+Inner）两种模式

**核心问题**：`.quay/config.yml` 当前**没有任何显式字段标记"这个项目是否接了 manager"**（实测读取本仓库
`config.yml` 全文,`loop:` 小节有 `board`/`gates`/`stop`/`policy`/`fork_baseline`/`merge_target`/`execution`/`audit`/
`concurrency`/`concurrency_bands`/`worktree_root`/`routines`,唯独没有 `manager` 相关字段)。manager 的存在目前只能
靠**间接侧证**推断：`.quay/manager-inbox/` 目录是否存在且非空（实测本仓库该目录下有多封信,含刚才 git status 里
列出的几个新文件)、`orchestration/manager-*.md` 系列文件是否存在、tmux 会话里是否有一个 `manager` pane。

**建议方案**：

1. **不要在 Web UI 层假设三层一定存在**——这是任务要求里明确强调的一点,也是仓库 `CLAUDE.md` 硬规则 6
   （"缺值=未查,不是为假")的直接应用。Web UI 检测 manager 存在性应该走**多信号加权判定**而不是单一布尔:
   - 信号 1（强）：`orchestration/manager-phase-goal.md` 文件存在（本仓库存在）;
   - 信号 2（强）：`.quay/manager-inbox/` 目录存在且非空（本仓库存在且非空,实测 6+ 封信)——**这里要复用
     `CLAUDE.md` 里已经写明的教训**："只跑 `inbox-reader.sh` 会把一个装着 64 封信的目录读成空的",Web UI 判断
     manager 收件箱状态时同样要**列目录本身**,不能只信 `inbox-reader.sh` 的 delivered 计数（它只认
     message-bus 写的 JSON 记录,手写的 `.md` 消息它不认——这条硬规则对 Web UI 后端同样成立,如果 Web UI 要展示
     "manager 收件箱有几封未读",必须同时数目录文件数和 inbox-reader 的 consumed 计数,两者不一致时要显式标注
     差异,不能只展示一个看似正常实则遗漏了大头的数字)。
   - 信号 3（弱,仅供交叉验证）：`session-liveness.sh`/`observer-registry.conf` 里是否登记了一个 manager 角色的
     tmux 目标。
2. **页面/组件的自适应策略**：
   - Dashboard 首页的"Manager 状态"卡片：三个信号都缺失 → 该卡片**整体不渲染**（不留一个空卡片占位,也不显示
     "无 manager"的消极状态——一个两层项目本来就不该有这张卡片,渲染出来反而是噪音)。至少一个强信号命中 →
     渲染卡片,若信号之间冲突（如目录存在但 phase-goal 文件不存在)则显式标注"检测到部分 manager 痕迹,状态不完整"
     而不是二选一静默假设。
   - 顶部导航：`Manager 状态` 这个链接本身的可见性也应该跟随同一套探测逻辑——两层项目的导航栏不应该出现一个
     点进去只会看到"无数据"的死链接。
   - `/manager-status`（如果新建这样一个页面）内部的三个子面板（Cron/Loop、Monitor、观测指标)可以进一步各自
     独立降级——例如某项目有 outer/inner 的 loop-driver 但没有 manager 的 tick-log,面板应该分别展示"outer/inner:
     LIVE"和"manager: 未检测到",而不是整个页面因为一个信号缺失就整体报错。
3. **建议把这套探测逻辑做成一个共享的后端判定函数**（类似 `observation.ts` 现有的角色——"唯一知道 workspace
   观测细节的模块"),避免每个新页面各自实现一遍探测逻辑而产生不一致的判定结果（这正是 `observer-registry.sh`
   头注释里记录的"2026-08-06 一晚四个独立消费者各自维护目标列表导致复活 bug"同一形状的风险,提前用统一模块规避）。

---

## 三、优先级建议

按"性价比"（工作量 vs 价值)排序,并标注依赖关系：

| 优先级 | 动作 | 工作量 | 理由 |
|---|---|---|---|
| **P0** | 重启当前 demo `quay serve` 进程 | 近零 | `/git-history` 功能已完整实现,只是进程陈旧导致 404,重启即可见效,不需要写代码 |
| **P0** | 修复 `serve-handlers.ts:860` 的内联 `white-space:normal` 覆盖 `.label-nav-wrap` 的 CSS bug | 极小（一行) | 直接影响移动端可用性,且是修 bug 不是加功能,风险最低 |
| **P0** | `/board` 加入全站导航（至少加进 `/` 的顶部导航条) | 极小 | 现成功能完全没有入口,加一个链接的成本几乎为零 |
| **P1** | 给 `/board` 的落地判断结果加缓存（按 git HEAD） | 小-中 | 63 秒延迟是当前最差的单点体验,缓存能把它降到接近 `/adr`/`/` 的水平,且不改变判定逻辑本身的正确性 |
| **P1** | 系统状态页（读 `resource-gate.sh`/`process-budget.sh`） | 小-中 | 数据源已是现成脚本,只需要解析文本输出 + 一个新路由,不依赖其它未完成的工作 |
| **P1** | Dashboard 首页的"循环脉搏"+"任务台账速览"+"最近提交"三张卡片 | 中 | 三个数据源（`/live`、任务列表聚合、`/journal` 的 commits）都已经是现成机制,只是需要摘要化 UI,不需要新的数据管道 |
| **P2** | Manager/Outer/Inner 状态页 + 两层/三层自适应探测 | 大 | 依赖 §2.4.2 提到的前置条件——"pool/floor/deficit"这类字段目前没有稳定的机读接口,这块工作的大头在后端补齐 `--json` 输出,不在 Web UI 本身;建议先立一个"给 manager tick 判据补机读输出"的独立任务,Web UI 页面作为其下游 |
| **P2** | 阶段目标页数据源迁移（`goals/` 从 0 条记录到真正承载内容） | 大,且部分决策权不在 Web UI 团队 | 依赖人对"是否推进 goal store 迁移"的裁定（§2.4.4 已注明"迁移方向归人裁定"),Web UI 层能做的短期动作（空态提示指向 prose 正本)可以先做,长期动作等裁定 |
| **P3** | 现代交互升级（自动刷新、即输即搜、锚点 TOC） | 中-大,且有架构决策岔路 | 需要人明确"是否接受引入极小运行时突破 zero-deps 边界"这个决策(§2.2 已标注),在决策明确前,`<meta refresh>`/`<details>` 这类零成本原生方案可以先垫底 |
| **P3** | ADR 依赖关系可视化、任务列表"进行中"标记 | 中 | 价值明确但不紧急,且"进行中"标记依赖 `/live` 的现成数据,实现简单但优先级低于系统状态/Dashboard 这类更高杠杆的页面 |

**一条贯穿全部优先级的建议**：无论做哪一项,都遵守本次审计已经验证过的模式——**新增的每一张状态卡片/页面,数据源为空
或不可用时必须显式渲染"未接入/无数据",绝不能静默留白或显示误导性的 0**（`observation.ts` 的三态模型已经是这个原则
的现成参考实现,直接复用其模式而不是发明新的空值语义）。
