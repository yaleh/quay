---
id: gap-ac296-journal-page-zh-chrome-nav-current-and-own-title
title: "AC-296 缺口 —— /journal 页面的 zh 切换完全未接线：页头 lang、本页 <title> 与导航当前项在 cookie:
  lang=zh 下与 en 逐字相同"
status: done
labels:
  - gap
  - webui
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac288-webui-lang-switch-mechanism
  - gap-ac289-dashboard-zh-nav-label-and-own-title
goal_ac: AC-296
---
**type:** execution

## Proposal

**缺口（AC-296 判据，立案当轮直接量，`--dry-run` ⛔ 不写台账，2026-09-17T17:22:27Z，cwd = 主检出 `/home/yale/work/quay`）**：

```
node packages/quay/bin/quay.js goal gate AC-296 --dry-run --json
⇒ {"id":"AC-296","verdict":"fail",
   "reason":"acceptance failed (exit 1) — CAUSE=html-lang-not-zh -- /journal with Cookie: lang=zh did not respond <html lang=\"zh\"> (addr=127.0.0.1:4173)",
   "timestamp":"2026-09-17T17:22:27.161Z","dryRun":true, ...}
GATE_EXIT=1
```

**判据自己钉死了缺口位置**（硬规则 3b：它没有静默通过，而是打印了具名 `CAUSE=`）：它**已经走过**前三段检查 ——
从运行中的实例取到了地址、en 响应非空、en 的 nav 区块**确实含字面量 `Journal`**、en 响应**有 `<title>`** ——
**fail 在第一段 zh 检查**：`Cookie: lang=zh` 没有让响应变成 `<html lang="zh">`。

**「无任务推进」的直接量（⛔ 不是关键词扫描；含硬规则 2 的两半 —— 非零查命中的是不是我要的、零查谓词对真样本干跑）**：

```
grep -rn '^goal_ac: AC-296' tasks/*.md   ⇒ 0 命中
grep -rn '^goal_ac: AC-295' tasks/*.md   ⇒ 1 命中（tasks/gap-ac295-needs-human-page-zh-chrome-nav-current-and-own-title.md）
                                            ↑ 已知为真的对照样本，证明该谓词本身可用，不是恒零
grep -rln 'AC-296'          tasks/*.md   ⇒ 1 命中：tasks/gap-ac291-live-page-zh-chrome-nav-current-and-own-title.md
                                            ↑ 唯一一处是**正文里的交接说明**（「不改 `serve-live.ts:162-164` 的
                                              `/journal` 页面…属 AC-296」），⛔ 不是本判据的任务
```

### 现状：`/journal` 的 zh 面**一处都没有接线**（两条互相独立的读数）

**读数 ①（live 面，同一 URL 两种请求头，响应逐字节相同）**：

```
curl -sf                      http://127.0.0.1:4173/journal  ⇒ 66781 bytes, <html lang="en", <title>quay — Journal — recent loop record</title>
curl -sf -H 'Cookie: lang=zh' http://127.0.0.1:4173/journal  ⇒ 66781 bytes, <html lang="en", <title>quay — Journal — recent loop record</title>
cmp -s <(两份响应体)  ⇒ IDENTICAL (byte-for-byte)
```

⛔ 不是「翻了但翻得不对」——是**连页头 `lang` 属性都没动**：两份响应体**字节数相同**。

**读数 ②（源码侧按位置枚举）** —— `/journal` 外壳（`renderJournalPage`）的断言点：

| 位置 | 字面量 | 归属 |
|---|---|---|
| `serve-live.ts:160` | `function renderJournalPage(journal, identity = null)` | **签名里没有 `lang` 参数位** |
| `serve-live.ts:162` | `<html lang="en">` | 页头 lang 属性（AC-296 的**第一段**断言） |
| `serve-live.ts:162` | `<title>${pageTitle("Journal — recent loop record", identity)}</title>` | 本页自己的 `<title>`（**第四段**断言；字面量 `Journal` 的来源之一） |
| `serve-live.ts:163` | `renderMobileChrome("journal", "journal")` | 移动端 chrome（nav 当前项的**移动端**那处） |
| `serve-live.ts:163` | `renderSiteNav("journal")` | nav 条（**当前项** `Journal` 的桌面来源） |
| `serve-live.ts:164` | `<h1>Journal — 循环最近记录</h1>` | 本页 `<h1>`（判据不查它，但属 GOAL-024 的「本页 chrome」） |
| `serve-live.ts:212` | `res.end(renderJournalPage(journal, cfg.identity))` | **handler 已经拿到 `cfg.lang` 却丢掉了**（见下） |

**字面量 `Journal` 在默认语言 `/journal` 响应里的全量枚举**（`tr '<' '\n<' | grep -n 'Journal'` ⇒ **恰好 4 条**，
`grep -o | wc -l` 复核同为 4；**全部是 chrome，零条来自数据**）：

