---
id: gap-ac303-architecture-page-zh-chrome-nav-current-and-own-title
title: '"AC-303 缺口 —— /architecture 页面的 zh 切换完全未接线：页头 lang、本页 <title> 与导航当前项在
  Cookie: lang=zh 下与 en 逐字相同"'
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
goal_ac: AC-303
---
**type:** execution

## Proposal

**缺口（AC-303 判据，立案当轮直接量，`--dry-run` ⛔ 不写台账，`2026-09-17T18:43:33.644Z`，cwd = 主检出 `/home/yale/work/quay`）**：

```
node packages/quay/bin/quay.js goal gate AC-303 --dry-run --json
⇒ {"id":"AC-303","verdict":"fail",
   "reason":"acceptance failed (exit 1) — CAUSE=html-lang-not-zh -- /architecture with Cookie: lang=zh did not respond <html lang=\"zh\"> (addr=127.0.0.1:4173)",
   "timestamp":"2026-09-17T18:43:33.644Z","dryRun":true}
GATE_EXIT=1
```

判据自己钉死了缺口位置（硬规则 3b：它没有静默通过，而是打印了具名 `CAUSE=`）：它**已经走过**前四段检查 —— 从运行中的实例取到地址（pid 3696699，`--host 0.0.0.0 --port 4173`，cwd = 仓库根）、en 与 zh 响应都非空、**en 的 nav 区块确实含字面量 `Architecture`**（实测 2 条，均为 chrome）、en 响应**有 `<title>`** —— **fail 在第一段 zh 检查**：`Cookie: lang=zh` 没有让响应变成 `<html lang="zh">`。

**「无任务推进」的直接量**（⛔ 不是关键词扫描；含硬规则 2 的两半）：

```
grep -rl '^goal_ac: AC-303' tasks/*.md          ⇒ 0 命中   （本任务立案前的真值）
grep -rn 'AC-303'           tasks/*.md          ⇒ 0 命中   （连关键词都不存在于任何任务体）
grep -rl '^goal_ac: AC-302' tasks/*.md          ⇒ 1 命中   （已知为真的对照样本 ①）
grep -rl '^goal_ac: AC-301' tasks/*.md          ⇒ 1 命中   （已知为真的对照样本 ②）
grep -rl '^goal_ac: AC-300' tasks/*.md          ⇒ 1 命中   （已知为真的对照样本 ③）
grep -rlE '^goal_ac: AC-29[0-9]' tasks/*.md     ⇒ 10 命中  （第二个对照：AC-290..299 全族）
grep -rlE '^goal_ac: AC-30[0-2]' tasks/*.md     ⇒ 3 命中   （第三个对照：AC-300..302）
在飞 worktree 侧同查（/home/yale/work/quay-worktrees/*/tasks/*.md）⇒ 0 命中
```

⇒ **三个已知为真样本 + 一个 10 条的族对照都命中** ⇒ 谓词本身可用，**不是恒零**（硬规则 2 的第二半：零计数配「谓词对已知为真样本干跑」）。**AC-288~AC-302 各有其任务，AC-303 一条都没有** —— 本任务是 `SITE_NAV_ROUTES` 里 `/architecture` 这一页（nv 标签 `Architecture`），缺口真实，⛔ 不是重复立案。

### 现状：`/architecture` 的 zh 面**一处都没有接线**（三条互相独立的读数，⛔ 不互相顶替）

**读数 ①（live 面，同一 URL 两种请求头）**：

```
addr=127.0.0.1:4173
curl -sf                      http://$addr/architecture ⇒ 36567 bytes, <html lang="en">, <title>quay — Architecture — 系统组件图</title>
curl -sf -H 'Cookie: lang=zh' http://$addr/architecture ⇒ 36567 bytes, <html lang="en">, <title>quay — Architecture — 系统组件图</title>
diff <(en) <(zh) ⇒ 0 行 —— 两份响应逐字节相同（36567 = 36567）
nav_en = 2417 bytes, 字面量 Architecture ×2 ; nav_zh = 2417 bytes, 字面量 Architecture ×2
```

⛔ 不是「翻了但翻得不对」——是**连页头 `lang` 属性都没动**。

**读数 ②（源码侧按位置枚举，⛔ 不按关键词）** —— `/architecture` 页面外壳（`renderArchitecturePage`，`serve-architecture.ts:12`）的断言点：

