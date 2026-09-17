---
id: gap-ac297-git-history-page-zh-chrome-nav-current-and-own-title
title: "AC-297 缺口 —— /git-history 页面的 zh 切换完全未接线：页头 lang、本页 &lt;title&gt;
  与导航当前项在 cookie: lang=zh 下与 en 逐字节相同"
status: todo
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
goal_ac: AC-297
---
**type:** execution

## Proposal

**缺口（AC-297 判据，立案当轮直接量，`--dry-run` ⛔ 不写台账，2026-09-17T17:45:07Z，cwd = 主检出 `/home/yale/work/quay`）**：

```
node packages/quay/bin/quay.js goal gate AC-297 --dry-run --json
⇒ {"id":"AC-297","verdict":"fail",
   "reason":"acceptance failed (exit 1) — CAUSE=html-lang-not-zh -- /git-history with Cookie: lang=zh did not respond <html lang=\"zh\"> (addr=127.0.0.1:4173)",
   "timestamp":"2026-09-17T17:45:07.488Z","dryRun":true, ...}
```

判据自己钉死了缺口位置（硬规则 3b：它没有静默通过，而是打印了具名 `CAUSE=`）：它**已经走过**前三段检查 —— 从运行中的实例取到地址、en 响应非空、**en 的 nav 区块确实含字面量 `Git History`**、en 响应有 `<title>` —— **fail 在第一段 zh 检查**：`Cookie: lang=zh` 没有让响应变成 `<html lang="zh">`。

**「无任务推进」的直接量（⛔ 不是关键词扫描；含硬规则 2 的两半）**：

```
grep -rn '^goal_ac: AC-297' tasks/*.md + 全部 quay-worktrees/*/tasks/*.md   ⇒ 0 命中
grep -rln '^goal_ac: AC-29[1-6]' tasks/*.md                                 ⇒ 6 命中（已知为真对照，证明谓词本身可用，不是恒零）
grep -rn 'AC-297' tasks/*.md                                                ⇒ 0 命中
```

### 现状：`/git-history` 的 zh 面一处都没有接线（两条互相独立的读数）

**读数 ①（live 面，同一 URL 两种请求头，响应逐字节相同）**：

```
curl -sf                      http://127.0.0.1:4173/git-history  ⇒ 513471 bytes, <html lang="en", <title>quay — Git history — vertical commit timeline</title>
curl -sf -H 'Cookie: lang=zh' http://127.0.0.1:4173/git-history  ⇒ 513471 bytes, <html lang="en", <title>quay — Git history — vertical commit timeline</title>
cmp -s <(两份响应体)  ⇒ IDENTICAL (byte-for-byte)
```

⛔ 不是「翻了但翻得不对」——是**连页头 `lang` 属性都没动**：两份响应体字节数相同。

**读数 ②（源码侧按位置枚举）** —— `/git-history` 外壳（`renderGitHistoryPage`，`packages/quay/src/serve-git.ts:900`）有**两个 view 分支**，两处硬编码都在：

| 位置 | 字面量 | 归属 |
|---|---|---|
| `serve-git.ts:900` | `function renderGitHistoryPage(history, view, remotes, identity = null)` | **签名里没有 `lang` 参数位** |
| `serve-git.ts:919` | `<html lang="en">` | task view 页头 lang（**第一段**断言） |
| `serve-git.ts:919` | `<title>${pageTitle("Git history — 任务分组", identity)}</title>` | task view 本页 `<title>`（**第四段**断言） |
| `serve-git.ts:920` | `renderMobileChrome("git", "git history")` | 移动端 chrome（未传 lang；pageLabel 未过 `pageNameFor`） |
| `serve-git.ts:920` | `renderSiteNav("git")` | nav 条（nav 当前项 `Git History` 的**移动端**来源） |
| `serve-git.ts:921` | `<h1>Git History — 任务分组时间轴</h1>` | task view `<h1>`（判据不查它，但含 ASCII `Git History`，属本页 chrome） |
| `serve-git.ts:963` | `<html lang="en">` | **git view（默认视图）页头 lang** ← **判据实际读到的这一处** |
| `serve-git.ts:963` | `<title>${pageTitle("Git history — vertical commit timeline", identity)}</title>` | **默认视图本页 `<title>`** ← 判据第四段 |
| `serve-git.ts:964` | `renderMobileChrome("git", "git history")` + `renderSiteNav("git")` | 同 task view，未传 lang |
| `serve-git.ts:965` | `<h1>Git History — 提交纵向时间轴</h1>` | 默认视图 `<h1>` |
| `serve-git.ts:990` | `res.end(renderGitHistoryPage(history, gitHistoryViewOf(url), remotes, cfg.identity))` | **handler 已拿到 `cfg.lang` 却丢掉了** |

