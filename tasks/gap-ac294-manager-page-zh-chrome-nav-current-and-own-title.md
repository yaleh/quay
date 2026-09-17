---
id: gap-ac294-manager-page-zh-chrome-nav-current-and-own-title
title: "AC-294 缺口 —— /manager 页面的 zh 切换完全未接线：页头 lang、本页 <title> 与导航当前项在 Cookie:
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
goal_ac: AC-294
---
**type:** execution

## Proposal

**缺口（AC-294 判据，立案当轮直接量，`--dry-run` ⛔ 不写台账，2026-09-17T17:18:18Z，cwd = 主检出 `/home/yale/work/quay`）**：

```
node packages/quay/bin/quay.js goal gate AC-294 --dry-run --json
⇒ {"id":"AC-294","verdict":"fail",
   "reason":"acceptance failed (exit 1) — CAUSE=html-lang-not-zh -- /manager with Cookie: lang=zh did not respond <html lang=\"zh\"> (addr=127.0.0.1:4173)",
   "timestamp":"2026-09-17T17:18:18.375Z","dryRun":true}
GATE_EXIT=1
```

**判据自己钉死了缺口位置**（硬规则 3b：它没有静默通过，而是打印了具名 `CAUSE=`）：它**已经走过**前三段检查 —— 从运行中的实例取到了地址、en 响应非空、en 的 nav 区块**确实含字面量 `Manager`**、en 响应**有 `<title>`** —— **fail 在第一段 zh 检查**：
`Cookie: lang=zh` 没有让响应变成 `<html lang="zh">`。

**「无任务推进」的直接量**（⛔ 不是关键词扫描；含硬规则 2 的两半 —— 零计数配「谓词对已知为真样本干跑」）：

```
grep -rn '^goal_ac: AC-294$' tasks/*.md   ⇒ 0 命中   （本任务立案前的真值）
grep -rn '^goal_ac: AC-293$' tasks/*.md   ⇒ 1 命中   （已知为真的对照样本，证明该谓词本身可用，不是恒零）
grep -rn '^goal_ac: AC-292$' tasks/*.md   ⇒ 1 命中   （第二个对照）
```

### 现状：`/manager` 的 zh 面**一处都没有接线**（两条互相独立的读数）

**读数 ①（live 面，同一 URL 两种请求头）** —— 主检出实例 `pid=3696699`，`--host 0.0.0.0 --port 4173`，cwd = 仓库根：

```
curl -sf                      http://127.0.0.1:4173/manager ⇒ 34069 bytes, <html lang="en", <title>quay — Manager / Outer / Inner</title>
curl -sf -H 'Cookie: lang=zh' http://127.0.0.1:4173/manager ⇒ 34069 bytes, <html lang="en", <title>quay — Manager / Outer / Inner</title>
nav 区块（tr '\n' ' ' | grep -o '<nav.*</nav>'，2428 字节）内字面量 Manager 计数：en=2, zh=2
curl -sf http://127.0.0.1:4173/health
⇒ {"ok":true,"stale":true,"evaluated":true,"processStartedAt":"2026-09-17T16:21:45.406Z","latestCodeCommitAt":"2026-09-17T16:43:05.000Z","source":"git"}
```

⚠️ 该实例 `stale:true`（起于 `latestCodeCommitAt` 之前）—— 这条读数的**用处**是证明 **en 基线的形状**（nav 内 `Manager` 恰好 2 条、本页有 `<title>`、判据的第一段前提成立）；⛔ **不能**用它断定「zh 接线是否已做」（陈旧实例对任何页面都返回 en 外壳）。见「操作前提」。

**读数 ②（源码侧按位置枚举）** —— `/manager` 外壳（`renderManagerPage`，`serve-system.ts:111`）的断言点：

| 位置 | 字面量 | 归属 |
|---|---|---|
| `serve-system.ts:148` | `<html lang="en">` | 页头 lang 属性（**第一段**断言） |
| `serve-system.ts:148` | `<title>${pageTitle("Manager / Outer / Inner", identity)}</title>` | 本页自己的 `<title>`（**第三段**断言） |
| `serve-system.ts:149` | `renderMobileChrome("manager", "manager")` | 移动端菜单里的 nav 当前项（**第二段**断言，移动端那处） |
| `serve-system.ts:149` | `renderSiteNav("manager")` | 桌面 nav 条（**第二段**断言，当前项 `Manager` 的桌面来源） |
| `serve-system.ts:150` | `<h1>Manager / Outer / Inner — 三层状态</h1>` | 本页 `<h1>`（判据不查，但属本页 chrome，本任务一并接线） |
| `serve-system.ts:192` | `renderManagerPage(mgr, cfg.identity)` | 渲染入口：`cfg.lang` **已经在 `handleManager`（`:171`）的参数里**（`serve-handlers.ts:144` 传的是 AC-288 的 `reqCfg`），只是没有往下传 |

