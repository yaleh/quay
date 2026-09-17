---
id: gap-ac289-dashboard-zh-nav-label-and-own-title
title: AC-289 缺口 —— /dashboard 的 zh 切换只翻了页头 lang 属性，nav 当前项标签与页面自身 title 仍是英文硬编码
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
goal_ac: AC-289
---
**type:** execution

## Proposal

**缺口（AC-289 判据，立案当轮直接量，`--dry-run` ⛔ 不写台账，2026-09-17T16:14:38Z，cwd = 主检出 `/home/yale/work/quay`）**：

```
node packages/quay/bin/quay.js goal gate AC-289 --dry-run --json
⇒ {"id":"AC-289","verdict":"fail",
   "reason":"acceptance failed (exit 1) — CAUSE=html-lang-not-zh -- /dashboard with Cookie: lang=zh did not respond <html lang=\"zh\"> (addr=100.78.206.100:4173)"}
GATE_EXIT=1
```

**判据自己钉死了缺口位置**（硬规则 3b：它没有静默通过，而是打印了具名 `CAUSE=`）：它**已经走过**前三段检查——
从运行中的实例取到了地址、en 响应非空、en 响应**确实含字面量 `Dashboard`**、en 响应**有 `<title>`**——
**fail 在第一段 zh 检查**：`Cookie: lang=zh` 没有让响应变成 `<html lang="zh">`。

**「无任务推进」的直接量**（⛔ 不是关键词扫描）：`grep -rn '^goal_ac: AC-289' tasks/*.md` ⇒ **零命中**；
`AC-289` 的文本命中只有 `tasks/gap-ac288-webui-lang-switch-mechanism.md` 一个，而它的 `goal_ac` 是 **AC-288**，
正文只是把 AC-289 列为下游消费者。

### 现状 enumerate（按位置，⛔ 不按关键词；立案当轮实测）

live 面：`curl -sf http://100.78.206.100:4173/dashboard` ⇒ 74178 字节，`grep -o 'Dashboard' | wc -l` = **5**。逐条（行号取自 `grep -n`）：

| # | 位置（响应 HTML） | 源码出处 | 归属 |
|---|---|---|---|
| 1 | `:640 <title>quay — Dashboard</title>` | `serve-dashboard.ts:1304` `pageTitle("Dashboard", opts.identity)` | **页面自身 chrome**（AC-289 的第二个断言） |
| 2 | `:653 <span class="mobile-menu-item nav-current" …>Dashboard</span>` | `serve-render.ts:837 navItem` ← `SITE_NAV_GROUPS`（`serve-render.ts:823`） | **导航当前项**（AC-289 的第一个断言，移动端菜单） |
| 3 | `:668 <span class="nav-item nav-current" …>Dashboard</span>` | 同上（桌面导航） | **导航当前项**（同上） |
| 4 | `:671 <h1>Dashboard</h1>` | `serve-dashboard.ts:1306`，硬编码 | **页面自身 chrome** |
| 5 | `:785 <div …>Web UI 展示层三处小修复合并（… / Dashboard 双列不等高拉伸留白）</div>` | **任务数据** —— `/dashboard` 的「ready（最近 10 条）」卡渲染 `tasks/*.md` 的 **title** | ⚠️ **不是 chrome，是本 workspace 的任务数据** |

源码侧对照（同一结论的第二个独立读法）：`grep -rn '"Dashboard"' packages/quay/src/*.ts` ⇒
`serve-render.ts:823`（nav 字典的**唯一正本**）、`serve-render.ts:945`/`:1034`（注释）、`serve-dashboard.ts:1304`（title）、`:1306`（h1）。

### ⚠️ 立案当轮发现：AC-289 的判据**目前结构性不可满足**，且本任务无权修它

判据的第三、四条断言是**整段响应体**的子串匹配（`case "$zh" in *"$LABEL_EN"*)`，`LABEL_EN="Dashboard"`），
而上面的第 5 条命中来自**任务数据**：

```
ready 池里 title 含字面量 "Dashboard" 的任务（枚举，⛔ 不是抽查）：
  READY-COLLISION: tasks/gap-webui-dashboard-tasks-display-polish.md
  title = Web UI 展示层三处小修复合并（favicon 缺失 / Tasks 默认排序 / Dashboard 双列不等高拉伸留白）
```

