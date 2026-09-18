---
id: gap-webui-dashboard-body-copy-en-zh
title: /dashboard 正文文案在 lang=en 下仍是硬编码中文 —— 卡片标题/状态词/链接/项目身份卡都不随语言切换（正文本地化系列第 1
  页，定 pattern）
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

**缺口（2026-09-18 在真实浏览器形态下复现：headless Chrome 截图 `/dashboard?lang=en` + curl `Cookie: lang=en` 抽取可见文本）**：

GOAL-024 AC-289~303 与 `gap-webui-lang-switcher-control` 落地后，`?lang=en` 下 `/dashboard` 的 **外壳**（nav 各项、`<h1>`、`<title>`、`<html lang>`、切换控件）已是英文，
但 **正文文案** 仍是写死在源码里的中文字面量。实测 `curl -H 'Cookie: lang=en' /dashboard` 去掉 `<style>/<script>`/标签后含中文的文本行 **57 条**，其中界面文案（非任务标题/提交信息等用户数据）包括：

| 位置 | 中文字面量（例） | 源码位置 |
|---|---|---|
| 副标题 | 循环脉搏、任务台账、系统资源与三层调度状态的总览 — 每张卡片指向对应完整页面。 | `serve-dashboard.ts:1366` |
| 时间轴窗口说明 | 时间轴窗口（以各自最近一次运行/fan-in 结束时刻为终点的过去 3h） | `serve-dashboard.ts`（窗口选择器一行） |
| 项目身份卡 | 项目身份 / 项目根路径 / 主机 / 监听 / 交付物 / 工作区落盘 / 分支模型 / 未接入/无数据 / 一致 / 不一致 — 该工作区落盘的 plugin 已过期 / 未评估（缺一侧读数） | `serve-render.ts:1262-1296` `renderIdentityCard` |
| 卡片标题与链接 | 循环脉搏 / 系统资源 / 工作进展 / 阶段目标 / 测试 / 变更记录 / 任务台账速览 / 查看 Live → / 查看系统状态 → / 查看三层状态 → / 查看 Goals → / 查看任务列表 → / 查看 Tests → / 查看 Journal → / 查看 Git History → | `serve-dashboard.ts`（`CJK 行` 共 50 条非注释行） |
| 状态词 | 在飞 N / 上限 M / 运行中 / 末条记录 N ago / AC 达成 a/b / ready（最近 10 条）/ 最近 5 次机械 fan-in（landed/red · 锁持有区间） | `serve-dashboard.ts` |

**去重（机制，不是症状）**：`tasks/*.md` 中无「正文文案本地化」机制的任务。相关但不同机制（仅 traceability）：`gap-ac289-dashboard-zh-nav-label-and-own-title`（只做 nav 当前项与 `<title>`）、`gap-webui-lang-switcher-control`（只做切换入口）。

<!-- dedup-ref -->
**为什么这是「系列第 1 页」**：其余 14 页 `lang=en` 下同样有大量中文正文（按含中文文本行数：journal 246 / tests 82 / sessions 60 / goal 44 / tasks 24 / live 23 / manager 23 / architecture 21 / board 20 / git-history 19 / adr 18 / system 14 / needs-human 14 / doc 7，含用户数据行，故为上界）。
它们全部共享 `serve-i18n.ts` 这份字典，若现在并发立 14 条，Touches 会在该文件上互锁且各自发明字典形态。**故先只立本页，把「正文文案字典 + 取词函数 + 测试形态」定下来，落地后其余页各一条、只需一行消费。** 用户数据（任务标题、提交信息、AC 文本）不翻译，只翻译界面文案。

## Plan

