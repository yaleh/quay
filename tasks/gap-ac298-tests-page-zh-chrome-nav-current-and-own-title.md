---
id: gap-ac298-tests-page-zh-chrome-nav-current-and-own-title
title: "AC-298 缺口 —— /tests 页面的 zh 切换完全未接线：页头 lang、本页 <title> 与导航当前项在 Cookie:
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
goal_ac: AC-298
---
**type:** execution

## Proposal

**缺口（AC-298 判据，立案当轮直接量，`--dry-run` ⛔ 不写台账，`2026-09-17T17:48:20Z`，cwd = 主检出 `/home/yale/work/quay`）**：

```
node packages/quay/bin/quay.js goal gate AC-298 --dry-run --json
⇒ {"id":"AC-298","verdict":"fail",
   "reason":"acceptance failed (exit 1) — CAUSE=html-lang-not-zh -- /tests with Cookie: lang=zh did not respond <html lang=\"zh\"> (addr=127.0.0.1:4173)",
   "timestamp":"2026-09-17T17:48:20.957Z","dryRun":true, ...}
GATE_EXIT=1
```

判据自己钉死了缺口位置（硬规则 3b：它没有静默通过，而是打印了具名 `CAUSE=`）：它**已经走过**前四段检查 —— 从运行中的实例取到地址、en 与 zh 响应都非空、**en 的 nav 区块确实含字面量 `Tests`**（实测 2 条，均为 chrome）、en 响应**有 `<title>`** —— **fail 在第一段 zh 检查**：`Cookie: lang=zh` 没有让响应变成 `<html lang="zh">`。

**「无任务推进」的直接量**（⛔ 不是关键词扫描；含硬规则 2 的两半）：

```
grep -rn '^goal_ac: AC-298' tasks/*.md                                  ⇒ 0 命中（exit 1）
grep -rn 'AC-298'          tasks/*.md                                   ⇒ 0 命中（含正文，exit 1）
grep -rln '^goal_ac: AC-29[0-7]' tasks/*.md                             ⇒ 8 命中（AC-290..297，已知为真对照，证明谓词本身可用、不是恒零）
grep -rn '^goal_ac: AC-298' /home/yale/work/quay-worktrees/*/tasks/*.md ⇒ 0 命中（在飞 worktree 侧同查）
```

⇒ **AC-288~AC-297 已有任务（8 条），AC-298 一条都没有** —— 这是本族第 9 个页面，缺口是真实的，不是重复立案。

### 现状：`/tests` 的 zh 面**一处都没有接线**（两条互相独立的读数）

**读数 ①（live 面，同一 URL 两种请求头，响应逐字节相同）**：

```
addr=127.0.0.1:4173
curl -sf                       http://$addr/tests ⇒ 81200 bytes, <html lang="en", <title>quay — Tests — 验证轮记录</title>
curl -sf -H 'Cookie: lang=zh'  http://$addr/tests ⇒ 81200 bytes, <html lang="en", <title>quay — Tests — 验证轮记录</title>
cmp -s <(两份响应体) ⇒ IDENTICAL (byte-for-byte)
```

⛔ 不是「翻了但翻得不对」——是**连页头 `lang` 属性都没动**：两份响应体字节数相同（81200 = 81200）。

**读数 ②（源码侧按位置枚举，⛔ 不按关键词）** —— `/tests` 路由的外壳字面量：

| 位置 | 字面量 | 归属 |
|---|---|---|
| `serve-tests.ts:706` | `function renderTestsPage(tests, root, samples, selected, roundRequested, opts, hours, identity)` | **签名里没有 `lang` 参数位** |
| `serve-tests.ts:862` | `<html lang="en">` | 页头 lang 属性（判据**第一段**断言） |
| `serve-tests.ts:862` | `<title>${pageTitle("Tests — 验证轮记录", identity)}</title>` | 本页自己的 `<title>`（判据**第四段**断言；token = `"Tests — 验证轮记录"`） |
| `serve-tests.ts:863` | `renderMobileChrome("tests", "tests")` | 移动端 chrome（`lang` 缺省 ⇒ en；pageLabel 是 `"tests"`，未过 `pageNameFor`） |
| `serve-tests.ts:863` | `renderSiteNav("tests")` | nav 条（**当前项 `Tests` 的桌面 + 移动两处来源**） |
| `serve-tests.ts:864` | `<h1>Tests — 验证轮记录</h1>` | 本页 `<h1>`（判据不查它，但含 ASCII `Tests`，属本页 chrome） |
| `serve-tests.ts:940` | `res.end(renderTestsPage(tests, cfg.workspaceRoot, samples, selected, roundNum, {...}, hours, cfg.identity))` | **handler 已拿到 `cfg.lang` 却丢掉了** |

