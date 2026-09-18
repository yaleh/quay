---
id: gap-webui-lang-switcher-control
title: web UI 无任何可点击的语言切换控件 —— serve-lang.ts 机制已生效但 nav 里没有入口
status: done
labels:
  - gap
  - webui
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**缺口（立案当轮直接量，2026-09-18，cwd = 主检出 `/home/yale/work/quay`）**：

`gap-ac288-webui-lang-switch-mechanism`（done）与 GOAL-024 AC-289~303（16 条，全部 done）已经把语言解析机制
（`packages/quay/src/serve-lang.ts` 的 `?lang=` query → `lang` cookie → 默认 `en`）与全部 15 个 nav 路由的
文案（`serve-i18n.ts` `NAV_LABELS`/`PAGE_LABELS`）接好，语言切换本身**功能上完全可用**——但页面渲染出的
HTML 里**没有任何一个可点击的元素**去触发这个切换。

**现状 enumerate（按位置，⛔ 不按关键词；立案当轮实测）**：

| 量 | 读数 | 取法 |
|---|---|---|
| `?lang=` 出现在渲染出的 `<a href=…>` 里的次数 | **0** | `grep -rn '?lang=\|langSwitcher\|LanguageSwitcher\|lang-toggle\|toggleLang' packages/quay/src/*.ts` 全仓库扫描，除 `serve-lang.ts` 自己的契约注释与各页「不得重新解析 `?lang=`/cookie」的 WHY 注释外，零命中 |
| 提及 switcher/toggle/selector/picker 的任务 | **0** | `grep -rli 'switcher\|toggle.*lang\|language.*picker\|language.*selector' tasks/*.md` ⇒ 空 |
| `renderSiteNav` / `renderMobileChrome` 渲染出的元素 | 15 个 `navItem`（各自 `<a href="/route">` 或当前页 `<span class="nav-current">`）+ 品牌 `<span class="nav-brand">Quay</span>` | `packages/quay/src/serve-render.ts:840-920`，逐项枚举，**没有第 16 个「语言」条目** |

⇒ **不是 AC-288/AC-289~303 的缺口延续**——那两批任务的验收形态本就是「机制 + 文案接线」，`gap-ac288-…`
的任务体 `## 关键口径` 一节明写「本任务做【机制】」，从未承诺过一个 UI 控件；这是一个**新的、独立的机制缺口**
（有可点击入口 vs 无可点击入口，是两个不同的东西）。

**去重核对（机制，不是症状关键词）**：

<!-- dedup-ref -->
- `switcher`/`toggle.*lang`/`language.*picker`/`language.*selector`：`tasks/*.md` 零命中（见上表）。
- 相关但不同机制（仅记 traceability，不构成依赖）：`gap-ac288-webui-lang-switch-mechanism`（done，语言解析机制本体）、
  GOAL-024 AC-289~303 的 16 个页面任务（done，各页文案接线）。本任务**复用**它们已经落地的 `resolveLang`/
  `Set-Cookie`/`?lang=` 契约，不重新实现解析，只补渲染面的入口。

## Plan

1. **红基线**：对任意一个已渲染页面（如 `/dashboard`）的响应体做 `grep -c '?lang='`，确认为 **0**——渲染出的
   HTML 里没有任何语言切换链接。同时确认 `packages/quay/src/serve-render.ts` 里 `renderSiteNav`/`renderMobileChrome`
   （分别是桌面头部与移动端汉堡菜单，两处已各自接收 `lang: Lang` 参数用于渲染文案，但都没有渲染切换控件本身）。

