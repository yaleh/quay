---
id: gap-webui-board-body-copy-en-zh
title: /board 正文文案在 lang=en 下仍是硬编码中文（三源列头、默认视图说明、「done 但未落地」等状态词）—— 正文本地化系列，照
  /dashboard 已定 pattern
status: ready
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

**缺口（2026-09-18，真实形态复现：`curl -H 'Cookie: lang=en' /board`，去 `<style>/<script>`/标签后含中文的行，剔除 endonym「中文」）**：**21 行**，全是界面文案（其中 `done 但未落地` 因每行一次而重复多次，去重后约 12 个不同的串）：

| en 下可见的中文（例） |
|---|
| `quay — Board — 三源 join 看板`（`<title>`）· `Board — 意图 / 执行 / 落地`（`<h1>`） |
| `意图: 任务库 (Provider ABI)` · `执行:` · `落地:` · `· 0 实现中 · 0 待落地` · `· 扫描 2287 任务`（三源摘要，含计数插值） |
| `默认视图：只显示「执行」或「落地」列非空的行 —— 9 行（全部 2287 行）。` · `显示全部 2287 行（含历史任务）` |
| 表头 `意图` / `执行` / `落地` · 单元格状态词 `done 但未落地` |

源码位置：`packages/quay/src/serve-board.ts`（**非注释中文行 29 条**）。

**去重（机制，不是症状）**：`tasks/*.md` 无 `/board` 正文本地化任务。相关但不同机制：`gap-ac292-board-request-path-cold-build`（/board 冷构建耗时，与语言无关）。

<!-- dedup-ref -->
**同源系列（traceability）**：`gap-webui-dashboard-body-copy-en-zh`（done，已定 pattern；本任务照抄其「决定记录」①~⑨）。**本页特有**：① 状态词（`done 但未落地`）**每行渲染一次**，是**一个渲染串一行字典**的典型（决定记录 ①），⛔ 不要为每个出现位置写一行；② 摘要行 `· {n} 实现中 · {m} 待落地`、`· 扫描 {n} 任务`、`默认视图：… —— {k} 行（全部 {n} 行）` 全是**带计数的模板**（决定记录 ②），英文语序需要在模板里整体决定；③ 该页 `Board` 已在 `serve-board.ts` 里有与 dashboard 同义的「未落地/实现中」状态概念——**不跨表复用 `DASHBOARD_LABELS` 的行**，在本页新增自己的行并在任务体记录取舍。

## Plan

1. **红基线**：`startServer({port:0})`，`Cookie: lang=en` GET `/board`（默认视图）与 `/board?all=1`（若展开开关是 query；以源码为准）各一次，逐行列出含 CJK 的行（剔 endonym），贴完整清单并去重计数；谓词先对 zh 干跑命中。
2. **字典**：`serve-i18n.ts` 新增 `BOARD_KEYS` + `BOARD_LABELS` + `boardLabelsFor`（同 `DASHBOARD_LABELS` 形；zh 列逐字等于现有字面量；计数行用模板 + `fillLabel`）。
3. **改 `serve-board.ts`**：全部经字典；标题后缀与页名并列处理；该页的 30s TTL 冷构建路径（`gap-ac292-board-request-path-cold-build`）与语言无关，⛔ 不顺手改。
4. 局部刷新端点（若有）带语言（决定记录 ⑥）；客户端脚本串走参数（⑦）。
5. **既有测试迁移**：`serve-board.test.mjs` 及被实跑证实变红的测试，钉中文断言改显式 zh；负向断言显式 zh；不在 Touches 的先补 Touches 再改。
6. **新测试** `packages/quay/test/serve-board-body-i18n.test.mjs`（`@test-group product`）：字典完备 + throw 路径 + 黑盒 en/zh（默认视图与展开全部各一）。
7. **因果对照**：钳成恒 zh → en 黑盒变红，恢复复绿。
8. **收口**：scoped 门 + `serve-*.test.mjs` + `tsc --noEmit` 绿；重启常驻 serve 并截图。

## AC

