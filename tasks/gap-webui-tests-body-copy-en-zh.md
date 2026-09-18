---
id: gap-webui-tests-body-copy-en-zh
title: /tests 正文文案在 lang=en 下仍是硬编码中文（数据源说明、时间轴/负载曲线标题、空态）—— 正文本地化系列（大页），照
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

**缺口（2026-09-18，真实形态复现：`curl -H 'Cookie: lang=en' /tests`，去 `<style>/<script>`/标签后含中文的行，剔除 endonym「中文」）**：**75 行**，其中相当一部分是界面文案、其余是验证轮记录里的**数据**（失败测试名、runId、错误输出）。已识别的界面文案：

| en 下可见的中文（例） |
|---|
| `quay — Tests — 验证轮记录`（`<title>`）· `Tests — 验证轮记录`（`<h1>`） |
| `数据源：` · `（每轮 suite 完成时追加，红绿皆入账）` · `（每轮一段，红=red · 绿=green，锚定最近一轮结束时刻）` · `（suite 运行期采样，结束即停）` |
| `最近测试记录分段时间轴` · `时间轴窗口（过去 3h）：` |
| `负载曲线（round #1924 · 15:27Z）` · `loadavg (1m) · suite 运行期采样` · `测试时间线（round #1924 · 15:27Z）` |

源码位置：`packages/quay/src/serve-tests.ts`（**非注释中文行 37 条**）。**待翻译量 ≤ 37；75 是含数据的上界。**

**去重（机制，不是症状）**：`tasks/*.md` 无 `/tests` 正文本地化任务。相关但不同机制：`gap-webui-tests-page-*`（表格/时间轴的布局缺陷，与语言无关）。

<!-- dedup-ref -->
**同源系列（traceability）**：`gap-webui-dashboard-body-copy-en-zh`（done，已定 pattern；本任务照抄其「决定记录」①~⑨）。**三个本页特有的点**：① `renderTimelineBarSvg` 是 dashboard 与本页**共享**的——dashboard 任务「决定记录 ⑧」已让它的 aria-label 随语言并要求本页传 `lang`；本任务要**核实**这一传递在本页所有调用点都成立（不传不报错，默认 en 会让 zh 页渲染英文 aria-label，硬规则 3b），⛔ 不重复改该共享函数；② `round #{n} · {time}` 等是**带插值的模板**（决定记录 ②）；③ 该页有大量**运行时诊断串/失败测试名**（数据），不翻译，与 `observation.readTests().reason` 同属 dashboard 记录 ⑤ 里已划出的「数据」类。

## Plan

1. **红基线 + 分离**：`startServer({port:0})`（fixture 里放一份含红/绿轮的 `verification-round.jsonl`），`Cookie: lang=en` GET `/tests`，得到含 CJK 的行；用**可复算谓词**拆成「界面文案」与「数据」（数据 = 来自载体记录内容的行），各列清单；并把 37 条源码字面量逐条归类。谓词先对 zh 干跑命中。**空态也要量**（无验证轮记录时的空态文案，`serve-tests-empty-state.test.mjs` 已钉着一部分）。
2. **字典**：`serve-i18n.ts` 新增 `TESTS_KEYS` + `TESTS_LABELS` + `testsLabelsFor`（同 `DASHBOARD_LABELS` 形；zh 列逐字等于现有字面量）。
3. **改 `serve-tests.ts`**：界面文案全走字典；数据原样；标题后缀与页名并列处理；核实 `renderTimelineBarSvg` 所有调用点已传 `lang`。
4. 局部刷新端点（若有）带语言（决定记录 ⑥）；客户端脚本串走参数（⑦）。
5. **既有测试迁移**：`serve-tests-empty-state.test.mjs`、`serve-ac95-views.test.mjs`、`gap-webui-tests-page-*.test.mjs` 中被**实跑**证实变红的，钉中文断言改显式 zh；负向断言显式 zh；不在 Touches 的先补 Touches 再改。
6. **新测试** `packages/quay/test/serve-tests-body-i18n.test.mjs`（`@test-group product`）：字典完备 + throw 路径 + 黑盒 en/zh（有记录态与空态各一）。
7. **因果对照**：钳成恒 zh → en 黑盒变红，恢复复绿。
8. **收口**：scoped 门 + `serve-*.test.mjs` + `tsc --noEmit` 绿；重启常驻 serve 并截图。

