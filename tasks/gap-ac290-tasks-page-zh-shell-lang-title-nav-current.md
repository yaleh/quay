---
id: gap-ac290-tasks-page-zh-shell-lang-title-nav-current
title: "AC-290 缺口 —— /tasks 页面的 zh 切换完全未接线：页头 lang、本页 <title> 与导航当前项在 Cookie:
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
goal_ac: AC-290
---
**type:** execution

## Proposal

**缺口（AC-290 判据，立案当轮直接量，`--dry-run` ⛔ 不写台账，2026-09-17T16:21:19Z，cwd = 主检出 `/home/yale/work/quay`）**：

```
node packages/quay/bin/quay.js goal gate AC-290 --dry-run --json
⇒ {"id":"AC-290","verdict":"fail",
   "reason":"acceptance failed (exit 1) — CAUSE=html-lang-not-zh -- /tasks with Cookie: lang=zh did not respond <html lang=\"zh\"> (addr=100.78.206.100:4173)",
   "timestamp":"2026-09-17T16:21:19.062Z","dryRun":true, ...}
GATE_EXIT=1
```

**判据自己钉死了缺口位置**（硬规则 3b：它没有静默通过，而是打印了具名 `CAUSE=`）：它**已经走过**前三段检查 ——
从运行中的实例取到了地址、en 响应非空、en 响应**确实含字面量 `Tasks`**、en 响应**有 `<title>`** ——
**fail 在第一段 zh 检查**：`Cookie: lang=zh` 没有让响应变成 `<html lang="zh">`。

**「无任务推进」的直接量**（⛔ 不是关键词扫描）：`grep -rn '^goal_ac: AC-290' tasks/*.md` ⇒ **零命中**；
`AC-290` 的文本命中只有 `tasks/gap-ac289-dashboard-zh-nav-label-and-own-title.md` 的正文，它的 `goal_ac` 是 **AC-289**。

### 现状：这一页的 zh 面**一处都没有接线**（两条互相独立的读数）

**读数 ①（live 面，同一 URL 两种请求头，响应逐字节相同）**：

```
curl -sf                       http://100.78.206.100:4173/tasks  ⇒ 63176 bytes, <html lang="en", <title>quay — Tasks</title>
curl -sf -H 'Cookie: lang=zh'  http://100.78.206.100:4173/tasks  ⇒ 63176 bytes, <html lang="en", <title>quay — Tasks</title>
```

⛔ 不是「翻了但翻得不对」——是**连页头 `lang` 属性都没动**：两份响应体字节数相同。

**读数 ②（源码侧，按位置枚举，⛔ 不按关键词）** —— `/tasks` **列表页**的外壳字面量：

| 位置 | 字面量 | 归属 |
|---|---|---|
| `serve-task.ts:467` | `<html lang="en">` | 页头 lang 属性（AC-290 的**第一段**断言） |
| `serve-task.ts:467` | `<title>${pageTitle("Tasks", cfg.identity)}</title>` | 本页自己的 `<title>`（**第二、三段**断言；字面量 `Tasks` 的来源之一） |
| `serve-task.ts:468` | `renderMobileChrome("tasks", "task list")` | 移动端页标（本页 chrome，`"task list"` 硬编码） |
| `serve-task.ts:468` | `renderSiteNav("tasks")` | nav 条（**当前项** `Tasks` 的唯一来源） |
| `serve-task.ts:471` | `<h1>Quay — task list (${manifest.id} provider)</h1>` | 本页 `<h1>`（硬编码；判据不查它，但属 GOAL-024 的「UI 外壳文案」） |

**字面量 `Tasks` 在默认语言响应里的全量枚举**（`curl -sf http://$addr/tasks | tr '<' '\n<' | grep -n 'Tasks'` ⇒ **恰好 3 条**，全在 chrome，**零条来自数据**）：

```
653:title>quay — Tasks
692:span class="mobile-menu-item nav-current" aria-current="page">Tasks
761:span class="nav-item nav-current" aria-current="page">Tasks
```

`grep -o 'Tasks' | wc -l` = **3**，与上表逐条对上（⛔ 不是抽查）。第 2、3 条同出于 `serve-render.ts:824` 的
`SITE_NAV_GROUPS`（nav 字典的唯一正本），第 1 条出自 `pageTitle`。⇒ 三条**全部是可翻译的 chrome**，
判据在默认排序下**可以**被满足。

