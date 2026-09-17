---
id: gap-ac302-doc-page-zh-chrome-nav-current-and-own-title
title: "AC-302 缺口 —— /doc 页面的 zh 切换完全未接线：页头 lang、本页 <title> 与导航当前项在 Cookie:
  lang=zh 下与 en 逐字相同"
status: ready
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
goal_ac: AC-302
---
**type:** execution

## Proposal

**缺口（AC-302 判据，立案当轮直接量，`--dry-run` ⛔ 不写台账，`2026-09-17T18:21:15.009Z`，cwd = 主检出 `/home/yale/work/quay`）**：

```
node packages/quay/bin/quay.js goal gate AC-302 --dry-run --json
⇒ {"id":"AC-302","verdict":"fail",
   "reason":"acceptance failed (exit 1) — CAUSE=html-lang-not-zh -- /doc with Cookie: lang=zh did not respond <html lang=\"zh\"> (addr=127.0.0.1:4173)",
   "timestamp":"2026-09-17T18:21:15.009Z","dryRun":true}
GATE_EXIT=1
```

判据自己钉死了缺口位置（硬规则 3b：它没有静默通过，而是打印了具名 `CAUSE=`）：它**已经走过**前四段检查 —— 从运行中的实例取到地址、en 与 zh 响应都非空、**en 的 nav 区块确实含字面量 `Docs`**（实测 2 条，均为 chrome）、en 响应**有 `<title>`** —— **fail 在第一段 zh 检查**：`Cookie: lang=zh` 没有让响应变成 `<html lang="zh">`。

**「无任务推进」的直接量**（⛔ 不是关键词扫描；含硬规则 2 的两半）：

```
grep -rl '^goal_ac: AC-302' tasks/*.md          ⇒ 0 命中   （本任务立案前的真值）
grep -rn 'AC-302'           tasks/*.md          ⇒ 0 命中   （连关键词都不存在于任何任务体）
grep -rl '^goal_ac: AC-301' tasks/*.md          ⇒ 1 命中   （已知为真的对照样本 ①）
grep -rl '^goal_ac: AC-300' tasks/*.md          ⇒ 1 命中   （已知为真的对照样本 ②）
grep -rl '^goal_ac: AC-29[0-9]' tasks/*.md      ⇒ 10 命中  （第二个对照：AC-290..299 全族）
在飞 worktree 侧同查（/home/yale/work/quay-worktrees/*/tasks/*.md）⇒ 0 命中
```

⇒ **两个已知为真样本 + 一个 10 条的族对照都命中** ⇒ 谓词本身可用，**不是恒零**（硬规则 2 的第二半：零计数配「谓词对已知为真样本干跑」）。**AC-290~AC-301 已各有 1 条任务，AC-302 一条都没有** —— 本任务是 `SITE_NAV_GROUPS` 的「知识」组第四个页面（`/doc`），缺口真实，⛔ 不是重复立案。

### 现状：`/doc` 的 zh 面**一处都没有接线**（三条互相独立的读数，⛔ 不互相顶替）

**读数 ①（live 面，同一 URL 两种请求头）**：

```
addr=127.0.0.1:4173
curl -sf                      http://$addr/doc ⇒ 32548 bytes, <html lang="en", <title>quay — Docs</title>
curl -sf -H 'Cookie: lang=zh' http://$addr/doc ⇒ 32548 bytes, <html lang="en", <title>quay — Docs</title>
diff <(en) <(zh) ⇒ 0 行 —— 两份响应逐字节相同（32548 = 32548）
nav_en = 2407 bytes, 字面量 Docs ×2 ; nav_zh = 2407 bytes, 字面量 Docs ×2
```

⛔ 不是「翻了但翻得不对」——是**连页头 `lang` 属性都没动**。

**读数 ②（源码侧按位置枚举，⛔ 不按关键词）** —— `/doc` 列表页外壳（`handleDocList`，`serve-doc.ts:9`）的断言点：