2. **新增 `renderLangSwitcher(current: Lang)` 纯函数**（`serve-render.ts`，紧邻 `navItem`/`renderSiteNav` 定义处）：
   - 渲染两个目标语言的链接：`en` 与 `zh`，样式复用 `navItem` 的 current/非-current 二态处理
     （当前语言渲染成非链接的 `<span class="nav-current" aria-current="true">`，另一语言渲染成 `<a href="?lang=en">`/`<a href="?lang=zh">`）；
   - href 用**相对路径** `?lang=en`/`?lang=zh`（浏览器按当前 pathname 解析，天然保留当前所在页面；不携带
     其它既有 query 参数，作为已知的最小可用范围——见 AC6 的边界说明，不在本任务范围内扩展成"保留全部 query"）；
   - 复用 AC-288 已定的契约：点击后浏览器带 `?lang=` 发起 GET，`resolveLang` 写 `Set-Cookie`，**不需要任何新的
     服务端逻辑**，本任务只加渲染。
   - 文案（"EN"/"中文"，以及 `aria-label`，如"切换到英文"/"Switch to Chinese"）新增进 `serve-i18n.ts`，
     跟随既有字典模式（不裸写字符串在 `serve-render.ts` 里）。

3. **接入两处 chrome**：
   - `renderSiteNav`（桌面头部，`serve-render.ts:878`）：在 `.nav` 内、`nav-group` 之后追加 `renderLangSwitcher(lang)`。
   - `renderMobileChrome`（移动头部，`serve-render.ts:908`）：在 `mobile-header` 内追加同一个控件（可复用同一渲染函数，
     用不同的 CSS 类前缀，参照 `navItem` 对 `"nav-" | "mobile-menu-"` prefix 的既有处理方式）。
   - ⛔ 两处都必须接（只接桌面会让移动端用户仍然无入口，反之亦然）。

4. **样式**：复用既有 design token（`.nav-current`/`.nav .nav-item` 已有的颜色/字重变量），不引入新的硬编码颜色值。

5. **新测试 `packages/quay/test/serve-lang-switcher.test.mjs`**（`// @test-group product`，`node:test`）：
   ① `renderLangSwitcher` 纯函数正负控制（`lang:"en"` 时 EN 是 non-link 当前态、ZH 是指向 `?lang=zh` 的链接；反之亦然）；
   ② 黑盒：`startServer({port:0})` 起真服务，GET 任意页面，body 里含渲染出的语言切换链接，且 href 逐字含 `?lang=en`/`?lang=zh`；
   ③ 覆盖全部 16 个路由（`SITE_NAV_ROUTES` 逐一 GET），证明入口不是只加在某一个页面上。

6. **因果对照**：一次性本地改动（不提交）把 `renderLangSwitcher` 调用点注释掉，验证 AC3②③ 变红；恢复后复绿。

7. **收口**：`bash scripts/test.sh --for-task gap-webui-lang-switcher-control` 绿 + `packages/quay/test/serve-*.test.mjs` 全绿 + `tsc --noEmit` 绿。

## AC

### 验收读数（原始输出，逐条对应）

**AC1（红基线）** —— 两个 `renderLangSwitcher` 调用点从 `serve-render.ts` 移除后，真实 `quay serve`（`port: 0`，temp workspace）+ 原始 HTTP：
```
probe: GET /dashboard -> 53036 bytes
probe: grep -c '?lang=' (occurrences) = 0
probe: href="?lang=zh" occurrences      = 0
probe: href="?lang=en" occurrences      = 0
probe: nav-switcher (desktop) occurrences = 0
probe: nav-switcher (mobile)  occurrences = 0
probe: GET /dashboard?lang=zh -> <html lang="zh"> = true          ← 机制本体仍在，缺的只是入口
```
接线后同一探针：`grep -c '?lang=' = 2`、`href="?lang=zh" = 2`、`desktop = 1`、`mobile = 1`。
（⛔ 计数口径：`pageStyles()` 里本控件的 CSS 注释刻意不写语言 query 字面量——否则未接线基线会读成 1 而不是 0。）

**AC2（纯函数正负控制）**：
```
✔ AC2① — the ACTIVE language is not a link to itself; the other one is (both directions)
✔ AC2② — the accessible names are keyed on BOTH axes (reader AND target), and are complete
```
AC2①：`renderLangSwitcher("en")` 含 `href="?lang=zh"`、**不含** `href="?lang=en"`、含 `aria-current="true"`；`"zh"` 为镜像；两态 `notEqual`。
（这一对断言互相钳制：两端都发 ⇒ `!includes` 侧红；两端都不发 ⇒ 正侧红。）