**字面量 `Git History` 在默认语言 `/git-history` 响应里的全量枚举**（`tr '<' '\n<' | grep -n 'Git History'` ⇒ **恰好 3 条**，`grep -o | wc -l` 复核同为 3；**全部是 chrome，零条来自数据**）：

```
726:span class="mobile-menu-item nav-current" aria-current="page">Git History
785:span class="nav-item nav-current" aria-current="page">Git History
808:h1>Git History — 提交纵向时间轴
```

第 1、2 条同出于 `serve-render.ts` 的 `SITE_NAV_GROUPS` → `navItem`；第 3 条是 `:965` 硬编码。

### ⚠️ 可满足性实测（本族任务的必要前置，⛔ 不是形式检查）—— 本页**没有**被数据打死的风险

判据对 `/board`（页内 CSS 注释含 "Board"）与 `/dashboard`（卡体渲任务 title）都曾**结构性不可满足**。**本页实测安全**：

```
nav_en 区块 = `grep -o '<nav.*</nav>'` ⇒ 2419 bytes（全响应 513471 bytes，占 0.47%）
'Git History' in nav_en  = 2   ← 两条 nav 当前项，均为 chrome
'Git History' in 全 en 体 = 3   ← 第 3 条是 <h1>，在 <main> 内、nav 区块之外
```

⇒ 贪婪匹配的 `<nav>…</nav>` 区间在 `<main>` **之前闭合**，不含正文，**也不含 `<h1>`**。本页正文渲染提交信息（`readGitHistory`），但**数据里的 `Git History` 计数为 0**（实测）。**判据可满足**。

### ⚠️ 本任务会踩的两个陷阱（当场记下，⛔ 不是事后补充）

**陷阱 1 —— 默认视图才是判据读的那个，两个分支都要接线。** 判据请求 `/git-history` **不带 query**，`gitHistoryViewOf(url)` 返回默认 `"git"` ⇒ 判据读到的是 **:962-973 的 git view 分支**。若只接 task view（:918-926），判据**仍红**在 `html-lang-not-zh`。两个分支**都要**接（同页同文件，一次改完）。

**陷阱 2 —— 标题 token 的大小写与 nav 标签不同，登记键必须逐字相等。** `PAGE_LABELS` 是按 `pageTitle` 收到的 token **精确查表**，而本页有两套大小写：
- nav 标签 / `<h1>` 用 **`Git History`**（大写 H）；
- 两个 `<title>` token 用 **`Git history`**（小写 h）：`"Git history — vertical commit timeline"`（默认视图）与 `"Git history — 任务分组"`（task view）。
⇒ 只登记 `"Git History"` 会让 `<title>` 原样返回英文，判据红在 `CAUSE=title-unchanged`（那正是判据存在的意义：**「只有共享导航条变了」不算**）。**登记键必须与传给 `pageTitle` 的 token 逐字相等**（含空格与 U+2014 EM DASH）。

### 机制前提（实测读数，⛔ 不是推测）