它由 `/dashboard` 的「ready（最近 10 条）」卡渲染进响应体，**任何翻译都拿不掉它**。
⇒ 本任务把 nav 当前项、`<title>`、`<h1>` **全部**翻成中文之后，zh 响应里仍会有这个字面量 ⇒ 判据**仍红**。

**判据的实现在此处比它自述的意图更宽**：它的 `CAUSE` 文案写的是 `nav-label-untranslated … still renders the literal
English nav label "Dashboard"`（**nav 标签**），而实现匹配的是**整段 body**。⇒ 这属于**判据自身的缺陷**，不是实现缺陷。

**⛔ 且它对 workspace 数据是时间敏感的**：碰撞项在不在，取决于「最近 10 条 ready」里当前有哪些任务。
⇒ 同一条判据在别的时刻会给出**相反**的裁决，而两次的页面代码可以完全相同。

**处置（本任务采取；与 `gap-ac288-webui-lang-switch-mechanism` 的既有先例一致）**：`goals/AC-289-*.md`
**是人与驱动维护的面，⛔ 不在本任务 `## Touches` 内**（前一任务的正文已就同类判据缺陷明确写下「判据本身的修法
不在本任务 Touches 内，此处只留证据供其所有者决定」）。⇒ 本任务**做**页面侧的真实接线，**并在 AC3/AC4 把这条
判据缺陷以可复算的形式交出**；⛔ **不**改判据、⛔ **不**改别的任务的 title 去「凑绿」（那是 gate-gameability）。

**⛔ 另一个当场记下的陷阱（本任务自己就会踩）**：filed 任务一旦进入 ready 池，它的 **title 会被渲染到
`/dashboard` 的 ready 卡上**。⇒ 本任务的 title 因此**刻意不含大写 `Dashboard`**（判据是大小写敏感的），
否则它会亲手把 AC-289 的判据钉死。**这条约束对 AC-290~303 的后续立案同样成立。**

### 作用域：本任务做 `/dashboard`，但 nav 字典是**一张**共享结构

- **必须一次做完的**：`SITE_NAV_GROUPS`（`serve-render.ts:822`）是**15 个页共用的一个数组**，
  「nav 当前项标签随语言变」在结构上只能在这里做一次 —— 按页拆做会 15 个任务反复改同一行（本仓库实测过的
  touches 交叠形态）。⇒ 本任务建 **`serve-i18n.ts`（新）**：nav 键 → `{en, zh}` 的**唯一正本字典**，**15 条一次给全**；
  `renderSiteNav` / `renderMobileChrome` / `renderMobileMenu` / `pageTitle` 增**可选** `lang`（默认 `en`）
  ⇒ **其余 12 个 `serve-*.ts` 零改动**（23 个调用点继续不传 lang），作用域不越界。
- **只做本页的**：`/dashboard` 自己的 `<title>` 与 `<h1>`。
- ⛔ **不做**其余 14 页的 `<title>`/`<h1>`（属 AC-290~303）。

### 依赖（实测读数，⛔ 不是推测）

`packages/quay/src/serve-lang.ts`（语言解析机制）**只活在** `task/gap-ac288-webui-lang-switch-mechanism` 分支上：
`git cat-file -e develop:packages/quay/src/serve-lang.ts` ⇒ `fatal: path … does not exist in 'develop'`；
主检出 `ls packages/quay/src/serve-lang.ts` ⇒ `No such file`。而判据**先**查 `<html lang="zh">`
（现行红读数 `CAUSE=html-lang-not-zh` 正是它）。⇒ zh 面的达成以该机制落地为前提，故顶层 `depends_on` 指向它
（机制化的声明，⛔ 不靠文风上的「先做」）。

<!-- dedup-ref -->
去重核对：顶层 `goal_ac: AC-289` **零命中**（`grep -rn '^goal_ac: AC-289' tasks/*.md` ⇒ 无输出）。
机制相邻但不同的一项：`gap-ac288-webui-lang-switch-mechanism` —— 它做**语言解析**与 `<html lang>`，
本任务做**标签字典与页面 chrome**。`gap-webui-detail-page-head-drops-pagestyles`(done) 做的是页头**样式表**绑定，与语言无关。

## Plan