| 位置 | 字面量 | 归属 |
|---|---|---|
| `serve-architecture.ts:6` | `import { … renderSiteNav, renderMobileChrome, obsNote, pageTitle } from "./serve-render.ts"` | **`pageNameFor` / `htmlLangTag` 都没 import** ⇒ 接线前须补；⚠️ 二者已由 `serve-render.ts:23-24` 再导出（`export { htmlLangTag, DEFAULT_LANG, … } from "./serve-lang.ts"` / `export { navLabel, navLabelsFor, pageNameFor, … } from "./serve-i18n.ts"`）⇒ 直接加进这条现有 import 即可，⛔ 不必新增 import 源 |
| `serve-architecture.ts:12` | `function renderArchitecturePage(arch, identity = null)` | 渲染入口签名；**无 `lang` 形参** |
| `serve-architecture.ts:72` | `<html lang="en">` | 页头 lang 属性（判据**第一段**断言） |
| `serve-architecture.ts:72` | `<title>${pageTitle("Architecture — 系统组件图", identity)}</title>` | 本页自己的 `<title>`（判据**第四段**断言；token = **整串** `Architecture — 系统组件图`） |
| `serve-architecture.ts:72` | `<meta name="description" content="Quay architecture — system component map">` | 页内 meta 描述（**小写** `architecture`；判据读不到；见陷阱 3） |
| `serve-architecture.ts:73` | `renderMobileChrome("architecture", "architecture")` | 移动端 chrome（`lang` 缺省 ⇒ en；pageLabel 是**小写字面量** `"architecture"`，渲染进 `<span class="mobile-header-page">`，在 `<nav class="mobile-menu">` **之外**） |
| `serve-architecture.ts:73` | `renderSiteNav("architecture")` | nav 条（**当前项 `Architecture` 的桌面 + 移动两处来源**） |
| `serve-architecture.ts:74` | `<h1>Architecture — 系统组件图</h1>` | 本页 `<h1>`（判据不查它，但含 ASCII 英文，属本页 chrome；**硬编码静态串**） |
| `serve-architecture.ts:83-95` | `handleArchitecture(req, res, cfg: ServePageCfg)`；`:95` `renderArchitecturePage(arch, cfg.identity)` | handler **已拿到 cfg（含 `lang`）**——`serve-handlers.ts:210-212` 传的是 AC-288 的 `reqCfg`——只是没有往下传；⚠️ **不是** `serve-goal.ts:305` 那种 `ServePageCfg \| string` 联合类型 ⇒ 直接 `cfg.lang` 即可，⛔ 不需要 `pageCfg` 归一化 |

**字面量 `Architecture`（首字母大写）在默认语言 `/architecture` 响应里的全量枚举**（`tr '<' '\n<' \| grep -n 'Architecture'` ⇒ **恰好 4 条，全部是 chrome**）：

```
653:title>quay — Architecture — 系统组件图                          ← 本页 <title>（判据第四段）
741:span class="mobile-menu-item nav-current" aria-current="page">Architecture   ← nav 当前项（移动端菜单）
795:span class="nav-item nav-current" aria-current="page">Architecture            ← nav 当前项（桌面 nav）
804:h1>Architecture — 系统组件图                                    ← 本页 <h1>
```

（另：**小写** `architecture` 恰好 2 条，⛔ 都不在 nav 区块内）：
```
8:meta name="description" content="Quay architecture — system component map">    ← :72 的 meta 描述
678:span class="mobile-header-page">architecture                                  ← :73 的 renderMobileChrome pageLabel
```

第 2、3 条同出于 `serve-render.ts` 的 `SITE_NAV_GROUPS` → `navItem`，标签来自 `NAV_LABELS.architecture`（`serve-i18n.ts:69` = `{ en: "Architecture", zh: "架构" }`，**已存在**）；第 1 条是 `:72` 的 `<title>`；第 4 条是 `:74` 的 `<h1>`。⚠️ 本页的组件表/图数据来自 `readArchitecture()`，其组件名是 `quay`/`quay-native`/`quay-github`/`web-ui`/`provider-abi`（实测），**不含 `Architecture`** ⇒ **数据侧 0 条**，四条命中全是 chrome。

**读数 ③（判别性对照 —— 这一条把「陈旧实例」与「机制没接」分开，硬规则 4 推论四）**：

读数 ①② 里的实例 `/health` 报 `stale:true`（`processStartedAt: 2026-09-17T16:21:45.405Z` < `latestCodeCommitAt: 2026-09-17T18:18:49.000Z`）⇒ **单靠它无法区分**「`/architecture` 没接线」与「该实例是旧代码」。于是取**另一个跑着新代码的实例**作对照（立案当轮在跑的兄弟 worktree 实例，如 AC-292 的 `127.0.0.1:4192`，其 `/board` 接线已生效）——实现时按下面「操作前提」的枚举取一个当轮活着的兄弟实例：

```
curl -H 'Cookie: lang=zh' http://<兄弟实例>/board           ⇒ <html lang="zh"   ← 同一实例、同一 cookie，机制是活的
curl -H 'Cookie: lang=zh' http://<兄弟实例>/architecture    ⇒ <html lang="en"   ← 同一实例、同一 cookie，/architecture 没接
curl                        http://<兄弟实例>/architecture  ⇒ <html lang="en"
```

⇒ **同一进程、同一 cookie，某个已接线页面变 zh 而 `/architecture` 不变** ⇒ 成因被**单独钉在 `/architecture` 的 handler 未穿 lang** 上：⛔ 不是实例陈旧（那样两个页面都会 en），⛔ 也不是语言机制坏了（那样已接线页面也会 en）。**若「陈旧实例」是成因，上述第一行就不可能返回 `lang="zh"`** —— 这正是本条对照的判别力。⚠️ 若当轮找不到任何活着的兄弟实例，**不得**据此跳过该对照：改用 AC2 的钳制对照（它不依赖第二个实例）。

