---
id: gap-webui-sessions-body-copy-en-zh
title: /sessions 正文文案在 lang=en 下仍是硬编码中文（数据源说明、会话生命周期/driver 操作说明与表单）——
  正文本地化系列（大页），照 /dashboard 已定 pattern
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

**缺口（2026-09-18，真实形态复现：`curl -H 'Cookie: lang=en' /sessions`，去 `<style>/<script>`/标签后含中文的行，剔除 endonym「中文」）**：**66 行**，其中一部分是会话 transcript 尾部/会话名等**数据**。已识别的界面文案：

| en 下可见的中文（例） |
|---|
| `quay — Sessions — 会话观测`（`<title>`）· `Sessions — 会话观测（运行中 + 已结束）`（`<h1>`） |
| `数据源：… （运行中 · 交互式 + …）+ transcript 目录扫描（已结束）+ 会话 transcript 尾部`（说明段，被 `<code>` 切成多个文本片段） |
| `会话生命周期（headless）` · `driver 复用 … ；新建 = … ；重启 = … 。⛔ 交互式 manager/outer/inner 不在此暴露。提交结果为 JSON。` · `driver 操作` |

源码位置：`packages/quay/src/serve-sessions.ts`（**非注释中文行 24 条**）。**待翻译量 ≤ 24；66 是含数据的上界。**

**去重（机制，不是症状）**：`tasks/*.md` 无 `/sessions` 正文本地化任务。

<!-- dedup-ref -->
**同源系列（traceability）**：`gap-webui-dashboard-body-copy-en-zh`（done，已定 pattern；本任务照抄其「决定记录」①~⑨）。**本页特有**：① 说明段被 `<code>` 切成多个片段，英文语序不一定同序——**整句作为一个带 `{name}` 占位符的模板**，⛔ 不按 `<code>` 边界拆成多个字典行拼接（决定记录 ②）；② 页内有**操作表单/按钮**（driver 启停/提交），表单的 `label`、按钮文字、**提交后返回的结果/错误提示**（JSON 提交后的反馈）都属界面文案，且反馈往往由**另一个 POST 端点**渲染——必须随请求语言（决定记录 ⑥ 的同形态：首屏正确、提交后变默认语言，单次 GET 探针看不见）；③ 会话名、transcript 尾部是数据，不翻译。

## Plan

1. **红基线 + 分离**：`startServer({port:0})`（fixture 里放运行中与已结束的会话记录），`Cookie: lang=en` GET `/sessions`，用**可复算谓词**拆成「界面文案」与「数据」，各列清单；把 24 条源码字面量逐条归类：GET 首屏 / 表单与按钮 / POST 反馈。**再对每个 POST 端点各抓一次响应**（含成功与失败反馈）。谓词先对 zh 干跑命中。
2. **字典**：`serve-i18n.ts` 新增 `SESSIONS_KEYS` + `SESSIONS_LABELS` + `sessionsLabelsFor`（同 `DASHBOARD_LABELS` 形；zh 列逐字等于现有字面量）。
3. **改 `serve-sessions.ts`**：界面文案全走字典；数据原样；标题后缀与页名并列处理；**POST 端点的响应带语言**。
4. 局部刷新端点（若有）带语言（决定记录 ⑥）；客户端脚本串走参数（⑦）。
5. **既有测试迁移**：`serve-sessions.test.mjs`、`serve-ac95-views.test.mjs`、`serve-handlers.test.mjs` 中被**实跑**证实变红的，钉中文断言改显式 zh；负向断言显式 zh；不在 Touches 的先补 Touches 再改。**（补：扫描范围须含 `plugin/test/`——本页源码的字面量也被该目录的测钉着；全量 suite 才暴露的第三条红见 AC7 补。）**
6. **新测试** `packages/quay/test/serve-sessions-body-i18n.test.mjs`（`@test-group product`）：字典完备 + throw 路径 + 黑盒 en/zh（GET 首屏 + 每个 POST 反馈）。
7. **因果对照**：钳成恒 zh → en 黑盒变红，恢复复绿。
8. **收口**：scoped 门 + `serve-*.test.mjs` + `tsc --noEmit` 绿；重启常驻 serve 并截图。

## AC

