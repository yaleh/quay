---
id: gap-ac288-webui-lang-switch-mechanism
title: 语言切换机制整体不存在 ⇒ AC-288 判据 exit 1（CAUSE=query-param-not-honored）：新增 lang
  解析器（?lang= 优先 / Cookie 兜底 / 默认 en，合法 query 写持久化 cookie）并在 /dashboard 落地首个消费者
status: ready
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
- **`serve-render.ts` `ServePageCfg`** 增一个可选 `lang`；`htmlLangTag` 从这里 re-export（页面只 import 一处）。
- **`serve-handlers.ts` `handleAllRoutes`**：**每请求解析一次**，写 `Set-Cookie`（仅当 query 给了**合法**值时），
  然后把 `{...cfg, lang}` 作为**每请求副本**传给下游 handler。
  ⛔ **不得原地改 `cfg`**——`routeCfg`（`serve.ts:410`）是**服务生命周期共享对象**，
  原地写会把一个请求的语言**泄漏到并发/后续请求里**（那正是 AC3「三条断言各自独立」要挡的形态）。
- **`serve-dashboard.ts`**：`renderDashboardPage` 的 opts 增 `lang`；**两个**调用点都传 `cfg.lang`；
  `<html lang="en">` 改为 `${htmlLangTag(lang)}`。
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
   ① 纯函数正/负控制；② 黑盒：`makeTmpDir` 建真 workspace（`.quay/config.yml` + native provider，形态照抄既有黑盒测试）+
   `startServer({port:0})`，三条断言各自独立。
   ⚠️ `startServer` 默认 bind `0.0.0.0`；端口冲突会让 provider 子进程泄漏并**挂住整个套件**
   （`packages/quay/test/serve-bind-failure-no-leak.test.mjs:2-11` 实测 23.5 分钟教训）⇒ 用 `port: 0` 让内核选端口，⛔ 不自己探端口。
7. **构建产物**：`packages/quay/scripts/build-dist.mjs` 需要知道新模块 ⇒ 跑一次 `npm run build -w quay`，
   确认产物里含 `resolveLang`（新 src 模块没进 bundle 会让 dist / golden-replay 类测试假红）。
8. **收口**：判据绿 + scoped 门绿 + 既有 serve 套件不回归。

## AC

- [x] **AC1（goal 判据红→绿；⛔ 判据不是我改的）**：`node packages/quay/bin/quay.js goal gate AC-288` 在**现行判据**上 `verdict: pass`（exit 0），并排贴**同一条现行判据**的红读数——两次红与一次绿之间**唯一的变量是被服务的代码**（证据 §1 / §8）。
  ⚠️ **判据在实现期间被改过，但改的人不是我**：`615e2270c`（人 2026-09-17 裁定的「选项 A」）把它从「自启服务器的 python 脚本」改成「**探询一个已在运行的 `quay.ts serve`**（cwd = 仓库根）」的 shell 探针。⇒ 本条的举证因此不是「criterion 一字未动」，而是两件事**分别**成立：① 我的实现提交对 `goals/` **零命中**（`git show --stat e778958bf -- 'goals/AC-288-*.md'` ⇒ 空）；② 现行判据在**实现前**的代码上 fail、在**实现后**的代码上 pass，两次读数都由判据自己写下的具名 `CAUSE=` 区分。