### ⚠️ 可满足性实测（本族任务的必要前置，⛔ 不是形式检查）—— 本页没有被打死的风险

```
'Architecture' in nav_en   = 2      （桌面 + 移动 nav-current，均为 chrome）
'Architecture' in 全 en 体 = 4      （另 2 条 = <title> 与 <h1>，均在 nav 区块之外）
小写 'architecture' in nav 区块 = 0 ; 'mobile-header-page' in nav 区块 = 0
nav_en = `grep -o '<nav.*</nav>'` ⇒ 2417 bytes（全响应 36567 bytes，占 6.6%）
`<nav` 计数 = 2，`</nav>` 计数 = 2（全响应）
nav_en 区间含 `<h1>`? ⇒ NO ；含 `<main>`? ⇒ NO ；含 'component map'? ⇒ NO （实测 grep -c 均为 0）
```

⇒ **本页响应里的 `<nav` 只有两处，都在 `serve-render.ts`**（site-nav + mobile-menu；`serve-task.ts` 的两个 `<nav>` 属任务详情页，本页不引）**且都在 `<main>` 之前** ⇒ 贪婪匹配的 `<nav>…</nav>` 区间**在本页只覆盖 chrome**（实测：区间内 `Architecture` 恰好 2 条、小写 `architecture` 0 条、不含 `<h1>`/`<main>`/meta 描述）。⇒ 判据可满足，且这个结论不依赖当前 workspace 的数据与排序。（对照：`/board` 的页内 CSS 注释含 "Board"、`/dashboard` 的活动流会渲出含 "Dashboard"/"Tasks" 的任务标题 —— 那两页的同形判据不可满足；本页**不是**那个形态，因为 `/architecture` 的数据面（组件名）与 chrome 字面量不重叠。）

### ⚠️ 本任务会踩的四个陷阱（当场记下，⛔ 不是事后补充）

**陷阱 1 —— `pageTitle` 收到的是【整串】，登记裸 `Architecture` 不会命中。** `serve-architecture.ts:72` 传给 `pageTitle` 的 token 是 `"Architecture — 系统组件图"`（含 em dash 与中文副标题），**与 `/board` 的 `"Board — 三源 join 看板"` 同形**。⚠️ 与 AC-302 的 `/doc`（token 是裸 `"Docs"`）**不同**：若照 AC-302 的形态登记裸 `Architecture`，`pageNameFor` 查不到 ⇒ zh 的 `<title>` 原样返回英文整串 ⇒ 判据红在 `CAUSE=title-unchanged`。**登记键必须与调用点传的字符串逐字相等。**

**陷阱 2 —— 本页要【三条】`PAGE_LABELS` 词条，且是三个互不相同的字符串**（⚠️ 不是「两条」，也⛔ 不是 AC-302 的三条形态照抄）：

- `"Architecture — 系统组件图"` —— `pageTitle` 的 token（判据**第四段**能否变绿就取决于它）；**⛔ 它不被 `<h1>` 复用**（h1 是另一个串，见下）；
- `"Architecture"` —— `<h1>` 的 token（在 `<main>` 内，⛔ 判据读不到；但它是本页 chrome）；
- `"architecture"` —— `renderMobileChrome` 的 pageLabel 用（**全小写！**渲染成 `<span class="mobile-header-page">`，在 `<nav class="mobile-menu">` **之外**，⛔ 判据读不到）。

**登记键必须与调用点传的字符串逐字相等**（ASCII 大小写与空格都计入，三次独立查表）。⚠️ 若图省事把 `"architecture"` / `"Architecture"` 映射到同一条词条上，**en 基线会从 `architecture`/`Architecture` 变成另一个串** —— 那会破坏「改动前的调用点渲染逐字不变」。

**⚠️ 一处**具名的先例分歧**（⛔ 不是遗漏，是刻意的选择，实现者须知道）**：AC-291（`/live`，done）与 AC-292（`/board`，done）**都没有**把 `renderMobileChrome` 的 pageLabel 过字典（`renderMobileChrome("live", "live", lang)` / `("board", "board", lang)`），即那两页 zh 下的 `<span class="mobile-header-page">` **仍是小写英文**；而 AC-302（`/doc`，ready）**选择了接线**（为 `"docs"` 单独登记词条）。**本任务取 AC-302 的更严读法**（GOAL-024 的范围写的是「各自的 UI 外壳文案在 zh 下相对当前英文基线发生真实变化」，pageLabel 就是外壳文案）⇒ 登记第三条 `"architecture"`。这是**判断，不是推导**：若实现者发现更严读法与本仓库其它约束冲突，**必须在 AC3 具名登记该分歧并说明理由**，⛔ 不得静默按 AC-292 的 2 条形态做。