## AC

- [x] **AC1（红基线 + 分离，枚举不是布尔）**：贴 `lang=en` 下 `/tests` 按可复算谓词拆出的「界面文案」与「数据」清单与条数（有记录态与空态各一），并把 37 条源码字面量逐条归类；谓词先对 zh 干跑命中。
- [x] **AC2（en 清零）**：两态改后「界面文案」类中文行 = 0；「数据」类行与改前逐字一致。
- [x] **AC3（zh 零变化）**：改前后各抓 `lang=zh`（两态），去动态数据后 diff 为空（或逐条解释）。
- [x] **AC4（字典完备且被强制）**：键集闭合；两列非空、`en` 无 CJK；删列 `tsc --noEmit` 报错（贴红读数再恢复）。
- [x] **AC5（共享组件传语言）**：列出本页对 `renderTimelineBarSvg` 的**全部**调用点及其 `lang` 实参（贴命中行，⛔ 不只报总数）；`?lang=zh` 下时间轴 aria-label 仍是 zh。
- [x] **AC6（因果对照）**：钳成恒 zh 后 en 黑盒变红，恢复复绿，两次读数并排贴出。
- [x] **AC7（既有测试迁移 + 不回归）**：贴实跑变红清单；迁移后全绿；scoped 门、`serve-*.test.mjs`、`tsc --noEmit` 绿；`/dashboard` 输出与改前逐字一致。
- [x] **AC8（真实浏览器形态）**：重启 serve，截图 `/tests?lang=en` 与 `?lang=zh`，en 图上界面文案全英文。

## DoD

**REAL LANDING（DIR-026 Reading A）**：真实 `quay serve` 在真实浏览器里，选 EN 后 `/tests` 的界面文案全为英文而数据原文不变，选中文后与改前一致。
1. 读数来自 HTTP 响应体。
2. AC6 实跑；AC1 谓词对 zh 命中过。
3. 不越界：`git diff --stat` 只含 Touches 内文件；`renderTimelineBarSvg` 本体与 `/dashboard` 输出不变。
4. 重启 serve + 截图（AC8）。
5. 可回滚：还原取词调用、删 `TESTS_*`。

## 决定记录（ROW 20 —— 其余页面照抄本页的两处新东西）

**① 字典**：`serve-i18n.ts` ROW 20 新增 `TESTS_KEYS` + `TESTS_LABELS: Record<TestsKey,{en,zh}>` + `testsLabelsFor` + `testsLabel`，
与 ROW 5~19 同形。单位是**一个渲染串**，不是组件。zh 列**逐字等于**提取前的字面量（改后 zh 响应**逐字节相同**，见证据）。

**② `{code}` 洞承载 markup**：`数据源：<code>…</code>（每轮一段…）` 这类句子是**一行模板 + 一个 `{code}` 洞**，
⛔ 不是「`数据源：` 一行 + `（…）` 另一行」。拆成三行会让句子变成**三个译文的拼接**（ROW 6 明禁）。
本页共 6 个 `{code}` 洞（`dataSourceRounds` / `dataSourceRoundsTimeline` / `dataSourceSuiteLoad` /
`dataSourcePerFile` / `fileTrendDataSource` / `fileFragmentDataSource`）。

**③ 一个共享的括号行 `roundSuffix`**：`（{round}）` 出现在**三个**标题里（负载曲线 / 测试时间线 / 运行期间负载曲线片段），
凡 `roundLabel()` 的插值都经它。⛔ 括号在模板**内**，不在调用点——ROW 19 的 `[`…`]` 教训：括号是句子的一部分，
留在调用点就是一次静默的 zh 字节变化。