- **AC-288（`gap-ac288-webui-lang-switch-mechanism`）已 done 且已落 develop**：`packages/quay/src/serve-lang.ts` 导出 `htmlLangTag(lang)`（`:128`，返回 `<html lang="${lang}">`）；语言每请求解析一次，`serve-handlers.ts` 组装 `reqCfg: ServePageCfg = { ...cfg, lang }` 并交给 `/git-history` 的 handler（`handleGitHistory`）。⇒ **`handleGitHistory` 已经拿到 `cfg.lang`，只是丢掉了**（`:990` 没传）。
- **AC-289 的产物 `packages/quay/src/serve-i18n.ts` 已在 develop**，已给出：
  - `NAV_LABELS` **15 条全给**，其中 **`git: { en: "Git History", zh: "Git 历史" }`**（`serve-i18n.ts:61`）⇒ **nav 当前项那两处本任务不需要新词**；
  - `renderSiteNav(current, lang = DEFAULT_LANG)`（`serve-render.ts:878`）/ `renderMobileChrome(current, pageLabel, lang = DEFAULT_LANG)`（`:908`）/ `pageTitle(pageName, id, lang = DEFAULT_LANG)`（`:1079`）/ `pageNameFor(pageName, lang = DEFAULT_LANG)`（`serve-i18n.ts`）—— 默认参数即作用域手段；
  - **`PAGE_LABELS` 只登记了 `Dashboard`、`Tasks`、`"task list"` 三条**（`serve-i18n.ts:96-104`），其 ROW 3 契约逐字写明：「the remaining 12 pages' page-chrome is AC-291~303」。
- **AC-290 已落地的接线模板**（`serve-task.ts:483-487`，照抄）：
  ```
  ${htmlLangTag(cfg.lang)}<head>…<title>${pageTitle("Tasks", cfg.identity, cfg.lang)}</title></head>
  <body>${renderMobileChrome("tasks", pageNameFor("task list", cfg.lang), cfg.lang)}${renderSiteNav("tasks", cfg.lang)}<main id="main">
  <h1>Quay — ${pageNameFor("task list", cfg.lang)} (${escapeHtml(manifest.id)} provider)</h1>
  ```
  ⚠️ 注意 `renderMobileChrome` 的 pageLabel 是**调用点**过 `pageNameFor`（`serve-render.ts:916` 只做 `escapeHtml(pageLabel)`，**函数内不翻译**）。
- ⇒ **本任务的核心工作量**：`renderGitHistoryPage` 加 `lang` 参数位 + 两个分支各接 4 处（lang 属性 / title / mobile chrome / site nav）+ `<h1>` + handler 传 `cfg.lang` + `PAGE_LABELS` 追加本页词条。

### 作用域与交叠（如实记录，⛔ 不含任何前置声明；机械的依赖边在顶层）

- 本任务只做**这一页**的接线：新建本页页码词条 + 本页调用点传 lang。⛔ **不改** `NAV_LABELS`（AC-289 的 15 行契约，`git` 行已存在且 `zh: "Git 历史"`）、⛔ **不重写**四个共享渲染函数（AC-289 的产物）、⛔ **不改** `serve-i18n.ts` 的 ROW 契约注释。
- ⚠️ **同文件交叠（机制化，⛔ 不靠文风串行）**：`gap-ac291-live-page-zh-chrome-nav-current-and-own-title` 等 **status=ready（在飞）**，其 `Touches` 声明 `packages/quay/src/serve-i18n.ts` ⇒ **派发器按 Touches 串行**（`serve-git.ts` 是本任务独占，无并发写者）。本任务**不**额外声明对它们的依赖边（那是同文件串行，不是逻辑前置）；顶层 `depends_on` 只指向两个**已 done** 的机制产物。
- ⚠️ **上游测试耦合的实测核对（⛔ 不假定）**：`packages/quay/test/serve-i18n.test.mjs:140` 用 **`"Not A Page"`** 作「未映射 token 在 zh 下原样返回」的样本（`assert.equal(pageNameFor("Not A Page","zh"), "Not A Page")`），`:131-133` 断言的已映射 token 是 `Tasks` / `task list`。**本任务不映射 `Tasks`/`task list`/`Dashboard`** ⇒ **该断言不受本页词条影响，⛔ 本任务不改那个测试文件**。⇒ 实现时若它**因本页词条**变红，那是新信息，**当场把它加进 Touches 并在任务体记下**，⛔ 不静默绕过。
- ⚠️ **本页独有的数据面提醒（如实记录）**：`/git-history` 正文渲染 `git log`（提交 subject 进正文）。判据对正文零断言且 nav 区块在 `<main>` 前闭合（实测 2419 B）⇒ **无不可满足风险**；但若实现时用了「对整段响应体子串匹配」的写法做自测，会得到**假红**——⛔ 自测必须复刻判据的 nav 区块作用域。