| 位置 | 字面量 | 归属 |
|---|---|---|
| `serve-doc.ts:9` | `cfg: ServePageCfg` | handler **已拿到 cfg（含 `lang`）**，只是没往下传；⚠️ **不是** `serve-goal.ts:305` 那种 `ServePageCfg \| string` 联合类型 ⇒ 直接 `cfg.lang` 即可，⛔ 不需要 `pageCfg` 归一化 |
| `serve-doc.ts:36` | `<html lang="en">` | 页头 lang 属性（判据**第一段**断言） |
| `serve-doc.ts:36` | `<title>${pageTitle("Docs", cfg.identity)}</title>` | 本页自己的 `<title>`（判据**第四段**断言；token = `"Docs"`） |
| `serve-doc.ts:37` | `renderMobileChrome("doc", "docs")` | 移动端 chrome（`lang` 缺省 ⇒ en；pageLabel 是**小写字面量 `"docs"`**，未过 `pageNameFor`） |
| `serve-doc.ts:37` | `renderSiteNav("doc")` | nav 条（**当前项 `Docs` 的桌面 + 移动两处来源**） |
| `serve-doc.ts:38` | `<h1>Managed documents (${docs.length})</h1>` | 本页 `<h1>`（判据不查它，但含 ASCII 英文，属本页 chrome；**动态串**；⚠️ token 是 `"Managed documents"`，**与 `<title>` 的 `"Docs"` 不是同一个串**） |
| `serve-doc.ts:7` | `import { … renderSiteNav, renderMobileChrome, renderBackLink, pageTitle } from "./serve-render.ts"` | **`pageNameFor` / `htmlLangTag` 都没 import** ⇒ 接线前须补（`pageNameFor` 出自 `serve-i18n.ts`、`htmlLangTag` 出自 `serve-lang.ts`） |

**字面量 `Docs` 在默认语言 `/doc` 响应里的全量枚举**（`tr '<' '\n<' \| grep -n 'Docs'` ⇒ **恰好 3 条，全部是 chrome**）：

```
652:title>quay — Docs                                                          ← 本页 <title>（判据第四段）
738:span class="mobile-menu-item nav-current" aria-current="page">Docs          ← nav 当前项（移动端菜单）
792:span class="nav-item nav-current" aria-current="page">Docs                  ← nav 当前项（桌面 nav）
```

（另：小写 `docs` 恰好 1 条 —— `677:span class="mobile-header-page">docs`，即 `:37` 的 `renderMobileChrome` pageLabel。）

第 2、3 条同出于 `serve-render.ts` 的 `SITE_NAV_GROUPS` → `navItem`（`:860`），标签来自 `NAV_LABELS.doc`（`serve-i18n.ts:68` = `{ en: "Docs", zh: "文档" }`，**已存在**）；第 1 条是 `:36` 的 `<title>`。⚠️ **本页 `<h1>` 是 `Managed documents (N)`、⛔ 不含 `Docs`**（与 AC-300/AC-301 的 h1 形态不同），所以全响应只有 3 条而不是 4 条。⚠️ 当轮 `docs-managed/` 下唯一一条记录 `DOC-001` 的 title 是 `quay-directive skill`（实测），**不含 `Docs`** ⇒ **数据侧 0 条**。

**读数 ③（判别性对照 —— 这一条把「陈旧实例」与「机制没接」分开，硬规则 4 推论四）**：

读数 ①② 里的实例 `/health` 报 `stale:true`（`processStartedAt: 2026-09-17T16:21:45.406Z` < `latestCodeCommitAt: 2026-09-17T18:04:20.000Z`）⇒ **单靠它无法区分**「`/doc` 没接线」与「该实例是旧代码」。于是取**另一个跑着新代码的实例**（AC-292 的 worktree，`pid=1424826`，`127.0.0.1:4192`，其 `/board` 接线已生效）作对照：

```
curl -H 'Cookie: lang=zh' http://127.0.0.1:4192/board ⇒ <html lang="zh"   ← 同一实例、同一 cookie，机制是活的
curl -H 'Cookie: lang=zh' http://127.0.0.1:4192/doc   ⇒ <html lang="en"   ← 同一实例、同一 cookie，/doc 没接
curl                        http://127.0.0.1:4192/doc   ⇒ <html lang="en"
```

⇒ **同一进程、同一 cookie，`/board` 变 zh 而 `/doc` 不变** ⇒ 成因被**单独钉在 `/doc` 的 handler 未穿 lang** 上：⛔ 不是实例陈旧（那样两个页面都会 en），⛔ 也不是语言机制坏了（那样 `/board` 也会 en）。**若「陈旧实例」是成因，上述第一行就不可能返回 `lang="zh"`** —— 这正是本条对照的判别力。

### ⚠️ 可满足性实测（本族任务的必要前置，⛔ 不是形式检查）—— 本页没有被打死的风险

```
'Docs' in nav_en   = 2      （桌面 + 移动 nav-current，均为 chrome）
'Docs' in 全 en 体 = 3      （另 1 条 = <title>，在 nav 区块之外）
小写 'docs' in nav 区块 = 0
nav_en = `grep -o '<nav.*</nav>'` ⇒ 2407 bytes（全响应 32548 bytes，占 7.4%）
`<nav` 计数 = 2，`</nav>` 计数 = 2（全响应）
nav_en 区间含 `<h1>`? ⇒ NO ；含 `<main>`? ⇒ NO （实测 grep -c '<h1\|<main' = 0）
```