**陷阱 3 —— `<meta name="description">` 含小写 `architecture`，本任务【不改】并具名登记。** `serve-architecture.ts:72` 的 `content="Quay architecture — system component map"` 是页内 meta，**判据读不到**（不在 nav 区块、也不是 `<title>`），且它**不经过任何字典**。按 AC-291/AC-292 的既定处置（`serve-board.ts:244` 的 `content="Quay board — 三源 join 看板"`、`serve-live.ts:159` 的 `content="Quay live — …"` 两页落地后均**未翻译**），本任务同样**只登记不改**，登记在 AC3。⚠️ 这是**刻意**的范围决定，⛔ 不是遗漏：硬规则 4c —— 判据点名的量必须穿过所有中间层还取得到，而这条在默认 URL 上取不到、且没有对应机制（`PAGE_LABELS` 只被 `pageNameFor` 消费）。

**陷阱 4 —— 本文件只有【一个】路由，所以逐文件计数是 1→0。** `serve-architecture.ts` 里 `html lang="en"` 实测 **1** 处（`:72`），`handleArchitecture` 是唯一 handler，⛔ 没有 `/architecture/<id>` 之类的第二路由。⇒ AC5 的逐文件计数是 **1→0**（⛔ 不要按 AC-302 的 2→1 或 AC-290/291 的 2→0 形态照抄）。

**陷阱 5 —— `PAGE_LABELS` 是【被并发写】的共享表。** 立案当轮实测：`grep -rln 'serve-i18n.ts' tasks/*.md` 中**非 done 的有 10 条**（AC-293~AC-302，全为 `ready`），它们各自会向同一张表追加本页词条 ⇒ 实现时**先读盘上实际内容**（`grep -n 'PAGE_LABELS' -A 60 packages/quay/src/serve-i18n.ts`），⛔ 不按本任务预写的表内容做假设。表在立案当轮有 **7 条**（`Dashboard`、`Tasks`、`"task list"`、`"Live — loop activity"`、`Live`、`"Board — 三源 join 看板"`、`Board`）；ROW 3 契约注释（`serve-i18n.ts:21-25`）列已接线页为 `/dashboard`、`/tasks`、`/live`、`/board`。

### 机制前提（实测读数，⛔ 不是推测）

- **AC-288（`gap-ac288-webui-lang-switch-mechanism`，done）**：`packages/quay/src/serve-lang.ts:128` 导出 `htmlLangTag(lang: Lang = DEFAULT_LANG)`；语言**每请求解析一次**在 `serve-handlers.ts:86`（`const reqCfg: ServePageCfg = { ...cfg, lang }`），并在 `:210-212` 把它交给本 handler（`if (url.pathname === "/architecture") { await handleArchitecture(req, res, reqCfg); return; }`）⇒ **handler 已经拿到 `cfg.lang`，只是丢掉了**（`:95` 只传了 `cfg.identity`）。`ServePageCfg.lang?: Lang`（缺省 `DEFAULT_LANG`）。
- **AC-289 的产物 `packages/quay/src/serve-i18n.ts` 已在 develop**（`git cat-file -e develop:packages/quay/src/serve-i18n.ts` ⇒ 存在）且已随 fan-in 落进主检出（`ls` ⇒ 9280 bytes）。已给出：
  - `NAV_LABELS.architecture = { en: "Architecture", zh: "架构" }`（`serve-i18n.ts:69`）⇒ **nav 当前项那两处本任务不需要新词**；
  - `renderSiteNav(current, lang = DEFAULT_LANG)`（`serve-render.ts:878`）/ `renderMobileChrome(current, pageLabel, lang = DEFAULT_LANG)`（`:908`）/ `pageTitle(pageName, id, lang = DEFAULT_LANG)`（`:1079`，内部经 `pageNameFor`）/ `pageNameFor(pageName, lang = DEFAULT_LANG)`（`serve-i18n.ts:140`）/ `htmlLangTag(lang)`（`serve-lang.ts:128`）—— 默认参数即「改动前的调用点渲染逐字不变」的作用域手段；
  - `pageNameFor` 对**未登记的 token 在 zh 下原样返回英文**（ROW 3：a VISIBLE degradation，不是空白）。
- **已落地的接线模板**（`serve-live.ts:159-161` 的 AC-291、`serve-board.ts:244-246` 的 AC-292）—— 照抄形态：

```
${htmlLangTag(lang)}<head>…<title>${pageTitle("Board — 三源 join 看板", identity, lang)}</title></head>
<body>${renderMobileChrome("board", "board", lang)}${renderSiteNav("board", lang)}<main id="main">
<h1>${pageNameFor("Board", lang)} — 意图 / 执行 / 落地</h1>
```

- ⇒ **本任务的核心工作量**：`serve-architecture.ts` 的 `handleArchitecture`/`renderArchitecturePage` 从 `cfg` 取 `lang`（lang 属性 / title / mobile chrome / site nav / h1 五处）＋ 补 import（`pageNameFor` / `htmlLangTag`，二者已由 `serve-render.ts` 再导出）＋ `PAGE_LABELS` 追加本页三条词条 ＋ 一个新测试文件。
- **⛔ 本任务不会「顺带」变绿**：若只把 `renderSiteNav("architecture", lang)` 接上，nav 会翻、**本页 `<title>` 仍是英文**（`pageNameFor` 对未登记 token 原样返回）⇒ 判据**仍红**在 `CAUSE=title-unchanged`。那正是判据存在的意义：**「只有共享导航条变了」不算**。