**字面量 `Manager` 在默认语言 `/manager` 响应里的全量枚举**（`grep -n 'Manager'` ⇒ **恰好 5 行**）：

```
   2: ...<meta name="description" content="Quay manager — Manager/Outer/Inner 三层状态">...  ← <head> 的 meta，不在 <title> 内
 636: </style><title>quay — Manager / Outer / Inner</title></head>                            ← 本页 <title>（第三段断言）
 652: ...<span class="mobile-menu-item nav-current" aria-current="page">Manager</span>...      ← nav 当前项（移动端菜单）
 664: ...<span class="nav-item nav-current" aria-current="page">Manager</span>...              ← nav 当前项（桌面 nav）
 667:       <h1>Manager / Outer / Inner — 三层状态</h1>                                        ← 本页 <h1>
```

**判据的作用域（实测，⛔ 不是读它的源码猜的）**：nav 区块 **2428 字节**，其中 `Manager` 命中**恰好 2 条**（`#652`/`#664`，两条都是 chrome 的 `nav-current`）；`<h1>`（`:667`）与 meta 描述（`:2`）**都在 nav 区块之外**，且判据只对 `<title>` 与 `<nav>…</nav>` 匹配、⛔ 不整段匹配响应体 ⇒ **本判据没有「数据命中把判据打死」的风险**（对照：`/board` 的页内 CSS 注释、`/dashboard` 的活动流任务标题都会让同形判据不可满足）。
⚠️ 但 meta 描述里含 `Manager/Outer/Inner`（无空格）——它**不在本判据的断言面内**（`<title>` 之外），本任务**不改它**（改了会让 en 基线漂移，反而破坏第一段断言的前提）。

### 机制前提（实测读数，⛔ 不是推测）——**本页的 `<title>` 不会「顺带」被翻**

- **AC-288（`gap-ac288-webui-lang-switch-mechanism`）status=done**：语言**每请求解析一次**在 `serve-handlers.ts:86`（`const reqCfg: ServePageCfg = { ...cfg, lang }`），并在 `:144` 把它交给 `/manager` 的 handler（`await handleManager(req, res, reqCfg)`）；`htmlLangTag(lang)` 在 `serve-lang.ts:128`（返回 `<html lang="${lang}">`）。
  ⇒ **`handleManager` 现在【已经拿到】`cfg.lang`，只是丢掉了**（`:192` 的渲染入口只传了 `cfg.identity`）。
- **AC-289（`gap-ac289-dashboard-zh-nav-label-and-own-title`）status=done，已落 develop（`27b2eab81`）**，`packages/quay/src/serve-i18n.ts` 已在主检出与 develop 上：
  - `NAV_LABELS` **15 条全给**，其中 `manager: { en: "Manager", zh: "管理器" }`（`serve-i18n.ts:58`）⇒ **nav 当前项那两处本任务不需要新词**；
  - `renderSiteNav(current, lang = DEFAULT_LANG)`（`serve-render.ts:878`）/ `renderMobileChrome(current, pageLabel, lang = DEFAULT_LANG)`（`:908`）/ `pageTitle(pageName, id, lang = DEFAULT_LANG)`（`:1079`，内部经 `pageNameFor`）/ `pageNameFor(pageName, lang = DEFAULT_LANG)`（`serve-i18n.ts:103`）—— 默认参数即作用域手段；
  - **`PAGE_LABELS` 只登记了 `Dashboard` 一条**（`serve-i18n.ts:96-98`），且其契约 ROW 3 逐字写明：
    「only /dashboard is wired here, because that is AC-289's scope; **the other 14 pages' page-chrome is AC-290~303**」。