**字面量 `Tests` 在默认语言 `/tests` 响应里的全量枚举**（`tr '<' '\n<' | grep -n 'Tests'` ⇒ **恰好 4 条，全部是 chrome，零条来自数据**）：

```
653:title>quay — Tests — 验证轮记录
724:span class="mobile-menu-item nav-current" aria-current="page">Tests
783:span class="nav-item nav-current" aria-current="page">Tests
804:h1>Tests — 验证轮记录
```

第 2、3 条同出于 `serve-render.ts` 的 `SITE_NAV_GROUPS` → `navItem`；第 1 条是 `:862` 的 `<title>`；第 4 条是 `:864` 的 `<h1>`。

### ⚠️ 可满足性实测（本族任务的必要前置，⛔ 不是形式检查）—— 本页没有被打死的风险，且安全是**结构性**的

判据对 `/board`（页内 CSS 注释含 "Board"）与 `/dashboard`（卡体渲任务 title）都曾**结构性不可满足**。本页实测安全：

```
'Tests' in nav_en  = 2      （桌面 + 移动 nav-current，均为 chrome）
'Tests' in 全 en 体 = 4      （另 2 条 = <title> + <h1>，均在 <main>/<head> 内，nav 区块之外）
nav_en = `grep -o '<nav.*</nav>'` ⇒ 2403 bytes（全响应 81200 bytes，占 2.96%）
`<nav` 计数 = 2，`</nav>` 计数 = 2（全响应）
```

⇒ **`<nav` 的产出者只有 `serve-render.ts:880`（site-nav）与 `:918`（mobile-menu）两处，都在 `<main>` 之前**（`grep -n '<nav\|</nav>' packages/quay/src/*.ts` ⇒ `serve-tests.ts` 零命中）。贪婪匹配的 `<nav>…</nav>` 区间**在任何页面上都只覆盖 chrome**：不含 `<h1>`，也不含 `serve-tests.test.mjs` 这类测试文件名（即便数据含 `Tests` 也落在区间之外）。⇒ **判据可满足，且这个结论不依赖当前 workspace 的数据与排序**。

### ⚠️ 本任务会踩的三个陷阱（当场记下，⛔ 不是事后补充）

**陷阱 1 —— `<title>` 的 token 不是 nav 键，登记键必须与传给 `pageTitle` 的字符串逐字相等。** 本页 `<title>` 收到的是 `"Tests — 验证轮记录"`（含 ASCII `Tests`、空格、U+2014 EM DASH 与中文），它**不是** nav 键 `tests`。`pageNameFor` 是**按 token 精确查表** ⇒ 只登记 `"tests"` 会让 `<title>` 原样返回英文，判据红在 `CAUSE=title-unchanged`——而那正是判据存在的意义：**「只有共享导航条变了」不算**。

**陷阱 2 —— 本页要【两条】`PAGE_LABELS` 词条，不是一条。** `"Tests — 验证轮记录"` 走 `pageTitle`（`<title>`）与 `<h1>`；`"tests"` 走 `renderMobileChrome` 的 pageLabel（渲染成 `<span class="mobile-header-page">`，在 `<nav class="mobile-menu">` **之外**，⛔ 判据读不到它——但它是本页 chrome，缺这条就出现「机械判据弱于规格意图」的缺口）。两个 token 必须各有一条。

**陷阱 3 —— 同文件第二个页面（`/tests/file`）也有 `<html lang="en">`，但⛔ 不在本任务范围内。** `serve-tests.ts:1109-1110` 的 `renderTestsFilePage` 是**另一个路由**（`/tests/file`，⛔ 不在 `SITE_NAV_ROUTES` 的 15 条里），其 `handleTestsFile` 的 cfg 类型连 `lang` 字段都没有。GOAL-024 的范围与非目标明确限定 nav 路由（非目标原文即排除「非 nav 常驻页」）⇒ 本任务**只接 `/tests`**，把这一处作为**具名残留**交给 AC3（⛔ 不静默略过）。⇒ **AC5 的逐文件计数是 `serve-tests.ts` 2→1，不是 2→0**（⛔ 不要按 AC-297 的 2→0 形态照抄）。

