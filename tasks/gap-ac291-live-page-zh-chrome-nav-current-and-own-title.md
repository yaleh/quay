---
id: gap-ac291-live-page-zh-chrome-nav-current-and-own-title
title: "AC-291 缺口 —— /live 页面的 zh 切换完全未接线：页头 lang、本页 <title> 与导航当前项在 cookie:
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
goal_ac: AC-291
---
**type:** execution

## Proposal

**缺口（AC-291 判据，立案当轮直接量，`--dry-run` ⛔ 不写台账，2026-09-17T16:47:44Z，cwd = 主检出 `/home/yale/work/quay`）**：

```
node packages/quay/bin/quay.js goal gate AC-291 --dry-run --json
⇒ {"id":"AC-291","verdict":"fail",
   "reason":"acceptance failed (exit 1) — CAUSE=html-lang-not-zh -- /live with Cookie: lang=zh did not respond <html lang=\"zh\"> (addr=127.0.0.1:4173)",
   "timestamp":"2026-09-17T16:47:44.027Z","dryRun":true, ...}
GATE_EXIT=1
```

**判据自己钉死了缺口位置**（硬规则 3b：它没有静默通过，而是打印了具名 `CAUSE=`）：它**已经走过**前三段检查 ——
从运行中的实例取到了地址、en 响应非空、en 的 nav 区块**确实含字面量 `Live`**、en 响应**有 `<title>`** ——
**fail 在第一段 zh 检查**：`Cookie: lang=zh` 没有让响应变成 `<html lang="zh">`。

**「无任务推进」的直接量（⛔ 不是关键词扫描；含硬规则 2 的两半）**：

```
grep -rn '^goal_ac: AC-291' tasks/*.md   ⇒ 0 命中
grep -rn '^goal_ac: AC-290' tasks/*.md   ⇒ 1 命中（已知为真的对照样本，证明该谓词本身可用，不是恒零）
grep -rn 'AC-291'          tasks/*.md   ⇒ 0 命中（连正文提及都没有）
```

### 现状：`/live` 的 zh 面**一处都没有接线**（两条互相独立的读数）

**读数 ①（live 面，同一 URL 两种请求头，响应逐字节相同）**：

```
curl -sf                       http://127.0.0.1:4173/live  ⇒ 34943 bytes, <html lang="en", <title>quay — Live — loop activity</title>
curl -sf -H 'Cookie: lang=zh'  http://127.0.0.1:4173/live  ⇒ 34943 bytes, <html lang="en", <title>quay — Live — loop activity</title>
比较两份响应体：IDENTICAL
```

⛔ 不是「翻了但翻得不对」——是**连页头 `lang` 属性都没动**：两份响应体字节数相同。

**读数 ②（源码侧按位置枚举）** —— `/live` 外壳（`renderLivePage`）的三个断言点：

| 位置 | 字面量 | 归属 |
|---|---|---|
| `serve-live.ts:150` | `<html lang="en">` | 页头 lang 属性（AC-291 的**第一段**断言） |
| `serve-live.ts:150` | `<title>${pageTitle("Live — loop activity", identity)}</title>` | 本页自己的 `<title>`（**第三段**断言；字面量 `Live` 的来源之一） |
| `serve-live.ts:151` | `renderMobileChrome("live", "live")` | 移动端 chrome（nav 当前项的**移动端**那处） |
| `serve-live.ts:151` | `renderSiteNav("live")` | nav 条（**当前项** `Live` 的桌面来源） |
| `serve-live.ts:152` | `<h1>Live — 循环此刻在做什么</h1>` | 本页 `<h1>`（判据不查它，但属 GOAL-024 的「本页 chrome」） |

**字面量 `Live` 在默认语言 `/live` 响应里的全量枚举**（`curl -sf http://127.0.0.1:4173/live | tr '<' '\n<' | grep -n 'Live'` ⇒ **恰好 4 条**，**全部是 chrome，零条来自数据**）：

```
653:title>quay — Live — loop activity
701:span class="mobile-menu-item nav-current" aria-current="page">Live
765:span class="nav-item nav-current" aria-current="page">Live
804:h1>Live — 循环此刻在做什么
```