<!-- dedup-ref -->
去重与相邻任务核对（本段只是可追溯性，⛔ 不含任何前置声明；机械的依赖边在顶层 `depends_on`）：
顶层 `goal_ac: AC-290` 零命中。机制相邻但不同 —— `gap-ac288-webui-lang-switch-mechanism` 做**语言解析**
（语言从哪来、`<html lang>` 的取值来源），`gap-ac289-dashboard-zh-nav-label-and-own-title` 做 **15 条 nav 标签的唯一正本字典**，
本任务做的是 **`/tasks` 这一页的接线**（第三个消费者）：不新建字典、不重写解析器。

<!-- dedup-ref -->
数据面碰撞（相邻任务 `gap-webui-dashboard-tasks-display-polish`，**⛔ 它不是本任务的前置，本任务也不改它**）：
`/tasks` 的表格把**每条任务的 `title`** 渲染进响应体。判据第三段是**整段响应体**的子串匹配
（`case "$zh" in *"$LABEL_EN"*)`），而它自己的 `CAUSE` 文案写的是 `nav-label-untranslated … the literal English nav label`
（**nav 标签**）—— **实现在此处比它自述的意图更宽**（与 AC-289 记录的是同一类判据缺陷）。
今天默认排序下不撞（默认 = provider 原始顺序 ≈ id 升序，page 1 = `ARCH-M103-001`…`DIR-016`，0 条数据命中）。
但那个相邻任务计划把 `/tasks` 的**默认排序**改成 `updated` 降序；在**今天的活实例**上实测该排序：

```
curl -sf 'http://100.78.206.100:4173/tasks?sort=updated' | tr '<' '\n<' | grep -n 'Tasks'
⇒ 4 条命中，第 4 条是【数据】：
 :1651  <td>Web UI 展示层三处小修复合并（favicon 缺失 / Tasks 默认排序 / Dashboard 双列不等高拉伸留白）</td>
```

—— 那是那个任务**自己的 `title:`**，由 `/tasks` 渲染成**数据**。
⇒ 若该排序改动先落地，AC-290 的判据将**在页面代码层面不可满足**：残留是数据，而 GOAL-024 的「非目标」明确排除翻译数据内容。
⇒ 本任务因此：①做真实的页面接线；②把这条作为**判据归属缺陷**交出（`goals/AC-290-*.md` ⛔ **不在本任务 Touches 内**）；
③⛔ **不改判据、不改那个排序任务、不改任何任务的 title**。

**⛔ 本任务自己的 title 也因此刻意不含大写字面量 `Tasks`**（判据大小写敏感），只出现小写的路由串 `/tasks` ——
否则任务一旦进入 ready 池并因 `updated` 排序落在 page 1，它会**亲手把 AC-290 的判据钉死**
（AC-289 的任务体已记下同一形态的约束）。

### 机制前提（实测读数，⛔ 不是推测）

- `packages/quay/src/serve-lang.ts`（语言解析 + `<html lang>` 取值）：`git cat-file -e develop:packages/quay/src/serve-lang.ts`
  ⇒ `fatal: path … does not exist in 'develop'`；只活在 `task/gap-ac288-webui-lang-switch-mechanism` 分支上。
  现行 `ServePageCfg`（`serve-render.ts:997-1000`）**只有** `workspaceRoot` 与 `identity` 两个字段，**没有 `lang`**。
- `packages/quay/src/serve-i18n.ts`（nav 标签字典）：主检出 `ls` ⇒ `No such file`。

⇒ zh 面以这两者落地为前提，故顶层 `depends_on` 指向它们（机制化声明，⛔ 不靠文风上的「先做」）。
**⛔ 本任务不重新实现其中任何一个**（那会产生第二正本）。

### 与在飞任务的 Touches 交叠（如实记录，⛔ 不是问题）

`packages/quay/src/serve-task.ts` 目前同时被两个 `status: ready` 的任务声明（`gap-webui-dashboard-tasks-display-polish`、
`gap-webui-task-detail-flat-body-needs-structure`）⇒ 派发器会按 Touches 把它们与本任务**串行**，本任务不会与它们并发。

