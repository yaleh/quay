---
id: gap-ac300-adr-page-zh-chrome-nav-current-and-own-title
title: "AC-300 缺口 —— /adr 页面的 zh 切换完全未接线：页头 lang、本页 <title> 与导航当前项在 Cookie:
  lang=zh 下与 en 逐字相同"
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
goal_ac: AC-300
---
**type:** execution

## Proposal

**缺口（AC-300 判据，立案当轮直接量，`--dry-run` ⛔ 不写台账，`2026-09-17T18:15:07Z`，cwd = 主检出 `/home/yale/work/quay`）**：

```
node packages/quay/bin/quay.js goal gate AC-300 --dry-run --json
⇒ {"id":"AC-300","verdict":"fail",
   "reason":"acceptance failed (exit 1) — CAUSE=html-lang-not-zh -- /adr with Cookie: lang=zh did not respond <html lang=\"zh\"> (addr=127.0.0.1:4173)",
   "timestamp":"2026-09-17T18:15:07.083Z","dryRun":true, ...}
GATE_EXIT=1
```

判据自己钉死了缺口位置（硬规则 3b：它没有静默通过，而是打印了具名 `CAUSE=`）：它**已经走过**前四段检查 —— 从运行中的实例取到地址、en 与 zh 响应都非空、**en 的 nav 区块确实含字面量 `ADRs`**（实测 2 条，均为 chrome）、en 响应**有 `<title>`** —— **fail 在第一段 zh 检查**：`Cookie: lang=zh` 没有让响应变成 `<html lang="zh">`。

**「无任务推进」的直接量**（⛔ 不是关键词扫描；含硬规则 2 的两半）：

```
grep -rl '^goal_ac: AC-300' tasks/*.md        ⇒ 0 命中
grep -rl 'AC-300'          tasks/*.md         ⇒ 1 命中
   ⚠️ 打印该命中确认（硬规则 2 的动作）：tasks/gap-spec-goal-store-third-sibling-kind.md:148 是 CLI
      用法示例「write AC-300 --origin ""」，属 **task id 命名空间**的同名，⛔ 不是本 goal criterion
grep -rl '^goal_ac: AC-29[0-9]' tasks/*.md    ⇒ 10 命中（AC-290..299，已知为真对照，证明谓词本身
   可用、不是恒零）
grep -rl '^goal_ac: AC-30[0-9]' tasks/*.md    ⇒ 0 命中
在飞 worktree 侧同查（/home/yale/work/quay-worktrees/*/tasks/*.md）⇒ 0 命中
```

⇒ **AC-290~AC-299 已有任务（10 条），AC-300 一条都没有** —— 这是本族第 12 个页面（`SITE_NAV_GROUPS` 的「知识」组第二个），缺口真实，不是重复立案。

### 现状：`/adr` 的 zh 面**一处都没有接线**（两条互相独立的读数）

**读数 ①（live 面，同一 URL 两种请求头）**：

```
addr=127.0.0.1:4173
curl -sf                      http://$addr/adr ⇒ 42015 bytes, <html lang="en", <title>quay — ADRs</title>
curl -sf -H 'Cookie: lang=zh' http://$addr/adr ⇒ 42015 bytes, <html lang="en", 同 title
diff <(en) <(zh) ⇒ 0 行 —— 两份响应逐字节相同（42015 = 42015）
```

⛔ 不是「翻了但翻得不对」——是**连页头 `lang` 属性都没动**。

**读数 ②（源码侧按位置枚举，⛔ 不按关键词）** —— `/adr` 路由的外壳字面量：