### 操作前提（实测，⛔ 不是推测）——**判据的探针读的是【已在运行】的实例**

```
for p in $(pgrep -f 'quay.ts serve'); do echo "pid=$p cwd=$(readlink /proc/$p/cwd) args=$(tr '\0' ' ' < /proc/$p/cmdline | grep -oE -- '--host [^ ]+ --port [0-9]+')"; done
⇒ pid=867922   cwd=.../gap-ac291-… (deleted)      --host 127.0.0.1 --port 51931
  pid=3338894  cwd=.../gap-ac288-… (deleted)      --host 127.0.0.1 --port 51921
  pid=3696699  cwd=/home/yale/work/quay            --host 0.0.0.0 --port 4173   ← 主检出实例（判据当轮命中，stale:true）
```

判据从 `git rev-parse --show-toplevel` 派生 root，再取**首个 cwd == root 且有 `--host --port` 的 serve 进程**。⇒

- 本任务的 live 读数一律取自**【本任务 worktree 内、跑本任务代码】的实例**（在 worktree 里跑判据时 `root` = worktree 根 ⇒ 探针命中自己的实例）；
- **主检出实例（4173）的重启是外部操作面**（它在 fan-in 之后才有意义，而 worker 在 fan-in 前就结束）—— 本任务只**如实报告**它的 `/health` 读数（AC6），⛔ 不为了让它变绿去重启/干扰不拥有的实例。
- ⚠️ 探针按 `pgrep` **取首个匹配**；重启自己的实例后须核对判据报出的 `addr=` 与你在跑的实例一致（memory `serve-probe-criterion-picks-first-pgrep-match-stale-instance`）。⚠️ `serve` 会泄漏孙进程（memory `quay-serve-leak-and-server-json-hijack`）⇒ 按 cwd 清孤儿，⛔ 不盲杀。

### 作用域与交叠（如实记录；机械的依赖边在顶层）

<!-- dedup-ref -->
- 本任务只做**这一页**的接线：新建本页三条页码词条 + 本页调用点传 lang。顶层 `depends_on` 只有两条，指向 AC-288 / AC-289 这两个**已 done** 的机制产物（它们**先落地**完成了，本任务不因它们阻塞）；⛔ **不改** `NAV_LABELS`（AC-289 的 15 行契约，`architecture` 行已存在）、⛔ **不重写**四个共享渲染函数或 `serve-render.ts`、⛔ **不改** `serve-handlers.ts`（`reqCfg` 已带 lang 且 `:210-212` 已传入）、⛔ **不改** `goals/AC-303-*.md`（人与驱动维护面）。
- ⚠️ **同文件交叠（机制化，⛔ 不靠文风串行）**：`packages/quay/src/serve-i18n.ts` 同时出现在 AC-293~AC-302 十条任务的 `Touches` 里（立案当轮实测全部为 `ready`）⇒ **派发器按 `Touches` 串行**，同一时刻只有一个任务能改它；本任务不为它们增加任何依赖边（这是同文件串行，不是逻辑上的先后关系）。`packages/quay/src/serve-architecture.ts` 在本任务 Touches 内，**当前无在飞任务的 Touches 覆盖它**（立案当轮实测：`grep -rln 'serve-architecture\.ts' tasks/*.md` 命中 5 条，**非 done 的 = 0 条**）⇒ 无并发写者。
- ⚠️ **上游测试耦合的实测核对（⛔ 不假定）**：
  - 四条跨页测试断言 `/architecture` 的 chrome，**全部读【默认 en】页**，而 `en` 列是**逐字身份**（`pageNameFor` 与 `navLabel` 对 `en` 直接返回原 token）⇒ 按构造保持绿：`serve-nav-inconsistent-routes.test.mjs:79`（ROUTES 表 `["/architecture", "architecture", "Architecture", "/architecture"]`，`:160` 断言 site-nav 条内 `>Architecture<`）、`serve-ac102-modernist-views.test.mjs:83`（`["/architecture", "Architecture"]`，label 只出现在断言**消息串**里）、`serve-ac95-views.test.mjs:390`（`["/architecture", "Architecture — 系统组件图"]`，断言 en 页含该标题）、`serve-ac96-responsive-two-form.test.mjs:103`（断言 en 页 mobile menu 含 `Architecture`；`:100` 另断言 `mobile-header-page` **存在**，⛔ 不断言其文本）。⇒ `serve-ac96:103` 是本任务相关的一条：它读 en 页 ⇒ 不动。
  - 实测**无**测试断言 `PAGE_LABELS` 的条数或键集（`grep -rn 'PAGE_LABELS' packages/quay/test/*.mjs` ⇒ 0 命中）；`serve-i18n.test.mjs:61` 只按**具名 token** 断言 nav 表（`architecture: "Architecture"`）⇒ 追加本页页码词条不会因表变大而红。
  - ⛔ **实现时仍必须先跑一遍**（⛔ 不靠这条推理代替实测）；红了就**当场加进 Touches** 并在任务体记下（⛔ 不静默改测试）。
  - 本页**没有**专属的 `serve-architecture*.test.mjs`（立案当轮实测）⇒ 本任务**新建**一个，⛔ 不新建第二份覆盖同一批断言的文件。