## Plan

1. **红基线**（⛔ 不假定仍等于立案值）：`node packages/quay/bin/quay.js goal gate AC-297 --dry-run --json; echo "GATE_EXIT=$?"`，贴完整输出与具名 `CAUSE=`（判据的所有者可能已改动它）。
2. **确认前置已落地 + 读【实际】签名**：`git cat-file -e develop:packages/quay/src/serve-i18n.ts`、`grep -n 'export function renderSiteNav\|export function renderMobileChrome\|export function pageTitle\|export function pageNameFor\|htmlLangTag' packages/quay/src/serve-render.ts packages/quay/src/serve-i18n.ts packages/quay/src/serve-lang.ts`。**⛔ 不按本任务 Plan 预写的签名假设**：以 AC-288/AC-289/AC-290 落地后的**实际**参数位为准；任一无命中 ⇒ **停下报缺**。
3. **接线 `serve-git.ts`（仅 `renderGitHistoryPage` 的两个分支）**：签名加 `lang: Lang = DEFAULT_LANG`；两个分支各把 `:919`/`:963` 的 `<html lang="en">` 改为 `${htmlLangTag(lang)}`、`<title>` 的 `pageTitle(...)` 传 `lang`、`renderMobileChrome("git", pageNameFor("git history", lang), lang)`、`renderSiteNav("git", lang)`、`<h1>` 的 `Git History` 部分过 `pageNameFor`；`:990` 传 `cfg.lang`。**两个分支都要改**（陷阱 1）。
4. **在 `serve-i18n.ts` 的 `PAGE_LABELS` 只追加本页词条**：`"Git history — vertical commit timeline"`、`"Git history — 任务分组"`、`"git history"`、`"Git History"`（用于 `<h1>`）。**登记键必须与调用点传的字符串逐字相等**（含 U+2014 与大小写，陷阱 2）。zh 值必须非空、⛔ **不含 ASCII 字面量 `Git History`**（否则是本判据的 gate-gameability 形态：值「看着翻了」而 nav/标题断言仍可能红）、⛔ 不得回落英文。`en` 列必须是**逐字身份**（`pageNameFor` 对 `en` 直接返回原 token ⇒ en 基线**按构造成立**，⛔ 不要靠自觉）。**⛔ 不碰 `NAV_LABELS`、不碰 ROW 契约注释行。**
5. **测试**：新建 `packages/quay/test/serve-git-history-zh-chrome.test.mjs`（头注释 `// @test-group product`；黑盒：真 workspace（`.quay/config.yml` + native provider）+ `startServer({ port: 0 })`；nav 区块用**判据同一手法**抽出 —— `body.replace(/\n/g," ")` 后 `/<nav.*<\/nav>/`，让测试与判据不会在「nav 区块是什么」上漂移）。断言 zh 下 ① 含 `<html lang="zh"` ② nav 当前项**两处**文本都不是 `Git History` ③ 本页 `<title>` 与 en 逐字不同 **且不含 ASCII `Git history`** ④ **`<h1>` 也不再含 ASCII `Git History`**（判据不查它，但它是本页 chrome，缺这条就出现「机械判据弱于规格意图」的缺口）；**外加 en 负控制：en 响应与今天的基线逐字相同**（没有这条对照，②③可能由别的改动满足）。⚠️ 用 `port: 0` 让内核选端口，⛔ 不自己探端口——端口冲突会让 provider 子进程泄漏并**挂住整个套件**。
6. **构建产物**：`npm run build -w quay`（新接线未进 bundle 会让 dist 类测试假红）。
7. **重启活实例**：AC-297 的探针从**已在运行**的 `quay.ts serve`（cwd = 仓库根）派生地址，⛔ 不自己启服务 ⇒ 实现落地后**必须重启该实例**，否则判据读的是旧代码（陈旧实例会把「没生效」伪装成「实现没做」）。⚠️ **本机实测的第二个形态**：探针按 `pgrep -f 'quay.ts serve'` + `/proc/$p/cwd` == 仓库根 **取首个匹配** ⇒ 若同时存在多个 cwd=仓库根的实例，**旧的那个可能被选中**；重启后须核对 `--host/--port` 与你在跑的实例一致。
8. **收口**：红/绿两条读数 + 因果对照 + 全量残留枚举 + scoped 门绿。