| 位置 | 字面量 | 归属 |
|---|---|---|
| `serve-adr.ts:13` | `cfg: ServePageCfg` | handler **已拿到 cfg（含 `lang`）**，只是没用 |
| `serve-adr.ts:25` | `<html lang="en">` | 页头 lang 属性（判据**第一段**断言） |
| `serve-adr.ts:25` | `<title>${pageTitle("ADRs", cfg.identity)}</title>` | 本页自己的 `<title>`（判据**第四段**断言；token = `"ADRs"`） |
| `serve-adr.ts:26` | `renderMobileChrome("adr", "adrs")` | 移动端 chrome（`lang` 缺省 ⇒ en；pageLabel 是**小写字面量 `"adrs"`**，未过 `pageNameFor`） |
| `serve-adr.ts:26` | `renderSiteNav("adr")` | nav 条（**当前项 `ADRs` 的桌面 + 移动两处来源**） |
| `serve-adr.ts:27` | `<h1>ADRs (${adrs.length})</h1>` | 本页 `<h1>`（判据不查它，但含 ASCII `ADRs`，属本页 chrome；**动态串**） |
| `serve-adr.ts:32` | `res.end(html`…`)` | 三个渲染函数全吃默认 `lang` ⇒ 整页 en |

**字面量 `ADRs` 在默认语言 `/adr` 响应里的全量枚举**（`tr '<' '\n<' | grep -n 'ADRs'` ⇒ **恰好 4 条，全部是 chrome**）：

```
652:title>quay — ADRs
734:span class="mobile-menu-item nav-current" aria-current="page">ADRs
788:span class="nav-item nav-current" aria-current="page">ADRs
803:h1>ADRs (36)
```

第 2、3 条同出于 `serve-render.ts` 的 `SITE_NAV_GROUPS` → `navItem`（`:860`），标签来自 `NAV_LABELS.adr`；第 1 条是 `:25` 的 `<title>`；第 4 条是 `:27` 的 `<h1>`。⚠️ 当轮 `adr/` 下 36 条记录的 title **无一含 `ADRs`** ⇒ **数据侧 0 条**；实现后若新立案的 ADR 标题含该字面量，AC3 的数据计数要如实报（⛔ 不得算成 chrome）。

### ⚠️ 可满足性实测（本族任务的必要前置，⛔ 不是形式检查）—— 本页没有被打死的风险

```
'ADRs' in nav_en   = 2      （桌面 + 移动 nav-current，均为 chrome）
'ADRs' in 全 en 体 = 4      （另 2 条 = <title> + <h1>，均在 nav 区块之外）
nav_en = `grep -o '<nav.*</nav>'` ⇒ 2407 bytes（全响应 42015 bytes，占 5.7%）
`<nav` 计数 = 2，`</nav>` 计数 = 2（全响应）
nav_en 区间含 `<h1>`? ⇒ NO
```

⇒ **本页响应里的 `<nav` 只有两处，都在 `serve-render.ts`**（`:880` site-nav、`:918` mobile-menu；`serve-task.ts:731/799` 的两个 `<nav>` 属任务详情页，本页不引）**且都在 `<main>` 之前** ⇒ 贪婪匹配的 `<nav>…</nav>` 区间**在本页只覆盖 chrome**。⇒ 判据可满足，且这个结论不依赖当前 workspace 的数据与排序。

### ⚠️ 本任务会踩的三个陷阱（当场记下，⛔ 不是事后补充）

**陷阱 1 —— 本页要【两条】`PAGE_LABELS` 词条，且第二条是【小写】。** 与 AC-299 的三条不同：`/adr` 的 `<title>` token 与 `<h1>` token **是同一个字符串 `ADRs`**（`serve-adr.ts:25` 与 `:27` 逐字相同），⇒ h1 复用 `"ADRs"` 一条。两条是：

- `"ADRs"` —— `pageTitle`（`<title>`）与 `<h1>` 共用（判据**第四段**能否变绿就取决于它）；
- `"adrs"` —— `renderMobileChrome` 的 pageLabel 用（**小写！**渲染成 `<span class="mobile-header-page">`，在 `<nav class="mobile-menu">` **之外**，⛔ 判据读不到它——但它是本页 chrome）。

**登记键必须与调用点传的字符串逐字相等**（ASCII 大小写也计入：`ADRs` ≠ `adrs`，两次独立查表）。

**陷阱 2 —— `<h1>` 是动态串，⛔ 不得整串登记。** `serve-adr.ts:27` 是 `<h1>ADRs (${adrs.length})</h1>`，计数会变 ⇒ 接线形态只能是 `${pageNameFor("ADRs", lang)} (${adrs.length})`：把**常量部分**过字典、计数原样插值。⛔ 不把 `"ADRs (36)"` 之类的成品串写进 `PAGE_LABELS`。