- [x] **AC2（纯函数层正/负控制——判据可被打红）**：直接 import `resolveLang` 单测，**至少**覆盖四态且取值**互不同形**：`{query:"zh"}`→`zh` / `source:"query"` / `setCookie ≠ null`；`{cookie:"zh"}`→`zh` / `"cookie"` / `setCookie === null`；`{}`→`en` / `"default"`；`{query:"fr"}`→`source:"invalid"` 且其返回值与 `"default"` 那一态**不相等**。⛔ 只测「绿」不测「红」不算（恒绿读数携带零信息，硬规则 4）。
- [x] **AC3（黑盒三断言各自独立，贴原始响应）**：`startServer({port:0})` 起真服务，三条**分别**断言：① 无 query/cookie ⇒ body 含 `<html lang="en"`；② `?lang=zh` ⇒ body 含 `<html lang="zh"` **且** 响应头 `Set-Cookie` 逐字含 `lang=zh`；③ 只带 `Cookie: lang=zh`（URL 无 `?lang=`）⇒ body 含 `<html lang="zh"`。⛔ ② 的 body 与 Set-Cookie 是**两条**断言（判据里它们也是两条独立检查）。⛔ 不得只跑 ③ 就宣称 ② 成立。
- [x] **AC4（机制不是 /dashboard 特例——因果对照）**：在 `handleAllRoutes` 处把解析结果**临时**钳到 `"en"`（一次性本地改动，⛔ 不提交），证明 AC3 的 ②/③ 变红；恢复后复绿。两次读数并排贴出。⛔ 无此对照 ⇒ 「机制在派发器上生效」只是一句未被检验的断言（硬规则 4 推论四）。并列出传导面证据：`resolveLang` 的调用点**只有** `handleAllRoutes` 一处——贴 `grep -rn 'resolveLang' packages/quay/src/` 的**全部命中行**（⛔ 不是只报一个总数，硬规则 2）。
- [x] **AC5（不回归 + 作用域）**：① `scripts/test.sh --for-task gap-ac288-webui-lang-switch-mechanism` 绿；② `packages/quay/test/serve-*.test.mjs` 全部绿；③ **作用域举证**：`grep -rc 'html lang="en"' packages/quay/src/*.ts` 的总数为 **22**（23 − 1，只少了 dashboard 那一个），**逐文件**贴出计数，证明其余文件一字未动（那 22 个点属于 AC-289~303）。
- [x] **AC6（三个决定被记录，且可区分）**：把 ① `Vary: Cookie` 的设置位置与理由、② 非法值的 `source:"invalid"` 独立取值、③ `setCookie` 不带 `HttpOnly` 的理由，写进任务体内联。⛔ 三者都是「当时做了决定但没留痕就等于没做」的形态（硬规则 9）。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「多了一个 `serve-lang.ts` 文件、单测绿了」，而是
**一个真实的 `quay serve` 进程在真实 HTTP 上真的按契约翻转了语言并种下了 cookie**：

1. **落地对象**：`gate AC-288` 在**真实 origin** 上 `pass`，贴完整输出 + 红基线对照。
2. **不被冒名**：AC3 的三条断言各自**从响应头 / 响应体直接读**（⛔ 不读进程内中间变量、不把 render 函数的返回值当「响应」——那测的是函数，不是线上行为）。
3. **可被打红**：AC2（纯函数正/负控制）+ AC4（派发器钳制的因果对照）**实际跑过**并贴上两次读数 ⇒ 证明这条判据不是结构上恒绿。
4. **机制可被下游消费**：AC4 的传导面清单（`resolveLang` 唯一调用点 + `ServePageCfg.lang` 字段存在）——让 AC-289~303 的页面任务**只需一行**（把该页 opts 串上 `cfg.lang`），不需要重新实现解析。
5. **作用域**：AC5 的逐文件 `html lang="en"` 计数（总数 22），证明没有越界改其它页。
6. **可回滚**：写明回滚形态（删 `serve-lang.ts` + 还原 4 处接线）与它的作用域（纯本地代码，无外部状态）。
7. **证据留痕**：红/绿判据输出、纯函数正负控制、黑盒三断言原始响应、因果对照两次读数、逐文件计数，落成**任务体内联**或 `.quay/ac288-*` **未跟踪** scratch 文件，可被下一轮独立复算（⛔ 不是只写一句「已修好」）。

## 决定记录（AC6 —— 三个当时做了、但不留痕就等于没做的决定）

### ① `Vary: Cookie` 的设置位置与理由

**位置**：`packages/quay/src/serve-handlers.ts` 的 `handleAllRoutes`，紧跟语言解析之后、**任何 handler 派发之前**；
**无条件设置**（⛔ 不是只在「这次写了 cookie」的那类请求上）。