```
653:title>quay — Journal — recent loop record
720:span class="mobile-menu-item nav-current" aria-current="page">Journal
779:span class="nav-item nav-current" aria-current="page">Journal
804:h1>Journal — 循环最近记录
```

第 2、3 条同出于 `serve-render.ts` 的 `SITE_NAV_GROUPS` → `navItem`；第 1 条出自 `pageTitle`；第 4 条是 `:164` 硬编码。
**判据的作用域（实测）**：它对 `/journal` 只在 **nav 区块**（`grep -o '<nav.*</nav>'`，实测 **2428 字节** =
移动端菜单 + 桌面 nav 两个 `<nav>`，其内字面量 `Journal` 出现 **2 次**，`grep -o | wc -l` 计数）与
**本页 `<title>`** 上断言。
⚠️ **与本族另两条判据不同的一处风险，如实记下**：`/journal` 的**正文**渲染 `git log`（`renderSectionBlock(journal.commits, …)`）
⇒ 提交信息**会进页面正文**。但判据对正文零断言，且 `<nav>…</nav>` 的贪婪匹配区间在 `<main>` 之前闭合
（实测 nav 区块 2428 B，⛔ 不含正文）⇒ **本判据没有被数据命中打死的风险**，与 `/board`（CSS 注释含 Board）、
`/dashboard`（卡体渲任务 title）那两条不同。

### 机制前提（实测读数，⛔ 不是推测）——**本任务的真正难点：本页的 `<title>` 不会「顺带」被翻**

- **AC-288（`gap-ac288-webui-lang-switch-mechanism`）已 done 且已落 develop**：
  `git cat-file -e develop:packages/quay/src/serve-lang.ts` ⇒ exit 0；语言**每请求解析一次**，在
  `serve-handlers.ts:86` 组装成 `reqCfg: ServePageCfg = { ...cfg, lang }`，并在 `:224-227`
  `if (url.pathname === "/journal") { await handleJournal(req, res, reqCfg); return; }` 把它交给本页 handler。
  ⇒ **`handleJournal` 现在【已经拿到】`cfg.lang`，只是丢掉了**：`serve-live.ts:212` 是
  `res.end(renderJournalPage(journal, cfg.identity))` —— 第二个参数位之后没有 lang。
- **AC-289（`gap-ac289-dashboard-zh-nav-label-and-own-title`）status=done，已落 develop（`27b2eab81`）**，
  其产物 `packages/quay/src/serve-i18n.ts` **在 develop 上**（`git cat-file -e develop:packages/quay/src/serve-i18n.ts` ⇒ exit 0）。
  该文件已给出：
  - `NAV_LABELS` **15 条全给**，其中 **`journal: { en: "Journal", zh: "日志" }`**（`serve-i18n.ts:60`）
    ⇒ **nav 当前项那两处本任务不需要新词**；
  - `renderSiteNav(current, lang = DEFAULT_LANG)`（`serve-render.ts:878`）/
    `renderMobileChrome(current, pageLabel, lang = DEFAULT_LANG)`（`:908`）/
    `pageTitle(pageName, id, lang = DEFAULT_LANG)`（`:1079`，内部走 `pageNameFor`）/
    `pageNameFor(pageName, lang = DEFAULT_LANG)`（`serve-i18n.ts:103`）—— 默认参数即作用域手段；
  - **`PAGE_LABELS` 只登记了 `Dashboard` 一条**（`serve-i18n.ts:96-98`），且它的契约 ROW 3 逐字写明：
    「only /dashboard is wired here, because that is AC-289's scope; **the other 14 pages' page-chrome is AC-290~303**」。
- **AC-289 已给出的接线模板**（`serve-dashboard.ts:1307-1309`，照抄即可）：
  `${htmlLangTag(opts.lang)}<head>…<title>${pageTitle("Dashboard", opts.identity, opts.lang)}</title></head>`
  ＋ `<body>${renderMobileChrome("dashboard", "dashboard", opts.lang)}${renderSiteNav("dashboard", opts.lang)}`
  ＋ `<h1>${pageNameFor("Dashboard", opts.lang)}</h1>`，handler 侧传 `lang: cfg.lang`。
- ⇒ **本任务的核心工作量正是这一条**：`pageNameFor` 对**未登记的 token 在 zh 下原样返回英文**
  （ROW 3：a VISIBLE degradation，不是空白）⇒ 若只把 `renderSiteNav("journal", lang)` 接上，
  **nav 会翻、本页 `<title>` 仍是 `Journal — recent loop record`** ⇒ 判据**仍红**在 `CAUSE=title-unchanged`
  （那正是判据存在的意义：**「只有共享导航条变了」不算**）。