- ⇒ **本任务的核心工作量正是这一条**：`pageNameFor` 对**未登记的 token 在 zh 下原样返回英文**
  （ROW 3：a VISIBLE degradation，不是空白）⇒ 若只把 `renderSiteNav("manager", lang)` 接上，
  **nav 会翻、本页 `<title>` 仍是 `quay — Manager / Outer / Inner`** ⇒ 判据**仍红**在 `CAUSE=title-unchanged`
  （那正是判据存在的意义：**「只有共享导航条变了」不算**）。
  ⇒ 必须为 `/manager` 在 `serve-i18n.ts` 的 `PAGE_LABELS` 里补本页的词条（`<title>` 的 token，以及 `<h1>` 的 token）。
- ⚠️ **键的形状（本任务最容易踩的一处，落地前必须实测）**：ROW 3 规定 `PAGE_LABELS` 的键是
  **「`pageTitle` 收到的那个英文 token」**，而 `/manager` 收到的 token 是**整串** `Manager / Outer / Inner`
  （`serve-system.ts:148`，含空格与斜杠）。**登记成 `Manager` 不会命中** ⇒ 判据红在 `CAUSE=title-unchanged`。
  两种解法都成立（① 以整串为键登记一条；② 在调用点拆成 `${pageNameFor("Manager", lang)} / Outer / Inner`）——
  **以落地时 AC-289 的实际签名为准**，本任务只约束**结果**：zh 的 `<title>` 与 en **逐字不同**且非空白。

### 操作前提（实测，⛔ 不是推测）——**判据的探针读的是【已在运行】的实例**

```
for p in $(pgrep -f 'quay.ts serve' 2>/dev/null); do echo "pid=$p cwd=$(readlink /proc/$p/cwd)"; done
⇒ pid=3696699  cwd=/home/yale/work/quay                       ← 判据从主检出评估时命中的就是它（stale:true）
  pid=126449   cwd=.../gap-ac291-live-page-zh-...             ← 兄弟任务的 worktree 实例
  pid=3338896  cwd=.../gap-ac288-webui-lang-switch-mechanism (deleted)
```

判据从 `git rev-parse --show-toplevel` 派生 root，再取**首个 cwd == root 的 serve 进程**；goal-driver 经
`runAsync`（**不传 `cwd`** ⇒ 继承 driver 的 cwd = 主检出）评估 AC-294
⇒ **驱动侧命中的就是上面这个自报 `stale:true` 的实例**（起于 AC-288 落 develop 之前）。
⇒ **即使 `/manager` 接线完全正确，驱动侧仍会红在 `CAUSE=html-lang-not-zh`**，而**成因是实例陈旧、与 `/manager` 无关**
（这是 AC-288 落地后 **15 个页面 AC 的公共前提**，⛔ 不是本任务引入的回归；同族已记 `serve-stale-signal-has-no-consumer-…`）。
⇒ 本任务的 live 读数一律取自**【本任务 worktree 内、跑本任务代码】的实例**（探针的 `root` 在 worktree 内就等于 worktree 根 ⇒ 命中本任务自己的实例）；
**主检出实例的重启是外部操作面**（它在 fan-in 之后才有意义，而 worker 在 fan-in 前就结束）——
本任务只**如实报告**它的 `/health` 读数（见 AC6），⛔ 不把它当成本任务可自证的部分，也⛔ 不为了让它变绿去重启它。

### 作用域与交叠（如实记录，⛔ 不含任何前置声明；机械的依赖边在顶层 `depends_on`）

- 本任务只做**这一页**的接线：**本页调用点传 lang + 新建本页词条**。⛔ **不改** `NAV_LABELS`（`manager` 行已存在）、
  ⛔ **不重写**四个共享渲染函数（AC-289 的产物）、⛔ **不改**其余 14 页的 `<title>`/`<h1>`。
- ⛔ **不碰同文件的 `/system`**：`:64`/`:65`/`:66` 与 `handleSystem` 是 **AC-293** 的页面，本任务对它 **Δ=0**
  （这正是 AC5 的逐文件判据要证的：`serve-system.ts` 的 `html lang="en"` **2→1**，只剩 `/system` 那条；
  若 AC-293 已先落地则该文件**由 1→0** —— 判据是**逐文件差量**，不是绝对值）。
- `packages/quay/src/serve-i18n.ts` 与 `packages/quay/src/serve-system.ts` 同时被 AC-290~293 的 `Touches` 声明
  ⇒ 派发器按 Touches 串行，**本任务不会与它们并发**。