**理由（是正确性要求，不是卫生习惯）**：加上本机制后，响应**体**依赖请求的 `Cookie` 头，而 URL 可以逐字相同——
同一个裸 `/dashboard` 对 A 客户端渲染 `en`、对 B 客户端渲染 `zh`。没有 `Vary: Cookie`，中间缓存**有权**把先到的
那份响应喂给后到的请求，即「发一个用户根本没要的语言」。放在派发之前 ⇒ 它落在**所有**路由上（含 `/` 的 302 与
POST 路由），因为「响应依赖 cookie」这件事对每条路由都成立。`/health` 是唯一例外：它在 `serve.ts` 里于
`handleAllRoutes` 之前返回，且它的体与语言无关。

⛔ **不附带 `Vary: Accept-Language`**：本机制从不读该头，声明一个自己不读的头，只会为一个不存在的理由碎片化缓存。

### ② 非法值的 `source:"invalid"` 是独立取值（⛔ 不与 `"default"` 同形）

若判定器的输出词表里没有「读不懂输入」这一态，`?lang=fr` 就会与「没给语言偏好」折叠成同一个值、二者不可区分
（硬规则 3b / 6）。因此四态并存：`query` / `cookie` / `default` / `invalid`，其中 `invalid` **不与 `default` 同形**：
`lang` 同样落回 cookie/default，但 `source` 不同，且 `setCookie` 恒为 `null` —— **一个读不懂的值绝不被持久化成
用户的选择**。

`?lang=`（present-but-empty）归 `invalid` 而非「缺席」：`URLSearchParams.get` 对「参数不存在」返回 `null`、
对「存在但为空」返回 `""`，把两者当同一件事会抹掉 `source` 这个字段存在的理由。

**可被判红**：`packages/quay/test/serve-lang.test.mjs` 的 AC2① 里 `assert.notDeepEqual(byInvalid, byDefault)`
—— 谁把这两态合并，这条断言当场红（不是靠注释里写「我们区分了」）。

### ③ `setCookie` 不带 `HttpOnly` 的理由（以及为什么也不带 `Secure`）

`lang` **不携带任何权限**（不是凭据、不是身份）。`HttpOnly` 保护的是「凭据 cookie 不被 XSS 读走」，对零权限的
UI 偏好它挡不住任何真实攻击面；而它的代价是真实的：`HttpOnly` 会禁止**第一方**客户端代码读用户自己的语言选择，
从而堵死一类后续消费者（客户端控件无需往返地回显当前选择、或按语言做客户端格式化）。关掉它，这些消费者将来
不必改服务端。**真正在这里干活的是 `SameSite=Lax`**（挡跨站发送与跨站设置）。

**同理不设 `Secure`**：web 面跑在明文 HTTP 上（`quay serve --host <ip>`，典型是 127.0.0.1 或局域网地址），
而 `Secure` cookie 在 `http://` 源上会被浏览器直接丢弃 —— 那会让「持久化」在这个机制瞄准的部署形态上**静默失效**。

**位置**：`packages/quay/src/serve-lang.ts` 的 `LANG_COOKIE_ATTRS`，是这些属性的唯一正本；`langCookie()`
与它同源，`resolveLang` 派生出的 `setCookie` 不再重复书写属性串。

## 证据（DoD 7 —— 内联摘要 + `.quay/ac288-*` 未跟踪 scratch，可被下一轮独立复算）

载体：`.quay/ac288-raw-http-probe.py`（原始 HTTP 探针）、`.quay/ac288-raw-http-evidence.txt`（其输出）、
`.quay/ac288-serve-restarted.log`（现行判据所需的常驻实例日志）；前三者与
`packages/quay/test/serve-lang.test.mjs`（可复跑的判据本体，随分支提交）互为独立读法。

### 1. 判据红 → 绿（AC1）