**⚠️ 本任务自己会踩的第一个陷阱（当场记下，⛔ 不是事后补充）**：`pageTitle` 收到的是**整串**
`"Journal — recent loop record"`（含空格与 U+2014 EM DASH），而 `PAGE_LABELS` 是**按这个 token 精确查表**的。
⇒ **若只登记 `"Journal"` 一个键，`pageNameFor("Journal — recent loop record", "zh")` 仍原样返回英文**，
判据红在 `title-unchanged`。**登记键必须与传给 `pageTitle` 的 token 逐字相等**（或改调用点把 `pageTitle` 的入参
换成已登记的词）。

### 作用域与交叠（如实记录，⛔ 不含任何前置声明；机械的依赖边在顶层）

- 本任务只做**这一页**的接线：**新建本页页码词条 + 本页调用点传 lang**。⛔ **不改** `NAV_LABELS`
  （AC-289 的 15 行契约，`journal` 行已存在且 `zh: "日志"`）、⛔ **不重写**四个共享渲染函数（AC-289 的产物）、
  ⛔ **不改** `serve-live.ts:149-157` 的 `/live` 页面（另一个 nav 路由，属 AC-291）。
- ⚠️ **同文件交叠（机制化，⛔ 不靠文风串行）**：`gap-ac291-live-page-zh-chrome-nav-current-and-own-title`
  **status=ready（在飞）**，其 `Touches` 同时声明 `packages/quay/src/serve-live.ts` 与 `packages/quay/src/serve-i18n.ts`
  ⇒ **派发器按 Touches 串行，本任务不会与它并发**。同理 `gap-ac290/292/293/294/295` 也各占 `serve-i18n.ts`。
  ⇒ 本任务**不**额外声明 `depends_on` 指向它们（那是同文件串行，不是逻辑前置）；
  `depends_on` 只指向两个**已 done** 的机制前置（AC-288 的解析器 + AC-289 的字典/模板）。
- ⚠️ **一处上游测试耦合的实测核对（⛔ 不假定，已查）**：`packages/quay/test/serve-i18n.test.mjs:129` 用
  **`Tasks`** 作「未映射 token 在 zh 下原样返回」的样本（`assert.equal(pageNameFor("Tasks","zh"), "Tasks")`）。
  **本任务不映射 `Tasks`**（也不映射 `Dashboard`）⇒ **该断言不受本页词条影响，⛔ 本任务不改那个测试文件**
  （`gap-ac290` 因要映射 `Tasks` 而声明了它，那是**它**的 delta）。
  ⇒ 实现时若它**因本页词条**变红，那是新信息，**当场把它加进 Touches 并在任务体记下**，⛔ 不静默绕过。

## Plan

1. **红基线**（⛔ 不假定仍等于立案值）：`node packages/quay/bin/quay.js goal gate AC-296 --dry-run --json; echo "GATE_EXIT=$?"`，
   贴完整输出与具名 `CAUSE=`（判据的所有者可能已改动它）。
2. **确认前置已落地 + 读【实际】签名**：`git cat-file -e develop:packages/quay/src/serve-i18n.ts`、
   `grep -n 'export function renderSiteNav\|export function renderMobileChrome\|export function pageTitle\|export function pageNameFor\|htmlLangTag' packages/quay/src/serve-render.ts packages/quay/src/serve-i18n.ts packages/quay/src/serve-lang.ts`。
   **⛔ 不按本任务 Plan 预写的签名假设**：以 AC-288/AC-289 落地后的**实际**参数位为准；任一无命中 ⇒ **停下报缺**。
3. **接线 `serve-live.ts`（仅 `/journal` 一处页面函数）**：`renderJournalPage(journal, identity, lang = DEFAULT_LANG)`；
   `:162` 的 `<html lang="en">` 改为 `${htmlLangTag(lang)}`、`<title>` 把 lang 传给 `pageTitle`；
   `:163` 的 `renderMobileChrome` / `renderSiteNav` 传 lang；`:164` 的 `<h1>` 取页码词条；`:212` 传 `cfg.lang`。
   ⛔ **`renderLivePage`（`:149-157`）一行不动**（AC-291 的页面，status=ready 在飞）。
4. **在 `serve-i18n.ts` 的 `PAGE_LABELS` 只追加 `/journal` 的本页词条**：
   **登记键必须与 `pageTitle` 收到的 token 逐字相等**（默认即 `"Journal — recent loop record"`，含 U+2014）。
   zh 值必须非空、⛔ **不含 ASCII 字面量 `Journal`**（否则是本判据的 gate-gameability 形态：值「看着翻了」
   而 nav/标题断言仍可能红）、⛔ 不得回落英文。**⛔ 不碰 `NAV_LABELS`、不碰它的契约注释行。**
   `en` 列必须是**逐字身份**（`pageNameFor` 对 `en` 直接返回原 token ⇒ en 基线**按构造成立**，⛔ 不要靠自觉）。