1. **红基线**：`curl -s -H 'Cookie: lang=en' http://127.0.0.1:<port>/dashboard`（自起 `startServer({port:0})` 的测试形态，⛔ 不探询常驻实例）去掉 `<style>/<script>`/标签，统计含 CJK 的行，并逐条列出**界面文案**行（剔除任务标题等数据行）；贴完整清单，这是本任务的「待清零集合」。
2. **字典**：在 `serve-i18n.ts` 新增 `DASHBOARD_LABELS: Record<DashboardKey, {en:string; zh:string}>`（与既有 `NAV_LABELS`/`PAGE_LABELS` 同形：`Record<Key, …>` 使缺一列编译期报错），**zh 列逐字等于现有中文字面量**（zh 下输出零变化）。带插值的文案（`在飞 ${n} / 上限 ${m}`、`AC 达成 ${a}/${b}`、`末条记录 ${t}`）用取词函数接收参数，⛔ 不在调用点拼接中英混合串。
3. **取词函数**：`dashboardLabelsFor(lang)`（照 `navLabelsFor` 一次取整表，避免逐项重复读）。
4. **改 `serve-dashboard.ts`**：50 条非注释中文行全部经字典取词；`renderDashboardPage` 已有 `opts.lang`，**两条渲染路径（快照路径=生产默认、旧路径）都要改**（AC-288 任务已记录过这个坑：只改旧路径会在生产形态下漏改）。
5. **改 `serve-render.ts` `renderIdentityCard`**：加 `lang` 形参，`stateText`/`branchVal`/各标签走字典；调用点 `serve-dashboard.ts:1368` 传 `opts.lang`。
6. **既有测试迁移**：默认语言是 `en`，钉中文字面量的 dashboard 测试在改造后会变红。逐个处理：断言中文的改为请求 `?lang=zh`（保持断言不变，同时它们因此变成 zh 输出零变化的回归护栏），另补 en 侧断言。先跑一遍找出全部红的（⛔ 不靠 grep 猜），红的文件若不在 Touches 里，**先补 Touches 再改**。
7. **新测试 `packages/quay/test/serve-dashboard-body-i18n.test.mjs`**（`// @test-group product`）：字典完备性（每键 en/zh 都非空且 `en` 列不含 CJK、`zh` 列含 CJK 或纯符号）、黑盒 en/zh 两态。
8. **因果对照**：临时把 `dashboardLabelsFor` 钳成恒返回 zh 列，验证 en 黑盒断言变红；恢复复绿。
9. **收口**：`scripts/test.sh --for-task gap-webui-dashboard-body-copy-en-zh` 绿 + `packages/quay/test/serve-*.test.mjs` 全绿 + `tsc --noEmit` 绿；落地后**重启常驻 `quay serve`**（不会自动重载）并在真实 headless Chrome 下截图核对。

## AC

- [x] **AC1（红基线，枚举不是布尔）**：贴 `lang=en` 下 `/dashboard` 的界面文案中文行**完整清单与条数**（本任务的待清零集合）；⛔ 不得只报总数，也不得把任务标题等数据行混进来。
- [x] **AC2（en 清零）**：同一判据在改后 `lang=en` 下，界面文案中文行 **= 0**；剩余含中文的行经逐条核对**全部是用户数据**（任务标题/提交信息/AC 文本），贴出剩余行及归类。⛔ 判据先对红基线干跑一次确认能命中（零计数必须先对已知真样本验证谓词，否则 0 不携带信息）。
- [x] **AC3（zh 零变化）**：`lang=zh` 下 `/dashboard` 的**界面文案**与改前逐字一致——在改前 commit 与改后各抓一次 zh 响应，去除动态数据后 diff 为空（或差异逐条解释）。⛔ 不得只测 en。
- [x] **AC4（字典完备且被强制）**：`DASHBOARD_LABELS` 为 `Record<DashboardKey,{en,zh}>`；测试断言每键两列非空、`en` 列无 CJK；删掉任一列 `tsc --noEmit` 报错（贴一次删列后的 tsc 红读数，再恢复）。
- [x] **AC5（两条渲染路径都改）**：快照路径与旧路径分别触发并断言 en 输出无界面中文（`peekDashboardSnapshot` 命中与未命中各一次）。
- [x] **AC6（因果对照）**：`dashboardLabelsFor` 钳成恒 zh 后 en 黑盒断言变红，恢复后复绿，两次读数并排贴出。
- [x] **AC7（既有测试迁移）**：改造前先跑 Touches 内与 dashboard 相关的全部既有测试，贴出**实际变红的清单**；逐个迁移后全绿；`scripts/test.sh --for-task gap-webui-dashboard-body-copy-en-zh` 绿；`node --test packages/quay/test/serve-*.test.mjs` 全绿；`tsc --noEmit` 绿。
- [x] **AC8（真实浏览器形态）**：落地后重启常驻 serve，用 headless Chrome 截图 `/dashboard?lang=en` 与 `?lang=zh`，贴截图路径；en 图上无界面中文。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「字典里多了一批键、单测绿了」，而是**一个真实的 `quay serve` 进程在真实浏览器里，选 EN 后 `/dashboard` 的界面文案全部是英文，选中文后与改前完全一致**：