**陷阱 3 —— 同文件第二个路由 `/adr/<id>` 也有 `<html lang="en">`，但⛔ 不在本任务范围内。** `serve-adr.ts:35` 的 `handleAdrDetail`（`:61` 页头、`:62` 的 `renderMobileChrome("adr", a.id)` / `renderSiteNav("adr")`）是**另一个路由**（`/adr/<id>`，⛔ 不在 `SITE_NAV_ROUTES` 的 15 条里；且它的 `<title>` 是**裸实体 id**，`pageTitle` 的文档明说详情页刻意不走它）。GOAL-024 的范围与非目标明确限定 nav 路由 ⇒ 本任务**只接 `/adr`**，把这一处作为**具名残留**交给 AC3（⛔ 不静默略过）。⇒ **AC5 的逐文件计数是 `serve-adr.ts` 2→1，不是 2→0**（⛔ 不要按 AC-298/299 的 2→0 形态照抄）。

### 机制前提（实测读数，⛔ 不是推测）

- **AC-288（`gap-ac288-webui-lang-switch-mechanism`，done）**：`packages/quay/src/serve-lang.ts` 导出 `htmlLangTag(lang)`（返回 `<html lang="${lang}">`）；语言每请求解析一次，`serve-handlers.ts:86` 组装 `reqCfg: ServePageCfg = { ...cfg, lang }`，`:269` 把它交给 `handleAdrList` ⇒ **handler 已经拿到 `cfg.lang`，只是丢掉了**（`:25/:26` 全用默认值）。`ServePageCfg.lang?: Lang`（`serve-render.ts:1025`，缺省 `DEFAULT_LANG`）。
- **AC-289 的产物 `packages/quay/src/serve-i18n.ts` 已在 develop**，已给出：
  - `NAV_LABELS.adr = { en: "ADRs", zh: "架构决策" }`（`serve-i18n.ts:66`）⇒ **nav 当前项那两处本任务不需要新词**；
  - `renderSiteNav(current, lang = DEFAULT_LANG)`（`serve-render.ts:878`）/ `renderMobileChrome(current, pageLabel, lang = DEFAULT_LANG)`（`:908`）/ `pageTitle(pageName, id, lang = DEFAULT_LANG)`（`:1079`）/ `pageNameFor(pageName, lang = DEFAULT_LANG)`（`serve-i18n.ts:111`）—— 默认参数即「改动前的调用点渲染逐字不变」的作用域手段；
  - **`PAGE_LABELS` 立案时只有 5 条**（`Dashboard`、`Tasks`、`"task list"`、`"Live — loop activity"`、`Live`；`serve-i18n.ts:108-123`）。⚠️ **立案时 AC-292~AC-299 八条为 `ready`（在飞）**，它们各自会向同一张表追加本页词条 ⇒ 实现时**先读盘上实际内容**（`grep -n 'PAGE_LABELS' -A 40 packages/quay/src/serve-i18n.ts`），⛔ 不按本任务预写的表内容做假设。
- **AC-290/AC-291 已落地的接线模板**（`serve-task.ts:483-487`；`serve-live.ts` 的 AC-291 提交 `575786189`）—— 照抄形态：

  ```
  ${htmlLangTag(lang)}<head>…<title>${pageTitle("Live — loop activity", identity, lang)}</title></head>
  <body>${renderMobileChrome("live", "live", lang)}${renderSiteNav("live", lang)}<main id="main">
  <h1>${pageNameFor("Live", lang)} — 循环此刻在做什么</h1>
  ```

  ⚠️ `renderMobileChrome` 的 pageLabel 是**调用点**过 `pageNameFor`（`serve-render.ts:916` 只做 `escapeHtml(pageLabel)`，**函数内不翻译**）。⚠️ AC-291 实际落地时把 `"live"` **原样**传了（移动 header 在 zh 下仍英文，判据读不到它）—— **本任务采取更严口径**（同 AC-299 陷阱 1 与其 AC1b）：pageLabel 也过 `pageNameFor`，让「该页自己的 chrome」整体切换；`en` 是逐字身份 ⇒ 默认面按构造不移动。这是一个**有意为之的更严选择**，显式登记（⛔ 不静默）。