5. ⛔ **不碰 `/live`**（`serve-live.ts:149-157`）：它不是本判据的路由，也不是本任务的页面（属 AC-291）。
6. **测试**：新建 `packages/quay/test/serve-journal-zh-chrome.test.mjs`（头注释 `// @test-group product`；黑盒：
   真 workspace（`.quay/config.yml` + native provider）+ `startServer({ port: 0 })`；nav 区块用**判据同一手法**抽出
   —— `body.replace(/\n/g," ")` 后 `/<nav.*<\/nav>/`，让测试与判据不会在「nav 区块是什么」上漂移）。
   断言 zh 下 ① 含 `<html lang="zh"` ② nav 当前项**两处**文本都不是 `Journal` ③ 本页 `<title>` 与 en 逐字不同；
   **外加 en 负控制：en 响应与今天的基线逐字相同**（没有这条对照，②③ 可能由别的改动满足）。
   ⚠️ 用 `port: 0` 让内核选端口，⛔ 不自己探端口——端口冲突会让 provider 子进程泄漏并**挂住整个套件**。
7. **构建产物**：`npm run build -w quay`（新接线未进 bundle 会让 dist 类测试假红）。
8. **重启活实例**：AC-296 的探针从**已在运行**的 `quay.ts serve`（cwd = 仓库根）派生地址，⛔ 不自己启服务
   ⇒ 实现落地后**必须重启该实例**，否则判据读的是旧代码（陈旧实例会把「没生效」伪装成「实现没做」）。
   ⚠️ **本机实测的第二个形态**：探针按 `pgrep -f 'quay.ts serve'` + `/proc/$p/cwd` == 仓库根 **取首个匹配**
   ⇒ 若同时存在多个 cwd=仓库根的实例，**旧的那个可能被选中**；重启后须核对 `--host/--port` 与你在跑的实例一致。
9. **收口**：红/绿两条读数 + 因果对照 + 全量残留枚举 + scoped 门绿。

## AC

- [x] **AC1（live 面判别性读数：四处各自独立断言）**：在**运行中的** `quay.ts serve`（cwd = 仓库根）上，
  `curl -H 'Cookie: lang=zh' http://$addr/journal` 的响应**分别**满足：① 含 `<html lang="zh"`；
  ② nav 当前项**两处**（桌面 `class="nav-item nav-current"` 与移动 `class="mobile-menu-item nav-current"`）
  的文本都**不是** `Journal`；③ 该页**自己的** `<title>` 与 en 基线**逐字不同**（并排贴 en/zh 两条 `<title>`）；
  ④ **en 基线逐字未变**：默认语言 `/journal` 响应体与立案基线（66781 B、四条 `Journal` 命中、nav 区块 2428 B）
  同口径对照。⛔ 四处分开断言、分开贴原始片段——只报「整页看起来翻了」不算（硬规则 3：枚举不是布尔）。
- [x] **AC2（可被打红——因果对照）**：把语言解析结果**临时**钳到 `"en"`（一次性本地改动，⛔ 不提交），
  证明 AC1 的 ②/③ 变红；还原后复绿。**两次读数并排贴出**。**再加更窄的一次对照**：只把语言**钳在字典入口**
  （`pageNameFor` / `navLabelsFor` 首行强制 `en`，AC-288 的机制原封不动）⇒ `<html lang>` 仍为 `zh` 而 nav/标题变红，
  判据自报的 `CAUSE=` 必须是 `nav-label-untranslated`（⛔ 不是 `html-lang-not-zh`）——**这一条才把成因单独钉在字典接线上**
  （硬规则 4 推论四：一个能解释现象的说法不是一个被检验的结论）。
- [x] **AC3（全量残留枚举 + 逐条归属，⛔ 不报「零」）**：对 zh 响应跑 `tr '<' '\n<' | grep -n 'Journal'`，
  把**每一条**命中的 HTML 片段与它的**产生源**贴出（chrome 出自哪一行源码 / 数据出自哪个 `tasks/*.md` 或哪条提交信息），
  并给出 **chrome 计数**与**数据计数**两个数。⛔ 禁止只报一个总数（硬规则 3）。
  **判别性证法（⛔ 不是「数出来是 0」）**：同一个谓词在 **en** 响应上必须命中（nav 区块内 `Journal` **2 次**）。