**④ 页名 re-key（照 ROW 14 ③ / ROW 15）**：`PAGE_LABELS` 的复合 token `"Tests — 验证轮记录"` **退役**，
页面改传裸 `Tests` + ROW 20 的 `pageSubtitle`（`<title>` 与 `<h1>` 各一）。**理由不是风格**：`pageNameFor`
对 `en` **原样返回实参**（ROW 3 的契约），所以复合 token 在**默认语言下就渲染它自己的中文**，
而它的 `en` 列是**没有任何查表会读的死代码**——即 AC-298 当初「注册裸 `Tests` 会让标题留英文」的判断，
量出来正好相反：复合 token **就是**那个「en 下渲染中文」的缺陷。`/tests/file` 的 `<h1>` 页名
`测试文件` 同样没有 token，新增 `PAGE_LABELS["Test file"]`。

**⑤ 同文件的两个页面一起改**：`serve-tests.ts` 同时拥有 `/tests`（轮次列表）与 `/tests/file`
（单文件跨轮下钻，**另一个 route**，链接来自 perFile 表）。`serve-sessions.ts`（ROW 15）就是
把同文件的三个页面一起本地化的先例——那个文件的非注释中文行现在是 **0**。

**⑥ 子页面的 chrome ⛔ 不碰**：`/tests/file` 的 `<html lang>`、nav、`<title>` **保持原样**
（它本来就没有语言管道）——那是 AC-290~303 的 chrome 家族的事；动它会把本任务 diff 的 `lang=zh`
基线挪走。本条与 ROW 15 ⑥ 对 `/session/<id>` 划的是同一条线。**只改它的正文文案**（`cfg` 注解由
`{ workspaceRoot }` 放宽为 `ServePageCfg`，与 ROW 5 ⑥ 对 `/dashboard/cards` 的放宽同形）。

**⑦ 负向断言必须显式 zh**（本页踩得最狠的一处）：`!body.includes("未找到")` / `!includes("<h2>负载曲线")` /
`!includes("仅出现在 1 轮")` 这类断言在**默认 en** 下会因为「页面现在用英文写」而**恒真空转**（硬规则 3b）。
实测迁移的 17 条既有断言里有 4 条属于此类，全部改成 `?lang=zh` 读数并在原位注明理由。

**⑧ 跨断言要用 `visibleText` 而不是 `body`**：`pageStyles()` 的 **CSS 注释里就写着**
`HUE = bucket (P 产品 / S 套件 / M 机件 …)`。裸 `body.includes()` 的负向臂会把它当成泄漏——
而它对读者不可见。判据必须落在**页面上看得见的文本**上，这也正是红基线的度量单位。

**⑨ 台账是 append-only**：`verification-round.jsonl` 的**最后一行是最新轮**（`readTests` 反转文件序）。
fixture 若按「新→旧」写，页面会把**最旧**那轮当最新，然后静默走 no-perFile 回退分支——
一个看起来对、实际量到另一条分支的夹具。本任务的新测试因此在 `rounds()` 里把这个顺序写成了注释。

## 证据（改后读数）

**探针**：`/tmp/tests-i18n/probe.mjs`（真实 `startServer({port:0})` + 真 fixture workspace；
纯 `node --experimental-strip-types`）。谓词 = 去 `<style>/<script>` → 去标签 → 解码实体 →
按行取含 CJK 的行。**先对 zh 干跑命中**（硬规则 2 的零计数对照）。

**AC1 红基线（改前，`lang=en`）**：`/tests` 有记录态 **26** 行、空态 **8** 行；`/tests/file` **13** 行（两态同）。
逐条归类（记录态 26 行）——**界面文案 24**（正文全部经 ROW 20）+ endonym `中文` ×2；
**数据 2**（`not ok 7 - 中文测试名 fails (硬编码断言)`、`AssertionError: 期望 3 得到 4`）。空态 8 行：
界面文案 5 + endonym 2 + **1**（`obsNote` 的共享外壳标签 `已接入/暂无记录`）+ reader 诊断串。
**zh 对照读数**：同一谓词命中 **62**（记录态）/ **44**（空态）——谓词确实能命中。