⇒ **本页响应里的 `<nav` 只有两处，都在 `serve-render.ts`**（`:880` site-nav、`:918` mobile-menu；`serve-task.ts:731/799` 的两个 `<nav>` 属任务详情页，本页不引）**且都在 `<main>` 之前** ⇒ 贪婪匹配的 `<nav>…</nav>` 区间**在本页只覆盖 chrome**（实测：区间内 `Docs` 恰好 2 条，且不含 `<h1>`/`<main>`）。⇒ 判据可满足，且这个结论不依赖当前 workspace 的数据与排序。（对照：`/board` 的页内 CSS 注释含 "Board"、`/dashboard` 的活动流会渲出含 "Dashboard"/"Tasks" 的任务标题 —— 那两页的同形判据不可满足；本页**不是**那个形态。）

### ⚠️ 本任务会踩的四个陷阱（当场记下，⛔ 不是事后补充）

**陷阱 1 —— 本页要【三条】`PAGE_LABELS` 词条，其中两条是【小写 / 多词】。** `/doc` 的 `<title>` token、`<h1>` token、mobile pageLabel **是三个互不相同的字符串**（⚠️ 与 AC-300/AC-301 的「两条」形态**不同**，⛔ 不要照抄 2 条）：

- `"Docs"` —— `pageTitle` 的 token（判据**第四段**能否变绿就取决于它）；**⛔ 它不被 `<h1>` 复用**（h1 是 `Managed documents (N)`）；
- `"docs"` —— `renderMobileChrome` 的 pageLabel 用（**全小写！**渲染成 `<span class="mobile-header-page">`，在 `<nav class="mobile-menu">` **之外**，⛔ 判据读不到它——但它是本页 chrome）；
- `"Managed documents"` —— `<h1>` 的常量前缀（在 `<main>` 内，⛔ 判据读不到）。

**登记键必须与调用点传的字符串逐字相等**（ASCII 大小写与空格都计入：`Docs` ≠ `docs` ≠ `Managed documents`，三次独立查表）。⚠️ 若图省事把 `"docs"` 也映射到 `"Docs"` 的词条上，**en 基线会从 `docs` 变成 `Docs`** —— 那会破坏「改动前的调用点渲染逐字不变」，属 AC2 可被打红的范围。

**陷阱 2 —— `<h1>` 是动态串，⛔ 不得整串登记。** `serve-doc.ts:38` 是 `<h1>Managed documents (${docs.length})</h1>`，计数会变 ⇒ 接线形态只能是 `<h1>${pageNameFor("Managed documents", lang)} (${docs.length})</h1>`：把**常量前缀**过字典、计数原样插值。⛔ 不把 `"Managed documents (1)"` 之类的成品串写进 `PAGE_LABELS`。

**陷阱 3 —— `<main>` 内的两条条件串，本任务【不改】并具名登记（⛔ 不静默略过）。** `serve-doc.ts:39` 的 `No documents.`（空态，仅 `docs.length === 0` 时渲染）与同行的 `读失败:` 错误横幅（仅 `readError` 非空时渲染）**都不是默认 URL 上恒渲染的 chrome**。按 AC-301 对 `otherTabLabel` 的既定处置（条件渲染、默认 URL 结构性读不到 ⇒ ⛔ 不为它立判据、本任务不改），本任务同样**只登记不改**，登记在 AC3。⚠️ 这是**刻意**的范围决定，⛔ 不是遗漏：硬规则 4c —— 判据点名的量必须穿过所有中间层还取得到，而这两条在默认 URL 上取不到。

**陷阱 4 —— 同文件第二个路由 `/doc/<id>` 也有 `<html lang="en">`，但⛔ 不在本任务范围内。** `serve-doc.ts:47` 的 `handleDocDetail`（`:64` 的页头、`:65` 的 `renderMobileChrome("doc", String(d.id))` / `renderSiteNav("doc")`，均未传 lang）是**另一个路由**（`/doc/<id>`，⛔ 不在 `SITE_NAV_ROUTES` 的 15 条里）。GOAL-024 的范围与非目标明确限定 nav 路由 ⇒ 本任务**只接 `/doc` 列表**，把这一处作为**具名残留**交给 AC3（⛔ 不静默略过）。⇒ **AC5 的逐文件计数是 `serve-doc.ts` 2→1，不是 2→0**（⛔ 不要按 AC-290/291 的 2→0 形态照抄；本形态与 AC-300 的 `serve-adr.ts` 2→1、AC-301 的 `serve-goal.ts` 2→1 相同）。