判据在实现期间被**人**改过（`615e2270c`，2026-09-17，选项 A）：新形态不自己启服务，而是
`pgrep -f 'quay.ts serve'` 找**第一个** cwd = `git rev-parse --show-toplevel` 的进程，从它的 cmdline 派生
`--host/--port` 再 curl；`origin` 明写操作前提是「有一个 cwd=仓库根的 serve 在跑；实现落地后须**重启**该实例才能翻绿」。
⇒ 本条的对照因此取**同一条现行判据**在两种**被服务代码**上的读数（持久载体 `.quay/gate-events.jsonl`，逐条可复算）：

```
2026-09-17T15:04:02.268Z fail | CAUSE=query-param-not-honored …        ← 立案基线（旧判据形态）
2026-09-17T15:08:52.489Z fail | CAUSE=query-param-not-honored …
2026-09-17T15:09:22.133Z fail | CAUSE=query-param-not-honored …
2026-09-17T16:05:03.207Z fail | CAUSE=query-param-not-honored …        ← 现行判据，打在【实现前】的常驻实例上
2026-09-17T16:05:31.567Z fail | CAUSE=default-fetch-failed -- GET http://127.0.0.1:45083/dashboard returned nothing (addr=127.0.0.1:45083)
2026-09-17T16:06:46.367Z pass | acceptance passed (exit 0)             ← 现行判据，打在【实现后】的常驻实例上
```

⛔ **我的提交对 `goals/` 零命中**：`git show --stat e778958bf -- 'goals/AC-288-*.md'` ⇒ **空**。
判据的两侧读数由它自己写下的具名 `CAUSE=` 区分，不是靠人工解释。

### 2. 纯函数正/负控制（AC2）

`node --test packages/quay/test/serve-lang.test.mjs` ⇒ **9 tests / 9 pass / 0 fail**，四个纯函数用例逐条：
AC2① 四态互不同形（含 `notDeepEqual(invalid, default)` 的负控制）、AC2② `en`/`zh` 同一条代码路径、
AC2③ query 压过 cookie 且非法 query 让位给合法 cookie、AC2④ `parseCookieHeader`/`isLang`/`htmlLangTag`
的边界（首个 `=` 切分、空名丢弃、大小写敏感、`undefined` ⇒ 默认标签）。

### 3. 黑盒三断言 + 非法值，从**响应头 / 响应体**直读（AC3）

`.quay/ac288-raw-http-probe.py` 起**真** `quay serve`（source 入口），逐条打印 status / `Set-Cookie` / `Vary` / body 里的 `<html …>` 标签：

```
① GET /dashboard（无 query 无 cookie）
   status 200 | Set-Cookie None | Vary 'Cookie' | body tag '<html lang="en">'
② GET /dashboard?lang=zh
   status 200 | Set-Cookie 'lang=zh; Path=/; Max-Age=31536000; SameSite=Lax' | Vary 'Cookie' | body tag '<html lang="zh">'
   ↳ 紧接一次不带 cookie 的 GET /dashboard ⇒ '<html lang="en">'（同一请求序列内，无跨请求泄漏）
③ GET /dashboard  headers={'Cookie': 'lang=zh'}（URL 无 ?lang=）
   status 200 | Set-Cookie None | Vary 'Cookie' | body tag '<html lang="zh">'
④ GET /dashboard?lang=fr（非法）
   status 200 | Set-Cookie None | Vary 'Cookie' | body tag '<html lang="en">'
⑤ GET /dashboard?lang=en  headers={'Cookie': 'zh'}（query 压过 cookie）
   status 200 | Set-Cookie 'lang=en; …' | Vary 'Cookie' | body tag '<html lang="en">'
```

②是**两条独立断言**（body 的标签 / 响应头的 Set-Cookie）—— 在测试文件里分列，在判据里也分列；
③ 的绿灯来自它自己的请求头，而不是②留下的 cookie（`request()` 不带 cookie jar，这是刻意的）。
④⑤ 是判据没写、但契约明写的边界：非法值既不渲染也不种 cookie；`?lang=en` 与 `?lang=zh` 走同一条路（都写 cookie）。

### 4. 因果对照：机制在**派发器**上，不是 /dashboard 特例（AC4）