- [x] **AC4（判据裁决原样记录）**：贴出**实现后**的 `node packages/quay/bin/quay.js goal gate AC-296 --dry-run --json`
  完整输出 + `GATE_EXIT=`（⛔ 不解释、不改写它的 `CAUSE`）。**红就是红**：若仍红，把它具名 `CAUSE` 与 AC3 的归属一并交出。
  ⛔ **明令禁止**的三种「凑绿」：改判据（`goals/AC-296-*.md` ⛔ 不在本 Touches 内）、改别的任务的 title、
  把 zh 值写成含英文 `Journal` 的混合串。
- [x] **AC5（不回归 + 作用域枚举）**：① `bash scripts/test.sh --for-task gap-ac296-journal-page-zh-chrome-nav-current-and-own-title` 绿；
  ② `node --test packages/quay/test/serve-*.test.mjs` 绿；③ **作用域举证**：
  `git diff --name-only develop...HEAD` **逐条**贴出，证明只有本任务 Touches 里的路径被动过
  （⛔ 其余 12 个 `serve-*.ts` 的硬编码标签点一字未改）；④ `grep -rc 'html lang="en"' packages/quay/src/*.ts`
  **逐文件**贴出并与立案基线对照（**总数 22**，`serve-live.ts` **2** = `:150` 的 `/live` ＋ `:162` 的 `/journal`）：
  本任务后 **`serve-live.ts` 2→1**（留下的那 1 处是 `:150` 的 `/live`，出作用域）。
  ⚠️ **本项与 AC-291 同文件、互为镜像**：谁先落地谁的减量先出现；`gap-ac291`（ready 在飞）落地会让 `:150` 那处先减 1
  ⇒ 本条的判据是**逐文件差量 + 归属**，⛔ 不是「总数必须等于 21」，且**不得把 AC-291 的减量记到自己账上**。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「多了一个 lang 参数、单测绿了」，而是
**一个真实的 `quay serve` 进程在真实 HTTP 上，对同一个 URL 按请求头给出了两种语言的页面外壳**：

1. **落地对象**：运行中的实例上，`/journal` 在 `Cookie: lang=zh` 下页头 lang、本页 `<title>`、nav 当前项**都**变，
   且 en 基线逐字未变 —— **从响应体直读**（⛔ 不读 render 函数的返回值当「响应」，那测的是函数，不是线上行为）。
2. **可被打红**：AC2 的两次钳制对照**实际跑过**并贴上读数 ⇒ 证明这条判据不是结构上恒绿（硬规则 4）。
3. **判据裁决诚实**：AC4 的判据输出原样贴出，**红就是红**；⛔ 不用任何改写数据或改写字典值的方式把它变成绿。
4. **作用域**：AC5 的逐文件计数 + `--name-only`，证明 `/live` 与其余 12 个文件未被顺手改掉。
5. **可回滚**：写明回滚形态（还原 `serve-live.ts` 的接线 + 删除 `serve-i18n.ts` 的本页词条
   + 重跑 `npm run build -w quay` + 重启实例）与它的作用域（纯本地代码、无外部状态）。
6. **证据留痕**：红/绿判据输出、en/zh 两条原始响应片段、因果对照两次读数、全量残留枚举、逐文件计数，
   落成**任务体内联**或**未跟踪** scratch 文件，可被下一轮独立复算（⛔ 不是只写一句「已修好」）。

## Touches

- tasks/gap-ac296-journal-page-zh-chrome-nav-current-and-own-title.md
- packages/quay/src/serve-live.ts
- packages/quay/src/serve-i18n.ts
- packages/quay/test/serve-live-zh-chrome.test.mjs
- packages/quay/test/serve-journal-zh-chrome.test.mjs (new)

（说明：`packages/quay/src/serve-lang.ts` 属 AC-288 的产物、四个共享渲染函数与 `NAV_LABELS` 属 AC-289 的产物，
⛔ 均不在本 Touches 的**改动**意图内（`serve-i18n.ts` 只追加本页 `PAGE_LABELS` 词条）；
`packages/quay/test/serve-i18n.test.mjs` **刻意不声明**——它的「未映射 token」样本是 `Tasks`，本任务不映射它，
故无 delta（Plan step 2 已实测核对；若实现时它因本页词条变红，则**当场**加进 Touches 并在任务体记下）。
`goals/AC-296-*.md` 属人与驱动维护面，⛔ 不在本 Touches。运行时证据若落 `.quay/` 则**保持未跟踪**，故不声明
——`anti-drift-touches-check` 只比对已跟踪文件。）

## Evidence

全部读数在**本任务 worktree** 内取得；实现提交 `754c6a389`（分支 `task/gap-ac296-journal-page-zh-chrome-nav-current-and-own-title`）。

### 0. 探针的落点（先记，因为它决定了后面每一条读数的取法）