- ⇒ **本任务的核心工作量**：`serve-adr.ts` 的 `handleAdrList` 接 `cfg.lang`（lang 属性 / title / mobile chrome / site nav 四处）+ `<h1>` + 补 import（`pageNameFor` / `htmlLangTag`）+ `PAGE_LABELS` 追加本页两条词条 + 一个新测试文件。

### 作用域与交叠（如实记录；机械的依赖边在顶层）

<!-- dedup-ref -->
- 本任务只做**这一页**的接线：新建本页两条页码词条 + 本页调用点传 lang。顶层 `depends_on` 只有两条，指向 AC-288 / AC-289 这两个**已 done** 的机制产物（它们**先落地**完成了，本任务不因它们阻塞）；⛔ **不改** `NAV_LABELS`（AC-289 的 15 行契约，`adr` 行已存在）、⛔ **不重写**四个共享渲染函数或 `serve-render.ts`、⛔ **不改** `serve-handlers.ts`（`reqCfg` 已带 lang）、⛔ **不改** `goals/AC-300-*.md`（人与驱动维护面）。
- ⚠️ **同文件交叠（机制化，⛔ 不靠文风串行）**：`packages/quay/src/serve-i18n.ts` 同时出现在 AC-292~AC-299 八条任务的 `Touches` 里（立案当轮实测：其中 8 条 `ready`、AC-290/291 已 `done`）⇒ **派发器按 `Touches` 串行**，同一时刻只有一个任务能改它；本任务不为它们增加任何依赖边（这是同文件串行，不是逻辑上的先后关系）。`packages/quay/src/serve-adr.ts` 在本任务 Touches 内，**当前无在飞任务的 Touches 覆盖它**（立案当轮实测：`grep -l 'serve-adr.ts' tasks/*.md` 命中 8 条，**全部 `done`**）⇒ 无并发写者。
- ⚠️ **上游测试耦合的实测核对（⛔ 不假定）**：
  - `packages/quay/test/serve-adr.test.mjs` 走**真服务器 HTTP**（`startServer({ port: 0 })` + `makeTmpDir` + 真 `.quay/config.yml`，见 `:32-46`），⛔ **不直调 render 函数** ⇒ 加 `lang` 参数位不影响它，且**刻意不声明**在本 Touches（无 delta）。
  - `packages/quay/test/gap-webui-tests-page-unpaginated-tables.test.mjs:211` 的 `<table>` 清单断言的是**文件多重集 + 命中条数**，**行号刻意不钉**（其 `:242` 注释明说 `serve-adr.ts` 的站点曾因无关改动从 `:26` 漂到 `:28`、检查因此变红，故不钉行号）⇒ 本任务**不新增、不删除 `<table>`** 即不动它。⛔ 实现时不得顺手改这张表的结构。
  - `packages/quay/test/webui-modernist-sync.test.mjs:136` 的 AC100(c) 只扫 `handleAdrDetail` 的**函数体**（找硬编码 hex）⇒ 本任务改的是 `handleAdrList`，不触及该函数体边界，无 delta。
  - 实测**无**测试断言 `PAGE_LABELS` 的条数或键集，也**无**测试钉 `/adr` 的 `<title>`（立案当轮 `grep -rn 'quay — ADRs\|PAGE_LABELS' packages/quay/test/*.mjs` ⇒ 0 命中）⇒ 追加词条不会因表变大而红。

## Plan