## Plan

1. **红基线**（⛔ 不假定仍等于立案值）：`node packages/quay/bin/quay.js goal gate AC-303 --dry-run --json; echo "GATE_EXIT=$?"`，贴完整输出与具名 `CAUSE=`（判据的所有者可能已改动它）。
2. **确认前提已落地 + 读【实际】签名与表内容**：`git cat-file -e develop:packages/quay/src/serve-lang.ts`、`ls packages/quay/src/serve-i18n.ts`；`grep -n 'export function renderSiteNav\|export function renderMobileChrome\|export function pageTitle\|export function pageNameFor\|export function htmlLangTag' packages/quay/src/serve-render.ts packages/quay/src/serve-i18n.ts packages/quay/src/serve-lang.ts`；`grep -n 'PAGE_LABELS' -A 60 packages/quay/src/serve-i18n.ts` 读**盘上当前**表内容；`grep -n 'architecture:' packages/quay/src/serve-i18n.ts` 复核 `NAV_LABELS.architecture.zh`。**⛔ 不按本任务 Plan 预写的签名/表内容假设**；任一无命中 ⇒ **停下报缺**（⛔ 不要在这里重写一份字典，那会产生第二正本）。
3. **接线 `serve-architecture.ts`（仅本页）**：给 `renderArchitecturePage` 加第三形参 `lang: Lang = DEFAULT_LANG`（⚠️ 形参形状以落地后的实际签名为准）；`:72` 的 `<html lang="en">` → `${htmlLangTag(lang)}`、同行 `<title>` 把 lang 传给 `pageTitle`；`:73` 的 `renderMobileChrome("architecture", pageNameFor("architecture", lang), lang)`（陷阱 2 第三条）与 `renderSiteNav("architecture", lang)`；`:74` 的 `<h1>` → `${pageNameFor("Architecture", lang)} — 系统组件图`（陷阱 2 第二条）；`:95` 的调用点传 `cfg.lang`。补 import `pageNameFor` / `htmlLangTag`（**二者已由 `serve-render.ts:23-24` 再导出** ⇒ 加进 `:6` 的现有 import 行即可）。五个渲染函数都有 `DEFAULT_LANG` 默认参数 ⇒ lang 为 `undefined` 时按构造回落 en（⛔ 不写 `?? "en"` 之类的兜底，那会让「没传 lang」与「传了 en」同形）。
4. **在 `serve-i18n.ts` 的 `PAGE_LABELS` 只追加本页【三条】词条**（陷阱 1/2）：`"Architecture — 系统组件图"`、`"Architecture"`、`"architecture"`（**键逐字**：一个含 em dash 与中文的多词整串、一个首字母大写单词、一个全小写单词）。zh 值必须非空、⛔ **不含 ASCII 字面量 `Architecture`/`architecture`**、⛔ 不得回落英文；`en` 列必须是**逐字身份**（`pageNameFor` 对 `en` 直接返回原 token ⇒ en 基线**按构造成立**，⛔ 不靠自觉）。同时**更新 ROW 3 的契约注释**（`serve-i18n.ts:21-25`，把 `/architecture` 列入已接线页，形态照 AC-290/291/292/300/301 的落地提交）。⛔ **不碰 `NAV_LABELS`、不碰已在表内的其它页词条**。
5. **测试**：新建 `packages/quay/test/serve-architecture-zh-chrome.test.mjs`（头注释 `// @test-group product`；形态照抄 `packages/quay/test/serve-live-zh-chrome.test.mjs`：黑盒真服务 `startServer({ port: 0 })` + nav 区块同法抽取 + 字典直调 + en 基线逐字钉死）。workspace 构造照抄该文件的 fixture（真 `.quay/config.yml` + native provider + 临时 tasks 目录；⛔ 裸 tasks 目录不是合法 workspace）。断言见 AC1~AC3。⚠️ 用 `port: 0` 让内核选端口，⛔ 不自己探端口 —— 端口冲突会让 provider 子进程泄漏并**挂住整个套件**。
6. **构建产物**：`npm run build -w quay`（新接线未进 bundle 会让 dist 类测试假红）。
7. **重启活实例**：AC-303 的探针从**已在运行**的 `quay.ts serve`（cwd = `git rev-parse --show-toplevel`）派生地址，⛔ 不自己启服务 ⇒ 在本任务 **worktree** 里起一个实例、**并从该 worktree** 跑判据；实现落地后**必须重启**它，否则判据读的是旧代码（陈旧实例会把「没生效」伪装成「实现没做」）。⛔ **不重启主检出上的实例**（`3696699`）—— 见 Proposal 的「操作前提」，本任务只报告它的 `/health`。
8. **收口**：红/绿两条读数 + 因果对照 + 全量残留枚举 + scoped 门绿。