## AC

- [ ] **AC1（live 面判别性读数：四处各自独立断言）**：在**运行中的** `quay.ts serve`（cwd = 仓库根）上，`curl -H 'Cookie: lang=zh' http://$addr/git-history` 的响应**分别**满足：① 含 `<html lang="zh"`；② nav 当前项**两处**（桌面 `class="nav-item nav-current"` 与移动 `class="mobile-menu-item nav-current"`）的文本都**不是** `Git History`；③ 该页**自己的** `<title>` 与 en 基线**逐字不同**（并排贴 en/zh 两条 `<title>`）；④ **en 基线逐字未变**：默认语言 `/git-history` 响应体与立案基线（513471 B、三条 `Git History` 命中、nav 区块 2419 B、nav 内 2 条）同口径对照。⛔ 四处分开断言、分开贴原始片段——只报「整页看起来翻了」不算（硬规则 3：枚举不是布尔）。
- [ ] **AC1b（默认视图之外的第二分支）**：`curl -H 'Cookie: lang=zh' "http://$addr/git-history?view=task"` 同样满足 ①②③（该分支的 `<title>` token 是 `"Git history — 任务分组"`，与本任务陷阱 2 的第二个键对应）。**判据只读默认视图**——本条是防止「只接了一个分支」的独立对照，⛔ 不得用默认视图的读数顶替。
- [ ] **AC2（可被打红——因果对照）**：把语言解析结果**临时**钳到 `"en"`（一次性本地改动，⛔ 不提交），证明 AC1 的 ②/③ 变红；还原后复绿。**两次读数并排贴出**。**再加更窄的一次对照**：只把语言**钳在字典入口**（`pageNameFor` / `navLabelsFor` 首行强制 `en`，AC-288 的机制原封不动）⇒ `<html lang>` 仍为 `zh` 而 nav/标题变红，判据自报的 `CAUSE=` 必须是 `nav-label-untranslated` 或 `title-unchanged`（⛔ 不是 `html-lang-not-zh`）——**这一条才把成因单独钉在字典接线上**（硬规则 4 推论四：一个能解释现象的说法不是一个被检验的结论）。
- [ ] **AC3（全量残留枚举 + 逐条归属，⛔ 不报「零」）**：对 zh 响应跑 `tr '<' '\n<' | grep -n 'Git History'` **与** `grep -n 'Git history'`，把**每一条**命中的 HTML 片段与它的**产生源**贴出（chrome 出自哪一行源码 / 数据出自哪条提交信息），并给出 **chrome 计数**与**数据计数**两个数。⛔ 禁止只报一个总数（硬规则 3）。**判别性证法（⛔ 不是「数出来是 0」）**：同一个谓词在 **en** 响应上必须命中（全 body **3 次**，其中 nav 区块内 **2 次**）。
- [ ] **AC4（判据裁决原样记录）**：贴出**实现后**的 `node packages/quay/bin/quay.js goal gate AC-297 --dry-run --json` 完整输出 + `GATE_EXIT=`（⛔ 不解释、不改写它的 `CAUSE`）。**红就是红**：若仍红，把它具名 `CAUSE` 与 AC3 的归属一并交出。⛔ **明令禁止**的三种「凑绿」：改判据（`goals/AC-297-*.md` ⛔ 不在本 Touches 内）、改别的任务的 title、把 zh 值写成含英文 `Git History` / `Git history` 的混合串。
- [ ] **AC5（不回归 + 作用域枚举）**：① `bash scripts/test.sh --for-task gap-ac297-git-history-page-zh-chrome-nav-current-and-own-title` 绿；② `node --test packages/quay/test/serve-*.test.mjs` 绿；③ **作用域举证**：`git diff --name-only develop...HEAD` **逐条**贴出，证明只有本任务 Touches 里的路径被动过（⛔ 其余 12 个 `serve-*.ts` 的硬编码标签点一字未改）；④ `grep -rc 'html lang="en"' packages/quay/src/*.ts` **逐文件**贴出并与立案基线对照（**立案基线：`serve-git.ts` = 2**，即 `:919` task view ＋ `:963` git view）：本任务后 **`serve-git.ts` 2→0**。⚠️ 该文件不在其他在飞任务的 Touches 内 ⇒ 本项的判据是**逐文件差量 + 归属**；若别的任务改动使全局总数变化，**不得记到自己账上**。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「多了一个 lang 参数、单测绿了」，而是**一个真实的 `quay serve` 进程在真实 HTTP 上，对同一个 URL 按请求头给出了两种语言的页面外壳**：