1. **红基线**（⛔ 不假定仍等于立案值）：`node packages/quay/bin/quay.js goal gate AC-289 --dry-run --json`，贴完整输出，
   把 `CAUSE=` 与时间戳一并记下（判据可能已被其所有者改动）。
2. **确认前置已落地**：`git cat-file -e develop:packages/quay/src/serve-lang.ts` 与
   `grep -n 'lang?: Lang' packages/quay/src/serve-render.ts` 都必须命中；任一无命中 ⇒ **停下报缺**，
   ⛔ 不要在这里重新实现一份解析器（那是 AC-288 的产物，重写会产生第二正本）。
3. **新建 `packages/quay/src/serve-i18n.ts`**：`NAV_LABELS: Record<NavKey, {en: string; zh: string}>`（15 条）
   + `navLabelsFor(lang)` / `pageNameFor(pageName, lang)` 纯函数。**头注释写契约**：字典是标签的唯一正本；
   `zh` 值必须非空且 ⛔ 不含 ASCII 字面量 `Dashboard`。
   ⛔ 不做「用 zh 覆盖 en」的兜底——`en` 一列必须**逐字等于今天的 15 个英文标签**（否则 en 基线自己会变，
   判据第一段 `case "$en" in *"Dashboard"*` 会红）。
4. **接线 `serve-render.ts`**：`SITE_NAV_GROUPS` 改为携带**键**、标签从字典取；四个渲染函数增**默认参数**
   `lang = "en"` —— 默认参数是作用域手段：23 个既有调用点与其余页行为**逐字不变**。
5. **接线 `serve-dashboard.ts`**：`renderDashboardPage` 的 `opts` 增 `lang`；**两处**调用点
   （snapshot 快路径 `:1817` 与 legacy 路径 `:1856`）都传 `cfg.lang`；`<h1>` 取字典词；`<title>` 传 `lang`。
   ⚠️ **两条路径都必须改**：快照路径是**生产默认路径**（`peekDashboardSnapshot` 命中即 `return`），
   只改旧路径 ⇒ 某些测试走旧路径而生产走新路径 ⇒ **假绿**（AC-288 正文已记同形）。
6. **新测试 `packages/quay/test/serve-i18n.test.mjs`**（`// @test-group product`、`node:test`）：① 字典纯函数正/负控制
   （15 条都在、en 列逐字等于今天的英文、zh 列非空且不含 `Dashboard`、未知键 fail-closed 而非回落 en）；
   ② 黑盒：真 workspace（`.quay/config.yml` + native provider）+ `startServer({ port: 0 })`
   （⚠️ 默认 bind `0.0.0.0`，端口冲突会让 provider 子进程泄漏并**挂住整个套件** ⇒ 用 `port: 0` 让内核选端口，⛔ 不自己探端口），
   断言 zh 下 nav 当前项、`<title>`、`<h1>` 三处都变了。
7. **构建产物**：`npm run build -w quay`，确认产物里含新字典模块（新 src 模块没进 bundle 会让 dist 类测试假红）。
8. **收口**：红/绿两条读数 + 因果对照 + 全量残留枚举 + scoped 门绿。

## AC

- [ ] **AC1（live 面判别性读数：三处 chrome 各自独立断言）**：在**运行中的** `quay.ts serve`（cwd = 仓库根）上，
  `curl -H 'Cookie: lang=zh' http://$addr/dashboard` 的响应**分别**满足：① 含 `<html lang="zh"`；
  ② nav 当前项**两处**（桌面 `class="nav-item nav-current"` 与移动 `class="mobile-menu-item nav-current"`）
  的文本都**不是** `Dashboard`；③ 该页**自己的** `<title>` 与 en 基线**逐字不同**（并排贴 en/zh 两条 `<title>`）。
  ⛔ 三处分开断言、分开贴原始片段——只报「整页看起来翻了」不算（硬规则 3：枚举不是布尔）。
- [ ] **AC2（可被打红——因果对照）**：在 `handleAllRoutes` 处把语言**临时**钳到 `"en"`（一次性本地改动，⛔ 不提交），
  证明 AC1 的 ②/③ 变红；还原后复绿。**两次读数并排贴出**。⛔ 无此对照 ⇒「是字典接线造成的」只是一句未被检验的断言
  （硬规则 4 推论四：一个能解释现象的说法不是一个被检验的结论）。