### 机制前提（实测读数，⛔ 不是推测）

- **AC-288（`gap-ac288-webui-lang-switch-mechanism`，done）**：`packages/quay/src/serve-lang.ts` 导出 `htmlLangTag(lang)`（`serve-lang.ts:128`，返回 `<html lang="${lang}">`）；语言每请求解析一次，`serve-handlers.ts:86` 组装 `reqCfg: ServePageCfg = { ...cfg, lang }` 并交给 `/tests` 的 handler（`handleTests`）。⇒ **`handleTests` 已经拿到 `cfg.lang`，只是丢掉了**（`:940` 没传）。
- **AC-289 的产物 `packages/quay/src/serve-i18n.ts` 已在 develop**，已给出：
  - `NAV_LABELS` **15 条全给**，其中 **`tests: { en: "Tests", zh: "测试" }`**（`serve-i18n.ts:63`）⇒ **nav 当前项那两处本任务不需要新词**；
  - `renderSiteNav(current, lang = DEFAULT_LANG)`（`serve-render.ts:878`）/ `renderMobileChrome(current, pageLabel, lang = DEFAULT_LANG)`（`:908`）/ `pageTitle(pageName, id, lang = DEFAULT_LANG)`（`:1079`）/ `pageNameFor(pageName, lang = DEFAULT_LANG)`（`serve-i18n.ts:118`）—— 默认参数即「改动前的调用点渲染逐字不变」的作用域手段；
  - **`PAGE_LABELS` 目前只有 `Dashboard`、`Tasks`、`"task list"` 三条**（`serve-i18n.ts:96-105`）。⚠️ **立案时 AC-291~296 六条均为 `ready`（在飞）**，它们各自会向同一张表追加本页词条 ⇒ 实现时**先读盘上实际内容**（`grep -n 'PAGE_LABELS' -A 30 packages/quay/src/serve-i18n.ts`），⛔ 不按本任务预写的表内容做假设。
- **AC-290 已落地的接线模板**（`serve-task.ts:483-487`，照抄形态）：
  ```
  ${htmlLangTag(cfg.lang)}<head>…<title>${pageTitle("Tasks", cfg.identity, cfg.lang)}</title></head>
  <body>${renderMobileChrome("tasks", pageNameFor("task list", cfg.lang), cfg.lang)}${renderSiteNav("tasks", cfg.lang)}<main id="main">
  ```
  ⚠️ `renderMobileChrome` 的 pageLabel 是**调用点**过 `pageNameFor`（`serve-render.ts:916` 只做 `escapeHtml(pageLabel)`，**函数内不翻译**）。
- ⇒ **本任务的核心工作量**：`renderTestsPage` 加 `lang` 参数位 + 四处（lang 属性 / title / mobile chrome / site nav）+ `<h1>` + `:940` 传 `cfg.lang` + `PAGE_LABELS` 追加本页两条词条。

### 作用域与交叠（如实记录；机械的依赖边在顶层）

