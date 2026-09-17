---
id: gap-ac288-webui-lang-switch-mechanism
title: 语言切换机制整体不存在 ⇒ AC-288 判据 exit 1（CAUSE=query-param-not-honored）：新增 lang
  解析器（?lang= 优先 / Cookie 兜底 / 默认 en，合法 query 写持久化 cookie）并在 /dashboard 落地首个消费者
status: todo
labels:
  - gap
  - webui
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-288
---
**type:** execution

## Proposal

**缺口（AC-288 判据，立案当轮直接量，2026-09-17T15:04:02Z，cwd = 主检出 `/home/yale/work/quay`）**：

`node packages/quay/bin/quay.js goal gate AC-288` ⇒ **exit 1**，逐字：

```
{"id":"AC-288","verdict":"fail",
 "reason":"acceptance failed (exit 1) — CAUSE=query-param-not-honored -- /dashboard?lang=zh did not respond <html lang=\"zh\">",
 "timestamp":"2026-09-17T15:04:02.268Z","dryRun":false, ...}
GATE_EXIT=1
```

**缺口不是「判据读不懂」**（硬规则 3b 的静默通过形态在这里被避免了：判据打印了具名 `CAUSE=`），
而且它**已经走过前两段检查**——`/dashboard` 无参数时**确实**回 `<html lang="en">`（第一段 `default-not-en` 未触发），
**fail 在第二段**：`?lang=zh` 没有翻转。⇒ 缺口位置被判据自己钉死在「query 参数未被兑现」。

**现状 enumerate（按位置，⛔ 不按关键词；立案当轮实测）**：

| 量 | 读数 | 取法 |
|---|---|---|
| `html lang="en"` 硬编码点 | **23 处 / 14 个文件** | `grep -rc 'html lang="en"' packages/quay/src/*.ts`（serve-tests / serve-task / serve-system / serve-sessions / serve-live / serve-goal / serve-git / serve-doc / serve-adr 各 2；serve-send / serve-needs-human / serve-dashboard / serve-board / serve-architecture 各 1） |
| cookie 读取/写入点 | **0 处** | `grep -rni 'cookie' packages/quay/src/*.ts packages/quay/bin/*.ts` ⇒ 空 |
| `Set-Cookie` 响应头 | **0 处** | `grep -rn 'Set-Cookie' packages/quay/src/*.ts packages/quay-native/src/*.ts` ⇒ 空 |
| `?lang=` 解析点 | **0 处** | 派发器 `handleAllRoutes`（`packages/quay/src/serve-handlers.ts:49`）只读 pathname 与少数既有 query（如 `hours`） |

⇒ **机制整体不存在**，不是「有机制但 /dashboard 没接上」。三个读法互相独立（源码位置计数、cookie 词扫、响应头词扫）指向同一结论。

**契约（AC-288 的 `origin` 逐字裁定，本任务即其实现）**：query 参数名/值 = `lang=en|zh`；cookie 名/值 = `lang=en|zh`；默认 `en`。
⇒ **取值是闭集 `{en, zh}`**：非法值（`?lang=fr` / `Cookie: lang=fr`）**不是**「另一个合法语言」，
必须与「没给」分派到**可区分**的不同取值上（硬规则 3b / 6：一个判定若没有「未评估/非法」这一态，
就无法区分「查过且合格」与「读不懂输入」）。

### 关键口径：本任务做【机制】，⛔ 不做那 14 个页面的翻译

GOAL-024 的 16 条 AC 是两层：**AC-288 = 机制本身**；**AC-289~303 = 15 个 nav 路由各自的「导航当前项标签 + `<title>`」在 zh 下真实变化**。
本任务的落地面 = **机制 + 第一个消费者 `/dashboard`**（AC-288 的判据只打 /dashboard）。
⛔ **不把其余 14 页的 `<html lang="en">` 一并改掉**——那 22 个硬编码点属于 AC-289~303 各自的页面任务，
一次改完会与它们的 `## Touches` 交叠，并在 `dispatchable_disjoint` 上把并发面锁死（本仓库实测过的形态）。