1. **红基线**（⛔ 不假定仍等于立案值）：`node packages/quay/bin/quay.js goal gate AC-300 --dry-run --json; echo "GATE_EXIT=$?"`，贴完整输出与具名 `CAUSE=`（判据的所有者可能已改动它）。
2. **确认前提已落地 + 读【实际】签名**：`grep -n 'export function renderSiteNav\|export function renderMobileChrome\|export function pageTitle\|export function pageNameFor\|export function htmlLangTag' packages/quay/src/serve-render.ts packages/quay/src/serve-i18n.ts packages/quay/src/serve-lang.ts`；`grep -n 'PAGE_LABELS' -A 40 packages/quay/src/serve-i18n.ts` 读**盘上当前**表内容；`grep -n 'adr:' packages/quay/src/serve-i18n.ts` 复核 `NAV_LABELS.adr.zh`。**⛔ 不按本任务 Plan 预写的签名/表内容假设**；任一无命中 ⇒ **停下报缺**。
3. **接线 `serve-adr.ts`（只 `handleAdrList` 一处外壳，⛔ 不碰 `handleAdrDetail`）**：`:25` 的 `<html lang="en">` → `${htmlLangTag(cfg.lang)}`、同行的 `pageTitle("ADRs", cfg.identity)` → `pageTitle("ADRs", cfg.identity, cfg.lang)`；`:26` 的 `renderMobileChrome("adr", "adrs")` → `renderMobileChrome("adr", pageNameFor("adrs", cfg.lang), cfg.lang)`、`renderSiteNav("adr")` → `renderSiteNav("adr", cfg.lang)`；`:27` 的 `<h1>ADRs (${adrs.length})</h1>` → `<h1>${pageNameFor("ADRs", cfg.lang)} (${adrs.length})</h1>`（陷阱 2）；补 import `pageNameFor`、`htmlLangTag`（⛔ 若实现需要 `Lang`/`DEFAULT_LANG` 再按**实际签名**决定）。四个渲染函数都有 `DEFAULT_LANG` 默认参数 ⇒ `cfg.lang` 为 `undefined` 时按构造回落 en。
4. **在 `serve-i18n.ts` 的 `PAGE_LABELS` 只追加本页两条词条**：`"ADRs"` 与 `"adrs"`（陷阱 1，**键逐字**：一个全大写、一个小写）。zh 值必须非空、⛔ **不含 ASCII 字面量 `ADRs`/`adrs`**、⛔ 不得回落英文；`en` 列必须是**逐字身份**（`pageNameFor` 对 `en` 直接返回原 token ⇒ en 基线**按构造成立**，⛔ 不靠自觉）。同时**更新 ROW 3 的契约注释**（原文只列 `/dashboard`、`/live`，「the remaining pages' page-chrome is AC-290~303」在追加后需把 /adr 列入已接线页，形态照 AC-291 的 `575786189`）。⛔ **不碰 `NAV_LABELS`、不碰已在表内的五条词条**。
5. **测试**：新建 `packages/quay/test/serve-adr-zh-chrome.test.mjs`（头注释 `// @test-group product`；形态照抄 `packages/quay/test/serve-live-zh-chrome.test.mjs`：黑盒真服务 + nav 区块同法抽取 + 字典直调 + en 基线逐字钉死）。workspace 构造照抄 `packages/quay/test/serve-adr.test.mjs:32-46`（真 `.quay/config.yml` + native provider + `QUAY_NATIVE_ADR_DIR`；⛔ 裸 tasks 目录不是合法 workspace）。断言见 AC1~AC3。
6. **构建产物**：`npm run build -w quay`（新接线未进 bundle 会让 dist 类测试假红）。
7. **重启活实例**：AC-300 的探针从**已在运行**的 `quay.ts serve`（cwd = 仓库根）派生地址，⛔ 不自己启服务 ⇒ 实现落地后**必须重启该实例**，否则判据读的是旧代码。⚠️ 探针按 `pgrep -f 'quay.ts serve'` + `/proc/$p/cwd` == 仓库根 **取首个匹配**；立案当轮本机同时存在多个匹配，判据报出的 `addr=127.0.0.1:4173`（`--host 0.0.0.0 --port 4173`）⇒ 重启后须核对判据报出的 `addr=` 与你在跑的实例一致（memory `serve-probe-criterion-picks-first-pgrep-match-stale-instance`）。⚠️ `serve` 会泄漏孙进程（memory `quay-serve-leak-and-server-json-hijack`）⇒ 按 cwd 清孤儿，⛔ 不盲杀。
8. **收口**：红/绿两条读数 + 因果对照 + 全量残留枚举 + scoped 门绿。

## AC