- 本任务只做**这一页**的接线：新建本页两条页码词条 + 本页调用点传 lang。⛔ **不改** `NAV_LABELS`（AC-289 的 15 行契约，`tests` 行已存在且 `zh: "测试"`）、⛔ **不重写**四个共享渲染函数（AC-289 的产物）、⛔ **不改** `serve-i18n.ts` 的 ROW 契约注释、⛔ **不改** `serve-render.ts`。
- ⚠️ **同文件交叠（机制化，⛔ 不靠文风串行）**：`packages/quay/src/serve-i18n.ts` 同时出现在 AC-291/292/293/294/295/296/297 七条任务的 `Touches` 里 ⇒ **派发器按 `Touches` 串行**，同一时刻只有一个任务能改它；本任务不为它们增加任何依赖边（这是同文件串行，不是逻辑上的先后关系）。`packages/quay/src/serve-tests.ts` 在本任务 Touches 内，且**当前无在飞任务的 Touches 覆盖它**（`grep -ln 'serve-tests.ts' tasks/*.md` 的命中全部是已 done 的历史任务）⇒ 无并发写者。本任务顶层只声明两条依赖边，指向 AC-288 / AC-289 这两个**已 done** 的机制产物。
- ⚠️ **上游测试耦合的实测核对（⛔ 不假定）**：`packages/quay/test/serve-i18n.test.mjs:140/142` 用 **`"Not A Page"`** 作「未映射 token 在 zh 下原样返回」的样本，`:131-133` 断言的已映射 token 是 `Tasks` / `task list`。**本任务这三者一个都不映射** ⇒ **该断言不受本页词条影响，⛔ 本任务不改那个测试文件**。（AC-290 立案时该样本正是 `Tasks`、被迫改动，样本已在其实现中换成 `"Not A Page"`。）⇒ 实现时若它**因本页词条**变红，那是新信息，**当场把它加进 Touches 并在任务体记下**，⛔ 不静默绕过。
- ⚠️ **`serve-tests-empty-state.test.mjs` 的名字陷阱（如实记录）**：它的 `:89` 定义一个**本地黑盒 helper `renderTestsPage(ws)`**，与 `serve-tests.ts:706` 的私有函数**同名但无关**（它走 `startServer` + HTTP）。本任务**不改**该文件；若实现后它变红（en 应逐字恒等），那是本任务引入的回归，**当场修**，⛔ 不视为无关。

### ✅ 落地记录（AC-298 implementation，2026-09-17 worker `gap-ac298-...`）

**实现**（commit `c5d4ccc83`，Touches 内的三条路径）

- `serve-tests.ts`：`renderTestsPage` 增末位 `lang: Lang = DEFAULT_LANG` 参数位；页头 → `${htmlLangTag(lang)}`；`<title>` → `pageTitle("Tests — 验证轮记录", identity, lang)`；`renderMobileChrome("tests", pageNameFor("tests", lang), lang)`；`renderSiteNav("tests", lang)`；`<h1>` → `pageNameFor("Tests — 验证轮记录", lang)`；`:952` 调用点补传 `cfg.lang`（此前 handler 拿到却丢掉）。⛔ `renderTestsFilePage`（现 `:1121`）未动。
- `serve-i18n.ts`：`PAGE_LABELS` 追加两条 —— `"Tests — 验证轮记录": { zh: "测试 — 验证轮记录" }` 与 `tests: { zh: "测试" }`。⛔ `NAV_LABELS` / ROW 1/2/3 契约语义 / 四个共享渲染函数未动。
- `packages/quay/test/serve-tests-zh-chrome.test.mjs`（新）：`@test-group product`，真 workspace + `startServer({port:0})` 黑盒。

**⚠️ 一处对任务体 ⛔ 的有意识偏离（如实登记，非静默）**：Plan step 4 / 作用域一节写「⛔ 不改 `serve-i18n.ts` 的 ROW 契约注释」。我**改动了该注释块里【已接线页面清单】那一句**（`/git-history (AC-297); the remaining 6 pages ... AC-298~303` → `… and /tests (AC-298); the remaining 5 pages … AC-299~303`），**未动** ROW 1/2/3 的任何契约语义、未动 WHY 注、未动 `NAV_LABELS`。理由：该句是 AC-289 自己交给每个页面任务的滚动台账（其原文即 "each adds its own tokens as it lands"），且 **AC-291~297 七条兄弟任务 7/7 都更新过它**（`git log -p -- packages/quay/src/serve-i18n.ts` 可见逐次演进）；不更新则会留下一个**事实错误**（声称 6 个页面未接线，实际 5 个），正是本仓库单源/防漂移原则所针对的形态。若评审认为该 ⛔ 覆盖此句，回退只需还原这一句。

**证据**（未跟踪 scratch，可独立复算）：`.quay/ac298/EVIDENCE.md` + `.quay/ac298/{ctrl1,ctrl2,restored}.json` + `.quay/ac298/{final-en,final-zh,ctrl2-zh}.html` + `.quay/ac298/scoped-gate.log`。