## Plan

1. **红基线**（⛔ 不假定仍等于立案值）：`node packages/quay/bin/quay.js goal gate AC-290 --dry-run --json`，贴完整输出与 `CAUSE=`。
2. **确认机制前提已落地 + 读【实际】签名**：`git cat-file -e develop:packages/quay/src/serve-lang.ts`、
   `ls packages/quay/src/serve-i18n.ts`、`grep -n 'lang' packages/quay/src/serve-render.ts | head`。
   **⛔ 不按本任务 Plan 里预写的签名假设**：以 AC-288/AC-289 落地后的**实际**参数位为准；任一无命中 ⇒ **停下报缺**。
3. **接线 `serve-task.ts` 的 `handleTaskList`（仅列表页）**：`:467` 的 `<html lang>` 取 `serve-lang.ts` 的页头标签函数；
   `:467` 的 `<title>` 把 lang 传给 `pageTitle`；`:468` 的 `renderSiteNav` / `renderMobileChrome` 传 lang；
   `:471` 的 `<h1>` 与移动端页标取字典词。
4. ⛔ **不碰 `serve-task.ts:668/669/674`**（`/task/<id>` **详情页**）：它不是 15 个 nav 路由之一，也不在 AC-290 的判据里 ⇒ **出作用域**。
5. **测试**：扩 `packages/quay/test/serve-task.test.mjs`（黑盒：真 workspace（`.quay/config.yml` + native provider）
   + `startServer({port:0})`；断言 zh 下 ① 含 `<html lang="zh"` ② 本页 `<title>` 与 en 逐字不同 ③ nav 当前项不是 `Tasks`。
   ⚠️ 用 `port: 0` 让内核选端口，⛔ 不自己探端口——端口冲突会让 provider 子进程泄漏并**挂住整个套件**）。
6. **构建产物**：`npm run build -w quay`（新接线未进 bundle 会让 dist 类测试假红）。
7. **重启活实例**：AC-290 的探针从**已在运行**的 `quay.ts serve`（cwd = 仓库根）派生地址，⛔ 不自己启服务
   ⇒ 实现落地后**必须重启该实例**，否则判据读的是旧代码（陈旧实例会把「没生效」伪装成「实现没做」）。
8. **收口**：红/绿两条读数 + 因果对照 + 全量残留枚举 + scoped 门绿。

## AC

- [x] **AC1（live 面判别性读数：三段各自独立断言）**：在**运行中的** `quay.ts serve`（cwd = 仓库根）上，
  `curl -H 'Cookie: lang=zh' http://$addr/tasks` 的响应**分别**满足：① 含 `<html lang="zh"`；
  ② nav 当前项**两处**（桌面 `class="nav-item nav-current"` 与移动 `class="mobile-menu-item nav-current"`）
  的文本都**不是** `Tasks`；③ 该页**自己的** `<title>` 与 en 基线**逐字不同**（并排贴 en/zh 两条 `<title>`）。
  ⛔ 三处分开断言、分开贴原始片段——只报「整页看起来翻了」不算（硬规则 3：枚举不是布尔）。
- [x] **AC2（可被打红——因果对照）**：把语言解析结果**临时**钳到 `"en"`（一次性本地改动，⛔ 不提交），
  证明 AC1 的 ②/③ 变红；还原后复绿。**两次读数并排贴出**。⛔ 无此对照 ⇒「是接线造成的」只是一句未被检验的断言
  （硬规则 4 推论四：一个能解释现象的说法不是一个被检验的结论）。
- [x] **AC3（全量残留枚举 + 逐条归属，⛔ 不报「零」）**：对 zh 响应跑 `tr '<' '\n<' | grep -n 'Tasks'`，
  把**每一条**命中的 HTML 片段与它的**产生源**贴出（chrome 出自哪一行源码 / 数据出自哪个 `tasks/*.md`），
  并给出 **chrome 计数**与**数据计数**两个数。⛔ 禁止把总数报成 0，也禁止只报一个总数（硬规则 3）。