1. **落地对象**：AC2/AC3 的读数直接来自 HTTP 响应体（⛔ 不读渲染函数返回值当「响应」）。
2. **可被打红**：AC6 因果对照实际跑过；AC2 判据先对红基线命中过。
3. **不越界**：只改 `/dashboard` 及其独占的 `renderIdentityCard`；其余 14 页的正文**一字不动**（`git diff --stat` 只含 Touches 内文件）。
4. **pattern 可被下游消费**：字典形态 + 取词函数 + 测试形态写进任务体「决定记录」一节，其余页面任务只需照抄，不需重新设计。
5. **可回滚**：还原 `serve-dashboard.ts`/`serve-render.ts`（`renderIdentityCard`）的取词调用、删 `DASHBOARD_LABELS`，纯本地代码无外部状态。
6. **生效核对**：重启 serve 后浏览器截图（AC8），⛔ 不以「代码已落地」代替「页面已变」（常驻 serve 不会自动重载）。

## 决定记录（pattern —— 其余 13 页照抄，不需重新设计）

**① 字典**：`serve-i18n.ts` ROW 5~8 新增 `DASHBOARD_KEYS` + `DASHBOARD_LABELS: Record<DashboardKey,{en,zh}>`。
单位是**一个渲染串**，不是组件 —— 两处渲染同一串（`未接入`/`运行中`/`读失败`）共用一行，一处改词两处同时动。
zh 列**逐字等于**提取前的字面量：本改动是**从运行中的代码里抽出来的**，不是另写一份。

**② 取词**：渲染函数开头 `const L = dashboardLabelsFor(lang)` 一次取整表；带插值的行写成**两列都含 `{name}` 的模板**，
由 `fillLabel(tpl, params)` 填。⛔ 不在调用点拼「中文字面量 + 数字」——那种串的英文语序无法在调用点修复。
缺参数 **throw**（ROW 6）：静默留 `{cap}` 会把模板语法渲染到页面上，而没有任何「页面该有的值在不在」的检查会变红。

**③ 默认语言**：`lang: Lang = DEFAULT_LANG`（= en），与 `pageNameFor` / `htmlLangTag` / `navLabelsFor` 同形。

**④ 既有测试迁移**：默认 en ⇒ 钉中文字面量的断言改为**显式** `lang: "zh"` / `?lang=zh` / `Cookie: lang=zh`，
原断言不变（它们因此成为 zh 回归护栏），另补 en 侧断言。
⚠️ **负向断言（`!includes("中文")`）必须显式 zh**：在 en 下它会变成恒真空转（字符串缺席的原因是错的）。
⚠️ 直接渲染的调用点用 `lang: "zh"`；HTTP 探针用 `?lang=zh`（不必改各文件自己的 `get()` helper）。

**⑤ 共享外壳的两个缺口**（本任务顺带修，zh 零变化）：`跳到主要内容`（skip link）与移动菜单四个分组标题
`核心/观测/记录/知识` —— 新增 ROW 9 `CHROME_LABELS` + `chromeLabel()`。它们是**每页都渲染**的 chrome，
由本任务的红基线探针量到：「外壳已是英文」这个前提对 nav 各项成立、对这 5 条不成立。
⛔ 切换控件的 endonym `中文` **不在此列**：它在两种语言下都必须是「中文」（ROW 4 的既定设计）。
⛔ 未纳入（逐条记录，属别的任务）：`pageTitle` 无 identity 时的 `未接入项目身份 — <page>`（需 identity
未解析才出现，实测页面不含）；`observation.readTests().reason` 等 reader 诊断串（本页只 `escapeHtml`
原样渲染，与任务标题同属「数据」）；`obsNote` / `renderBackLink`（其他页面）；`serve-live.ts` 自己的
`phaseLabel` 副本（/live 的，硬规则 5b 兄弟实例）。