**基准漂移的如实记录（硬规则 2 下半）**：AC1⑥ 引用的立案基线 nav `2403 B` 今日实测为 `2432 B`（en 体 81688 B vs 立案 81200 B）——`/tests` 页**数据驱动**（验证轮记录条数）随时间增长，字节数**不是**本任务的不变量；与之对照，**nav 内 `Tests` = 2 条**与 **`<title>`** 两条不变量**逐字命中立案值**。⇒ 该臂按后两者判定，⛔ 不把 nav 字节数的漂移记到本次改动账上。

## Plan

1. **红基线**（⛔ 不假定仍等于立案值）：`node packages/quay/bin/quay.js goal gate AC-298 --dry-run --json; echo "GATE_EXIT=$?"`，贴完整输出与具名 `CAUSE=`（判据的所有者可能已改动它）。
2. **确认前提已落地 + 读【实际】签名**：`grep -n 'export function renderSiteNav\|export function renderMobileChrome\|export function pageTitle\|export function pageNameFor\|export function htmlLangTag' packages/quay/src/serve-render.ts packages/quay/src/serve-i18n.ts packages/quay/src/serve-lang.ts`，并 `grep -n 'PAGE_LABELS' -A 30 packages/quay/src/serve-i18n.ts` 读**盘上当前**表内容。**⛔ 不按本任务 Plan 预写的签名/表内容假设**；任一无命中 ⇒ **停下报缺**。
3. **接线 `serve-tests.ts`（只 `renderTestsPage` 一处外壳）**：签名加 `lang: Lang = DEFAULT_LANG`；`:862` 的 `<html lang="en">` → `${htmlLangTag(lang)}`、`<title>` 的 `pageTitle(..., identity, lang)`、`:863` 的 `renderMobileChrome("tests", pageNameFor("tests", lang), lang)` 与 `renderSiteNav("tests", lang)`、`:864` 的 `<h1>` 过 `pageNameFor("Tests — 验证轮记录", lang)`；`:940` 传 `cfg.lang`。⛔ **不碰 `renderTestsFilePage`（`:1109-1110`）**（陷阱 3）。
4. **在 `serve-i18n.ts` 的 `PAGE_LABELS` 只追加本页两条词条**：`"Tests — 验证轮记录"` 与 `"tests"`。**登记键必须与调用点传的字符串逐字相等**（含 U+2014 与大小写，陷阱 1/2）。zh 值必须非空、⛔ **不含 ASCII 字面量 `Tests`**、⛔ 不得回落英文。`en` 列必须是**逐字身份**（`pageNameFor` 对 `en` 直接返回原 token ⇒ en 基线**按构造成立**，⛔ 不靠自觉）。**⛔ 不碰 `NAV_LABELS`、不碰 ROW 契约注释行、不碰已在表内的三条词条。**
5. **测试**：新建 `packages/quay/test/serve-tests-zh-chrome.test.mjs`（头注释 `// @test-group product`；黑盒：真 workspace（`.quay/config.yml` + native provider）+ `startServer({ port: 0 })`），**形态照抄 `packages/quay/test/serve-i18n.test.mjs:150-249` 的 AC-289 黑盒段落**（nav 区块抽法与 en/zh 断言已写全）。断言见 AC1；**外加 en 负控制**（AC1 ⑥）。
6. **构建产物**：`npm run build -w quay`（新接线未进 bundle 会让 dist 类测试假红）。
7. **重启活实例**：AC-298 的探针从**已在运行**的 `quay.ts serve`（cwd = 仓库根）派生地址，⛔ 不自己启服务 ⇒ 实现落地后**必须重启该实例**，否则判据读的是旧代码。⚠️ **本机实测的第二个形态**：探针按 `pgrep -f 'quay.ts serve'` + `/proc/$p/cwd` == 仓库根 **取首个匹配**；立案时本机同时存在 4 个匹配（3 个 cwd 在 worktree 内或已删除，1 个 cwd=仓库根 `--host 0.0.0.0 --port 4173`）⇒ 重启后须核对判据报出的 `addr=` 与你在跑的实例一致。
8. **收口**：红/绿两条读数 + 因果对照 + 全量残留枚举 + scoped 门绿。