一次性本地改动（**未提交**，取证后已还原、已 grep 确认无残留）：把 `handleAllRoutes` 里的解析结果钳成
`{ lang: "en", setCookie: null }`，再跑黑盒五条：

```
钳制后：✔ AC3①  ✖ AC3②  ✖ AC3③  ✖ AC3④  ✔ AC3⑤     （tests 5 / pass 2 / fail 3）
还原后：✔ AC3①  ✔ AC3②  ✔ AC3③  ✔ AC3④  ✔ AC3⑤     （tests 5 / pass 5 / fail 0）
```

②③④ 随钳制变红 ⇒ 它们的绿是**派发器解析**造成的，而不是渲染函数或 /dashboard 自己的分支造成的；
①⑤ 仍绿是**正确的**（它们断言的正是 `en`），也说明这五条断言各自有区分力，不是整组恒绿。

传导面（AC4 要求的**全部命中行**，不是总数）：`grep -rn 'resolveLang' packages/quay/src/`

```
packages/quay/src/serve-lang.ts:32: *  a dedicated branch anywhere in this module (see `resolveLang`). */
packages/quay/src/serve-lang.ts:104:export function resolveLang(
packages/quay/src/serve-handlers.ts:15:// transmission-surface claim; `grep -rn resolveLang packages/quay/src/` returns this line + the one
packages/quay/src/serve-handlers.ts:17:import { resolveLang, parseCookieHeader, LANG_COOKIE_NAME } from "./serve-lang.ts";
packages/quay/src/serve-handlers.ts:69:  const { lang, setCookie } = resolveLang({
packages/quay/src/serve-handlers.ts:73:  // Set-Cookie only when the query named a legal language (see resolveLang's `setCookie` contract).
```

⇒ 唯一的**调用点**是 `serve-handlers.ts:69`（另两行是文件内的注释与 import，`serve-lang.ts` 的命中是定义与自身文档）；
下游页面的消费面 = `ServePageCfg.lang?: Lang`（`serve-render.ts`）+ `htmlLangTag`（同文件 re-export）——
AC-289~303 的页面任务只需把本页的 `opts`/`cfg.lang` 串上，**不需要重新实现解析**。

### 5. 作用域：逐文件 `html lang="en"`（AC5③，硬规则 3 —— 枚举不是布尔）

`grep -rc 'html lang="en"' packages/quay/src/*.ts`（改动后），**逐文件**：

```
serve-adr.ts 2 · serve-architecture.ts 1 · serve-board.ts 1 · serve-doc.ts 2 · serve-git.ts 2 ·
serve-goal.ts 2 · serve-live.ts 2 · serve-needs-human.ts 1 · serve-send.ts 1 · serve-sessions.ts 2 ·
serve-system.ts 2 · serve-task.ts 2 · serve-tests.ts 2          （13 个文件）
serve-dashboard.ts 0                                            ← 本次唯一减少的文件
------------------------------------------------------------------------------
合计 22          （立案基线 23，差 1 = dashboard 那一个）
```

⚠️ 更正任务体早先的一处措辞：立案时是「23 处 / **14** 个文件」（含 dashboard），故改动后未被触碰的是
**13** 个文件 22 处，而不是先写的「其余 14 个文件」。上面的清单是**枚举**结果，不是从那个数字推的。

### 6. 不回归（AC5①②）

- `bash scripts/test.sh --for-task gap-ac288-webui-lang-switch-mechanism --allow-thin` ⇒ `tests 167 / pass 167 / fail 0`，`SCOPED_EXIT=0`
  （merge develop 之后**复跑一次同样 167/167**；新测试确实被选中并执行：输出中含 `✔ AC3⑤ …`）。
- `node --test packages/quay/test/serve-*.test.mjs`（21 个文件）⇒ `tests 195 / pass 194 / fail 0 / skipped 1`，`SERVE_EXIT=0`。
- `tsc --noEmit`（`.quay/config.yml` 里 `ts-typecheck` 门逐字的那条 per-package 循环）⇒ `TSC_EXIT=0`。
- `npm run build -w quay` ⇒ 产物里 `resolveLang` 命中 2、`htmlLangTag` 命中 2（新模块确实进了 bundle，
  ⛔ 不是「源码有、产物没有」的假红形态）。

