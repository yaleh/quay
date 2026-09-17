---
id: gap-webui-board-transient-columns-drowned-by-history
title: /board 的"执行/落地"列是瞬时信号，默认视图混排 2243 条历史任务后几乎永远清一色"—"，NEW 标签名不副实
status: ready
labels:
  - gap
  - webui
parent: null
children: []
extra:
  schema: finding
---
**type:** finding

## Finding

**背景**：`/board`（导航栏标 NEW）近 7 天访问日志只有 2 次命中，而同期 `/dashboard` 360 次、`/tasks` 31 次。chrome-devtools 实测生产实例 `100.78.206.100:4173` 的 `/board` 页面，前 20 行（page 1/113）"执行"列、"落地"列全部是 `—`。

**⚠️ 先纠正一个容易得出的错误诊断**：第一反应会怀疑"执行/落地两列没接真实数据"，但读了 `packages/quay/src/serve-board.ts` 之后确认不是——页面顶部自己写着"执行: `.workflow-events/` · 0 实现中 · 0 待落地"，这两个数字是真实读数，不是恒零占位。`board.execution`/`board.landing` 的判断逻辑（`gap-web-board-needs-an-inconsistency-verdict-it-does-not-have` 已 done 落地）确实在读 `.workflow-events/` 目录和 `task-status-drift-check.ts` 的落地判定——**只是这两个维度本质是"瞬时"信号：只有一个任务正处在 in-flight worktree 或排队等 fan-in 时，它这一行才会非空**。同一时刻 Dashboard 页面显示"在飞 0 / 上限 5"——系统级 in-flight 数就是 0，所以 `.workflow-events/` 自然对全部 2243 行都给不出匹配，每一行"—"都是如实反映"当前没有在飞"，不是 bug。

**真正的问题**：`/board` 默认视图是把这两个"仅在极短时间窗口内非空"的列，铺在一张默认显示全部 2243 条（其中 2171 done、多数 57+ 天前更新）任务的表格里分页浏览。这两列在几乎任何一次打开页面的瞬间，对几乎任何一行都会是"—"——不是这次抽样运气不好，是这个默认视图的构造方式决定了它几乎必然如此。一个"意图/执行/落地" join 页面如果每次打开都是一堵空横杠，无法体现它的设计意图（用户也确实没在用它——2 次/周）。

**不是要重新做 join 逻辑**（那部分已经在生产上正确工作），**是默认呈现方式没有过滤到"当前值得看"的那个子集**。

**实现取向（同一次读页面得出的第二条判断）**：过滤只在**两个瞬时时源都真读到**（`status === "ok"`）时生效。源 `empty`/`error` **不是**一个说"没有"的源——凭它隐藏行就是把「无法判定哪些任务在飞」渲染成「没有任务在飞」（硬规则 5 来源完备性 / 硬规则 3b：读不懂的输入不得与合格同形）。该路径有自己的取值 `board_default_view=unfiltered-source-incomplete`，说明原因并显示全部行，绝不静默。这也是既有 /board 测试（分页、冷加载、漂移一致、降级）一行未改仍全绿的原因。

## AC

- [x] `/board` 默认视图（无 status/label 筛选参数时）只展示"执行"或"落地"列非空的行，或在两列全空时页面给出明确的空态提示（如"当前没有在飞/待落地的任务"），而不是渲染一整页历史任务配一堵横杠
      （`handleBoard` 新增 `transientView` 三态 + `visibleRows`；判定谓词 `isTransientRow`（`landingFlag != null || execFlags.length > 0 || inFlightMinutes != null`）。两列全空 ⇒ 渲染 info-banner 空态「当前没有在飞 / 待落地的任务」`board_default_view=transient-empty` 并**不渲染任何表格**（真浏览器 `document.querySelectorAll('table').length == 0`）。真实 2248 行生产库：默认视图 12 行一页，全部有信号）
- [x] 保留现有的手工 status/label 筛选能力，可让用户主动切回"看全部 2243 条"的视图（不是彻底删除该能力，只改默认）
      （`?status=`/`?label=` 语义不变，且**显式筛选不再叠瞬时过滤**（用户点名要的集合就是他要的）；新增 `?all=1` 为显式"看全部"入口，空态与默认视图上都带该链接；`buildBoardHref` 携带 `all`，翻页/改 pageSize 不丢该视图）