**AC3（桌面 + 移动端两处分别断言）**：
```
✔ AC3② — /dashboard's DESKTOP and MOBILE chrome EACH carry the control, in both languages
```
区域分别抽取（`.nav` 到 `</nav>` / `<header class="mobile-header">` 到 `</header>`），每个区域独立断言
`lang-switcher` 存在、en 请求含 `href="?lang=zh"` 且不含 `href="?lang=en"`，zh 请求（`Cookie: lang=zh`）为镜像；
并附互斥负控制（桌面区域不含 `mobile-header`，移动区域不含 `class="nav-item"`）。

**AC4（全站 15 路由逐一枚举）**：
```
  [ac-lang-switcher] PASS  /dashboard  status=200  desktop=true  mobile=true
  [ac-lang-switcher] PASS  /tasks  status=200  desktop=true  mobile=true
  [ac-lang-switcher] PASS  /live  status=200  desktop=true  mobile=true
  [ac-lang-switcher] PASS  /board  status=200  desktop=true  mobile=true
  [ac-lang-switcher] PASS  /system  status=200  desktop=true  mobile=true
  [ac-lang-switcher] PASS  /manager  status=200  desktop=true  mobile=true
  [ac-lang-switcher] PASS  /needs-human  status=200  desktop=true  mobile=true
  [ac-lang-switcher] PASS  /journal  status=200  desktop=true  mobile=true
  [ac-lang-switcher] PASS  /git-history  status=200  desktop=true  mobile=true
  [ac-lang-switcher] PASS  /tests  status=200  desktop=true  mobile=true
  [ac-lang-switcher] PASS  /sessions  status=200  desktop=true  mobile=true
  [ac-lang-switcher] PASS  /adr  status=200  desktop=true  mobile=true
  [ac-lang-switcher] PASS  /goal  status=200  desktop=true  mobile=true
  [ac-lang-switcher] PASS  /doc  status=200  desktop=true  mobile=true
  [ac-lang-switcher] PASS  /architecture  status=200  desktop=true  mobile=true
```
15 条路由清单**以字面量钉死**在测试里，并断言它 == `SITE_NAV_ROUTES`（新增路由会红在钉子上，而非漏跑）；
同时断言 `SITE_NAV_ROUTES` 的键集 == `NAV_KEYS`。

**AC5（因果对照，两次读数并排）** —— 把两处调用点从 `renderSiteNav`/`renderMobileChrome` 移除（本地、不提交），跑同一套读数：
```
                    | 接线后 | 对照（调用点移除） | 恢复后
grep -c '?lang='    |   2    |        0           |   2
AC2①                |   ✔    |        ✔           |   ✔     ← 纯函数，本就不依赖调用点（对照的负控制）
AC3②                |   ✔    |        ✖           |   ✔
AC4③                | ✔ 15/15|   ✖ 15/15 FAIL     | ✔ 15/15
AC6                 |   ✔    |        ✖           |   ✔
```
⛔ 方法学记录：第一次尝试用 HTML 注释包住 `${…}` 属**无效对照**——模板字面量里的插值照样求值，读数全绿。
真实对照必须删掉调用本身；上面表格是删掉调用后的读数。

**AC6（真链接的 click-through）** —— 取**页面自己渲染出来的** href，用浏览器自身的规则 `new URL(href, base)` 解析后跟随：
```
probe: rendered href found in the body = "?lang=zh"
probe: browser-resolved target = /dashboard?lang=zh
probe: followed -> status=200 <html lang="zh">=true Set-Cookie=["lang=zh; Path=/; Max-Age=31536000; SameSite=Lax"]
probe: followed page offers the way back (href="?lang=en") = true
```
（`href` 是相对路径 ⇒ 停在原页面；这是"点击"这条路径到达 AC-288 已有机制的证明，不重验 `resolveLang` 四态本体。）