**⑥ `/dashboard/cards` 必须带语言**：它在 30 s 后整卡替换 DOM；退回默认语言会让 zh 页面在几秒后变英文，
而**页面自身的 HTML 是正确的** ⇒ 任何只抓一次响应的探针看不见。（`handleDashboardCards` 的 `cfg` 由
`{ workspaceRoot }` 放宽为 `ServePageCfg`；dispatcher 本来传的就是它，只是这个注解比实参窄。）

**⑦ `sparklineSvg` 的阈值词作为【参数】传入**：其源码经 `Function#toString` 进客户端脚本，浏览器没有字典。
服务端渲染用 `dashboardLabelsFor(lang).sparkThreshold`，客户端从内联常量 `THRESHOLD_LABEL` 取。
缺参数时降级为**裸数字**（绝不替调用方选一个语言）。

**⑧ `renderTimelineBarSvg` 是 /dashboard 与 /tests 共享的**：aria-label 变语言相关后，`serve-tests.ts`
必须传自己那页的 `lang`（已做）。⛔ 不传不会报错 —— 默认 en 会让 `?lang=zh` 的 /tests 渲染英文
aria-label（硬规则 3b：静默默认与「接好了」同形）。

**⑨ 测试形态**：`packages/quay/test/serve-dashboard-body-i18n.test.mjs` 三层 —— 字典完备性（键集闭合 /
两列非空 / en 无 CJK / zh 有 CJK 或与 en 逐字同）+ 取词函数的**两条 throw 路径** + 黑盒两态
（en 下界面 CJK = 0，且**同一谓词对 zh 干跑必须命中**；`/dashboard/cards` 也随语言）。
「zh 有 CJK 或与 en 逐字同」**不是放宽而是更强的谓词**：一个纯 ASCII 的 zh 值只允许在它**逐字等于**
en 时存在（如 live_state 的 `running`），因此「误写成英文的 zh 文案」仍然会红。

## 证据（改后读数）