1. **落地对象**：运行中的实例上，`/git-history` 在 `Cookie: lang=zh` 下页头 lang、本页 `<title>`、nav 当前项**都**变，且 en 基线逐字未变 —— **从响应体直读**（⛔ 不读 render 函数的返回值当「响应」，那测的是函数，不是线上行为）。
2. **可被打红**：AC2 的两次钳制对照**实际跑过**并贴上读数 ⇒ 证明这条判据不是结构上恒绿（硬规则 4）。
3. **判据裁决诚实**：AC4 的判据输出原样贴出，**红就是红**；⛔ 不用任何改写数据或改写字典值的方式把它变成绿色。
4. **作用域**：AC5 的逐文件计数 + `--name-only`，证明其余 12 个文件未被顺手改掉。
5. **可回滚**：写明回滚形态（还原 `serve-git.ts` 的接线 + 删除 `serve-i18n.ts` 的本页词条 + 重跑 `npm run build -w quay` + 重启实例）与它的作用域（纯本地代码、无外部状态）。
6. **证据留痕**：红/绿判据输出、en/zh 两条原始响应片段、因果对照两次读数、全量残留枚举、逐文件计数，落成**任务体内联**或**未跟踪** scratch 文件，可被下一轮独立复算（⛔ 不是只写一句「已修好」）。

## Touches

- tasks/gap-ac297-git-history-page-zh-chrome-nav-current-and-own-title.md
- packages/quay/src/serve-git.ts
- packages/quay/src/serve-i18n.ts
- packages/quay/test/serve-git-history-zh-chrome.test.mjs (new)

（说明：`packages/quay/src/serve-lang.ts` 属 AC-288 的产物、四个共享渲染函数与 `NAV_LABELS` 属 AC-289 的产物、`serve-task.ts` 的接线模板属 AC-290 的产物，⛔ 均不在本 Touches 的**改动**意图内（`serve-i18n.ts` 只追加本页 `PAGE_LABELS` 词条）；`packages/quay/test/serve-i18n.test.mjs` **刻意不声明**——它的「未映射 token」样本是 `"Not A Page"`，本任务不映射它，故无 delta（Plan step 2 已实测核对；若实现时它因本页词条变红，则**当场**加进 Touches 并在任务体记下）。`goals/AC-297-*.md` 属人与驱动维护面，⛔ 不在本 Touches。运行时证据若落 `.quay/` 则**保持未跟踪**，故不声明——`anti-drift-touches-check` 只比对已跟踪文件。）