### 机制前提（实测读数，⛔ 不是推测）

- **AC-288（`gap-ac288-webui-lang-switch-mechanism`，done）**：`packages/quay/src/serve-lang.ts:128` 导出 `htmlLangTag(lang: Lang = DEFAULT_LANG)`（返回 `<html lang="${lang}">`）；语言**每请求解析一次**在 `serve-handlers.ts:86`（`const reqCfg: ServePageCfg = { ...cfg, lang }`），并在 `:296-297`（`if (url.pathname === "/doc") await handleDocList(req, res, url, reqCfg)`）交给本 handler ⇒ **handler 已经拿到 `cfg.lang`，只是丢掉了**（`:36/:37` 全用默认参数）。`ServePageCfg.lang?: Lang`（`serve-render.ts`，缺省 `DEFAULT_LANG`）。
- **AC-289 的产物 `packages/quay/src/serve-i18n.ts` 已在 develop**，已给出：
  - `NAV_LABELS.doc = { en: "Docs", zh: "文档" }`（`serve-i18n.ts:68`）⇒ **nav 当前项那两处本任务不需要新词**；
  - `renderSiteNav(current, lang = DEFAULT_LANG)`（`serve-render.ts:878`）/ `renderMobileChrome(current, pageLabel, lang = DEFAULT_LANG)`（`:908`）/ `pageTitle(pageName, id, lang = DEFAULT_LANG)`（`:1079`，内部经 `pageNameFor`）/ `pageNameFor(pageName, lang = DEFAULT_LANG)`（`serve-i18n.ts:128`）—— 默认参数即「改动前的调用点渲染逐字不变」的作用域手段；
  - **`PAGE_LABELS` 立案时只有 5 条**（`Dashboard`、`Tasks`、`"task list"`、`"Live — loop activity"`、`Live`；`serve-i18n.ts:108-123`）。⚠️ **立案时 AC-292~AC-299 八条为 `ready`、AC-300/AC-301 为 `todo`（在飞/待办）**，它们各自会向同一张表追加本页词条 ⇒ 实现时**先读盘上实际内容**（`grep -n 'PAGE_LABELS' -A 45 packages/quay/src/serve-i18n.ts`），⛔ 不按本任务预写的表内容做假设。
- **AC-290/AC-291 已落地的接线模板**（`serve-task.ts` 的 AC-290、`serve-live.ts` 的 AC-291）—— 照抄形态：

```
${htmlLangTag(lang)}<head>…<title>${pageTitle("Live — loop activity", identity, lang)}</title></head>
<body>${renderMobileChrome("live", "live", lang)}${renderSiteNav("live", lang)}<main id="main">
<h1>${pageNameFor("Live", lang)} — 循环此刻在做什么</h1>
```

- ⇒ **本任务的核心工作量**：`serve-doc.ts` 的 `handleDocList` 从 `cfg` 取 `lang`（lang 属性 / title / mobile chrome / site nav / h1 五处）＋ 补 import（`pageNameFor` / `htmlLangTag`）＋ `PAGE_LABELS` 追加本页三条词条 ＋ 一个新测试文件。

### 操作前提（实测，⛔ 不是推测）——**判据的探针读的是【已在运行】的实例**

```
for p in $(pgrep -f 'quay.ts serve'); do echo "pid=$p cwd=$(readlink /proc/$p/cwd) args=$(tr '\0' ' ' < /proc/$p/cmdline | grep -oE -- '--host [^ ]+ --port [0-9]+')"; done
⇒ pid=867922   cwd=.../gap-ac291-… (deleted)                --port 51931
  pid=1424826  cwd=.../gap-ac292-board-…                    --port 4192   ← 兄弟任务 worktree 实例（读数③的对照）
  pid=3338894  cwd=.../gap-ac288-… (deleted)                --port 51921
  pid=3696699  cwd=/home/yale/work/quay   --host 0.0.0.0 --port 4173   ← 主检出实例（判据当轮命中，stale:true）
  主检出侧另有若干 churn 进程（当轮 `pid=1453692` 无 --host/--port 参数 ⇒ 判据的 `[ -n "$a" ] || continue` 会跳过它）
```

判据从 `git rev-parse --show-toplevel` 派生 root，再取**首个 cwd == root 且有 `--host --port` 的 serve 进程**。⇒