**⇒ 机制的验收形态是「其它页面只需一行即可消费」**。举证方式见 AC4：不是「我们设计得很好」，
而是 `ServePageCfg.lang` 字段存在 + 解析只在派发器发生一次 + 页面侧零 `?lang=`/cookie 解析。

### 设计与作用域（一处解析，N 处消费）

- **`packages/quay/src/serve-lang.ts`（新）**：纯函数核——`parseCookieHeader(header)`、
  `resolveLang({queryLang, cookieLang})` → `{lang, source: "query"|"cookie"|"default"|"invalid", setCookie: string|null}`、
  `htmlLangTag(lang)`。做成纯函数是为了能被**直接 import 单测**（本仓库既有形态：分支密集的决策函数都有直接 import 单测）。
- **`serve-render.ts:997` `ServePageCfg`** 增一个可选 `lang`；`htmlLangTag` 从这里 re-export（页面只 import 一处）。
- **`serve-handlers.ts:49` `handleAllRoutes`**：**每请求解析一次**，写 `Set-Cookie`（仅当 query 给了**合法**值时），
  然后把 `{...cfg, lang}` 作为**每请求副本**传给下游 handler。
  ⛔ **不得原地改 `cfg`**——`routeCfg`（`serve.ts:410`）是**服务生命周期共享对象**，
  原地写会把一个请求的语言**泄漏到并发/后续请求里**（那正是 AC3「三条断言各自独立」要挡的形态）。
- **`serve-dashboard.ts`**：`renderDashboardPage` 的 opts 增 `lang`；**两个**调用点（`:1817` 快照路径 / `:1856` 旧路径）都传 `cfg.lang`；
  `:1304` 的 `<html lang="en">` 改为 `${htmlLangTag(lang)}`。
  ⚠️ **两条路径都必须改**：快照路径是**生产默认路径**（`peekDashboardSnapshot` 命中即 `return`），
  只改旧路径 ⇒ 生产形态下判据仍红，而某些测试可能恰好走旧路径 ⇒ **假绿**。

### 去重核对（机制，不是症状关键词）

<!-- dedup-ref -->
- 顶层 `goal_ac: AC-288`：`grep -rn '^goal_ac: AC-288' tasks/*.md` ⇒ **零命中**。
- `GOAL-024`：`grep -rln 'GOAL-024' tasks/*.md` ⇒ **零命中**（该 GOAL 的 16 条 AC 于 `8419a026f` 批量立项，尚无任何子任务）。
- 机制词复扫（`lang=zh` / `双语` / `i18n` / `bilingual`）：命中 1 个文件 `gap-ac-record-choke-point-naming-dedup-ac238-bypass`，
  经核实为**假阳性**——命中的是 `双语义`（字段双语义），与语言切换无关。
- 同域邻面（不同机制，仅记 traceability）：`gap-webui-detail-page-head-drops-pagestyles`（`done`）做的是页面 shell 样式表绑定，
  同属 serve 页头面但机制不同（样式 vs 语言解析）；本任务复用它在 `packages/quay/test/gap-webui-detail-page-head-drops-pagestyles.test.mjs` 里建立的
  `makeTmpDir` + `.quay/config.yml` + `startServer({port:0})` 黑盒测试形态。

## Plan

1. **红基线**（⛔ 不假定仍等于立案值）：`node packages/quay/bin/quay.js goal gate AC-288` ⇒ `verdict: fail` + `CAUSE=query-param-not-honored`，贴完整输出。
2. **新建 `packages/quay/src/serve-lang.ts`**（纯函数核）。取值表写进头注释作为契约正本：
   - query 合法 ⇒ 用它，`source:"query"`，`setCookie` 非空；
   - query 缺 ⇒ 看 cookie：cookie 合法 ⇒ 用它，`source:"cookie"`，`setCookie:null`；
   - 两者都缺 ⇒ `en`，`source:"default"`；
   - query 给了但**非法** ⇒ `source:"invalid"`（**独立取值**，⛔ 不与 `"default"` 同形），语言落回 cookie / default。
   - `setCookie` 形如 `lang=zh; Path=/; Max-Age=31536000; SameSite=Lax`。**仅当 query 合法时写**；`en` 与 `zh` 走**同一条代码路径**（无专门分支）。