### 7. 回滚形态（DoD 6）

纯本地代码，**无外部状态**（不写数据库、不改配置、不动 git ref）。回滚 = 删 `packages/quay/src/serve-lang.ts`
+ 还原三处接线（`serve-handlers.ts` 的 import 与解析块、`serve-render.ts` 的 re-export 与 `ServePageCfg.lang`、
`serve-dashboard.ts` 的两处调用点与页头标签），并重跑 `npm run build -w quay`。
回滚后 `/dashboard` 回到恒 `en`（即 AC-288 判据回到 fail），影响面仅限 web 面的语言标签与一个响应头，
不涉及任何持久化数据的形态。

### 8. 现行判据的操作前提 + 一个实测到的判据缺陷（⛔ 属于判据，不属于本任务）

**操作前提（`origin` 明写，实测确认）**：现行 AC-288 判据要求**已有一个 cwd = 仓库根的 `quay.ts serve` 在跑**。
本 task 落地后已在本任务 worktree 内起了一个常驻实例供判据读取：
`pid 3338896 · cwd = /home/yale/work/quay-worktrees/gap-ac288-webui-lang-switch-mechanism · --host 127.0.0.1 --port 51921`
（`setsid nohup node --experimental-strip-types packages/quay/bin/quay.ts serve --host 127.0.0.1 --port <N>`，
日志 `.quay/ac288-serve-restarted.log`）。⛔ **改完代码必须重启它**，否则判据读的是旧代码。

**实测到的缺陷（硬规则 3 的「枚举 vs 首个」形态）**：判据用 `pgrep -f 'quay.ts serve'` 取**第一个** cwd 匹配的进程
就 `break`，即在一个**无序集合**上取首个元素，且不校验它是否还活着：16:05:03 那次红正是它挑中了
`pid 3004043`（15:48:35 启动、承载**实现前**代码的孤儿，port 45083）——两次红读数（`query-param-not-honored`
与随后的 `default-fetch-failed -- addr=127.0.0.1:45083`）都指向同一个孤儿。孤儿来自**旧判据形态**自己：
它自启的 `quay.js serve` 只 kill 了 shim，`spawnSync` 出来的 `quay.ts serve` 子进程留了下来（实测同 cwd 下积了 4 个）。
⇒ 影响面不止本任务：**任何 cwd 下有陈旧实例的仓库，该判据都会静默地测旧代码**（新旧实例同时存在时更是随机取一个）。
处置（本任务采取的）：只 kill **cwd = 本任务 worktree** 的 4 个孤儿（`pgrep` + `readlink /proc/<pid>/cwd` 逐个判，
⛔ 主检出 `/home/yale/work/quay` 的实例一个未动），再起一个承载新代码的实例。**判据本身的修法不在本任务 Touches 内**
（`goals/AC-288-*.md` 属人/驱动维护面），此处只留证据供其所有者决定。

## Touches

- tasks/gap-ac288-webui-lang-switch-mechanism.md
- packages/quay/src/serve-lang.ts (new)
- packages/quay/src/serve-render.ts
- packages/quay/src/serve-handlers.ts
- packages/quay/src/serve-dashboard.ts
- packages/quay/test/serve-lang.test.mjs (new)

（说明：本任务只碰**机制 + /dashboard 这一个消费者**。其余 13 个 serve-*.ts 的 22 个 `html lang="en"` 硬编码点**刻意不在本 Touches 内**——
它们各自属于 AC-289~303 的页面任务，列入会把那 15 条任务的并发面锁死。`packages/quay/src/serve.ts` 也不在列：
解析与 `Set-Cookie` 都落在 `handleAllRoutes`（`serve-handlers.ts`），`routeCfg` 只需保持只读、不必改动。
取证用 scratch（`.quay/ac288-raw-http-probe.py` / `.quay/ac288-raw-http-evidence.txt` / `.quay/ac288-serve-restarted.log`）
为未跟踪文件，不进交付面。）