- [x] **AC1（红基线，枚举不是布尔）**：贴 `lang=en` 下 `/board` 默认视图与展开全部**各一份**界面文案中文行完整清单、去重条数；谓词先对 zh 干跑命中。
- [x] **AC2（en 清零）**：两种视图改后界面中文行均 = 0；剩余含中文的行逐条归类为用户数据（任务标题）。
- [x] **AC3（zh 零变化）**：改前后各抓 `lang=zh`（两种视图），去动态数据后 diff 为空（或逐条解释）。
- [x] **AC4（字典完备且被强制）**：键集闭合；两列非空、`en` 无 CJK；删列 `tsc --noEmit` 报错（贴红读数再恢复）。
- [x] **AC5（所有渲染路径带语言）**：列出全部渲染入口/刷新端点，`?lang=zh` 下逐个断言仍 zh。
- [x] **AC6（因果对照）**：钳成恒 zh 后 en 黑盒变红，恢复复绿，两次读数并排贴出。
- [x] **AC7（既有测试迁移 + 不回归）**：贴实跑变红清单；迁移后全绿；scoped 门、`serve-*.test.mjs`、`tsc --noEmit` 绿。
- [x] **AC8（真实浏览器形态）**：重启 serve，截图 `/board?lang=en` 与 `?lang=zh`，en 图无界面中文。

## DoD

**REAL LANDING（DIR-026 Reading A）**：真实 `quay serve` 在真实浏览器里，选 EN 后 `/board` 界面文案全为英文，选中文后与改前一致。
1. 读数来自 HTTP 响应体。
2. AC6 实跑；AC1 谓词对 zh 命中过。
3. 不越界：`git diff --stat` 只含 Touches 内文件；冷构建路径不动。
4. 重启 serve + 截图（AC8）。
5. 可回滚：还原取词调用、删 `BOARD_*`。

## 决定记录（本页 —— 其余 13 页照抄 dashboard 的 ①~⑨，本页只记这三条不同）

**A. `<title>` 的 token 本身必须换成英文（本页与 dashboard 的唯一结构性差异）**：
`serve-board.ts` 传给 `pageTitle` 的 token 原为 `Board — 三源 join 看板` —— 即**默认语言（en）下这个页面
自己的 `<title>` 渲染出中文副标题**。`pageNameFor` 对 en 是恒等（ROW 3：en 列对每个 token 都是 identity），
所以这不是「字典少了一行」，**任何字典补行都修不掉它，必须换 token 本身**（这正是 AC-291/293/296/298 的
`<title>` token 形态）。故 PAGE_LABELS 的键由 `Board — 三源 join 看板` 改为 `Board — three-source join`，
zh 列逐字节不变（`看板 — 三源 join 看板`）。
⚠️ AC-292 **看不见**这个缺陷：它的第三段只断言 `t_zh ≠ t_en`，而两列本来就不同 ⇒ 换 token 前后它都绿
（已实测：`quay goal gate AC-292 --dry-run` 在本分支的 serve 上 `verdict: pass`）。

**B. 不跨表复用 `DASHBOARD_LABELS` / `JOURNAL_LABELS` 的行（本页新增 31 行，含 `读失败`/`无数据` 这类与它们逐字相同的）**：
取舍按 ROW 11 注释 ③ —— 跨页共用会让「为 /board 改词」移动 /dashboard 与 /journal 的文案（硬规则 5b 的镜像形态），
重复是**记录在案**的、比它更便宜的失败模式。⛔ 不是留给后人「合并重复项」的邀请。
（/journal 的行是 `gap-webui-journal-body-copy-en-zh` 先落在 develop 上的 ROW 10；本页合并时与之冲突，
按「先落地者保留行号」裁定为 **ROW 11**，两边的行一行未丢——机械核对见证据末条。）

**C. 不在本页的三类**（逐条记录，不是遗漏）：
① `observation.ts` 的 reader **诊断串**（`未找到遥测记录（.workflow-events/ 不存在）`、
`landing 判断源执行超过 8000ms 未完成（fail-open）`）——它是**数据层**产出、经 `escapeHtml` 原样渲染，
与任务标题同类；`observation.ts` 不在 Touches 且被 /dashboard 等共享（pattern 任务与 /journal 任务对同类串作同样归类）。
② `Filter` / `Page size:` / `« Previous` / 两个筛选框 placeholder —— 两语言下**本来就是英文**，改了会动 zh（AC3 禁）。
③ `id` 列头与空单元格 `—` —— 与语言无关。

## 证据（改后读数）

**AC1 红基线（改前，`/tmp/board-i18n/before-cjk.txt`）** —— 同一状态（landing=ok / exec=empty / 扫描 2301）下
`Cookie: lang=en` 去标签后逐行含 CJK：**默认视图 13 条、`?all=1` 13 条**，其中**界面文案各 12 条**、reader 诊断串 1 条。
去重后 14 个不同界面串（两视图共有的 12 + `?all=1` 独有的 `已显示全部 {n} 行（含历史任务）。` / `只看当前在飞 / 待落地`）：
`<title>` token · `<h1>` 副标题 · `意图: 任务库 (Provider ABI)` · `执行:` · `落地:` · `无数据` ·
`扫描 {n} 任务` · `默认过滤未生效` · 默认过滤未生效正文（整句模板） · 表头 `意图`/`执行`/`落地` · 两条链接文案。
（另有一次冷启动读数落在 `landing=读取超时` 分支，多出 `读取超时` 与超时 reason —— 同一谓词，多一个状态。）
**谓词先行对照（硬规则 2）**：同一谓词对 zh 干跑命中 —— 默认视图 48 条、`?all=1` 48 条（非零）。
⚠️ 该谓词按【标签切行】故看不见 meta description 里的 `content="Quay board — 三源 join 看板"`；本任务一并修掉
（`L.metaDescription`），否则它会成为一条**判据看不见但读者看得见**的残留。