- **AC1 红基线**：`lang=en` 含 CJK 文本行 **60**；分类 —— 界面文案 **51**（正文 46 + 共享外壳 5：`跳到主要内容`、`核心`/`观测`/`记录`/`知识`）、切换控件 endonym `中文` ×2（既定设计）、用户数据 7（3 条任务标题 + 1 条提交信息 + 3 条 reader/goal 诊断串）。逐条清单见 `/tmp/dash-i18n/en-before.cjk.txt`（`status=200 lang=en path=/dashboard totalTextLines=153 cjkLines=60`）。
- **AC2 改后**：同一判据 **8** 条 —— `中文` ×2（endonym）+ 6 条用户数据；**界面文案 = 0**。零计数对照：同一谓词对 zh 响应命中 **92 > 20**。清单见 `/tmp/dash-i18n/en-after.cjk.txt`。
- **AC3 zh 零变化**：`lang=zh` 改前/改后可见文本 diff 仅 6 处、raw HTML diff 27 行，全部是动态数据（监听端口、cpu/load 实时采样、4 处 `5m ago`→`10m ago`、提交列表随 develop 前进）或新增的客户端脚本管道（`THRESHOLD_LABEL` 常量 + 序列化函数多一个形参），**界面文案无一处变化**。读数：`/tmp/dash-i18n/zh-before.text.txt` vs `zh-after.text.txt`。
- **AC4 因果**：删掉 `loopPulse` 的 `zh` 列 ⇒ `tsc` 报 `TS2741: Property 'zh' is missing … but required in type '{ en: string; zh: string; }'`（`serve-i18n.ts:540`，指向 `:522` 的 `Record<DashboardKey, {en,zh}>`）；恢复后 `tsc` 干净。
- **AC6 因果**：`dashboardLabelsFor`/`dashboardLabel`/`chromeLabel` 三处钳成恒 zh（**先 grep 确认 mutant 真的落进文件：3 处**，否则「对照」不生效 —— 第一次尝试就因锚点写错而**没落盘**，那次绿读数无效）⇒ 新测试 **6 条转红**（含 AC2 黑盒、两条 AC5 路径、cards payload）；恢复后 **12/12 绿**。
- **AC7 迁移**：Touches 内 5 个文件改造后先红 **8** 条（A/B 对照：同一命令在原始源码上 49/49 绿）；扩面到「所有可能受影响的测试」（导入 serve-* 或含被移动文案的 105 个文件）后共 **33 条**转红，逐个迁移后仅余 2 条**与本次改动无关的既存红**（`cli.test.mjs`、`server-status-web-control-same-pid.test.mjs` 的 dist bundle 断言 —— 两者在**原始源码**的 A/B 对照里同样红，因为 worktree 无 `dist/`；scoped 门跑前会先 build dist，故门下不红）。**scoped 门 263/263 绿、exit 0**；`tsc --noEmit` 干净。
- **AC8 真实浏览器**：worktree 起 `quay serve --host 127.0.0.1 --port 4319`（真实进程，加载的是本分支的 `serve-*.ts`），headless Chrome 1500×3200 截图：
  `/tmp/dash-i18n/dashboard-en.png`（394867 B）与 `/tmp/dash-i18n/dashboard-zh.png`（396075 B）。
  en 图上界面文案全英文（`Work progress` / `Loop pulse` / `In flight 2 / cap 5` / `Project identity` / `View Live →` …），仅余用户数据（任务标题、提交信息）与切换控件的 `中文` endonym；zh 图与改前逐页一致。
  ⛔ **未重启 :4173 常驻 serve**：它服务的是**共享主检出**，把未落地的 worktree 指过去会改掉其他层正在读的工作区（且落地发生在 fan-in 之后）。落地后重启常驻 serve 属收尾步骤，已记录为待办。

## Touches

- tasks/gap-webui-dashboard-body-copy-en-zh.md
- packages/quay/src/serve-dashboard.ts
- packages/quay/src/serve-render.ts
- packages/quay/src/serve-i18n.ts
- packages/quay/src/serve-tests.ts
- packages/quay/test/serve-dashboard-body-i18n.test.mjs (new)
- packages/quay/test/serve-dashboard.test.mjs
- packages/quay/test/serve-ac95-views.test.mjs
- packages/quay/test/serve-nav-inconsistent-routes.test.mjs
- packages/quay/test/serve-live-implcomplete.test.mjs
- packages/quay/test/gap-dashboard-cards-layout-and-livecard-swimlane.test.mjs
- packages/quay/test/gap-dashboard-grid-autofit-columns-vs-card-count.test.mjs
- packages/quay/test/gap-dashboard-livecard-minilist-overflow-indicator.test.mjs
- packages/quay/test/gap-dashboard-driver-status-card.test.mjs
- packages/quay/test/gap-dashboard-fanin-panel-and-timeline-bars.test.mjs
- packages/quay/test/gap-dashboard-goal-card-ac-denominator-includes-superseded-retired.test.mjs
- packages/quay/test/gap-dashboard-goal-card-ac-progress-bar.test.mjs
- packages/quay/test/gap-dashboard-goal-card-provider-backed.test.mjs
- packages/quay/test/gap-dashboard-taskcard-multistatus-minitable.test.mjs
- packages/quay/test/gap-dashboard-visual-review-batch-fixes.test.mjs
- packages/quay/test/gap-webui-dashboard-tests-card-latest-round-no-live-signal.test.mjs
- packages/quay/test/gap-webui-goal-list-sort-and-column-set.test.mjs
- packages/quay/test/gap-webui-tests-page-missing-rounds-timeline-bar.test.mjs
- packages/quay/test/gap-ac179-criterion-cold-miss-dashboard-snapshot.test.mjs