- 本任务的 live 读数一律取自**【本任务 worktree 内、跑本任务代码】的实例**（在 worktree 里跑判据时 `root` = worktree 根 ⇒ 探针命中自己的实例）；
- **主检出实例（4173）的重启是外部操作面**（它在 fan-in 之后才有意义，而 worker 在 fan-in 前就结束）—— 本任务只**如实报告**它的 `/health` 读数（AC6），⛔ 不为了让它变绿去重启/干扰不拥有的实例。
- ⚠️ 探针按 `pgrep` **取首个匹配**；重启自己的实例后须核对判据报出的 `addr=` 与你在跑的实例一致（memory `serve-probe-criterion-picks-first-pgrep-match-stale-instance`）。⚠️ `serve` 会泄漏孙进程（memory `quay-serve-leak-and-server-json-hijack`）⇒ 按 cwd 清孤儿，⛔ 不盲杀。

### 作用域与交叠（如实记录；机械的依赖边在顶层）

<!-- dedup-ref -->
- 本任务只做**这一页**的接线：新建本页三条页码词条 + 本页调用点传 lang。顶层 `depends_on` 只有两条，指向 AC-288 / AC-289 这两个**已 done** 的机制产物（它们**先落地**完成了，本任务不因它们阻塞）；⛔ **不改** `NAV_LABELS`（AC-289 的 15 行契约，`doc` 行已存在）、⛔ **不重写**四个共享渲染函数或 `serve-render.ts`、⛔ **不改** `serve-handlers.ts`（`reqCfg` 已带 lang 且 `:296-297` 已传入）、⛔ **不改** `goals/AC-302-*.md`（人与驱动维护面）。
- ⚠️ **同文件交叠（机制化，⛔ 不靠文风串行）**：`packages/quay/src/serve-i18n.ts` 同时出现在 AC-292~AC-301 十条任务的 `Touches` 里（立案当轮实测：AC-292~299 为 `ready`、AC-300/AC-301 为 `todo`）⇒ **派发器按 `Touches` 串行**，同一时刻只有一个任务能改它；本任务不为它们增加任何依赖边（这是同文件串行，不是逻辑上的先后关系）。`packages/quay/src/serve-doc.ts` 在本任务 Touches 内，**当前无在飞任务的 Touches 覆盖它**（立案当轮实测：`grep -rln 'serve-doc\.ts' tasks/*.md` 命中 6 条，**非 done 的 = 0 条**）⇒ 无并发写者。
- ⚠️ **上游测试耦合的实测核对（⛔ 不假定；本页的耦合面比 AC-301 的 `/goal` 更宽，实测如下）**：
  - `packages/quay/test/serve-goal-doc.test.mjs` 走**真服务器 HTTP**（`startServer({ port: 0 })` + 真 workspace，`:129` 断言 `/doc` 返回 200 且列出 DOC-001），⛔ **不直调 render 函数、不钉本页 chrome**（实测 `grep -n 'Managed documents\|mobile-header-page\|Docs'` ⇒ **0 命中**）⇒ 加 `lang` 参数位不影响它，且**刻意不声明**在本 Touches（无 delta）。它覆盖 `/doc` 的 **en** 基线 ⇒ **必须保持绿**（⛔ 不新建第二个覆盖同一批断言的文件）。
  - ⚠️ **两条钉了本页 `Docs` 字面量的测试，但它们读的是【默认 en】页**，而 `en` 列是**逐字身份**（`pageNameFor` 对 `en` 直接返回原 token）⇒ 按构造保持绿：`serve-nav-inconsistent-routes.test.mjs:78`（ROUTES 表 `["/doc", "doc", "Docs", "/doc"]`，`:160` 断言 site-nav 条内 `>Docs<`）、`serve-ac102-modernist-views.test.mjs:82`（`["/doc", "Docs"]`，label 只出现在断言**消息串**里）。⛔ **实现时仍必须先跑一遍**（⛔ 不靠这条推理代替实测）；红了就**当场加进 Touches** 并在任务体记下（⛔ 不静默改测试）。
  - 实测**无**测试断言 `PAGE_LABELS` 的条数或键集（`grep -rn 'PAGE_LABELS' packages/quay/test/*.mjs` ⇒ **0 命中**），`serve-i18n.test.mjs:126` 只按**具名 token** 断言 `pageNameFor` 的取值（`Dashboard`/`Tasks`/`"task list"`/未映射 token）⇒ 追加本页三条词条不会因表变大而红。

## Plan