- [ ] **AC1（live 面判别性读数：逐处独立断言，⛔ 不报「整页看起来翻了」）**：在**运行中的** `quay.ts serve`（cwd = 仓库根）上，`curl -H 'Cookie: lang=zh' http://$addr/adr` 的响应**分别**满足：① 含 `<html lang="zh"`；② nav 当前项**两处**（桌面 `class="nav-item nav-current"` 与移动 `class="mobile-menu-item nav-current"`）的文本都**不是** `ADRs`；③ nav 区块**整体**不含 `ADRs`；④ 该页**自己的** `<title>` 与 en 基线（立案值 `quay — ADRs`）**逐字不同**（并排贴 en/zh 两条 `<title>`）且 zh 标题**不含 ASCII `ADRs`**；⑤ `<h1>` 也不再含 ASCII `ADRs`；⑥ **en 负控制逐字未变**：默认语言 `/adr` 的 nav 区块与 `<title>` 与立案基线（nav 2407 bytes、nav 内 `ADRs` 2 条、`<title>quay — ADRs</title>`）同口径对照。⛔ 六处分开断言、分开贴原始片段（硬规则 3：枚举不是布尔）。
- [ ] **AC1b（判据读不到的那处 chrome）**：`<span class="mobile-header-page">` 的文本在 zh 下不再是 `adrs`（它渲染在 `<nav class="mobile-menu">` **之外** ⇒ 判据读不到，但它是本页 chrome）。⛔ 不得用 nav 区块的读数顶替这一条。（本任务采取比 AC-291 实际落地更严的口径，见 Proposal 陷阱 1。）
- [ ] **AC2（可被打红——因果对照）**：把语言解析结果**临时**钳到 `"en"`（一次性本地改动，⛔ 不提交），证明 AC1 的 ②/③/④ 变红；还原后复绿。**两次读数并排贴出**。**再加更窄的一次对照**：只把语言**钳在字典入口**（`pageNameFor` / `navLabelsFor` 首行强制 `en`，AC-288 的机制原封不动）⇒ `<html lang>` 仍为 `zh` 而 nav/标题变红，判据自报的 `CAUSE=` 必须是 `nav-label-untranslated` 或 `title-unchanged`（⛔ 不是 `html-lang-not-zh`）——**这一条才把成因单独钉在字典接线上**（硬规则 4 推论四：一个能解释现象的说法不是一个被检验的结论）。
- [ ] **AC3（全量残留枚举 + 逐条归属，⛔ 不报「零」）**：对 zh 与 en **两份**响应各跑 `tr '<' '\n<' | grep -n 'ADRs'`（以及小写 `adrs`），把**每一条**命中的 HTML 片段与它的**产生源**贴出（chrome 出自哪一行源码 / 数据出自哪条记录），并给出 **chrome 计数**与**数据计数**两个数。⛔ 禁止只报一个总数（硬规则 3）。**判别性证法（⛔ 不是「数出来是 0」）**：同一个谓词在 **en** 响应上必须命中（立案基线：body **4 次**、nav 区块内 **2 次**）。**并显式登记本任务范围外的具名残留**：`serve-adr.ts:35`/`:61`/`:62`（`/adr/<id>` 路由）的 `<html lang="en">` 与未传 lang 的 `renderMobileChrome`/`renderSiteNav` **本任务不改**，须在 AC5 的逐文件计数里如实体现（**2→1**）。
- [ ] **AC4（判据裁决原样记录）**：贴出**实现后**的 `node packages/quay/bin/quay.js goal gate AC-300 --dry-run --json` 完整输出 + `GATE_EXIT=`（⛔ 不解释、不改写它的 `CAUSE`）。**红就是红**：若仍红，把它具名 `CAUSE` 与 AC3 的归属一并交出。⛔ **明令禁止**的三种「凑绿」：改判据（`goals/AC-300-*.md` ⛔ 不在本 Touches 内）、改别的任务的 title、把 zh 值写成含英文 `ADRs` 的混合串。
- [ ] **AC5（不回归 + 作用域枚举）**：① `bash scripts/test.sh --for-task gap-ac300-adr-page-zh-chrome-nav-current-and-own-title` 绿；② `node --test packages/quay/test/serve-*.test.mjs` 绿（**含** `serve-adr.test.mjs`、`serve-i18n.test.mjs`、`serve-live-zh-chrome.test.mjs`、`gap-webui-tests-page-unpaginated-tables.test.mjs`、`webui-modernist-sync.test.mjs`）；③ **作用域举证**：`git diff --name-only develop...HEAD` **逐条**贴出，证明只有本任务 Touches 里的路径被动过（⛔ 其余 `serve-*.ts` 的硬编码标签点一字未改）；④ `grep -c 'html lang="en"' packages/quay/src/serve-adr.ts` **逐处**贴出并与立案基线对照（**立案基线 = 2**，即 `:25` `/adr` ＋ `:61` `/adr/<id>`）：本任务后 **2→1**（残留的那一处即 AC3 登记的具名范围外项）。⚠️ 若别的任务改动使全局计数变化，**不得记到自己账上**。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「多了一个 lang 参数、单测绿了」，而是**一个真实的 `quay serve` 进程在真实 HTTP 上，对同一个 URL 按请求头给出了两种语言的页面外壳**：