- `packages/quay/test/serve-manager.test.mjs` **不存在**（实测：`ls packages/quay/test/ | grep manager` ⇒ 空）
  ⇒ 本任务**新建**它（照 `serve-board.test.mjs` 的形态）；既有 `packages/quay/test/serve-ac95-views.test.mjs`
  已覆盖 `/manager` 的 en 面 ⇒ **必须保持绿**（⛔ 不新建第二个覆盖同一批断言的通用文件）。

<!-- dedup-ref -->
去重核对：顶层 `goal_ac: AC-294` **零命中**（`grep -rn '^goal_ac: AC-294$' tasks/*.md` ⇒ 无输出；同谓词对 AC-293/AC-292 各 1 命中，证明它非恒零 —— 硬规则 3 的零计数配套动作）。机制相邻但**不同**的四项：`gap-ac288-webui-lang-switch-mechanism`（done）做**语言解析**与 `<html lang>` 的产生器；`gap-ac289-dashboard-zh-nav-label-and-own-title`（done，已落 develop `27b2eab81`）做**字典与共享渲染函数** —— 它是本任务引用的依赖，不是重复；`gap-ac293-system-page-zh-chrome-nav-current-and-own-title`（ready）做**同文件的 `/system`**；`gap-ac290-tasks-page-zh-shell-lang-title-nav-current`（ready）做 `/tasks`；`gap-ac291-live-…`（ready）做 `/live`；`gap-ac292-board-…`（ready）做 `/board`。五个相邻任务的页面各不相同，交叠只在共享文件上（`serve-i18n.ts` / `serve-system.ts`），由 Touches 串行化。

## Plan

1. **红基线**（⛔ 不假定仍等于立案值）：`node packages/quay/bin/quay.js goal gate AC-294 --dry-run --json; echo "GATE_EXIT=$?"`，贴完整输出与具名 `CAUSE=`。
2. **确认前置已落地 + 读【实际】签名**：`ls packages/quay/src/serve-i18n.ts`、
   `grep -n 'export function renderSiteNav\|export function renderMobileChrome\|export function pageTitle\|export function pageNameFor\|^const PAGE_LABELS\|^export const NAV_LABELS\|^export const NAV_KEYS' packages/quay/src/serve-render.ts packages/quay/src/serve-i18n.ts`、
   `grep -n '^export function htmlLangTag' packages/quay/src/serve-lang.ts`。
   **⛔ 不按本任务 Plan 预写的签名假设**：以 AC-288/AC-289 落地后的**实际**参数位为准；任一无命中 ⇒ **停下报缺**
   （⛔ 不要在这里重写一份字典，那会产生第二正本）。
3. **接线 `serve-system.ts` 的 `/manager` 这一页（⛔ 只这一页）**：`renderManagerPage(mgr, identity, lang = DEFAULT_LANG)`（⛔ 形参形状以实际签名为准）；
   `:148` 的 `<html lang="en">` 改为 `${htmlLangTag(lang)}`、`<title>` 把 lang 传给 `pageTitle`；
   `:149` 的 `renderMobileChrome` / `renderSiteNav` 传 lang；`:150` 的 `<h1>` 取本页词条
   （**en 必须是 identity ⇒ en 基线逐字不变**）；`:192` 的调用点传 `cfg.lang`。
   ⛔ `:64`/`:65`/`:66`（`/system`）与 `handleSystem` 一行不动。
4. **在 `serve-i18n.ts` 的 `PAGE_LABELS` 只追加 `/manager` 的本页词条**（按 ROW 3 的键形状，见 Proposal 的 ⚠️）：
   zh 值必须非空、⛔ 不含 ASCII 字面量 `Manager`（否则是本判据的 gate-gameability 形态：值「看着翻了」而断言仍红）、
   ⛔ 不得回落英文。**⛔ 不碰 `NAV_LABELS`、不碰它的契约注释行、不碰 `PAGE_LABELS` 的 `Dashboard` 行。**