判据探针取 `root=$(git rev-parse --show-toplevel)`，再找 **cwd == root** 的 `quay.ts serve` 进程。⇒ **从 worktree 调用判据时，root = 本 worktree**；主检出那个常驻实例（cwd=`/home/yale/work/quay`、port 4173）**不在探针的候选集里**，而且它跑的是**未落地的旧代码**（本任务的实现在任务分支上）。⇒ 正确做法是**在 worktree 内起一个 cwd=worktree 的实例（port 4174）**，并从 worktree 调用判据 —— 这样判据读到的**就是本次实现**。⛔ 不是「自己启服务来让判据变绿」：判据只读 alive 实例的 HTTP 响应，实例由谁先起不影响它读到什么；红基线也是**同一个实例、改前改后各取一次**（比引用立案值更强，Plan step 1 要求的正是这个）。

### 1. 红基线（AC4 的前半；改前，同一实例 port 4174）

```
git checkout HEAD~1 -- packages/quay/src/serve-live.ts packages/quay/src/serve-i18n.ts && npm run build -w quay
node packages/quay/bin/quay.js goal gate AC-296 --dry-run --json
⇒ {"id":"AC-296","verdict":"fail",
   "reason":"acceptance failed (exit 1) — CAUSE=html-lang-not-zh -- /journal with Cookie: lang=zh did not respond <html lang=\"zh\"> (addr=127.0.0.1:4174)",
   "timestamp":"2026-09-17T19:35:01.208Z","dryRun":true, ...}
GATE_EXIT=1
```
同刻 en / zh 两份响应体：`57167 B` vs `57167 B`，`sha256` 前 16 位同为 `3c3b31aeca4826b1` ⇒ **逐字节相同**（⛔ 不是「翻得不对」，是这一页的 lang 属性根本没动）。

### 2. AC1 —— live 面四处【各自独立】的断言（实现后，port 4174）

```
(1) <html lang>          en: <html lang="en"        zh: <html lang="zh"
(2) nav 当前项（桌面）   en: <span class="nav-item nav-current" aria-current="page">Journal</span>
                         zh: <span class="nav-item nav-current" aria-current="page">日志</span>
    nav 当前项（移动）   en: <span class="mobile-menu-item nav-current" aria-current="page">Journal</span>
                         zh: <span class="mobile-menu-item nav-current" aria-current="page">日志</span>
(3) 本页自己的 <title>   en: <title>gap-ac296-journal-page…47d402e0 — Journal — recent loop record</title>
                         zh: <title>gap-ac296-journal-page…47d402e0 — 日志 — 循环最近记录</title>
(4) en 基线（与 §1 的改前同一实例同口径对照）
    改前 en: 57167 B  sha=3c3b31aeca4826b1
    改后 en: 57167 B  sha=3c3b31aeca4826b1   ⇒ BYTE-IDENTICAL
    nav 区块：en 2427 B / zh 2439 B
```
`<h1>`（判据不查，属 GOAL-024 的「本页 chrome」）：en `Journal — 循环最近记录` → zh `日志 — 循环最近记录`。

⚠️ **与立案基线（66781 B / nav 2428 B）的绝对值不同，如实记下**：立案读数在主检出实例上取（不同 workspace ⇒ 不同 `git log`、不同 `tick-log.md`，且其间过了一天）。**真正同口径的那条**是 §1 vs §2(4) 的**同一实例改前/改后**对照，它逐字节相同 ⇒ 「en 未动」这一条成立；绝对值差异只是 workspace 不同，⛔ 不当作「en 变了」。

### 3. AC2 —— 两次因果对照（都实际跑过并留下读数）

**Control-D（宽：把语言解析结果钳到 `en`）** —— `serve-handlers.ts` 的 `resolveLang` 结果被覆盖为 `"en"`（一次性本地改动，**已还原、未提交**）：
```
zh 请求下：html lang = <html lang="en" ；nav 当前项 = "Journal" ；title = "… — Journal — recent loop record"
gate ⇒ GATE_EXIT=1  verdict=fail  CAUSE=html-lang-not-zh      ← 判据的【第一段】zh 检查先红
```

**Control-C（窄：只把字典入口钳到 `en`，AC-288 的机制原封不动）** —— `serve-i18n.ts` 的 `navLabelsFor` / `pageNameFor` 首行强制 `lang = "en"`（同样**已还原、未提交**）：
```
zh 请求下：html lang = <html lang="zh"      ← 解析器没动，仍然是 zh
          nav 当前项 = <span class="nav-item nav-current" aria-current="page">Journal</span>
          title      = <title>… — Journal — recent loop record</title>
gate ⇒ GATE_EXIT=1  verdict=fail  CAUSE=nav-label-untranslated   ← ⛔ 不是 html-lang-not-zh
```
⇒ **判别性预测成立**：宽钳 → `html-lang-not-zh`；窄钳（只动字典）→ `nav-label-untranslated`。**这一条才把成因单独钉在「字典接线」上**（硬规则 4 推论四：一个能解释现象的说法不是被检验的结论；两个假设给出**相反**的预测，实测与之相符）。