- [x] **AC1（红基线 + 分离，枚举不是布尔）**：贴 `lang=en` 下 `/sessions` GET 首屏与**每个 POST 端点响应**按可复算谓词拆出的「界面文案」与「数据」清单与条数，并把 24 条源码字面量逐条归类；谓词先对 zh 干跑命中。
- [x] **AC2（en 清零）**：GET 与全部 POST 反馈改后「界面文案」类中文行 = 0；「数据」类行与改前逐字一致。
- [x] **AC3（zh 零变化）**：改前后各抓 `lang=zh`（GET + 各 POST 反馈），去动态数据后 diff 为空（或逐条解释）。
- [x] **AC4（字典完备且被强制）**：键集闭合；两列非空、`en` 无 CJK；删列 `tsc --noEmit` 报错（贴红读数再恢复）。
- [x] **AC5（POST 反馈与刷新端点带语言）**：`?lang=zh`/`Cookie: lang=zh` 下每个 POST 反馈仍是 zh；`lang=en` 下均为 en（分别断言，⛔ 不只测 GET）。
- [x] **AC6（因果对照）**：钳成恒 zh 后 en 黑盒变红，恢复复绿，两次读数并排贴出。
- [x] **AC7（既有测试迁移 + 不回归）**：贴实跑变红清单；迁移后全绿；scoped 门、`serve-*.test.mjs`、`tsc --noEmit` 绿。
- [x] **AC8（真实浏览器形态）**：重启 serve，截图 `/sessions?lang=en` 与 `?lang=zh`，并在浏览器里实际触发一次表单提交后再截一张；en 图上界面文案全英文。

## Evidence（读数，2026-09-18；谓词 = 去 `<style>/<script>`/标签后含 CJK 的可见文本行，剔除 endonym「中文」）

**谓词先对 zh 干跑命中**：GET `/sessions` zh = 21 行（同谓词 en 改前 8 行、改后 0 行）——零计数的对照。

**界面文案 / 数据 分离（真实 `startServer({port:0})` + 原始 HTTP，`Cookie:` 与 `?lang=` 两条传输各抓一次）**

| 入口 | en 改前 文案/数据 | en 改后 文案/数据 | zh 改前后 diff |
|---|---|---|---|
| GET `/sessions` | 8 / 0 | **0** / 0 | 逐字相同（去 workspace 名） |
| POST `/sessions/new`（校验 400） | 1 / 0 | **0** / 0 | 逐字相同 |
| POST `/sessions/resume`（校验 400） | 1 / 0 | **0** / 0 | 逐字相同 |
| GET `/session/<id>/earlier`（非 UUID 400） | 1 / 0 | **0** / 0 | 逐字相同 |
| POST `/sessions/driver`（非法 verb 400） | 0 / 0 | 0 / 0 | 逐字相同（机件文案，两语相同） |
| GET `/session/<id>`（详情页） | 5 / 0 | 4 / 0 | 逐字相同（脚本源码形见下） |

「数据」类行（会话名 `inner-有中文名`、transcript 正文、共享 schema 的拒收明细、`session.lifecycle=` 字段名）改前后**逐字一致**；详情页 en 残余 4 行 = `obsNote` 的共享外壳词（`未接入/无数据`，serve-render.ts，全部页面共用，ROW 15 ⑥）+ `serve-send.ts` 的投递表单（`消息投递`/发送提示/`发送`，**不同模块、不在 Touches**）。

**24 条源码字面量逐条归类**（`packages/quay/src/serve-sessions.ts` 非注释 CJK 行，实测 24）：

| 归类 | 行号 | 处置 |
|---|---|---|
| GET 首屏 文案 | 39（拒收框）、64（延迟读取提示）、96（无运行中会话）、99（GONE 摘要）、106（`<title>`/meta）、108（`<h1>`）、109（数据源说明） | ROW 15 |
| 表单与按钮 | 715（小节标题）、716（说明段）、720/725/731（三个按钮）、723/724/729/730（四个 placeholder） | ROW 15 |
| POST 反馈 | 334（/earlier 400）、685（/new 400）、701（/resume 400） | ROW 15 |
| 详情页 文案 | 221（Transcript 标题）、223（加载更早）、245（脚本串）、280（meta）、283（返回链接 + 数据源） | ROW 15 |
| 数据（不翻译） | 无（24 条全部是界面文案；会话名/正文/机件字段名不在此 24 内） | 原样 |