5. **测试**：**新建** `packages/quay/test/serve-manager.test.mjs`（黑盒：真 workspace（`.quay/config.yml` + native provider）
   + `startServer({ port: 0 })`；断言 zh 下 ① 含 `<html lang="zh"` ② nav 当前项**两处**文本都不是 `Manager`
   ③ 本页 `<title>` 与 en 逐字不同；**外加 en 负控制：en 响应的 `<title>` 与 nav 区块逐字等于今天基线** —— 没有这条对照，②③ 可能由别的改动满足）。
   ⚠️ 用 `port: 0` 让内核选端口，⛔ 不自己探端口 —— 端口冲突会让 provider 子进程泄漏并**挂住整个套件**。
   ⚠️ `renderManagerPage` 目前**未 export**（`serve-system.ts:111`）；黑盒走 HTTP 即可，⛔ 不要为了单测而顺手改导出面。
6. **构建产物**：`npm run build -w quay`（新接线未进 bundle 会让 dist 类测试假红）。
7. **重启活实例**：AC-294 的探针从**已在运行**的 `quay.ts serve`（cwd = `git rev-parse --show-toplevel`）派生地址，
   ⛔ 不自己启服务 ⇒ 在本任务 **worktree** 里起一个实例、**并从该 worktree** 跑判据（AC-289/AC-293 的实测形态）；
   实现落地后**必须重启**它，否则判据读的是旧代码（陈旧实例会把「没生效」伪装成「实现没做」）。
   ⛔ **不重启主检出上的那个实例**（pid 3696699）—— 见 Proposal 的「操作前提」，本任务只报告它的 `/health`。
8. **收口**：红/绿两条读数 + 因果对照 + 全量残留枚举 + scoped 门绿。

## AC

- [ ] **AC1（live 面判别性读数：三段各自独立断言）**：在**运行中的** `quay.ts serve`（cwd = 本任务 worktree 根）上，
  `curl -H 'Cookie: lang=zh' http://$addr/manager` 的响应**分别**满足：① 含 `<html lang="zh"`；
  ② nav 区块（`tr '\n' ' ' | grep -o '<nav.*</nav>'`）内**不再**含字面量 `Manager`
  （同一谓词在 **en** 上 = **2** ⇒ 该量能取假，不是空断言）；③ 该页**自己的** `<title>` 与 en 基线**逐字不同**
  （并排贴 en/zh 两条 `<title>`）。⛔ 三处分开断言、分开贴原始片段 —— 只报「整页看起来翻了」不算（硬规则 3：枚举不是布尔）。
- [ ] **AC2（可被打红——因果对照）**：把语言在**第一段检查之前**的那一层**临时**钳到 `"en"`
  （一次性本地改动，⛔ 不提交），证明 AC1 的 ②/③ 变红；还原后复绿。**两次读数并排贴出**。
  更窄的形态（更强）：**只把字典钳到 `en`**（`navLabelsFor`/`pageNameFor` 首行强制 `lang="en"`），
  此时 `<html lang>` 仍正确、判据自报的 `CAUSE=nav-label-untranslated` 或 `CAUSE=title-unchanged`
  ⇒ 成因被单独钉在字典接线上。⛔ 无此对照 ⇒「是本次接线造成的」只是一句未被检验的断言（硬规则 4 推论四）。
- [ ] **AC3（全量残留枚举 + 逐条归属，⛔ 不报「零」）**：对 zh 响应跑 `grep -n 'Manager'`，
  把**每一条**命中的 HTML 片段与它的**产生源**贴出（chrome 出自哪一行源码 / 数据出自哪个载体），
  并给出 **nav 区块内**与 **nav 区块外**两个计数。⛔ 禁止只报一个总数（硬规则 3）。
  预期：zh 下 nav 区块内 `Manager` 计数 = **0**，而同一谓词在 **en** 上 = **2**；
  若 `<h1>` 一并接线则区块外计数由 **5→4**（`<head>` meta 描述那条**预期保留**，见 Proposal 的作用域说明）。
- [ ] **AC4（判据裁决原样记录）**：贴出**实现后**的 `node packages/quay/bin/quay.js goal gate AC-294 --dry-run --json`
  完整输出 + `GATE_EXIT=`（⛔ 不解释、不改写它的 `CAUSE`）。**红就是红**：若仍红，把它具名 `CAUSE` 与 AC3 的归属一并交出。
  ⛔ **明令禁止**的三种「凑绿」：改判据（`goals/AC-294-*.md` ⛔ 不在本 Touches 内）、改别的任务的 title、
  把 zh 值写成含英文 `Manager` 的混合串。