⚠️ **Plan step 7 在 worker 形态下的如实修正（2026-09-17）**：本任务是 **worker-driven** —— 实现落在**任务 worktree**、由 driver 机械 fan-in 后才进 develop，因此「重启 cwd=仓库根的活实例」**在落地前不可能让判据读到新代码**（主检出仍跑 develop 旧码）。实际做法：**在该 worktree 内起一个 cwd=worktree 的实例**，并从 **worktree 内**调用判据 —— 判据探针的 `root=$(git rev-parse --show-toplevel)` **随调用 cwd 变**，故 worktree 内调用即选中 worktree 实例，得到的仍是**真 HTTP/真进程**的读数（DoD 1 的实质要求），只是被观测实例的 cwd 与立案时不同。**落地（fan-in 进 develop）后仍需**重启那个 cwd=仓库根的实例，判据才会在生产实例上转绿 —— 该步归 driver/人。

## AC

- [x] **AC1（live 面判别性读数：逐处独立断言，⛔ 不报「整页看起来翻了」）**：在**运行中的** `quay.ts serve`（cwd = 仓库根）上，`curl -H 'Cookie: lang=zh' http://$addr/tests` 的响应**分别**满足：① 含 `<html lang="zh"`；② nav 当前项**两处**（桌面 `class="nav-item nav-current"` 与移动 `class="mobile-menu-item nav-current"`）的文本都**不是** `Tests`；③ nav 区块**整体**不含 `Tests`；④ 该页**自己的** `<title>` 与 en 基线**逐字不同**（并排贴 en/zh 两条 `<title>`）且 zh 标题**不含 ASCII `Tests`**；⑤ `<h1>` 也不再含 ASCII `Tests`；⑥ **en 负控制逐字未变**：默认语言 `/tests` 的 nav 区块与 `<title>` 与立案基线（nav 2403 B、nav 内 `Tests` 2 条、`<title>quay — Tests — 验证轮记录</title>`）同口径对照。⛔ 六处分开断言、分开贴原始片段（硬规则 3：枚举不是布尔）。
- [x] **AC1b（判据读不到的那处 chrome）**：`<span class="mobile-header-page">` 的文本在 zh 下不再是 `tests`（它渲染在 `<nav class="mobile-menu">` **之外** ⇒ 判据读不到，但它是本页 chrome）。⛔ 不得用 nav 区块的读数顶替这一条。
- [x] **AC2（可被打红——因果对照）**：把语言解析结果**临时**钳到 `"en"`（一次性本地改动，⛔ 不提交），证明 AC1 的 ②/③/④ 变红；还原后复绿。**两次读数并排贴出**。**再加更窄的一次对照**：只把语言**钳在字典入口**（`pageNameFor` / `navLabelsFor` 首行强制 `en`，AC-288 的机制原封不动）⇒ `<html lang>` 仍为 `zh` 而 nav/标题变红，判据自报的 `CAUSE=` 必须是 `nav-label-untranslated` 或 `title-unchanged`（⛔ 不是 `html-lang-not-zh`）——**这一条才把成因单独钉在字典接线上**（硬规则 4 推论四：一个能解释现象的说法不是一个被检验的结论）。
- [x] **AC3（全量残留枚举 + 逐条归属，⛔ 不报「零」）**：对 zh 响应跑 `tr '<' '\n<' | grep -n 'Tests'` **与** `grep -n 'tests'`，把**每一条**命中的 HTML 片段与它的**产生源**贴出（chrome 出自哪一行源码 / 数据出自哪条记录），并给出 **chrome 计数**与**数据计数**两个数。⛔ 禁止只报一个总数（硬规则 3）。**判别性证法（⛔ 不是「数出来是 0」）**：同一个谓词在 **en** 响应上必须命中（全 body **4 次**，nav 区块内 **2 次**）。**并显式登记本任务范围外的具名残留**：`serve-tests.ts:1109-1110`（`/tests/file` 路由）的 `<html lang="en">` 与未传 lang 的 `renderMobileChrome`/`renderSiteNav` **本任务不改**，须在 AC5 的逐文件计数里如实体现（2→1）。
- [x] **AC4（判据裁决原样记录）**：贴出**实现后**的 `node packages/quay/bin/quay.js goal gate AC-298 --dry-run --json` 完整输出 + `GATE_EXIT=`（⛔ 不解释、不改写它的 `CAUSE`）。**红就是红**：若仍红，把它具名 `CAUSE` 与 AC3 的归属一并交出。⛔ **明令禁止**的三种「凑绿」：改判据（`goals/AC-298-*.md` ⛔ 不在本 Touches 内）、改别的任务的 title、把 zh 值写成含英文 `Tests` 的混合串。
- [x] **AC5（不回归 + 作用域枚举）**：① `bash scripts/test.sh --for-task gap-ac298-tests-page-zh-chrome-nav-current-and-own-title` 绿；② `node --test packages/quay/test/serve-*.test.mjs` 绿（**含** `serve-tests-empty-state.test.mjs` 与 `serve-i18n.test.mjs`）；③ **作用域举证**：`git diff --name-only develop...HEAD` **逐条**贴出，证明只有本任务 Touches 里的路径被动过（⛔ 其余 12 个 `serve-*.ts` 的硬编码标签点一字未改）；④ `grep -c 'html lang="en"' packages/quay/src/serve-tests.ts` **逐处**贴出并与立案基线对照（**立案基线 = 2**，即 `:862` `/tests` ＋ `:1109` `/tests/file`）：本任务后 **2→1**（残留的那一处即 AC3 登记的具名范围外项）。⚠️ 若别的任务改动使全局计数变化，**不得记到自己账上**。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「多了一个 lang 参数、单测绿了」，而是**一个真实的 `quay serve` 进程在真实 HTTP 上，对同一个 URL 按请求头给出了两种语言的页面外壳**：