**AC6 因果对照（同一个黑盒探针，三次读数并排）**

| | en `/sessions` | en `/new` | en `/resume` | en `/earlier` | en 详情 |
|---|---|---|---|---|---|
| 改前（HEAD） | 8 | 1 | 1 | 1 | 5 |
| **钳成恒 zh**（表级 clamp） | **8** | **1** | **1** | **1** | **5** |
| 恢复后（本次实现） | **0** | **0** | **0** | **0** | 4 |

钳位点选在**表**（`SESSIONS_LABELS[k].en = .zh`）而非 `sessionsLabelsFor`：先钳后者时 POST 仍为 0（它们走 `sessionLabel`），即**钳位必须覆盖真正在跑的那条路径**。

**AC7 实跑变红清单**（`node --test <file>`）：`serve-sessions.test.mjs` 1/8 红、`serve-sessions-zh-chrome.test.mjs` 2/4 红；`serve-ac95-views.test.mjs` 21/21、`serve-handlers.test.mjs` 63/63、`observation.test.mjs` 51/51 **全绿未动**。迁移后五者全绿；scoped 门 131/131 绿；`tsc --noEmit` 干净。

**AC7 补（fan-in 全量 suite 才暴露的第三条红，2026-09-18 第二轮）**：上表的扫描范围只到 `serve-*.test.mjs` / `packages/quay/test/`，**漏了 `plugin/test/`**——全量 suite（3289 tests）报出 `plugin/test/session-primitives-adoption.test.mjs` AC5 红 1 条，**根因同一**：该测用 `assert.match(src, /状态记录不可用/)` 钉 `serve-sessions.ts` 的**源码形**，而本次本地化正是把这个字面量搬进了 `serve-i18n.ts` ROW 15（`refusedStateRecord`）——**它断言的是本地化前的源码形，恰是本任务要移除的那样东西**（且该测文件不在 Touches/diff 内，故机械 delta-relatedness 判为 UNRELATED；实为同一根因，硬规则 5 的窄范围教训）。**处置 = 跟着文案走**（与 `serve-*.test.mjs` 迁移同形，家族已定 pattern）：一条断言改为两读——`serve-sessions.ts` 必须解析该帧行（`refusedStateRecord`，实测在该文件**出现 1 次且位于代码位**、非注释）+ `serve-i18n.ts` 该行 zh 列仍带原措辞。**红控制（证明非空转）**：把渲染表达式里的该帧行替换掉 ⇒ `AssertionError: the render surface resolves the refusal frame row`；`git checkout --` 还原（`refusedStateRecord` 计数回到 1、`git status` 只余该测试文件）⇒ 10/10 复绿。`## Touches` 已补 `plugin/test/session-primitives-adoption.test.mjs`（DoD 3 的「只含 Touches 内文件」随之成立）。

**AC3 的唯一逐条解释**：详情页 zh 响应在**长 transcript**（触发滚动加载）时，`<script>` 的**源码形**变了（两个字面量改为注入的 JS literal），**执行的 DOM 写入逐字相同**（两版求值同串），短 transcript 则整页逐字相同。

## DoD

**REAL LANDING（DIR-026 Reading A）**：真实 `quay serve` 在真实浏览器里，选 EN 后 `/sessions` 的界面文案（含表单提交后的反馈）全为英文而数据原文不变，选中文后与改前一致。
1. 读数来自 HTTP 响应体。
2. AC6 实跑；AC1 谓词对 zh 命中过。
3. 不越界：`git diff --stat` 只含 Touches 内文件。
4. 重启 serve + 截图（AC8，含一次真实表单提交）。
5. 可回滚：还原取词调用、删 `SESSIONS_*`。

## Touches

- tasks/gap-webui-sessions-body-copy-en-zh.md
- packages/quay/src/serve-sessions.ts
- packages/quay/src/serve-i18n.ts
- packages/quay/test/serve-sessions-body-i18n.test.mjs (new)
- packages/quay/test/serve-sessions.test.mjs
- packages/quay/test/serve-sessions-zh-chrome.test.mjs
- packages/quay/test/serve-ac95-views.test.mjs
- plugin/test/session-primitives-adoption.test.mjs