- [ ] **AC5（不回归 + 作用域枚举）**：① `bash scripts/test.sh --for-task gap-ac294-manager-page-zh-chrome-nav-current-and-own-title` 绿；
  ② `node --test packages/quay/test/serve-*.test.mjs` 绿 —— 其中 `serve-ac95-views.test.mjs` 对 `/manager` 的既有断言
  测的是 **en 基线**，必须**原样绿**；
  ③ **作用域举证**：`grep -c 'html lang="en"' packages/quay/src/*.ts` **逐文件**贴出并与立案基线对照
  （立案基线：总数 **22**，其中 `serve-system.ts` **2** = `:64` `/system` + `:148` `/manager`）：
  本任务后 **`serve-system.ts` 的 `/manager` 那条消失**（AC-293 若已落地则该文件由 1→0），
  **其余 12 个文件计数一字未动**；⛔ 兄弟任务（AC-290~293）可能已先落地，故本条是**逐文件差量**，不是绝对值。
  ④ `git diff --name-only <base>...HEAD` 只含本任务 Touches 的路径。
- [ ] **AC6（陈旧实例的诚实报告，⛔ 不掩盖）**：贴出**驱动侧**实例（cwd = 主检出、判据探针会命中的那一个；
  立案时为 `pid=3696699`、`--host 0.0.0.0 --port 4173`）的 `curl -sf http://<addr>/health` 原始读数，
  并写明 `processStartedAt` / `latestCodeCommitAt` / `stale`。
  若其 `stale:true`，**明写**「驱动侧仍会红在 `CAUSE=html-lang-not-zh`，成因是该实例陈旧（AC-288 落地前的进程），
  与 `/manager` 的接线无关」—— ⛔ 不得据此把 AC1 的结论改写为「已达成」，⛔ 也不得为让它变绿而去重启/干扰本任务不拥有的实例。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「多了一个 lang 参数、单测绿了」，而是
**一个真实的 `quay serve` 进程在真实 HTTP 上，对同一个 URL 按请求头给出了两种语言的页面外壳**：

1. **落地对象**：运行中的实例上，`/manager` 在 `Cookie: lang=zh` 下页头 lang、本页 `<title>`、nav 当前项**都**变，
   且 en 基线逐字未变 —— **从响应体直读**（⛔ 不读 render 函数的返回值当「响应」，那测的是函数，不是线上行为）。
2. **可被打红**：AC2 的钳制对照**实际跑过**并贴上两次读数 ⇒ 证明这条判据不是结构上恒绿（硬规则 4）。
3. **判据裁决诚实**：AC4 的判据输出原样贴出，**红就是红**；⛔ 不用任何改写数据或改写字典值的方式把它变成绿。
   若因「操作前提」里那个陈旧实例而红，按 AC6 具名报告，⛔ 不勾「已达成」后靠 Evidence 描述补救。
4. **作用域**：AC5 的逐文件计数 + `git diff --name-only`，证明其余 14 页与同文件的 `/system` 未被顺手改掉。
5. **可回滚**：写明回滚形态（还原 `serve-system.ts` 的 `/manager` 接线 + 删除 `serve-i18n.ts` 的 `/manager` 词条
   + 重跑 `npm run build -w quay` + 重启实例）与它的作用域（纯本地代码、无外部状态）。
6. **证据留痕**：红/绿判据输出、en/zh 两条原始响应片段、因果对照两次读数、全量残留枚举、逐文件计数、
   驱动侧 `/health` 读数，落成**任务体内联**或**未跟踪** scratch 文件，可被下一轮独立复算（⛔ 不是只写一句「已修好」）。

## Touches

- tasks/gap-ac294-manager-page-zh-chrome-nav-current-and-own-title.md
- packages/quay/src/serve-system.ts
- packages/quay/src/serve-i18n.ts
- packages/quay/test/serve-manager.test.mjs

（说明：`packages/quay/src/serve-lang.ts` 属 AC-288 的产物、四个共享渲染函数与 `NAV_LABELS` 属 AC-289 的产物，
⛔ 均不在本 Touches 的**改动**意图内（`serve-i18n.ts` 只追加本页 `PAGE_LABELS` 词条）；
`packages/quay/src/serve-render.ts` 同理**不声明** —— 本任务对它 Δ=0；
`goals/AC-294-*.md` 属人与驱动维护面，⛔ 不在本 Touches。运行时证据若落 `.quay/` 则**保持未跟踪**，故不声明 ——
`anti-drift-touches-check` 只比对已跟踪文件。）