## AC

- [ ] **AC1（live 面判别性读数：三段各自独立断言，⛔ 不报「整页看起来翻了」）**：在**运行中的** `quay.ts serve`（cwd = 本任务 worktree 根）上，`curl -H 'Cookie: lang=zh' http://$addr/architecture` 的响应**分别**满足：① 含 `<html lang="zh"`；② nav 区块（`tr '\n' ' ' | grep -o '<nav.*</nav>'`）内**不再**含字面量 `Architecture`（同一谓词在 **en** 上 = **2** ⇒ 该量能取假，不是空断言）；③ 该页**自己的** `<title>` 与 en 基线（立案值 `quay — Architecture — 系统组件图`）**逐字不同**（并排贴 en/zh 两条 `<title>`）且 zh 标题**不含 ASCII `Architecture`**。⛔ 三处分开断言、分开贴原始片段（硬规则 3：枚举不是布尔）。
- [ ] **AC1b（判据读不到的那两处 chrome，⛔ 不得用 nav 区块的读数顶替）**：① `<span class="mobile-header-page">` 的文本在 zh 下不再是 `architecture`（它渲染在 `<nav class="mobile-menu">` **之外** ⇒ 判据读不到）；② `<h1>` 在 zh 下不再是 `Architecture — 系统组件图` 的纯英文形态（它在 `<main>` 内、nav 区块之外）。两处**分开**贴 zh 与 en 的原始片段。
- [ ] **AC2（可被打红——因果对照）**：把语言解析结果**临时**钳到 `"en"`（一次性本地改动，⛔ 不提交），证明 AC1 的 ②/③ 变红；还原后复绿。**两次读数并排贴出**。**再加更窄的一次对照**：只把语言**钳在字典入口**（`pageNameFor` / `navLabelsFor` 首行强制 `en`，AC-288 的机制原封不动）⇒ `<html lang>` 仍为 `zh` 而 nav/标题变红，判据自报的 `CAUSE=` 必须是 `nav-label-untranslated` 或 `title-unchanged`（⛔ 不是 `html-lang-not-zh`）——**这一条才把成因单独钉在字典接线上**（硬规则 4 推论四：一个能解释现象的说法不是一个被检验的结论）。
- [ ] **AC3（全量残留枚举 + 逐条归属，⛔ 不报「零」）**：对 zh 与 en **两份**响应各跑 `tr '<' '\n<' | grep -n 'Architecture'`（以及小写 `architecture`），把**每一条**命中的 HTML 片段与它的**产生源**贴出（chrome 出自哪一行源码 / 数据出自哪条记录），并给出 **nav 区块内**、**`<main>` 内**、**`<title>` 内**三个计数。⛔ 禁止只报一个总数（硬规则 3）。**判别性证法（⛔ 不是「数出来是 0」）**：同一个谓词在 **en** 响应上必须命中（立案基线：全响应 `Architecture` **4 次**、nav 区块内 **2 次**；小写 `architecture` 全响应 **2 次**、nav 区块内 **0 次**）。**并显式登记本任务范围外的具名残留**：① `serve-architecture.ts:72` 的 `<meta name="description" content="Quay architecture — system component map">`（小写、不经字典、判据读不到 ⇒ 本任务不改，见陷阱 3）；② **`renderMobileChrome` pageLabel 的接线分歧**——AC-291/AC-292 未接线而 AC-302 已接线，本任务按 AC-302 的更严读法执行，须在 AC3 具名记录实际取法（陷阱 2）。
- [ ] **AC4（判据裁决原样记录）**：贴出**实现后**的 `node packages/quay/bin/quay.js goal gate AC-303 --dry-run --json` 完整输出 + `GATE_EXIT=`（⛔ 不解释、不改写它的 `CAUSE`）。**红就是红**：若仍红，把它具名 `CAUSE` 与 AC3 的归属一并交出。⛔ **明令禁止**的三种「凑绿」：改判据（`goals/AC-303-*.md` ⛔ 不在本 Touches 内）、改别的任务的 title、把 zh 值写成含英文 `Architecture` 的混合串。
- [ ] **AC5（不回归 + 作用域枚举）**：① `bash scripts/test.sh --for-task gap-ac303-architecture-page-zh-chrome-nav-current-and-own-title` 绿；② `node --test packages/quay/test/serve-*.test.mjs` 绿（**含** `serve-nav-inconsistent-routes.test.mjs`、`serve-ac102-modernist-views.test.mjs`、`serve-ac95-views.test.mjs`、`serve-ac96-responsive-two-form.test.mjs`、`serve-i18n.test.mjs`、`serve-live-zh-chrome.test.mjs`）；③ **作用域举证**：`git diff --name-only develop...HEAD` **逐条**贴出，证明只有本任务 Touches 里的路径被动过（⛔ 其余 `serve-*.ts` 的硬编码标签点一字未改）；④ `grep -c 'html lang="en"' packages/quay/src/serve-architecture.ts` **逐处**贴出并与立案基线对照（**立案基线 = 1**，即 `:72` 唯一路由）：本任务后 **1→0**（陷阱 4；⛔ 不要按 AC-302 的 2→1 照抄）。⚠️ 若别的任务改动使全局计数变化（立案基线全局 = **19**），**不得记到自己账上**。
- [ ] **AC6（争用/陈旧实例的诚实报告，⛔ 不掩盖）**：贴出**驱动侧**可能命中的实例（cwd = 主检出；立案当轮为 `pid=3696699 --host 0.0.0.0 --port 4173`，`/health` 立案值 `stale:true`，`processStartedAt: 2026-09-17T16:21:45.405Z` < `latestCodeCommitAt: 2026-09-17T18:18:49.000Z`）的 `curl -sf http://<addr>/health` **原始读数**，写明 `processStartedAt` / `latestCodeCommitAt` / `stale`，并**明写**「驱动侧仍可能在 `CAUSE=html-lang-not-zh` 上红，成因是该实例陈旧，与 `/architecture` 的接线无关」—— ⛔ 不得据此把 AC1 的结论改写为「已达成」，⛔ 也不得为让它变绿而去重启/干扰本任务不拥有的实例。⚠️ 并复跑立案轮读数③的**判别性对照**（兄弟实例上某已接线页 = zh 而 `/architecture` = en），证明**成因定位不依赖那个陈旧实例**。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「多了一个 lang 参数、单测绿了」，而是**一个真实的 `quay serve` 进程在真实 HTTP 上，对同一个 URL 按请求头给出了两种语言的页面外壳**：