**还原后复绿**：`git checkout HEAD -- packages/quay/src/{serve-i18n,serve-handlers}.ts` + 重建 + 重启 ⇒ `verdict: "pass"`、`GATE_EXIT=0`。两次还原后 `git status --porcelain` 只剩未跟踪的 `.quay/` 证据文件 ⇒ **两次钳制都没有进入任何提交**。

### 4. AC3 —— zh 响应的全量残留枚举（+ 判别性证法）

谓词 `tr '<' '\n<' | grep -n 'Journal'`（判据与测试同用的一手）：

```
zh 响应命中：0 条
en 响应命中：4 条（同一谓词，判别性证法所需的正样本）
  653:title>gap-ac296-journal-page…47d402e0 — Journal — recent loop record
  720:span class="mobile-menu-item nav-current" aria-current="page">Journal
  779:span class="nav-item nav-current" aria-current="page">Journal
  804:h1>Journal — 循环最近记录
  en nav 区块内 'Journal' 出现 2 次  ← 判据要求的判别性读数
```
**两个数**：en `chrome=4 / data=0`；zh `chrome=0 / data=0`。逐条归属（全部是 chrome，零条来自数据）：
`653` ← `serve-live.ts` 的 `pageTitle("Journal — recent loop record")`；`720` ← `serve-render.ts` `renderMobileMenu`→`navItem` 取 `NAV_LABELS.journal.en`；`779` ← 同上的桌面 `renderSiteNav`→`navItem`；`804` ← `serve-live.ts` 硬编码的 `<h1>`。

⚠️ **零计数的配套动作（硬规则 2 的另一半）**：`0` 只有在谓词对真样本会命中时才算读数 ⇒ 已在 **en** 上干跑（4 命中，nav 内 2 次）。另核**数据段确实非空**（`/journal` 正文渲 20 条 commit），故 zh 的 `data=0` 是**对一个非空集合的测量**，不是空段造成的恒零。补记：commit 主题与本页身份前缀用的是**小写** `journal`，不匹配本谓词（大小写敏感）—— 这是「数据命中为 0」的直接原因，诚实登记。

### 5. AC4 —— 判据裁决原样记录（实现后）

```
node packages/quay/bin/quay.js goal gate AC-296 --dry-run --json      （cwd = worktree 根）
⇒ {"id":"AC-296","verdict":"pass","reason":"acceptance passed (exit 0)",
   "timestamp":"2026-09-17T19:35:55.275Z","dryRun":true,
   "event":{"id":"dfdc0218-5f4e-4977-b604-e7c3abfd1474","item_id":"AC-296","pipeline_id":"AC-296",
            "gate":"goal","actor":"goal-cli", ...}}
GATE_EXIT=0
```
⛔ 未做三种「凑绿」中的任何一种：判据文件 `goals/AC-296-*` 一字未动（不在本 Touches 内）、未改任何别的任务 title、zh 值不含 ASCII `Journal`（`日志 — 循环最近记录` / `日志`）。

### 6. AC5 —— 不回归 + 作用域

```
① bash scripts/test.sh --for-task gap-ac296-…（**AC5① 的逐字形态，⛔ 不带 `--allow-thin`**）⇒ **EXIT=0**；
   98 tests / 98 pass / 0 fail，**无 thin-selection 提示**（⇒ 选择器不 thin；`--allow-thin` 形态同形同结果 98/98/0）。
   （本任务的 4 条测试都在被选中的集合里跑过：AC-dict ✔ / AC-black-box ✔ / AC-en-baseline ✔ / AC-scope ✔；
    另有一条 AC-291 文件里被本任务改写的 `AC-black-box: /journal is ALSO wired` ✔ —— 见 §7。
    ⚠️ 收尾前先跑过一次 94 tests 的 scoped 门，那次 `## Touches` 尚未扩到 AC-291 的测试文件；
    扩了之后选择集变大 ⇒ 以 98 为准。）
② node --test packages/quay/test/serve-*.test.mjs             ⇒ 222 tests / 221 pass / 1 skipped / 0 fail
③ git diff --name-only develop...HEAD
   packages/quay/src/serve-i18n.ts
   packages/quay/src/serve-live.ts
   packages/quay/test/serve-journal-zh-chrome.test.mjs
   packages/quay/test/serve-live-zh-chrome.test.mjs      ← 见 §7「同文件交叠」新增申报