第 2、3 条同出于 `serve-render.ts` 的 `SITE_NAV_GROUPS` → `navItem`；第 1 条出自 `pageTitle`；第 4 条是 `:152` 硬编码。
**判据的作用域（实测）**：它对 `/live` 只在 **nav 区块**（`grep -o '<nav.*</nav>'`，实测 **2433 字节**，含移动端菜单 + 桌面 nav 两个 `<nav>`，**不含页面正文**）
与**本页 `<title>`** 上断言 ⇒ 与 `/board`、`/dashboard` 那两条判据不同，**本判据没有被数据命中打死的风险**：
`/live` 渲染的是 `taskId` / `runId` / `pid` / 状态与阶段列（`serve-live.ts:88-96/138-141`），**不渲染任何任务 `title`**
（本任务自己的 title 因此不构成对该判据的自伤，但仍刻意只写小写路由串 `/live`，与 AC-289/AC-290 的既有约束一致）。

### 机制前提（实测读数，⛔ 不是推测）——**本任务的真正难点：本页的 `<title>` 不会「顺带」被翻**

- **AC-288（`gap-ac288-webui-lang-switch-mechanism`）已 done 且已落 develop**：
  `git log --oneline -1 develop -- packages/quay/src/serve-lang.ts` ⇒ `e778958bf`；
  语言**每请求解析一次**在 `serve-handlers.ts:86`（`const reqCfg: ServePageCfg = { ...cfg, lang }`），
  并在 `:220` 把它交给 `/live` 的 handler。⇒ **`handleLive` 现在【已经拿到】`cfg.lang`，只是丢掉了**：
  `serve-live.ts:192` 是 `res.end(renderLivePage(live, cfg.identity))` —— 第二个参数位之后没有 lang。
- **AC-289（`gap-ac289-dashboard-zh-nav-label-and-own-title`）status=ready（在飞）**，其产物 `packages/quay/src/serve-i18n.ts`
  **只活在它的 worktree 里**（`git cat-file -e develop:packages/quay/src/serve-i18n.ts` ⇒ 不存在；主检出 `ls` ⇒ No such file）。
  该文件（**在飞分支上的实测内容，⛔ 不是我的假设**）已经给出：
  - `NAV_LABELS` **15 条全给**，其中 `live: { en: "Live", zh: "实时" }` ⇒ **nav 当前项那两处本任务不需要新词**；
  - `renderSiteNav(current, lang = "en")` / `renderMobileChrome(current, pageLabel, lang = "en")` /
    `pageTitle(pageName, id, lang = "en")` / `pageNameFor(pageName, lang)` —— 默认参数即作用域手段；
  - **`PAGE_LABELS` 只登记了 `Dashboard` 一条**，且它的契约 ROW 3 逐字写明：
    「only /dashboard is wired here, because that is AC-289's scope; **the other 14 pages' page-chrome is AC-290~303**」。
- ⇒ **本任务的核心工作量正是这一条**：`pageNameFor` 对**未登记的 token 在 zh 下原样返回英文**
  （ROW 3：a VISIBLE degradation，不是空白）⇒ 若只把 `renderSiteNav("live", lang)` 接上，
  **nav 会翻、本页 `<title>` 仍是 `Live — loop activity`** ⇒ 判据**仍红**在 `CAUSE=title-unchanged`
  （那正是判据存在的意义：**「只有共享导航条变了」不算**）。
  ⇒ 必须为 `/live` 在 `serve-i18n.ts` 的 `PAGE_LABELS` 里补本页的页码词条（`<title>` 的完整 token，以及 `<h1>` 的 token）。

### 作用域与交叠（如实记录，⛔ 不含任何前置声明；机械的依赖边在顶层 `depends_on`）

- 本任务只做**这一页**的接线：**新建词条 + 本页调用点传 lang**。⛔ **不改** `NAV_LABELS`（AC-289 的 15 行契约，`live` 行已存在）、
  ⛔ **不重写**四个共享渲染函数（AC-289 的产物）、⛔ **不改** `serve-live.ts:162-164` 的 `/journal` 页面（另一个 nav 路由，属 AC-296）。
- `packages/quay/src/serve-i18n.ts` 同时被 AC-289 的 `Touches` 声明 ⇒ 派发器按 Touches 串行，**本任务不会与它并发**；
  顶层 `depends_on` 又已把它排在前面（机制化声明，⛔ 不靠文风上的「先做」）。
- `packages/quay/src/serve-live.ts` 目前**没有任何在飞任务**声明（`grep -rln` 命中的 9 个任务**全部 status: done**）⇒ 无并发交叠。
- 相邻任务的一处**结构性观察**（记录，⛔ 不在此修）：`gap-ac290-...-tasks-page-zh-shell-lang-title-nav-current` 的 AC1③
  要求 `/tasks` **本页 `<title>`** 在 zh 下与 en 逐字不同，而它的 `Touches` **不含** `serve-i18n.ts` —— 按 AC-289 的 ROW 3，
  那正是页码词条唯一能登记的地方。**这是那个任务的接线缺口，不是本任务的**，本任务只保证 `/live` 这一页走通。