- [ ] **AC3（全量残留枚举 + 逐条归属，⛔ 不报「零」）**：对 zh 响应跑 `grep -o 'Dashboard' | wc -l`，
  把**每一条**命中的 HTML 片段与它的**产生源**贴出（chrome 出自哪一行源码 / 数据出自哪个 `tasks/*.md`），
  并给出 **chrome 计数**与**数据计数**两个数。⛔ 禁止把总数报成 0，也禁止只报一个总数（硬规则 3）。
- [ ] **AC4（判据裁决原样记录 + 交给判据所有者）**：贴出**实现后**的
  `node packages/quay/bin/quay.js goal gate AC-289 --dry-run --json` 完整输出（⛔ 不解释、不改写它的 `CAUSE`），
  并在任务体写明：若它仍红，其唯一残留是 AC3 里的**数据**命中，判据的整段子串谓词比它自述的「nav label」更宽
  ⇒ **判据缺陷，归其所有者**（`goals/AC-289-*.md` ⛔ 不在本 Touches 内）。⛔ **明令禁止**的两种「凑绿」：
  改判据、改别的任务的 title。**这两种做法若出现，本任务视为失败。**
- [ ] **AC5（不回归 + 作用域枚举）**：① `bash scripts/test.sh --for-task gap-ac289-dashboard-zh-nav-label-and-own-title` 绿；
  ② `node --test packages/quay/test/serve-*.test.mjs` 绿；③ **作用域举证**：
  `grep -rc 'renderSiteNav(' packages/quay/src/*.ts` **逐文件**贴出，证明其余 12 个文件的调用点**一字未动**；
  ④ `grep -rn 'html lang="en"' packages/quay/src/*.ts` 的总数相对立案基线（**23**）**只减少 dashboard 那 1 处**
  （其余 22 处属 AC-290~303）——若 AC-288 尚未落地，此项以「同口径前后对照」形式给出，⛔ 不假装它已减。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「多了一个字典文件、单测绿了」，而是
**一个真实的 `quay serve` 进程在真实 HTTP 上，对同一个 URL 按请求头给出了两种语言的页面 chrome**：

1. **落地对象**：运行中的实例上，`/dashboard` 在 `Cookie: lang=zh` 下 nav 当前项、`<title>`、`<h1>` 三处 chrome 都变，
   且 en 基线逐字未变——**从响应体直读**（⛔ 不读 render 函数的返回值当「响应」，那测的是函数，不是线上行为）。
2. **可被打红**：AC2 的钳制对照**实际跑过**并贴上两次读数 ⇒ 证明这条判据不是结构上恒绿（硬规则 4）。
3. **判据裁决诚实**：AC4 的判据输出原样贴出，**红就是红**；把「判据比它的意图更宽」作为**发现**交出，
   ⛔ 不用任何改写数据的方式把它变成绿。
4. **作用域**：AC5 的逐文件计数，证明其余 14 页未被顺手改掉（那些硬编码标签点属 AC-290~303）。
5. **可回滚**：写明回滚形态（删 `serve-i18n.ts` + 还原 `serve-render.ts`/`serve-dashboard.ts` 的接线
   + 重跑 `npm run build -w quay`）与它的作用域（纯本地代码、无外部状态）。
6. **证据留痕**：红/绿判据输出、en/zh 两条原始响应片段、因果对照两次读数、全量残留枚举、逐文件计数，
   落成**任务体内联**或**未跟踪** scratch 文件，可被下一轮独立复算（⛔ 不是只写一句「已修好」）。

## Touches

- tasks/gap-ac289-dashboard-zh-nav-label-and-own-title.md
- packages/quay/src/serve-i18n.ts (new)
- packages/quay/src/serve-render.ts
- packages/quay/src/serve-dashboard.ts
- packages/quay/test/serve-i18n.test.mjs (new)

（说明：`packages/quay/src/serve-lang.ts` 属 AC-288 的产物，⛔ 不在本 Touches；`goals/AC-289-*.md` 属人与驱动维护面，⛔ 不在本 Touches。其余 12 个 `serve-*.ts` 的硬编码标签点刻意不含（属 AC-290~303）—— 本任务把它们全部排除，靠的是四个渲染函数的**默认参数**，⛔ 不是靠「不要去改」。）