- [x] `node --experimental-strip-types --test packages/quay/test/gap-webui-board-transient-columns-drowned-by-history.test.mjs` 覆盖：默认视图在 0 个任务命中执行/落地时的空态渲染 + 至少 1 个任务命中时默认视图只显示该任务（不显示其余 2242 条纯历史行）
      （4/4 绿：空态（含"未渲染表格"断言）；1 个 in-flight ⇒ 只显示该行、`Page 1 of 1 (1 rows)`；`?status=`/`?all=1` 恢复全库；**外加**「源读不到 ⇒ 显示全部且不冒充空态」这条独立的不可评估态，以及 `renderBoardPage` 直调的 legacy 路径保持表格）
- [x] `scripts/test.sh` 全绿
      （worker 面：`scripts/test.sh --for-task gap-webui-board-transient-columns-drowned-by-history --allow-thin` = **exit 0 / 99 tests, 0 fail**，其中含本任务新增 4 条、`serve-board.test.mjs` 既有 11 条（**未改一字**）、以及交叉集 `adr-gate`/`adr-store`/`build-dist`/`npm-pack-e2e`/`plugin-packaging`；scoped 静态检查全 PASS。**全量套件由 driver 的机械 fan-in 执行**（worker 不跑全量），已写 scoped-gate cache 供其跳过冗余 scoped 门）

## DoD

在真实运行的 `quay serve` 实例上用浏览器复核：系统 0 在飞时 `/board` 默认视图显示明确的空态说明（而非空表格/空横杠墙）；人为让至少一个任务进入 in-flight 或 awaiting-land 状态时，`/board` 默认视图能直接看到这一行，不需要翻页。是否保留"NEW"导航标签，视这次改动后的实际可用性由实现者一并判断并在 PR/commit 里说明理由。

**已复核**（本机无 chrome-devtools / playwright MCP，故用仓库已装的 chromium 经 CDP 直接驱动真浏览器，脚本与截图见 Evidence）：
- 0 在飞 ⇒ 空态说明、0 个表格（真 `quay serve` + 真浏览器，`board-dod-empty.png`）；
- 人工注入 1 个 in-flight（活进程 + start 无 end 遥测）⇒ 默认视图直接看到该行、单页、其余 2 条历史行不渲染（`board-dod-inflight.png`）；
- **真实生产库**（2248 行 / 3 在飞 / 9 条落地异常）⇒ 默认视图 12 行一页、全是真信号（`board-real-default.png`）。
- **"NEW" 导航标签：保留**，理由写在 commit message（affordance 作用不受本次改动影响、无 AC 要求动它、且它住在 serve-render.ts —— 15 个视图共用的渲染文件，为纯装饰性标签扩大爆炸半径不划算；若将来要改成语义标签，应另立一条有自己的证据的改动）。

## Touches

- packages/quay/src/serve-board.ts
- packages/quay/test/gap-webui-board-transient-columns-drowned-by-history.test.mjs
- tasks/gap-webui-board-transient-columns-drowned-by-history.md

## Evidence

**实现 `853e580c8`**（serve-board.ts +132 −14；新增测试 4 条 232 行）；**scoped 门验于 HEAD `80152da5b`**（= `853e580c8` + `git merge develop` 无损合并，仅带进一条无关任务文件改动）。证据包 `.quay/board-transient-view/`（截图 4 张 + `board-scoped-gate.log` + 本次浏览器驱动脚本 `board-cdp.mjs` + 夹具脚本 `board-dod-setup.sh`）。