1. **红基线**（⛔ 不假定仍等于立案值）：`node packages/quay/bin/quay.js goal gate AC-302 --dry-run --json; echo "GATE_EXIT=$?"`，贴完整输出与具名 `CAUSE=`（判据的所有者可能已改动它）。
2. **确认前提已落地 + 读【实际】签名与表内容**：`grep -n 'export function renderSiteNav\|export function renderMobileChrome\|export function pageTitle\|export function pageNameFor\|^export const NAV_LABELS' packages/quay/src/serve-render.ts packages/quay/src/serve-i18n.ts packages/quay/src/serve-lang.ts`；`grep -n 'PAGE_LABELS' -A 45 packages/quay/src/serve-i18n.ts` 读**盘上当前**表内容；`grep -n 'doc:' packages/quay/src/serve-i18n.ts` 复核 `NAV_LABELS.doc.zh`。**⛔ 不按本任务 Plan 预写的签名/表内容假设**；任一无命中 ⇒ **停下报缺**。
3. **接线 `serve-doc.ts` 的 `handleDocList`（⛔ 不碰 `handleDocDetail`）**：从 `cfg.lang` 取 lang（⚠️ `cfg` 已是 `ServePageCfg`，**不是**联合类型 ⇒ 直接读，⛔ 无需归一化）；`:36` 的 `<html lang="en">` → `${htmlLangTag(lang)}`、同行的 `pageTitle("Docs", cfg.identity)` → `pageTitle("Docs", cfg.identity, lang)`；`:37` 的 `renderMobileChrome("doc", "docs")` → `renderMobileChrome("doc", pageNameFor("docs", lang), lang)`、`renderSiteNav("doc")` → `renderSiteNav("doc", lang)`；`:38` 的 `<h1>Managed documents (…` → `<h1>${pageNameFor("Managed documents", lang)} (…`（陷阱 2）；补 import `pageNameFor`（自 `./serve-i18n.ts`）、`htmlLangTag`（自 `./serve-lang.ts`）（⛔ 若实现需要 `Lang`/`DEFAULT_LANG` 再按**实际签名**决定，`:7` 的现有 import 行不动其余符号）。五个渲染函数都有 `DEFAULT_LANG` 默认参数 ⇒ lang 为 `undefined` 时按构造回落 en（⛔ 不写 `?? "en"` 之类的兜底，那会让「没传 lang」与「传了 en」同形）。
4. **在 `serve-i18n.ts` 的 `PAGE_LABELS` 只追加本页【三条】词条**：`"Docs"`、`"docs"`、`"Managed documents"`（陷阱 1，**键逐字**：一个首字母大写、一个全小写、一个含空格的多词串）。zh 值必须非空、⛔ **不含 ASCII 字面量 `Docs`/`docs`**、⛔ 不得回落英文；`en` 列必须是**逐字身份**（`pageNameFor` 对 `en` 直接返回原 token ⇒ en 基线**按构造成立**，⛔ 不靠自觉）。同时**更新 ROW 3 的契约注释**（`serve-i18n.ts:21-25`，原文列 `/dashboard`、`/tasks`、`/live` 三页为已接线，把 `/doc` 列入已接线页，形态照 AC-290/291/300/301 的落地提交）。⛔ **不碰 `NAV_LABELS`、不碰已在表内的五条词条**。
5. **测试**：新建 `packages/quay/test/serve-doc-zh-chrome.test.mjs`（头注释 `// @test-group product`；形态照抄 `packages/quay/test/serve-live-zh-chrome.test.mjs`：黑盒真服务 `startServer({ port: 0 })` + nav 区块同法抽取 + 字典直调 + en 基线逐字钉死）。workspace 构造照抄 `packages/quay/test/serve-goal-doc.test.mjs`（真 `.quay/config.yml` + native provider + `docs-managed/` 目录；⛔ 裸 tasks 目录不是合法 workspace）。断言见 AC1~AC3。⚠️ 用 `port: 0` 让内核选端口，⛔ 不自己探端口 —— 端口冲突会让 provider 子进程泄漏并**挂住整个套件**。
6. **构建产物**：`npm run build -w quay`（新接线未进 bundle 会让 dist 类测试假红）。
7. **重启活实例**：AC-302 的探针从**已在运行**的 `quay.ts serve`（cwd = `git rev-parse --show-toplevel`）派生地址，⛔ 不自己启服务 ⇒ 在本任务 **worktree** 里起一个实例、**并从该 worktree** 跑判据；实现落地后**必须重启**它，否则判据读的是旧代码（陈旧实例会把「没生效」伪装成「实现没做」）。⛔ **不重启主检出上的实例**（`3696699`）—— 见 Proposal 的「操作前提」，本任务只报告它的 `/health`。
8. **收口**：红/绿两条读数 + 因果对照 + 全量残留枚举 + scoped 门绿。

## AC