3. **接线 `serve-handlers.ts`**：`handleAllRoutes` 顶部 `const { lang, setCookie } = resolveLang(...)`；
   `if (setCookie) res.setHeader("Set-Cookie", setCookie)`；另设 `Vary: Cookie`（响应体依赖 cookie，
   ⛔ 不设会让中间缓存把一种语言的响应喂给另一种语言的请求）；然后 `const reqCfg = { ...cfg, lang }` 传下游。
4. **`serve-render.ts`**：`ServePageCfg` 增 `lang?: Lang`；re-export `htmlLangTag`。
5. **`serve-dashboard.ts`**：`renderDashboardPage` opts 增 `lang`；**两处**调用点传 `cfg.lang`；`:1304` 用 `${htmlLangTag(lang)}`。
6. **新测试 `packages/quay/test/serve-lang.test.mjs`**（`// @test-group product`，`node:test`）：
   ① 纯函数正/负控制；② 黑盒：`makeTmpDir` 建真 workspace（`.quay/config.yml` + native provider，
   形态照抄 `packages/quay/test/gap-webui-detail-page-head-drops-pagestyles.test.mjs:100-135`）+ `startServer({port:0})`，三条断言各自独立。
   ⚠️ `startServer` 默认 bind `0.0.0.0`；端口冲突会让 provider 子进程泄漏并**挂住整个套件**
   （`packages/quay/test/serve-bind-failure-no-leak.test.mjs:2-11` 实测 23.5 分钟教训）⇒ 用 `port: 0` 让内核选端口，⛔ 不自己探端口。
7. **构建产物**：`packages/quay/scripts/build-dist.mjs` 需要知道新模块 ⇒ 跑一次 `npm run build -w quay`，
   确认产物里含 `resolveLang`（新 src 模块没进 bundle 会让 dist / golden-replay 类测试假红）。
8. **收口**：判据绿 + scoped 门绿 + 既有 serve 套件不回归。

## AC

- [ ] **AC1（goal 判据红→绿，判据一字未动）**：`node packages/quay/bin/quay.js goal gate AC-288` 逐字重跑 `verdict: pass` 并贴完整输出，**并排**贴第 1 步的红基线（同一条命令、同一个对象，取值由 fail 变 pass ⇒ 判据可被打红且这次改动是那个变化的因）。⛔ `goals/AC-288-*.md` 的 `criterion` / `expect` / `origin` / `activatedAt` 四处**一字未动**（举证：`git diff develop -- goals/AC-288-*.md` 零命中 + 两侧 blob sha 相同）。
- [ ] **AC2（纯函数层正/负控制——判据可被打红）**：直接 import `resolveLang` 单测，**至少**覆盖四态且取值**互不同形**：`{query:"zh"}`→`zh` / `source:"query"` / `setCookie ≠ null`；`{cookie:"zh"}`→`zh` / `"cookie"` / `setCookie === null`；`{}`→`en` / `"default"`；`{query:"fr"}`→`source:"invalid"` 且其返回值与 `"default"` 那一态**不相等**。⛔ 只测「绿」不测「红」不算（恒绿读数携带零信息，硬规则 4）。
- [ ] **AC3（黑盒三断言各自独立，贴原始响应）**：`startServer({port:0})` 起真服务，三条**分别**断言：① 无 query/cookie ⇒ body 含 `<html lang="en"`；② `?lang=zh` ⇒ body 含 `<html lang="zh"` **且** 响应头 `Set-Cookie` 逐字含 `lang=zh`；③ 只带 `Cookie: lang=zh`（URL 无 `?lang=`）⇒ body 含 `<html lang="zh"`。⛔ ② 的 body 与 Set-Cookie 是**两条**断言（判据里它们也是两条独立检查）。⛔ 不得只跑 ③ 就宣称 ② 成立。
- [ ] **AC4（机制不是 /dashboard 特例——因果对照）**：在 `handleAllRoutes` 处把解析结果**临时**钳到 `"en"`（一次性本地改动，⛔ 不提交），证明 AC3 的 ②/③ 变红；恢复后复绿。两次读数并排贴出。⛔ 无此对照 ⇒ 「机制在派发器上生效」只是一句未被检验的断言（硬规则 4 推论四）。并列出传导面证据：`resolveLang` 的调用点**只有** `handleAllRoutes` 一处——贴 `grep -rn 'resolveLang' packages/quay/src/` 的**全部命中行**（⛔ 不是只报一个总数，硬规则 2）。
- [ ] **AC5（不回归 + 作用域）**：① `scripts/test.sh --for-task gap-ac288-webui-lang-switch-mechanism` 绿；② `packages/quay/test/serve-*.test.mjs` 全部绿；③ **作用域举证**：`grep -rc 'html lang="en"' packages/quay/src/*.ts` 的总数为 **22**（23 − 1，只少了 dashboard 那一个），**逐文件**贴出计数，证明其余 14 个文件一字未动（那 22 个点属于 AC-289~303）。
- [ ] **AC6（三个决定被记录，且可区分）**：把 ① `Vary: Cookie` 的设置位置与理由、② 非法值的 `source:"invalid"` 独立取值、③ `setCookie` 不带 `HttpOnly` 的理由，写进任务体内联。⛔ 三者都是「当时做了决定但没留痕就等于没做」的形态（硬规则 9）。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「多了一个 `serve-lang.ts` 文件、单测绿了」，而是
**一个真实的 `quay serve` 进程在真实 HTTP 上真的按契约翻转了语言并种下了 cookie**：