- **改动本体**（`packages/quay/src/serve-board.ts`）：`renderBoardPage` 增 `transientView`/`joinedTotal`/`incompleteSources` 三个**可选**入参（缺省 = legacy 单页全渲染，直调者零变化）；`handleBoard` 增 `?all=1` 解析、`incompleteSources` 归集、`transientView` 三态判定与 `visibleRows` 过滤；`execution.flags`/`execution.inFlight` 的 taskId 也并入行并集（在飞/孤儿行在意图读分歧时也必须有一行可渲染——否则默认视图恰好藏掉它存在的理由）。零客户端 JS 不变（无 `<script>`，既有 AC3 断言仍绿）。
- **AC1 真实数据（生产库，真浏览器）**：`quay serve`（worktree 源码）指向 `/home/yale/work/quay`，Chromium CDP 取回：`默认视图：只显示「执行」或「落地」列非空的行 —— 12 行（全部 2248 行）`、`Page 1 of 1 (12 rows)`、12 行 id 全部命中（3 在飞 + 9 落地异常 + …），`tableCount=1`。对照缺陷：改前同一视图是 `page 1/113` 的 20 行全 `—`。
- **AC1 空态 + DoD 前半**：真 `quay serve` + 真工作区（3 条纯历史行 + 1 条已结束遥测使执行源 `ok`）⇒ `当前没有在飞 / 待落地的任务 board_default_view=transient-empty`、`tableCount=0`、`rowCount=0`（非空表格/非空横杠墙）。
- **DoD 后半（人工注入）**：同一实例注入活进程 runId + start 无 end 遥测 ⇒ 默认视图 `1 行（全部 3 行）`、`Page 1 of 1 (1 rows)`、只有 `dod-history-2` 一行（`在飞 5.1 分钟`），另两条历史行不渲染；`?all=1` ⇒ `已显示全部 3 行（含历史任务）`，三条全在。
- **反例控制（"读不到 ≠ 没有"）**：无 `.workflow-events/` 的工作区 ⇒ `board_default_view=unfiltered-source-incomplete` + 「默认过滤未生效…因此下面显示全部 N 行」，**不出现**空态文案（两种 0 行状态文本可区分，硬规则 3b）。
- **既有回归面**：`serve-board.test.mjs` 11/11 绿（含分页 25 行、冷加载、缓存负控制、读超时 fail-open、漂移逐任务一致、孤儿/在飞判定）——**该文件未改一字**；另 `/board` 的其余消费者（`gap-webui-detail-page-head-drops-pagestyles` / `gap-webui-list-table-no-overflow-container` / `serve-nav-inconsistent-routes` / `serve-ac102-modernist-views`）29/29 绿；`npx tsc --noEmit -p packages/quay` exit 0。

### 第 2 轮（2026-09-17，续做 exited-not-landed 之后）

- **pre-merge**：`git merge develop` 无损（HEAD `b54cada9c`，diff 仍为 2 文件 `+401 −6`）；**scoped 门重跑 exit 0 / 99 tests / 0 fail**；**重写 scoped-gate cache**（developSha 由 `50e7bb21a` 更新为 `888010338`）。
- **⚠️ 上一轮 fan-in 的 suite 红已诊断为【宿主资源饥饿】，不是本任务的代码缺陷**（三条证据）：
  1. **隔离复跑同一批失败文件 ⇒ 全绿，且快一个量级**：`scripts/test.sh <那 4 个文件>` = **exit 0 / 125 tests / 0 fail / 58.5s**。逐文件对照（同一份代码）：`worker-driver.test.mjs` 174s✖ → 通过；`driver-anchor.test.mjs` 176s✖ → 通过（其中 `双派发硬闸` 89s✖ ⇒ **1.0s ✔**）；`cli.test.mjs` 146s✖ → 通过；`server-status-web-control-same-pid.test.mjs` 203s✖ → 通过（其中 `AC3 ps -p <pid>` 88s✖ ⇒ **3.9s ✔**；`AC1 dispatch 持久记录`✖ ⇒ ✔）。四个失败**全部是超时形**（22–89s、stderr 为空 ⇒ 子进程在测试内部窗口内没跑完），墙钟总差 ~12×。
  2. **独立复现（同 anchor 的邻居任务）**：`gap-webui-dashboard-tasks-display-polish` 在其后一个窗口（同 `wk-prod-anchor`、不同分支、14:57–15:01）**同样 `exited-not-landed @ step=suite`**，失败在 `packages/quay/test/web-ui-browser.test.mjs`（1 fail / 3081）⇒ `step=suite` 红不是本分支特有。
  3. **无交集、无可共享状态**：4 个失败文件都不在 Touches/diff 内；本改动是 `/board` 渲染的**纯增补**（三个可选入参，缺省 = legacy）；新增测试用**进程内** `startServer({port:0})`（无外部服务/端口争用）、只写自己的 `mkdtemp` 私有工作区，退出后实测**零残留进程**（`ps` 中 `setInterval` 签名计数 = 0）。
  - 现场读数：该窗口宿主 **loadavg 18.4 / 16 核**、6 个在飞 worktree；同日另有 `gap-spec-release-hotfix-branching-…` 两次被 **silence watchdog** 杀掉套件（06:47、07:40）。
  - **未再跑全量套件**（判别性证据已由上面第 1 条对照给出）：宿主已过载，再叠一条 16 路并发的全量套件会自己诱发同类超时、并可能把别的 worker 的套件推红——属自败动作。
  - **范围外（留给另立任务）**：这 4 个文件都是 child-spawn 形却**未**登记 `@load-sensitive`（`plugin/scripts/known-load-sensitive.ts --list` 无它们），因此落在 16 路 main 桶；但该注册表只喂续做提示文案（`worker-driver.ts:2043/2075` 的 `relatednessSignalsFor`/`formatRelatednessNote`），**既不驱动分桶、也不会触发自动重试**，故本任务无机械杠杆可用。修它不在本任务 Touches 内。