1. **落地对象**：运行中的实例上，`/architecture` 在 `Cookie: lang=zh` 下页头 lang、本页 `<title>`、nav 当前项（桌面 + 移动）**都**变，且 en 基线逐字未变（36567 bytes / nav 2417 bytes / nav 内 `Architecture` 2 条 / `quay — Architecture — 系统组件图`）—— **从响应体直读**（⛔ 不读 render 函数的返回值当「响应」，那测的是函数，不是线上行为）。
2. **可被打红**：AC2 的两次钳制对照**实际跑过**并贴上读数 ⇒ 证明这条判据不是结构上恒绿（硬规则 4）。
3. **判据裁决诚实**：AC4 的判据输出原样贴出，**红就是红**；⛔ 不用任何改写数据或改写字典值的方式把它变成绿色。若因「操作前提」里的陈旧/争用实例而红，按 AC6 具名报告，⛔ 不勾「已达成」后靠 Evidence 描述补救。
4. **作用域**：AC5 的逐处计数 + `--name-only`，证明其余文件未被顺手改掉，且**范围外的 meta 描述一处被具名登记**（陷阱 3）而不是被悄悄算进「已全部双语」。
5. **可回滚**：写明回滚形态（还原 `serve-architecture.ts` 的接线 + 删除 `serve-i18n.ts` 的本页三条词条 + 重跑 `npm run build -w quay` + 重启实例）与它的作用域（纯本地代码、无外部状态）。
6. **证据留痕**：红/绿判据输出、en/zh 两条原始响应片段、因果对照两次读数、全量残留枚举、逐处计数、驱动侧 `/health` 读数，落成**任务体内联**或**未跟踪** scratch 文件（`.quay/ac303-*`），可被下一轮独立复算（⛔ 不是只写一句「已修好」）。

## Touches

- tasks/gap-ac303-architecture-page-zh-chrome-nav-current-and-own-title.md
- packages/quay/src/serve-architecture.ts
- packages/quay/src/serve-i18n.ts
- packages/quay/test/serve-architecture-zh-chrome.test.mjs (new)

（说明：`packages/quay/src/serve-lang.ts` 属 AC-288 的产物、四个共享渲染函数与 `NAV_LABELS` 属 AC-289 的产物、`serve-live.ts`/`serve-board.ts`/`serve-task.ts` 的接线模板属 AC-291/AC-292/AC-290 的产物，⛔ 均不在本 Touches 的**改动**意图内（`serve-i18n.ts` 只追加本页三条 `PAGE_LABELS` 词条 + 更新 ROW 3 契约注释）；`packages/quay/src/serve-handlers.ts` **刻意不声明**——`reqCfg` 已带 lang 且 `:210-212` 已传入，无 delta；`packages/quay/src/serve-render.ts` **刻意不声明**——本任务只从它**再导出**的符号里取用，Δ=0；`packages/quay/test/serve-nav-inconsistent-routes.test.mjs`、`serve-ac102-modernist-views.test.mjs`、`serve-ac95-views.test.mjs`、`serve-ac96-responsive-two-form.test.mjs`、`serve-i18n.test.mjs` **刻意不声明**——实测无 delta（Proposal 已逐条核对，均读默认 en 页），但若它们因本页改动变红则**当场**加进 Touches；`goals/AC-303-*.md` 属人与驱动维护面，⛔ 不在本 Touches。运行时证据落 `.quay/ac303-*` 并**保持未跟踪**，故不声明——`anti-drift-touches-check` 只比对已跟踪文件。）