1. **落地对象**：运行中的实例上，`/adr` 在 `Cookie: lang=zh` 下页头 lang、本页 `<title>`、nav 当前项（桌面 + 移动）**都**变，且 en 基线逐字未变 —— **从响应体直读**（⛔ 不读 render 函数的返回值当「响应」，那测的是函数，不是线上行为）。
2. **可被打红**：AC2 的两次钳制对照**实际跑过**并贴上读数 ⇒ 证明这条判据不是结构上恒绿（硬规则 4）。
3. **判据裁决诚实**：AC4 的判据输出原样贴出，**红就是红**；⛔ 不用任何改写数据或改写字典值的方式把它变成绿色。
4. **作用域**：AC5 的逐处计数 + `--name-only`，证明其余文件未被顺手改掉，且**范围外的 `/adr/<id>` 一处被具名登记**而不是被悄悄算进「已全部双语」。
5. **可回滚**：写明回滚形态（还原 `serve-adr.ts` 的接线 + 删除 `serve-i18n.ts` 的本页两条词条 + 重跑 `npm run build -w quay` + 重启实例）与它的作用域（纯本地代码、无外部状态）。
6. **证据留痕**：红/绿判据输出、en/zh 两条原始响应片段、因果对照两次读数、全量残留枚举、逐处计数，落成**任务体内联**或**未跟踪** scratch 文件（`.quay/ac300-*`），可被下一轮独立复算（⛔ 不是只写一句「已修好」）。

## Touches

- tasks/gap-ac300-adr-page-zh-chrome-nav-current-and-own-title.md
- packages/quay/src/serve-adr.ts
- packages/quay/src/serve-i18n.ts
- packages/quay/test/serve-adr-zh-chrome.test.mjs (new)

（说明：`packages/quay/src/serve-lang.ts` 属 AC-288 的产物、四个共享渲染函数与 `NAV_LABELS` 属 AC-289 的产物、`serve-task.ts`/`serve-live.ts` 的接线模板属 AC-290/AC-291 的产物，⛔ 均不在本 Touches 的**改动**意图内（`serve-i18n.ts` 只追加本页两条 `PAGE_LABELS` 词条 + 更新 ROW 3 契约注释）；`packages/quay/src/serve-handlers.ts` **刻意不声明**——`reqCfg` 已带 lang 且 `:269` 已传入，无 delta；`packages/quay/test/serve-adr.test.mjs` **刻意不声明**——只走 HTTP、无 delta（Proposal 已实测核对）；`packages/quay/test/gap-webui-tests-page-unpaginated-tables.test.mjs` 与 `webui-modernist-sync.test.mjs` **刻意不声明**——不新增 `<table>`、不改 `handleAdrDetail` 函数体，无 delta；若实现时它们因本页改动变红，则**当场**加进 Touches 并在任务体记下。`goals/AC-300-*.md` 属人与驱动维护面，⛔ 不在本 Touches。运行时证据落 `.quay/ac300-*` 并**保持未跟踪**，故不声明——`anti-drift-touches-check` 只比对已跟踪文件。）