- **留待 fan-in**：全量套件（`scripts/test.sh` 默认面）由 driver 的机械 fan-in 执行；scoped-gate cache 已按 developSha `888010338` 重写，fan-in 侧不重复 scoped 门。

### 第 3 轮（2026-09-17，第二次续做 exited-not-landed 之后）

- **⚠️ 上一轮 `step=merge-develop: exit null` 的真因已定位：worktree 索引里卡着 3 个 staged 文件**（内容 = develop 版）⇒ `git merge develop` 硬拒：
  ```
  error: Your local changes to the following files would be overwritten by merge:
    .quay/routine-findings.jsonl tasks/gap-ac288-webui-lang-switch-mechanism.md tasks/gap-webui-board-transient-columns-drowned-by-history.md
  Merge with strategy ort failed.
  ```
  **处置**：三个文件先用 `git hash-object <path>` vs `git rev-parse develop:<path>` 逐字核对，**确认与 develop 完全一致**（`e83256d0` / `eb698ae3` / `45e7f60a`）⇒ `git reset HEAD -- <3>` + 将两个 tracked 文件恢复为 HEAD 版、删掉那个 develop 侧的未跟踪新增文件（**内容由紧接着的 merge 原样带回，零丢失**）。
  **⚠️ 给下一次续做的判据**：`merge-develop` 报错时**先看索引干不干净**（`git status --short` 第一列），别急着怀疑分支或代码——本次 `exit null` 就是这么来的，且它**不会**留下 `MERGE_HEAD`（merge 从未开始），所以从「分支落后/无进行中 merge」两个角度都看不出问题。
- **pre-merge + scoped 门（本轮一次性重做，全部在 post-merge HEAD 上取值）**：`git merge develop` 无损通过（develop 已前进 13 提交，两边无共同改动文件 ⇒ 无冲突；新 merge commit，`behind=0`）；`scripts/test.sh --for-task gap-webui-board-transient-columns-drowned-by-history --allow-thin` = **exit 0 / 99 tests / 0 fail / 45.3s**，本任务新增 4 条逐条在场：`✔ AC1: default view with 0 in-flight…` / `✔ AC1/AC3: with 1 in-flight…` / `✔ guard: an unread transient source…` / `✔ render: transientView=applied…`。
- **对上一轮 suite 红的独立对照（本轮亲自重跑，不引用第 2 轮的转述）**：那 4 个失败文件隔离复跑 = **exit 0 / 125 tests / 0 fail / 61.0s**（同一批文件在 16 路全量里是 `fail 4`、单文件 146–203s）⇒ **不重现**，与第 2 轮的「宿主资源饥饿」诊断一致，且这次是在**更靠后的 HEAD**（已含 develop 那 13 提交）上取的。现场 `loadavg 5.7 / 16 核`（上一轮该窗口是 18.4）。
- **AC1 回归面本轮亲验**：`scripts/test.sh packages/quay/test/serve-board.test.mjs` = **exit 0 / 11 tests / 0 fail**（该文件**不在** scoped 选集内，故单列一条控制，不靠第 2 轮的转述）。
- **仍未跑全量套件**：worker 不跑全量、由 driver 的机械 fan-in 跑；且宿主当时仍有在飞同侪，叠一条 16 路全量属自败动作（同第 2 轮理由）。