**AC7（不回归）**：
```
$ bash scripts/test.sh --for-task gap-webui-lang-switcher-control --allow-thin   → exit 0（95 tests, 0 fail）
$ node --test packages/quay/test/serve-*.test.mjs                                → tests 264 / pass 263 / fail 0 / skipped 1（既有 skip）
$ npx tsc --noEmit                                                               → exit 0
```

### 判据清单

- [x] **AC1（红基线）**：对未接线代码上的 `/dashboard` 响应体执行 `grep -c '?lang='`，读数为 **0**，贴原始输出。
- [x] **AC2（纯函数正负控制）**：`node --test packages/quay/test/serve-lang-switcher.test.mjs` 里的 ① 用例，逐条断言
  `renderLangSwitcher("en")` 的输出含 `href="?lang=zh"` 且**不含** `href="?lang=en"`（当前语言不可点自身），反之亦然；
  且两种语言态的输出**互不相等**（负控制，防止恒定输出蒙混过关）。
- [x] **AC3（黑盒：桌面 + 移动端两处入口都生效）**：`startServer({port:0})`，② GET `/dashboard` 的 body 同时含
  `class="nav"`（桌面头部）与 `class="mobile-header"`（移动头部）区块内的语言切换链接，两处**分别**断言存在，
  href 逐字含 `?lang=en`/`?lang=zh`。
- [x] **AC4（全站覆盖，枚举不是抽查）**：③ 对 `SITE_NAV_ROUTES` 的**全部 15 个**路由逐一 GET，每个响应体都含
  语言切换链接，贴逐路由的 pass/fail 表（不是只报一个总数）。
- [x] **AC5（因果对照）**：把 `renderLangSwitcher` 调用点临时注释掉，AC3②③ 变红；恢复后复绿，两次读数并排贴出。
- [x] **AC6（点击后真的切换语言——复用 AC-288 机制，不重新实现）**：真实 HTTP 序列——GET `/dashboard` 拿到含
  `href="?lang=zh"` 的链接 → 跟随该链接 GET `/dashboard?lang=zh` → 响应头含 `Set-Cookie: lang=zh…` 且 body 含
  `<html lang="zh">`（复用 `gap-ac288-webui-lang-switch-mechanism` 已证的契约，本任务不重新验证 `resolveLang`
  本体的四态，只验证"点击这个新链接"这条路径确实到达了已有机制）。
- [x] **AC7（不回归）**：`bash scripts/test.sh --for-task gap-webui-lang-switcher-control` 绿；
  `node --test packages/quay/test/serve-*.test.mjs` 全绿；`tsc --noEmit` 绿。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「多了一个 `renderLangSwitcher` 函数、单测绿了」，而是
**一个真实的 `quay serve` 进程在真实 HTTP 上，任意一个页面的渲染结果里出现了用户真能点的语言切换链接，
点击后语言确实切换**：

1. **落地对象**：AC3/AC4 的黑盒响应体直接读（⛔ 不读进程内中间变量、不把渲染函数返回值当"响应"）。
2. **可被打红**：AC5 的因果对照实际跑过，证明这不是结构上恒绿的断言。
3. **全站生效**：AC4 逐路由枚举，不是"在 /dashboard 上验证一次就外推到全部页面"。
4. **不重复造轮子**：AC6 证明新控件只是给已有机制加了一个入口，没有重新实现 `resolveLang`/cookie 逻辑。
5. **可回滚**：删 `renderLangSwitcher` 及其在 `renderSiteNav`/`renderMobileChrome` 的两处调用、`serve-i18n.ts`
   里新增的文案条目；纯本地代码，无外部状态。

## Touches

- tasks/gap-webui-lang-switcher-control.md
- packages/quay/src/serve-render.ts
- packages/quay/src/serve-i18n.ts
- packages/quay/test/serve-lang-switcher.test.mjs (new)