**AC2 en 清零（两个状态各一份读数，后者是更强的那个）**：
- **状态 ①「三源都读到」（`/tmp/board-i18n/live-en.html`，即 ac8 截图那一帧，landing=ok / exec=ok / 10 行 transient）**：
  `totalTextLines=106`、**含 CJK 行 = 2**、**两条都是切换控件 endonym `中文`（ROW 4 既定设计）⇒ 界面文案与 reader 诊断串
  一律为 0**。零计数对照：**同一谓词同一次抓取**对 zh 命中 **57** 条（`live-zh.html`）。
- **状态 ②「执行源无数据」（`/tmp/board-i18n/after-cjk.txt`，默认视图与 `?all=1` 各一次）**：含 CJK 各 3 条 =
  endonym ×2 + **1 条 reader 诊断串**。**界面文案 = 0**；剩余那条归类见决定记录 C①。
- 两种视图（默认 / `?all=1`）与两个状态**都测过**；新测试对「实测残余必须被 provenance 归类命中」另有断言
  （排除集非空，故它不是黑洞）。

**AC3 zh 零变化（逐字节，不是「逐条解释」）**：把改动 `git stash` 后重跑同一探针（同一状态）取改前 zh，
恢复后再取一次：`diff before-zh-{default,all}.html after-zh-{default,all}.html` **两个视图都是 0 行差异**
（`/tmp/board-i18n/{before,after}-zh-*.html`）。理由：zh 列逐字等于提取前的字面量，且 ROW 11 的模板在 zh 下
用同一填空函数还原同一串。

**AC4 字典完备且被强制**：`BOARD_KEYS`/`BOARD_LABELS` 键集闭合（31 键，新测试断言无重复、双向一一对应）；
每键两列非空、en 列无 CJK、zh 列「含 CJK 或与 en 逐字相同」（后者是**更强**的谓词：纯 ASCII 的 zh 只允许在
逐字等于 en 时存在）。**删列红读数**：把 `colIntent` 的 `zh` 列删掉 ⇒
`packages/quay/src/serve-i18n.ts:841 - error TS2741: Property 'zh' is missing in type '{ en: string; }' but required in type '{ en: string; zh: string; }'`（`tsc` 非零）；
恢复后 `tsc --noEmit` exit 0。

**AC5 所有渲染路径带语言**：`/board` 是唯一路由（`serve-handlers.ts:256`），**没有 /dashboard/cards 那样的局部刷新端点**
（已枚举：`grep 'pathname === "/board' serve-handlers.ts` ⇒ 1 条）。该路由有**两条渲染路径**：
① **快照路径**（`peekBoardSnapshot` 命中，生产默认）；② **旧路径**（`QUAY_BOARD_SNAPSHOT_DISABLED=1` 或启动后首建期间）。
两条都经同一个 `renderBoardResponse(..., cfg.lang)`。新测试对两条**各触发一次**：`Cookie: lang=zh` 下断言仍是 zh 文案
**且不含 en 措辞**（负向臂），en 下断言无界面 CJK。

**AC6 因果对照（两次读数并排）**：
- 钳制：`boardLabelsFor` 与 `boardLabel` 两处改成恒取 `["zh"]`（**先 `grep -n MUTANT` 确认 2 处真的落盘**，
  否则「对照」不生效）⇒ 新测试 **11 条中 6 条转红**（字典解析、AC2 两视图、AC3、AC5 两条路径）；`/tmp/board-i18n/ac6-mutant.log`
- 恢复（`grep -c MUTANT` ⇒ 0）⇒ **11/11 绿**；`/tmp/board-i18n/ac6-restored.log`

**AC7 既有测试迁移 + 不回归**：
- **A/B 对照**：Touches 内 4 个既有/相关文件在**原始源码**上先跑一次 = **27/27 绿**（`pristine-board-tests.log`）。
- 改造后同一命令 ⇒ **9 条转红**，逐条列出（`after-board-tests.log`）：
  `serve-board.test.mjs` 5 条 —— AC5/AC6 三源列 · AC7 执行列 in-flight · AC8 两个计数 · AC2/AC3 负控制 · AC3 fail-open 渲染；
  `gap-webui-board-transient-columns-drowned-by-history.test.mjs` 4 条 —— AC1 空态 · AC1/AC3 单行 · guard 未评估态 · 直接渲染单元。