- [ ] **AC1（live 面判别性读数：三段各自独立断言，⛔ 不报「整页看起来翻了」）**：在**运行中的** `quay.ts serve`（cwd = 本任务 worktree 根）上，`curl -H 'Cookie: lang=zh' http://$addr/doc` 的响应**分别**满足：① 含 `<html lang="zh"`；② nav 区块（`tr '\n' ' ' | grep -o '<nav.*</nav>'`）内**不再**含字面量 `Docs`（同一谓词在 **en** 上 = **2** ⇒ 该量能取假，不是空断言）；③ 该页**自己的** `<title>` 与 en 基线（立案值 `quay — Docs`）**逐字不同**（并排贴 en/zh 两条 `<title>`）且 zh 标题**不含 ASCII `Docs`**。⛔ 三处分开断言、分开贴原始片段（硬规则 3：枚举不是布尔）。
- [ ] **AC1b（判据读不到的那两处 chrome，⛔ 不得用 nav 区块的读数顶替）**：① `<span class="mobile-header-page">` 的文本在 zh 下不再是 `docs`（它渲染在 `<nav class="mobile-menu">` **之外** ⇒ 判据读不到）；② `<h1>` 在 zh 下不再是 `Managed documents (N)` 的纯英文形态（它在 `<main>` 内、nav 区块之外）。两处**分开**贴 zh 与 en 的原始片段。
- [ ] **AC2（可被打红——因果对照）**：把语言解析结果**临时**钳到 `"en"`（一次性本地改动，⛔ 不提交），证明 AC1 的 ②/③ 变红；还原后复绿。**两次读数并排贴出**。**再加更窄的一次对照**：只把语言**钳在字典入口**（`pageNameFor` / `navLabelsFor` 首行强制 `en`，AC-288 的机制原封不动）⇒ `<html lang>` 仍为 `zh` 而 nav/标题变红，判据自报的 `CAUSE=` 必须是 `nav-label-untranslated` 或 `title-unchanged`（⛔ 不是 `html-lang-not-zh`）——**这一条才把成因单独钉在字典接线上**（硬规则 4 推论四：一个能解释现象的说法不是一个被检验的结论）。
- [ ] **AC3（全量残留枚举 + 逐条归属，⛔ 不报「零」）**：对 zh 与 en **两份**响应各跑 `tr '<' '\n<' | grep -n 'Docs'`（以及小写 `docs`），把**每一条**命中的 HTML 片段与它的**产生源**贴出（chrome 出自哪一行源码 / 数据出自哪条记录），并给出 **nav 区块内**、**`<main>` 内**、**`<title>` 内**三个计数。⛔ 禁止只报一个总数（硬规则 3）。**判别性证法（⛔ 不是「数出来是 0」）**：同一个谓词在 **en** 响应上必须命中（立案基线：body **3 次**、nav 区块内 **2 次**）。**并显式登记本任务范围外的具名残留**：① `serve-doc.ts:39` 的 `No documents.` 空态串与同行的 `读失败:` 错误横幅（**条件渲染**、默认 URL 上读不到 ⇒ 本任务不改、⛔ 也不为它立判据，见陷阱 3）；② `serve-doc.ts:47`/`:64` 的 `/doc/<id>` 路由（页头 `<html lang="en">` 与未传 lang 的 `renderMobileChrome`/`renderSiteNav`）**本任务不改**，须在 AC5 的逐文件计数里如实体现（**2→1**）。
- [ ] **AC4（判据裁决原样记录）**：贴出**实现后**的 `node packages/quay/bin/quay.js goal gate AC-302 --dry-run --json` 完整输出 + `GATE_EXIT=`（⛔ 不解释、不改写它的 `CAUSE`）。**红就是红**：若仍红，把它具名 `CAUSE` 与 AC3 的归属一并交出。⛔ **明令禁止**的三种「凑绿」：改判据（`goals/AC-302-*.md` ⛔ 不在本 Touches 内）、改别的任务的 title、把 zh 值写成含英文 `Docs` 的混合串。
- [ ] **AC5（不回归 + 作用域枚举）**：① `bash scripts/test.sh --for-task gap-ac302-doc-page-zh-chrome-nav-current-and-own-title` 绿；② `node --test packages/quay/test/serve-*.test.mjs` 绿（**含** `serve-goal-doc.test.mjs`、`serve-i18n.test.mjs`、`serve-live-zh-chrome.test.mjs`、`serve-nav-inconsistent-routes.test.mjs`、`serve-ac102-modernist-views.test.mjs`）；③ **作用域举证**：`git diff --name-only develop...HEAD` **逐条**贴出，证明只有本任务 Touches 里的路径被动过（⛔ 其余 `serve-*.ts` 的硬编码标签点一字未改）；④ `grep -c 'html lang="en"' packages/quay/src/serve-doc.ts` **逐处**贴出并与立案基线对照（**立案基线 = 2**，即 `:36` `/doc` ＋ `:64` `/doc/<id>`）：本任务后 **2→1**（残留的那一处即 AC3 登记的具名范围外项）。⚠️ 若别的任务改动使全局计数变化，**不得记到自己账上**。
- [ ] **AC6（争用/陈旧实例的诚实报告，⛔ 不掩盖）**：贴出**驱动侧**可能命中的实例（cwd = 主检出；立案当轮为 `pid=3696699 --host 0.0.0.0 --port 4173`）的 `curl -sf http://<addr>/health` 原始读数，写明 `processStartedAt` / `latestCodeCommitAt` / `stale`，并**明写**「驱动侧仍可能在 `CAUSE=html-lang-not-zh` 上红，成因是该实例陈旧，与 `/doc` 的接线无关」—— ⛔ 不得据此把 AC1 的结论改写为「已达成」，⛔ 也不得为让它变绿而去重启/干扰本任务不拥有的实例。⚠️ 并复跑立案轮读数③的**判别性对照**（兄弟实例上 `/board`=zh 而 `/doc`=en），证明**成因定位不依赖那个陈旧实例**。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「多了一个 lang 参数、单测绿了」，而是**一个真实的 `quay serve` 进程在真实 HTTP 上，对同一个 URL 按请求头给出了两种语言的页面外壳**：