**37 条源码字面量逐条归类**（`serve-tests.ts`，非注释中文**代码**行，用去块/行注释的脚本数）：

| 区域 | 条数 | 归类 |
|---|---|---|
| `/tests` 列表段（≤ 975 行） | **26** | 全部 → ROW 20（`loadCurveCaption` / `perFileSummary` / 5 条 bucket 词 / `ganttBarTitle` / `ganttLegend` / `ganttCaption` / `focusNote` / `roundNotFoundNote` / `latestMarker` / `failureDetailsSummary` / `loadCurveHeading` / `dataSourceSuiteLoad` / `perFileTimelineHeading` / `timelineFallbackNote` / `dataSourcePerFile` / `roundsTimelineHeading` / `dataSourceRoundsTimeline` / `timelineWindow` / `pageSubtitle` ×2 / `dataSourceRounds` / `historyHeading`）；其中 `（{round}）` 三处共用 `roundSuffix` |
| `/tests/file` 段（> 975 行） | **11** | 全部 → ROW 20（`fileTrendCaption` / `fileTrendHeading` / `fileTrendDataSource` / `fileTrendSingleRound` / `fileFragmentHeading` / `fileFragmentDataSource` / `fileFragmentNoSamples` / `fileBackLink` / `notFoundLabel`+`fileNotFoundSuffix` / `fileHistoryHeading`）+ `PAGE_LABELS["Test file"]`（`<h1>` 页名 `测试文件`） |
| **合计** | **37** | **37/37 有家**（硬规则 5 的「全部有家」，不是抽查） |

**AC2 改后（fixture）**：`/tests` 有记录态 **4** 行、空态 **4** 行；`/tests/file` **2** 行。拆开看**全部是刻意不译的三类**：

| 残留 | 条数（两页合计） | 归类 |
|---|---|---|
| `中文`（切换控件 endonym） | 2/页 | ROW 4 的既定设计——英文页上它**必须**读「中文」，否则读不懂当前语言的人找不到自己的语言 |
| 台账**数据**（失败用例名 + 错误输出） | 2（有记录态） | 载体内容，`escapeHtml` 原样渲染，两种语言逐字相同 |
| `obsNote` 的标签 `已接入/暂无记录` | 1（空态） | **共享外壳**：6 个调用点、4 个页面文件（serve-architecture / serve-sessions ×3 / serve-tests ×2 / serve-system ×6）⇒ 属 ROW 9 级别的 chrome 行，不属本页 |
| reader 诊断串 `tests.reason` | 1（空态） | DATA（`observation.ts` 自己的诊断，与任务标题同类） |

**⇒「界面文案」类中文行 = 0。** 零计数对照：同一谓词对 zh 命中 **62 / 44 / 13**。

**AC2 改后（真实生产页，非 fixture）** —— 这是本任务最强的一条读数：本 worktree 起真实
`quay serve`，加载的是**仓库自己的** 1947 轮 / 449 个文件的台账：

```
/tests?lang=en        status=200 bytes=83108  textLines=510 cjkLines=2
/tests?lang=zh        status=200 bytes=81939  textLines=510 cjkLines=113
/tests/file?lang=en   status=200 bytes=57486  textLines=404 cjkLines=2
```
**en 的 2 条恰好就是两个切换控件 endonym（`中文` ×2）**，再无第三条；zh 113 条是对照
（谓词在真页上确实命中）。⛔ 与 fixture 读数不同，这一条**没有排除任何东西**——真实数据里一条
中文都没有漏进来。

**AC3 zh 零变化（逐字节）**：改前/改后各抓四组（有记录态·空态 × `/tests`·`/tests/file`），
把 fixture 临时目录名归一后 `diff`：
```
records-zh-tests:      0 changed line(s), 43711 vs 43711 bytes
empty-zh-tests:        0 changed line(s), 35392 vs 35392 bytes
records-zh-testsfile:  0 changed line(s), 37839 vs 37839 bytes
empty-zh-testsfile:    0 changed line(s), 35482 vs 35482 bytes
```
**四组原始 HTML 逐字节相同**（不只可见文本）——因为 zh 列是从运行中的代码里抽出来的，不是另写一份（ROW 7）。