## Plan

1. **红基线**（⛔ 不假定仍等于立案值）：`node packages/quay/bin/quay.js goal gate AC-291 --dry-run --json; echo "GATE_EXIT=$?"`，贴完整输出与具名 `CAUSE=`。
2. **确认前置已落地 + 读【实际】签名**：`git cat-file -e develop:packages/quay/src/serve-lang.ts`、
   `ls packages/quay/src/serve-i18n.ts`、`grep -n 'export function renderSiteNav\|export function renderMobileChrome\|export function pageTitle\|export function pageNameFor\|const PAGE_LABELS' packages/quay/src/serve-render.ts packages/quay/src/serve-i18n.ts`。
   **⛔ 不按本任务 Plan 预写的签名假设**：以 AC-288/AC-289 落地后的**实际**参数位为准；任一无命中 ⇒ **停下报缺**。
3. **接线 `serve-live.ts`（仅本页）**：`renderLivePage(live, identity, lang = DEFAULT_LANG)`；
   `:150` 的 `<html lang="en">` 改为 `${htmlLangTag(lang)}`、`<title>` 把 lang 传给 `pageTitle`；
   `:151` 的 `renderMobileChrome` / `renderSiteNav` 传 lang；`:152` 的 `<h1>` 取页码词条（**en 必须是 identity ⇒ en 基线逐字不变**）；
   `handleLive:192` 传 `cfg.lang`。
4. **在 `serve-i18n.ts` 的 `PAGE_LABELS` 只追加 `/live` 的两条本页词条**（`<title>` 的 token + `<h1>` 的 token）：
   zh 值必须非空、⛔ 不含 ASCII 字面量 `Live`（否则是本判据的 gate-gameability 形态：值「看着翻了」而断言仍红）、
   ⛔ 不得回落英文。**⛔ 不碰 `NAV_LABELS`、不碰它的契约注释行。**
5. ⛔ **不碰 `/journal`**（`serve-live.ts:162-164`）：它不是本判据的路由，也不是本任务的页面（属 AC-296）⇒ 出作用域。
6. **测试**：新建 `packages/quay/test/serve-live-zh-chrome.test.mjs`（黑盒：真 workspace（`.quay/config.yml` + native provider）
   + `startServer({ port: 0 })`；断言 zh 下 ① 含 `<html lang="zh"` ② nav 当前项**两处**文本都不是 `Live`
   ③ 本页 `<title>` 与 en 逐字不同且等于字典词；**外加 en 负控制：en 响应与今天的基线逐字相同**——
   没有这条对照，②③ 可能由别的改动满足）。
   ⚠️ 用 `port: 0` 让内核选端口，⛔ 不自己探端口——端口冲突会让 provider 子进程泄漏并**挂住整个套件**。
7. **构建产物**：`npm run build -w quay`（新接线未进 bundle 会让 dist 类测试假红）。
8. **重启活实例**：AC-291 的探针从**已在运行**的 `quay.ts serve`（cwd = 仓库根）派生地址，⛔ 不自己启服务
   ⇒ 实现落地后**必须重启该实例**，否则判据读的是旧代码（陈旧实例会把「没生效」伪装成「实现没做」）。
9. **收口**：红/绿两条读数 + 因果对照 + 全量残留枚举 + scoped 门绿。

## AC

- [ ] **AC1（live 面判别性读数：三段各自独立断言）**：在**运行中的** `quay.ts serve`（cwd = 仓库根）上，
  `curl -H 'Cookie: lang=zh' http://$addr/live` 的响应**分别**满足：① 含 `<html lang="zh"`；
  ② nav 当前项**两处**（桌面 `class="nav-item nav-current"` 与移动 `class="mobile-menu-item nav-current"`）
  的文本都**不是** `Live`；③ 该页**自己的** `<title>` 与 en 基线**逐字不同**（并排贴 en/zh 两条 `<title>`）。
  ⛔ 三处分开断言、分开贴原始片段——只报「整页看起来翻了」不算（硬规则 3：枚举不是布尔）。