1. **落地对象**：运行中的实例上，`/doc` 在 `Cookie: lang=zh` 下页头 lang、本页 `<title>`、nav 当前项（桌面 + 移动）**都**变，且 en 基线逐字未变（32548 bytes / nav 2407 bytes / nav 内 `Docs` 2 条 / `quay — Docs`）—— **从响应体直读**（⛔ 不读 render 函数的返回值当「响应」，那测的是函数，不是线上行为）。
2. **可被打红**：AC2 的两次钳制对照**实际跑过**并贴上读数 ⇒ 证明这条判据不是结构上恒绿（硬规则 4）。
3. **判据裁决诚实**：AC4 的判据输出原样贴出，**红就是红**；⛔ 不用任何改写数据或改写字典值的方式把它变成绿色。若因「操作前提」里的陈旧/争用实例而红，按 AC6 具名报告，⛔ 不勾「已达成」后靠 Evidence 描述补救。
4. **作用域**：AC5 的逐处计数 + `--name-only`，证明其余文件未被顺手改掉，且**范围外的 `/doc/<id>` 一处被具名登记**而不是被悄悄算进「已全部双语」。
5. **可回滚**：写明回滚形态（还原 `serve-doc.ts` 的接线 + 删除 `serve-i18n.ts` 的本页三条词条 + 重跑 `npm run build -w quay` + 重启实例）与它的作用域（纯本地代码、无外部状态）。
6. **证据留痕**：红/绿判据输出、en/zh 两条原始响应片段、因果对照两次读数、全量残留枚举、逐处计数、驱动侧 `/health` 读数，落成**任务体内联**或**未跟踪** scratch 文件（`.quay/ac302-*`），可被下一轮独立复算（⛔ 不是只写一句「已修好」）。

## Touches

- tasks/gap-ac302-doc-page-zh-chrome-nav-current-and-own-title.md
- packages/quay/src/serve-doc.ts
- packages/quay/src/serve-i18n.ts
- packages/quay/test/serve-doc-zh-chrome.test.mjs (new)

（说明：`packages/quay/src/serve-lang.ts` 属 AC-288 的产物、四个共享渲染函数与 `NAV_LABELS` 属 AC-289 的产物、`serve-task.ts`/`serve-live.ts` 的接线模板属 AC-290/AC-291 的产物，⛔ 均不在本 Touches 的**改动**意图内（`serve-i18n.ts` 只追加本页三条 `PAGE_LABELS` 词条 + 更新 ROW 3 契约注释）；`packages/quay/src/serve-handlers.ts` **刻意不声明**——`reqCfg` 已带 lang 且 `:296-297` 已传入，无 delta；`packages/quay/test/serve-goal-doc.test.mjs`、`serve-nav-inconsistent-routes.test.mjs`、`serve-ac102-modernist-views.test.mjs` **刻意不声明**——实测无 delta（Proposal 已逐条核对），但若它们因本页改动变红则**当场**加进 Touches；`goals/AC-302-*.md` 属人与驱动维护面，⛔ 不在本 Touches。运行时证据落 `.quay/ac302-*` 并**保持未跟踪**，故不声明——`anti-drift-touches-check` 只比对已跟踪文件。）