**AC4 字典完备且被类型强制**：删掉 `TESTS_LABELS.pageSubtitle` 的 `zh` 列 ⇒
`tsc --noEmit` 报 `packages/quay/src/serve-i18n.ts:2356:3 - error TS2741: Property 'zh' is missing in type '{ en: string; }' but required in type '{ en: string; zh: string; }'`
（指向 `:2355` 的 `Record<TestsKey, {en,zh}>`）；恢复后 `tsc` 干净（exit 0）。
测试侧另有三层：键集闭合/两列非空/`en` 无 CJK/`zh` 已译或与 en 逐字同、未知键 throw、缺参数 throw、
以及**两列占位符名必须一致**（zh 列把 `{shown}` 写成 `{显示}` 会让 `fillLabel` 在渲染期对每个中文读者抛错）。

**AC5 共享组件传语言**：本页对 `renderTimelineBarSvg` 的**全部**调用点（`grep -rn 'renderTimelineBarSvg(' packages/quay/src/*.ts`）：
```
packages/quay/src/serve-dashboard.ts:193  export function renderTimelineBarSvg(        ← 定义（本体，本任务 ⛔ 不改）
packages/quay/src/serve-dashboard.ts:588  renderTimelineBarSvg(timelineSegments, hours, windowEndMs ?? nowMs, opts.lang)
packages/quay/src/serve-dashboard.ts:1232 renderTimelineBarSvg(segments, hours, windowEndMs ?? nowMs, opts.lang)
packages/quay/src/serve-tests.ts:331      renderTimelineBarSvg(buildTestsTimelineSegments(runs), hours, latestRoundEndMs(runs) ?? nowMs, lang)   ← 本页唯一调用点
```
包装函数 `renderTestsTimelineBar` 的唯一调用点：`packages/quay/src/serve-tests.ts:889`
`renderTestsTimelineBar(tests.runs, hours, Date.now(), lang)`。**两端都传 `lang`，无默认值兜底路径。**
黑盒读数：`?lang=zh` ⇒ `aria-label="过去 3 小时时间轴"`；默认 en ⇒ `aria-label="Timeline: the past 3 hours"`。

**AC6 因果对照**：把 `testsLabelsFor` 钳成恒返回 zh 列（`serve-i18n.ts:2491` 的 `// MUTANT`，
**先 grep 确认落盘**——dashboard 任务第一次尝试就因锚点写错而没落盘，那次绿读数无效）⇒
新测试 + `serve-handlers.test.mjs` 共 **14 条转红**（新文件 7 条：AC2 黑盒、空态、`/tests/file`、
AC3 对照、AC5 aria、数据逐字、字典解析；`serve-handlers` 7 条）；恢复后 **75/75 绿**。

**AC7 既有测试迁移**：Touches 内先跑 ⇒ 变红清单（**A/B 对照：同一命令在原始源码上全绿**，
不是猜的）：`serve-tests-zh-chrome.test.mjs` 2 条、`serve-ac95-views.test.mjs` 2 条、
`gap-webui-tests-page-timeline-gantt-truncated.test.mjs` 1 条。扩面到「所有可能受影响的测试」
（26 个候选文件：引用 `serve-tests` / `/tests` / 被移动文案）⇒ 再暴露 **17 条**，全在
`packages/quay/test/serve-handlers.test.mjs`（A/B 对照：原始源码 63/63 绿）。逐个迁移后：
- `node --test packages/quay/test/serve-*.test.mjs` ⇒ **391 tests / 390 pass / 0 fail**
- 26 个候选文件的合并跑 ⇒ **389 tests / 372 pass / 0 fail**（含上面 17 条）
- 新文件 `serve-tests-body-i18n.test.mjs` ⇒ **12/12 绿**
- `tsc --noEmit -p packages/quay` ⇒ 干净（exit 0）
- **scoped 门** `bash scripts/test.sh --for-task gap-webui-tests-body-copy-en-zh --allow-thin`
  ⇒ **209 tests / 209 pass / 0 fail，exit 0**（选择器选中 14 个测试文件，含全部被迁移的文件与新文件）