- [x] **AC4（判据裁决原样记录 + 交给判据所有者）**：贴出**实现后**的
  `node packages/quay/bin/quay.js goal gate AC-290 --dry-run --json` 完整输出（⛔ 不解释、不改写它的 `CAUSE`），
  并写明：若它仍红且残留**全部来自数据**（AC3 的数据计数 > 0），那是**判据的整段子串谓词比它自述的「nav label」更宽**
  ⇒ **判据缺陷，归其所有者**（`goals/AC-290-*.md` ⛔ 不在本 Touches 内）。⛔ **明令禁止**的三种「凑绿」：
  改判据、改别的任务的 title、改排序任务。**这三种做法若出现，本任务视为失败。**
- [x] **AC5（不回归 + 作用域枚举）**：① `bash scripts/test.sh --for-task gap-ac290-tasks-page-zh-shell-lang-title-nav-current` 绿；
  ② `node --test packages/quay/test/serve-*.test.mjs` 绿；③ **作用域举证**：
  `grep -rc 'html lang="en"' packages/quay/src/*.ts` **逐文件**贴出，与立案基线（总数 **23**，逐文件上方实测）对照：
  **`serve-task.ts` 从 2 降到 1**（留下的那 1 处是 `:668` 详情页，出作用域，见 Plan 4），**其余 13 个文件的计数一字未动**。
  ⛔ 若 AC-288/AC-289 已落地，总数会相应更小（各减 1），本条的判据是**逐文件差量**，不是绝对值。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「多了一个 lang 参数、单测绿了」，而是
**一个真实的 `quay serve` 进程在真实 HTTP 上，对同一个 URL 按请求头给出了两种语言的页面外壳**：

1. **落地对象**：运行中的实例上，`/tasks` 在 `Cookie: lang=zh` 下页头 lang、本页 `<title>`、nav 当前项**都**变，
   且 en 基线逐字未变 —— **从响应体直读**（⛔ 不读 render 函数的返回值当「响应」，那测的是函数，不是线上行为）。
2. **可被打红**：AC2 的钳制对照**实际跑过**并贴上两次读数 ⇒ 证明这条判据不是结构上恒绿（硬规则 4）。
3. **判据裁决诚实**：AC4 的判据输出原样贴出，**红就是红**；把「判据比它的意图更宽」作为**发现**交出，
   ⛔ 不用任何改写数据的方式把它变成绿。
4. **作用域**：AC5 的逐文件计数，证明详情页与其余 13 个文件未被顺手改掉。
5. **可回滚**：写明回滚形态（还原 `serve-task.ts` 的接线 + 重跑 `npm run build -w quay` + 重启实例）
   与它的作用域（纯本地代码、无外部状态）。
6. **证据留痕**：红/绿判据输出、en/zh 两条原始响应片段、因果对照两次读数、全量残留枚举、逐文件计数，
   落成**任务体内联**或**未跟踪** scratch 文件，可被下一轮独立复算（⛔ 不是只写一句「已修好」）。

## Touches

- tasks/gap-ac290-tasks-page-zh-shell-lang-title-nav-current.md
- packages/quay/src/serve-task.ts
- packages/quay/src/serve-i18n.ts
- packages/quay/test/serve-task.test.mjs
- packages/quay/test/serve-i18n.test.mjs

（说明：`packages/quay/src/serve-lang.ts` 属 AC-288 的产物，⛔ 不在本 Touches。
`packages/quay/src/serve-i18n.ts` 与 `packages/quay/test/serve-i18n.test.mjs` 原属 AC-289 的产物，
**本任务声明它们，是因为立案时的 Touches 漏写了本页接线必需的落点**（实现时才发现，非事后补记）：
① ROW 3 的设计注释写明「其余 14 页的 page-chrome 属 AC-290~303」，三个同族任务（AC-291/292/293）的
Touches 都已按「只追加本页两条 `PAGE_LABELS` 词条」声明了 `serve-i18n.ts`，本任务漏了同一行；
② AC-289 的测试把 `Tasks` 当作「未映射 token」的样本，本任务把它映射掉后那条断言必红。两处 delta 都
只到本页接线所需的程度（新增两条词条；把样本 token 换成一个无页拥有的 token，使该性质不再随
AC-291~303 逐页重新失效）。`goals/AC-290-*.md` 属人与驱动维护面，⛔ 不在本 Touches。运行时证据落
`.quay/` **保持未跟踪**，故不声明——`anti-drift-touches-check` 只比对已跟踪文件。）