- [ ] **AC2（可被打红——因果对照）**：把语言解析结果**临时**钳到 `"en"`（一次性本地改动，⛔ 不提交），
  证明 AC1 的 ②/③ 变红；还原后复绿。**两次读数并排贴出**。⛔ 无此对照 ⇒「是本次接线造成的」只是一句未被检验的断言
  （硬规则 4 推论四）。
- [ ] **AC3（全量残留枚举 + 逐条归属，⛔ 不报「零」）**：对 zh 响应跑 `tr '<' '\n<' | grep -n 'Live'`，
  把**每一条**命中的 HTML 片段与它的**产生源**贴出（chrome 出自哪一行源码 / 数据出自哪个 `tasks/*.md`），
  并给出 **chrome 计数**与**数据计数**两个数。⛔ 禁止只报一个总数（硬规则 3）。预期：zh 下 nav 区块内 `Live` 计数 = 0。
- [ ] **AC4（判据裁决原样记录）**：贴出**实现后**的 `node packages/quay/bin/quay.js goal gate AC-291 --dry-run --json`
  完整输出 + `GATE_EXIT=`（⛔ 不解释、不改写它的 `CAUSE`）。**红就是红**：若仍红，把它具名 `CAUSE` 与 AC3 的归属一并交出。
  ⛔ **明令禁止**的三种「凑绿」：改判据（`goals/AC-291-*.md` ⛔ 不在本 Touches 内）、改别的任务的 title、把 zh 值写成含英文 `Live` 的混合串。
- [ ] **AC5（不回归 + 作用域枚举）**：① `bash scripts/test.sh --for-task gap-ac291-live-page-zh-chrome-nav-current-and-own-title` 绿；
  ② `node --test packages/quay/test/serve-*.test.mjs` 绿；③ **作用域举证**：`grep -rc 'html lang="en"' packages/quay/src/*.ts`
  **逐文件**贴出并与立案基线对照（总数 **23**，`serve-live.ts` **2**）：本任务后 **`serve-live.ts` 2→1**
  （留下的那 1 处是 `:162` 的 `/journal`，出作用域），**其余 12 个文件计数一字未动**。
  ⛔ 若 AC-289 已落地，总数会相应更小（各减 1），本条的判据是**逐文件差量**，不是绝对值。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「多了一个 lang 参数、单测绿了」，而是
**一个真实的 `quay serve` 进程在真实 HTTP 上，对同一个 URL 按请求头给出了两种语言的页面外壳**：

1. **落地对象**：运行中的实例上，`/live` 在 `Cookie: lang=zh` 下页头 lang、本页 `<title>`、nav 当前项**都**变，
   且 en 基线逐字未变 —— **从响应体直读**（⛔ 不读 render 函数的返回值当「响应」，那测的是函数，不是线上行为）。
2. **可被打红**：AC2 的钳制对照**实际跑过**并贴上两次读数 ⇒ 证明这条判据不是结构上恒绿（硬规则 4）。
3. **判据裁决诚实**：AC4 的判据输出原样贴出，**红就是红**；⛔ 不用任何改写数据或改写字典值的方式把它变成绿。
4. **作用域**：AC5 的逐文件计数，证明 `/journal` 与其余 12 个文件未被顺手改掉。
5. **可回滚**：写明回滚形态（还原 `serve-live.ts` 的接线 + 删除 `serve-i18n.ts` 的两条 `/live` 词条
   + 重跑 `npm run build -w quay` + 重启实例）与它的作用域（纯本地代码、无外部状态）。
6. **证据留痕**：红/绿判据输出、en/zh 两条原始响应片段、因果对照两次读数、全量残留枚举、逐文件计数，
   落成**任务体内联**或**未跟踪** scratch 文件，可被下一轮独立复算（⛔ 不是只写一句「已修好」）。

## Touches

- tasks/gap-ac291-live-page-zh-chrome-nav-current-and-own-title.md
- packages/quay/src/serve-live.ts
- packages/quay/src/serve-i18n.ts
- packages/quay/test/serve-live-zh-chrome.test.mjs (new)

（说明：`packages/quay/src/serve-lang.ts` 属 AC-288 的产物、四个共享渲染函数与 `NAV_LABELS` 属 AC-289 的产物，
⛔ 均不在本 Touches 的**改动**意图内（`serve-i18n.ts` 只追加本页两条 `PAGE_LABELS` 词条）；
`goals/AC-291-*.md` 属人与驱动维护面，⛔ 不在本 Touches。运行时证据若落 `.quay/` 则**保持未跟踪**，故不声明——
`anti-drift-touches-check` 只比对已跟踪文件。）