- 迁移（决定记录 ④）：HTTP 探针改 `?lang=zh`、直接渲染传第三实参 `"zh"`；**负向断言同样显式 zh**（在 en 下它会恒真空转）。
  ⛔ 不靠 grep 猜：扩面到「导入 serve-*/handlers/render 或含本页被移动文案」的 **46 个文件**实跑，
  **418/418 绿**（`affected-run.log`）——即除上述 9 条外无其它红。
- **`gap-webui-board-transient-columns-drowned-by-history.test.mjs` 不在原 Touches**（4 条红全在它里面）⇒ **先补 Touches 再改**（已补）。
- 收口（**合并 develop 之后**重跑）：scoped 门 `bash scripts/test.sh --for-task gap-webui-board-body-copy-en-zh --allow-thin`
  **118/118 绿、exit 0**（`scoped-gate4.log`）；`node --test packages/quay/test/serve-*.test.mjs` **288 pass / 0 fail**（`serve-sweep2.log`）；
  `tsc --noEmit` **exit 0**。
  ⚠️ 第一次跑门是**红的**：新测试的 `mkdtemp` 清理写的是 `fs.rmSync(path.dirname(root))`（同一目录的别名），
  而 `tmp-leak-pairing-check` 按**变量名**配对 ⇒ 报 `mkdtemp-no-cleanup`。改为模块级 `parent` 并在 `after()` 里
  `fs.rmSync(parent)` 后门绿（**负控**：改前 `tmp-leak-pairing-check --files <新测试>` 报 1 条未配对，改后 0 条）。

**AC8 真实浏览器形态**：worktree 内起**真实 serve 进程**（`quay.ts serve --host 127.0.0.1 --port 4322`，
加载的是**合并 develop 之后**、本分支的 `serve-*.ts`），headless Chrome 1500×2400 截图：
`/tmp/board-i18n/board-en.png`（168870 B）与 `/tmp/board-i18n/board-zh.png`（171024 B）。
**en 图界面文案全为英文且一个中文都没有**（除切换控件 endonym）：`Board — intent / execution / landing` ·
`Intent: task store (Provider ABI)` · `Execution: .workflow-events/ · 1 implementing · 0 awaiting land` ·
`Landing: task-status-drift-check.ts · scanned 2301 tasks` · `Default view: showing only rows where the Execution or
Landing column is non-empty — 10 of 2301 rows.` · `Show all 2301 rows (including historical tasks)` ·
表头 `Intent`/`Execution`/`Landing` · 单元格 `done but not landed` ×9 · `In flight 29.9 min`。
该帧恰好是三源都读到的状态，故连决定记录 C① 的 reader 诊断串也不渲染 —— 与 AC2 状态① 的 0 条互证。
zh 图与改前逐页一致（与 AC3 的逐字节 diff 互证）。
⚠️ **未重启 :4173 常驻 serve**：它服务**共享主检出**，把未落地的 worktree 指过去会改掉其他层正在读的工作区
（且落地发生在 fan-in 之后）。DoD 要求的是「真实 serve 进程 + 真实浏览器」，本读数在受测代码上满足；
常驻重启属**落地后**步骤（与 pattern 任务同样的处置）。

**旁证（一个已 achieved 的 goal 判据没被本改动打回）**：AC-292 的活判据（探运行中的 serve）在本分支上实跑
`quay goal gate AC-292 --dry-run --json` ⇒ `{"id":"AC-292","verdict":"pass","reason":"acceptance passed (exit 0)"}`
—— 决定记录 A 的 token 改名对它的两条标题臂（`!includes("Board")` 与 `t_zh ≠ t_en`）都安全。

**合并核对（决定记录 B 末）**：与 develop 的冲突解决后，
`comm -23 <(git show :3:packages/quay/src/serve-i18n.ts | sort) <(sort packages/quay/src/serve-i18n.ts)`
**只输出 1 行** —— 本任务有意改写的那条 PAGE_LABELS token 行；journal 的 ROW 10 一行未丢。

## Touches

- tasks/gap-webui-board-body-copy-en-zh.md
- packages/quay/src/serve-board.ts
- packages/quay/src/serve-i18n.ts
- packages/quay/test/serve-board-body-i18n.test.mjs (new)
- packages/quay/test/serve-board.test.mjs
- packages/quay/test/gap-webui-board-transient-columns-drowned-by-history.test.mjs