**`/dashboard` 不回归（A/B，硬读数）**：把两个源文件临时换回基线 `3663391bf` 的版本、各跑一次真实
serve，把**易变量**（监听端口、实时 cpu_stall/loadavg、`ts`）归一后比对：
```
dashboard-en:    IDENTICAL (md5 22f707b62f1c781eeb88a8869a057fa0)
dashboard-zh:    IDENTICAL (md5 d0d82146fefde23d47792e59a45647b7)
dashboard-cards: IDENTICAL (md5 13afc48a8d284790f2edfa63ccd845af)
```
⚠️ 第一次尝试这条时踩了一个坑并已纠正：`git stash push -- <两个文件>` 在**文件已提交、工作树干净**
时**什么也不建**，随后的 `git stash pop` 于是弹出了一个**别的层预先放着的 stash**（`goals/` 证据写），
制造了 22 个冲突文件。已 `git checkout -f HEAD -- goals/` 复原（**那个 stash 条目本身未被 drop，原样保留**），
随后改用「从基线 `git show` 取文件 + 显式拷回」的方式重做，读数如上。

**AC8 真实浏览器形态**：worktree 起真实 `quay serve --host 127.0.0.1 --port 14417`（加载的是本分支的
`serve-*.ts`，标题印证：en 下 `<title>` = `gap-webui-tests-body-copy-en-zh — Tests — verification rounds`），
headless Chrome（`google-chrome --headless=new`，1500×2600）截图：
- `/tmp/tests-i18n/shots/tests-en.png`（347008 B）：`Tests — verification rounds` / `Data source: …(one row appended per completed suite run, red and green alike)` / `Recent test-record timeline segments` / `Load curve (round #1947 · 22:50Z)` / `Test timeline (round #1947 · 22:50Z)` / `Legend: P product · M mechanism · multi-bucket · unresolved` / `Run history (new → old)` / `← latest`——**界面文案全英文**，仅余切换控件 endonym `中文`。
- `/tmp/tests-i18n/shots/tests-zh.png`（368291 B）：逐项与改前一致（`测试 — 验证轮记录` / `数据源：` / `最近测试记录分段时间轴` / `负载曲线` / `测试时间线` / `图例：P 产品 …` / `历史运行（新→旧）` / `← 最新`）。
⚠️ 任务体原写的端口 4322 实测**已被另一 worktree 的常驻 serve 占用**（`EADDRINUSE`；它服务的是
`gap-webui-board-body-copy-en-zh`），故改用 14417 并先核对 `<title>` 确认是自己的 worktree。
⛔ **未重启 :4173 常驻 serve**：它服务的是**共享主检出**，把未落地的 worktree 指过去会改掉其他层
正在读的工作区（且落地发生在 fan-in 之后）。落地后重启常驻 serve 属收尾步骤。

**观察项（不阻塞，⛔ 不是本任务引入的）**：zh 页上 `Page size:` / `Page 1 of 9 (449 rows)` /
`« Previous` / `Next »` 仍是英文——那是 `renderPagingNav` 的字面量，本任务与之前都未处理；
方向是「zh 下混英文」而非本任务的「en 下混中文」，且改前改后逐字节相同（AC3 已证），故仅登记。

## Touches

- tasks/gap-webui-tests-body-copy-en-zh.md
- packages/quay/src/serve-tests.ts
- packages/quay/src/serve-i18n.ts
- packages/quay/test/serve-tests-body-i18n.test.mjs (new)
- packages/quay/test/serve-tests-empty-state.test.mjs
- packages/quay/test/serve-ac95-views.test.mjs
- packages/quay/test/serve-tests-zh-chrome.test.mjs (补：本任务 re-key 了它钉的 `TITLE_TOKEN`)
- packages/quay/test/serve-handlers.test.mjs (补：17 条 /tests 断言改显式 zh)
- packages/quay/test/gap-webui-tests-page-timeline-gantt-truncated.test.mjs (补：AC5 的 gantt caption 断言)