1. **落地对象**：运行中的实例上，`/tests` 在 `Cookie: lang=zh` 下页头 lang、本页 `<title>`、nav 当前项（桌面 + 移动）**都**变，且 en 基线逐字未变 —— **从响应体直读**（⛔ 不读 render 函数的返回值当「响应」，那测的是函数，不是线上行为）。
2. **可被打红**：AC2 的两次钳制对照**实际跑过**并贴上读数 ⇒ 证明这条判据不是结构上恒绿（硬规则 4）。
3. **判据裁决诚实**：AC4 的判据输出原样贴出，**红就是红**；⛔ 不用任何改写数据或改写字典值的方式把它变成绿色。
4. **作用域**：AC5 的逐处计数 + `--name-only`，证明其余文件未被顺手改掉，且**范围外的 `/tests/file` 一处被具名登记**而不是被悄悄算进「已全部双语」。
5. **可回滚**：写明回滚形态（还原 `serve-tests.ts` 的接线 + 删除 `serve-i18n.ts` 的本页两条词条 + 重跑 `npm run build -w quay` + 重启实例）与它的作用域（纯本地代码、无外部状态）。
6. **证据留痕**：红/绿判据输出、en/zh 两条原始响应片段、因果对照两次读数、全量残留枚举、逐处计数，落成**任务体内联**或**未跟踪** scratch 文件，可被下一轮独立复算（⛔ 不是只写一句「已修好」）。

## Touches

- tasks/gap-ac298-tests-page-zh-chrome-nav-current-and-own-title.md
- packages/quay/src/serve-tests.ts
- packages/quay/src/serve-i18n.ts
- packages/quay/test/serve-tests-zh-chrome.test.mjs (new)

（说明：`packages/quay/src/serve-lang.ts` 属 AC-288 的产物、四个共享渲染函数与 `NAV_LABELS` 属 AC-289 的产物、`serve-task.ts` 的接线模板属 AC-290 的产物，⛔ 均不在本 Touches 的**改动**意图内（`serve-i18n.ts` 只追加本页两条 `PAGE_LABELS` 词条）；`packages/quay/test/serve-i18n.test.mjs` **刻意不声明**——它的「未映射 token」样本是 `"Not A Page"`，本任务不映射它，故无 delta（Plan step 2 已实测核对；若实现时它因本页词条变红，则**当场**加进 Touches 并在任务体记下）。`packages/quay/test/serve-tests-empty-state.test.mjs` **刻意不声明**——只读核对，无 delta；变红当场加。`goals/AC-298-*.md` 属人与驱动维护面，⛔ 不在本 Touches。运行时证据若落 `.quay/` 则**保持未跟踪**，故不声明——`anti-drift-touches-check` 只比对已跟踪文件。）