1. **落地对象**：`gate AC-288` 在**真实 origin** 上 `pass`，贴完整输出 + 红基线对照。
2. **不被冒名**：AC3 的三条断言各自**从响应头 / 响应体直接读**（⛔ 不读进程内中间变量、不把 render 函数的返回值当「响应」——那测的是函数，不是线上行为）。
3. **可被打红**：AC2（纯函数正/负控制）+ AC4（派发器钳制的因果对照）**实际跑过**并贴上两次读数 ⇒ 证明这条判据不是结构上恒绿。
4. **机制可被下游消费**：AC4 的传导面清单（`resolveLang` 唯一调用点 + `ServePageCfg.lang` 字段存在）——让 AC-289~303 的页面任务**只需一行**（把该页 opts 串上 `cfg.lang`），不需要重新实现解析。
5. **作用域**：AC5 的逐文件 `html lang="en"` 计数（总数 22），证明没有越界改其它 14 页。
6. **可回滚**：写明回滚形态（删 `serve-lang.ts` + 还原 4 处接线）与它的作用域（纯本地代码，无外部状态）。
7. **证据留痕**：红/绿判据输出、纯函数正负控制、黑盒三断言原始响应、因果对照两次读数、逐文件计数，落成**任务体内联**或 `.quay/ac288-*` **未跟踪** scratch 文件，可被下一轮独立复算（⛔ 不是只写一句「已修好」）。

## Touches

- tasks/gap-ac288-webui-lang-switch-mechanism.md
- packages/quay/src/serve-lang.ts (new)
- packages/quay/src/serve-render.ts
- packages/quay/src/serve-handlers.ts
- packages/quay/src/serve-dashboard.ts
- packages/quay/test/serve-lang.test.mjs (new)

（说明：本任务只碰**机制 + /dashboard 这一个消费者**。其余 14 个 serve-*.ts 的 22 个 `html lang="en"` 硬编码点**刻意不在本 Touches 内**——
它们各自属于 AC-289~303 的页面任务，列入会把那 15 条任务的并发面锁死。`packages/quay/src/serve.ts` 也不在列：
解析与 `Set-Cookie` 都落在 `handleAllRoutes`（`serve-handlers.ts`），`routeCfg` 只需保持只读、不必改动。）