④ grep -rc 'html lang="en"' packages/quay/src/*.ts（逐文件，仅列非零）
   serve-doc 2 · serve-git 2 · serve-goal 2 · serve-adr 2 · serve-tests 2 · serve-sessions 2
   serve-needs-human 1 · serve-task 1 · serve-architecture 1 · serve-send 1
   TOTAL 16（develop 上为 17）；serve-live.ts **1 → 0**
```
⚠️ **立案值已移动，如实记**：AC5④ 预写「总数 22、`serve-live.ts` 2→1（留下 `:150` 的 `/live`）」。实际 develop 上已是 **17**、`serve-live.ts` 已是 **1** —— 因为 **AC-291（`/live`，同一文件）在本任务 fork 之前已落 develop**（`575786189`），`/live` 那处硬编码属性早已被它去掉。⇒ 本任务使 `serve-live.ts` **1→0**、总数 **17→16**。⛔ **未把 AC-291 的减量记到自己账上**；本任务的减量恰好是 1（`:171` 的 `/journal` 那一处）。其余 12 个 `serve-*.ts` 的硬编码标签点**一字未改**（逐文件计数与 develop 逐条相同 ⇒ 作用域成立）。

### 7. 同文件交叠：一处任务体未预见、当场发现并申报的扩展

`packages/quay/test/serve-live-zh-chrome.test.mjs`（**AC-291 的测试文件**）里有一条 AC-scope 断言，逐字写着 `/journal is untouched by this task … /journal's own <title> is unchanged`，并预期 zh 下仍是 ` — Journal — recent loop record`。**本任务把 `/journal` 接上 zh 之后这条断言必然变红** —— 它不是别的任务的缺陷，是本任务实现的**直接后果**。
⇒ 当场按任务体 Plan 的纪律处理：**把它加进 `## Touches`**（本次写入）**并改写那条断言到镜像面** —— 现在断言「`serve-live.ts` 的两个路由**都**已接线，谁都没被落下」（读 `/journal` 的 zh `<title>` 已译为 `日志 — 循环最近记录`）。这与 AC-294 落地时改写 AC-293 的 `serve-system.test.mjs` 的 AC-scope 层是同一处置。
（任务体 Plan step 2 已实测核对过的 `packages/quay/test/serve-i18n.test.mjs:129` 用 `Tasks` 作未映射样本 —— 本任务不映射 `Tasks`，**实测其不受影响**，故仍不申报，与预判一致。）

### 8. DoD 逐条

1. **落地对象**：运行中的实例（port 4174，cwd=worktree）上 `/journal` 在 `Cookie: lang=zh` 下页头 lang、本页 `<title>`、nav 当前项（桌面+移动）**都变**，en 基线逐字节未变（§2）。**全部从 HTTP 响应体直读**，⛔ 未把 `renderJournalPage` 的返回值当「响应」。附：单测 `serve-journal-zh-chrome.test.mjs` 用**真 `startServer` + raw HTTP** 再断言一遍同一组事实。
2. **可被打红**：§3 两次钳制对照实际跑过并贴上读数（宽 → `html-lang-not-zh`；窄 → `nav-label-untranslated`）⇒ 判据不是结构上恒绿。
3. **判据裁决诚实**：§5 原样贴出；`/journal` 现在是 **pass**，且 pass 来自判据自身的四段检查全过，⛔ 未改写任何数据或字典值。
4. **作用域**：§6③ 逐条 `--name-only` + §6④ 逐文件计数证明 `/live`（AC-291）与其余 12 个文件未被顺手改掉。
5. **可回滚**：还原 `serve-live.ts` 的接线（`renderJournalPage` 的 `lang` 形参、`htmlLangTag(lang)`、`pageTitle(..., lang)`、`renderMobileNav`/`renderSiteNav` 的 `lang`、`<h1>` 的 `pageNameFor`、handler 传 `cfg.lang`）+ 删除 `serve-i18n.ts` 的两条本页词条 + `npm run build -w quay` + 重启实例。**作用域 = 纯本地代码（两个源文件）、无外部状态、无 schema/迁移**；`git revert 754c6a389` 即完成（测试文件那条镜像断言会随之回到 AC-291 的原始形态，需一并 revert，它与实现同属一个提交）。
6. **证据留痕**：本节内联全部读数；原始载体另存**未跟踪**文件：`.quay/ac296-evidence-*.txt`、`.quay/ac296-serve-ctl.sh`（实例起停）、`.quay/ac296-build-body.mjs`（正文构造 + 往返断言）、`/tmp/ac296-{en,zh}-*.html`、`/tmp/ac296-gate-*.json`。

### 9. 落地形态（供下一轮独立复算）

实现 = 一个提交 `754c6a389`，4 个文件（§6③）。**判据的 green 是「运行中实例 + Cookie 头」的读数，不是源码 grep**；下一轮复算只需：worktree 内 `npm run build -w quay` → 起 cwd=worktree 的 serve → `node packages/quay/bin/quay.js goal gate AC-296 --dry-run --json`（cwd=worktree）。
