---
id: gap-webui-architecture-body-copy-en-zh
title: /architecture 正文文案在 lang=en 下仍是硬编码中文（数据源说明、组件状态图例、变更表头）—— 正文本地化系列，照
  /dashboard 已定 pattern
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

**缺口（2026-09-18，真实形态复现：`curl -H 'Cookie: lang=en' /architecture`，去 `<style>/<script>`/标签后含中文的行，剔除 endonym「中文」）**：**14 行**，全是界面文案：

| en 下可见的中文 |
|---|
| `quay — Architecture — 系统组件图`（`<title>`）· `Architecture — 系统组件图`（`<h1>`） |
| `数据源：` · `（git log 提交事实）·` · `（在飞开发）` |
| 图例 `正在开发` / `最近变更` / `已标记问题` / `稳定` |
| `组件最近变更（git 可证，近 7 天）` · 表头 `组件` / `路径` / `近 7 天提交` / `末次提交` |

源码位置：`packages/quay/src/serve-architecture.ts`（**非注释中文行 9 条**；可见 14 行多于源码 9 条，是因为部分串在一行里被 `<code>`/`<span>` 切成多个文本片段——AC1 逐条对应）。

**去重（机制，不是症状）**：`tasks/*.md` 无 `/architecture` 正文本地化任务。

<!-- dedup-ref -->
**同源系列（traceability）**：`gap-webui-dashboard-body-copy-en-zh`（done，已定 pattern；本任务照抄其「决定记录」①~⑨）。**本页特有**：图例四个状态词同时出现在 SVG/图例与表格里时，按「一个渲染串一行」共用字典行；`近 7 天` 是**窗口天数参数**，若窗口可变，用模板 `近 {days} 天提交`，⛔ 不写死 7；组件名/路径是数据，不翻译。

## Plan

1. **红基线**：`startServer({port:0})`，`Cookie: lang=en` GET `/architecture`，逐行列出含 CJK 的行（剔 endonym），贴完整清单，并与源码 9 条非注释中文行逐条对应；谓词先对 zh 干跑命中。
2. **字典**：`serve-i18n.ts` 新增 `ARCHITECTURE_KEYS` + `ARCHITECTURE_LABELS` + `architectureLabelsFor`（同 `DASHBOARD_LABELS` 形；zh 列逐字等于现有字面量）。
3. **改 `serve-architecture.ts`**：全部经字典；标题后缀与页名并列处理。
4. 局部刷新端点（若有）带语言（决定记录 ⑥）；客户端脚本串走参数（⑦）。
5. **既有测试迁移**：`serve-ac95-views.test.mjs` 等被实跑证实变红的测试，钉中文断言改显式 zh；负向断言显式 zh；不在 Touches 的先补 Touches 再改。
6. **新测试** `packages/quay/test/serve-architecture-body-i18n.test.mjs`（`@test-group product`）：字典完备 + throw 路径 + 黑盒 en/zh。
7. **因果对照**：钳成恒 zh → en 黑盒变红，恢复复绿。
8. **收口**：scoped 门 + `serve-*.test.mjs` + `tsc --noEmit` 绿；重启常驻 serve 并截图。

## AC

- [x] **AC1（红基线，枚举不是布尔）**：贴 `lang=en` 下 `/architecture` 界面文案中文行完整清单与条数，并与 `serve-architecture.ts` 的 9 条非注释中文行逐条对应；谓词先对 zh 干跑命中。
- [x] **AC2（en 清零）**：改后界面中文行 = 0；剩余含中文的行逐条归类为用户数据（无则写「无」）。
- [x] **AC3（zh 零变化）**：改前后各抓 `lang=zh`，去动态数据后 diff 为空（或逐条解释）。
- [x] **AC4（字典完备且被强制）**：键集闭合；两列非空、`en` 无 CJK；删列 `tsc --noEmit` 报错（贴红读数再恢复）。
- [x] **AC5（所有渲染路径带语言）**：列出全部渲染入口/刷新端点，`?lang=zh` 下逐个断言仍 zh。
- [x] **AC6（因果对照）**：钳成恒 zh 后 en 黑盒变红，恢复复绿，两次读数并排贴出。
- [x] **AC7（既有测试迁移 + 不回归）**：贴实跑变红清单；迁移后全绿；scoped 门、`serve-*.test.mjs`、`tsc --noEmit` 绿。
- [x] **AC8（真实浏览器形态）**：重启 serve，截图 `/architecture?lang=en` 与 `?lang=zh`，en 图无界面中文。

## DoD

**REAL LANDING（DIR-026 Reading A）**：真实 `quay serve` 在真实浏览器里，选 EN 后 `/architecture` 界面文案全为英文，选中文后与改前一致。
1. 读数来自 HTTP 响应体。
2. AC6 实跑；AC1 谓词对 zh 命中过。
3. 不越界：`git diff --stat` 只含 Touches 内文件。
4. 重启 serve + 截图（AC8）。
5. 可回滚：还原取词调用、删 `ARCHITECTURE_*`。

## Evidence

**提交**：`cf085365b`（字典 + 全量取词）· `a7d1e32bb`（既有测试迁移）· `d73bea173`（en 尾随空格，AC8 截图暴露）。

### AC1 —— 红基线 14 行（改前代码、同一 workspace、端口 4239）

```bash
git show 7d9cafbab:packages/quay/src/{serve-architecture,serve-i18n}.ts > <worktree>/...   # 临时还原成改前
node ... serve --port 4239 ; curl -H 'Cookie: lang=zh' .../architecture   # 同一 workspace，同一数据
```

`lang=en` 响应去 `<style>/<script>`/标签、剔 endonym 后，含 CJK 的**文本行 = 14**（= 任务体提案表逐字）：

```
gap-webui-architecture…b4af1ad7 — Architecture — 系统组件图   ← <title>（前缀是 projectLabel，身份非本页文案）
Architecture — 系统组件图                                    ← <h1>
数据源： ／ （git log 提交事实）· ／ （在飞开发）                 ← 数据源三片段（两个 <code> 边界切成三个文本节点）
正在开发 ／ 最近变更 ／ 已标记问题 ／ 稳定                        ← 图例四词
组件最近变更（git 可证，近 7 天）                              ← <h2>
组件 ／ 路径 ／ 近 7 天提交 ／ 末次提交                          ← 表头四列
```

**与源码 9 条非注释中文行逐条对应**（改前 `grep -nP CJK serve-architecture.ts` 剔注释）：
`:75` `<h2>` → 第 10 行；`:77` 四个 `<th>` → 11~14 行；`:86~89` 图例四词 → 6~9 行；`:92` `<title>` token → 1 行；`:94` `<h1>` token + 字面后缀 → 2 行；`:95` 数据源三片段 → 3~5 行。
⇒ **9 条源码行 → 14 可见行**的差额全部来自 `<code>`/`<span>` 把一行切成多文本节点（提案已述）。

**谓词对 zh 干跑命中**：同一谓词对**同一改前代码**的 `lang=zh` 响应命中 50 行（14 条本页文案 + 15 项 zh nav × 桌面/移动两套）⇒ 「en 下 0 条」不是谓词坏了（硬规则 2 的零计数对照）。测试里另有一条更紧的臂：把上面 14 条中属于本页的 13 条**逐串**在 zh 渲染里断言在场。

### AC2 —— en 界面中文 = 0

改后（端口 4238，本 worktree 代码）`lang=en`：

```
switcher items stripped: 4 (endonym 中文 in 2)
CJK visible lines: 0
```

剩余含中文的行**逐条归类 = 无**：剔掉切换控件 endonym 后为 0 条；**未剔时**仅 2 条，都是 ROW 4 的 `中文` endonym（桌面 + 移动各一，按设计在英文页也必须读 `中文`，否则读不懂当前语言的人找不到自己的语言）。

**具名不在范围内的一类**（不出现于健康渲染，但空态会出现，在此具名而非留给下一个任务重新发现）：`obsNote()`（`serve-render.ts:1034`）的 `未接入/无数据` / `读失败` 前缀 —— 它是**共享 chrome**，被 tests/system/sessions 等六个页面消费（ROW 9 类），不在本任务 Touches；其 `reason` 半边是 reader 自己的诊断（`observation.ts`），/dashboard、/journal、/board 三个先行任务都归类为**数据**。新测试的空态臂断言它**仍在**（逐字），使其不被误当成本任务遗漏，也使其不被后来的「全面翻译」改动悄悄改写。

### AC3 —— zh 输出零变化（**byte-identical，无需去掉动态数据**）

改前/改后**同一 workspace**（同一 `packages/`、同一 git 事实）各抓一次 `lang=zh`：

```
zh pre bytes: 37761   post bytes: 37761   BYTE-IDENTICAL: true
raw zh bytes identical: true
```

⇒ 去掉动态数据的归一化都不需要：整份响应**逐字节相同**。逐串证据另见新测试 AC3 臂（`<title>` 尾 `架构 — 系统组件图`、`<h1>架构 — 系统组件图</h1>`、`<h2>组件最近变更（git 可证，近 7 天）</h2>`、四表头整串、数据源行含两个 `<code>` 边界整串）；AC-303 的测试（非本任务撰写）其 zh 臂**原样通过**，是独立的第三方佐证。

### AC4 —— 字典闭合且被类型强制

- 闭合：`ARCHITECTURE_KEYS` ≡ `Object.keys(ARCHITECTURE_LABELS)`（13 行：1 `<h1>` 后缀 + 3 数据源片段 + 4 图例 + 1 表标题 + 4 表头），重复键 0。
- 两列非空；`en` 无 CJK；`zh` 含 CJK 或与 en 逐字相同（`zhArmOk` 是更强的谓词）。
- 两条 throw 路径：未知键 `unknown architecture key`；缺参数 `{days}` → 抛（两行各测）。缺参数若静默留 `{days}`，页面会渲染自己的模板语法而无一条「页面上有没有该有的值」的检查会红（硬规则 3b）。
- **删列对照**：删 `ARCHITECTURE_LABELS.colLastCommit` 的 `en` 列 ⇒

```
packages/quay/src/serve-i18n.ts:1138:3 - error TS2741: Property 'en' is missing in type '{ zh: string; }'
        but required in type '{ en: string; zh: string; }'.
tsc exit=1
```

还原后 `tsc exit=0`、`git diff` 空（两步读数都在本次会话内取得）。

### AC5 —— 渲染路径枚举 = 1，且该路径带语言

```
packages/quay/src/serve-handlers.ts:211   if (url.pathname === "/architecture") → handleArchitecture
packages/quay/src/serve-architecture.ts   → renderArchitecturePage(arch, cfg.identity, cfg.lang)
```

**只有这一条**：本页没有快照/cache seam（对比 /board 的 `peekBoardSnapshot`）、没有刷新端点、**不发出任何 `<script>`**（对比 /live 的 SSE）⇒ Plan 步骤 4（局部刷新端点带语言 ⑥、客户端脚本串走参数 ⑦）在本页**结构上为空**，不是漏做。测试把这条枚举**测量**而非断言：剔注释后 `renderArchitecturePage(` 的出现数 = 2（一定义 + 一调用），并断言剔除器确实删掉了东西（原文里注释也提到该名字）；同时断言源码无 `<script`、无 `readFile*`/`.jsonl`。该唯一路径在 `?lang=en` / `?lang=zh` / `Cookie: lang=zh` 三个通道下各自断言。

### AC6 —— 因果对照

钳成恒 zh：`const L = architectureLabelsFor("zh");`（无视请求语言）

| 读数 | 钳成恒 zh | 恢复 |
|---|---|---|
| `node --test serve-architecture-body-i18n.test.mjs` | **pass 7 / fail 4** | **pass 11 / fail 0** |

变红的 4 条正是「en 下界面中文 = 0」及其相依臂（AC2 黑盒、AC2 空态、AC3 的 en 缺席臂、AC5 单路径）。恢复后 `git diff` 空、复绿。

### AC7 —— 既有测试迁移

**实跑变红清单（改后、迁移前）**：

| 文件 | 变红条数 | 原因 |
|---|---|---|
| `packages/quay/test/serve-architecture-zh-chrome.test.mjs` | 3 | `TITLE_TOKEN` 钉死改前的 `<title>` token |
| `packages/quay/test/serve-ac95-views.test.mjs` | 1 | 六路由 AC1 表的 `/architecture` 行同钉该 token |

**迁移原则**（Plan 步骤 5）：旧断言是**钉 token 字面量**而非**钉语言** —— 默认 locale 是 en，而这页的 `<title>` 在 re-key 前恰恰在 en 下渲染中文，所以旧断言过去是**偶然**读到中文的。中文断言改成**显式 zh 请求**，默认 locale 行改钉新 en token。

- `serve-architecture-zh-chrome.test.mjs`：**只改 `TITLE_TOKEN` 一个字面量**；其 zh 臂（`TITLE_ZH`/`H1_ZH`/`META_DESCRIPTION`/`lowerZh==1`/`h1Zh` 逐字）**全部原样通过** —— 这是 AC3「zh 零变化」的独立佐证。
- `serve-ac95-views.test.mjs`：`/architecture` 行改钉 `Architecture — system component map`，并**新增显式 zh 臂**（`?lang=zh` 下断言 `架构 — 系统组件图` 与正文中文串在场、en 措辞缺席）。

**回归读数**：`tsc --noEmit` exit 0；scoped 门 `scripts/test.sh --for-task … --allow-thin` **EXIT=0 / 127 pass / 0 fail**，选择器 `11 test file(s)`（非 0，含本任务新测试）；`packages/quay/test/serve-*.test.mjs`（38 文件）**308 tests / 307 pass / 0 fail / 1 skipped**（skip = QN-061 live-GitHub，需 `QUAY_TEST_LIVE_GITHUB=1`，与本任务无关）；anti-drift `5 actual file(s), all within declared Touches (6 glob(s))`。

### AC8 —— 真实浏览器

⚠️ **常驻 serve（端口 4173，主检出）不是证据**：它加载的是主检出的**旧**代码（主检出无 `ARCHITECTURE_LABELS`，`grep -c` = 0，本任务尚未 fan-in 落地），且该进程本身已陈旧（它仍渲染 `16f27e69a` 已删除的 Board NEW 徽标）。故读数取自**本 worktree 的真实 `quay serve`**（`--port 4238`，真实 workspace：真实 `packages/*` + 真实 git 事实），真实 `google-chrome --headless=new` 1440×900 截图：

- EN：`<h1>Architecture — system component map`；`Source: packages/* (git log commit facts) · git worktree list (in-flight development)`；图例 `In development / Recently changed / Flagged issue / Stable`；`Recently changed components (git-verifiable, past 7 days)` + 表头 `Component / Path / Commits in the past 7 days / Last commit`。**唯一的中文是切换控件的 `中文` endonym**（ROW 4 设计如此）。
- ZH：与改前逐像素一致（`架构 — 系统组件图`、`数据源：…（git log 提交事实）· …（在飞开发）`、`正在开发/最近变更/已标记问题/稳定`、`组件最近变更（git 可证，近 7 天）`、四表头）。
- 截图由 **AC8 暴露的一个英文瑕疵**引发一次修正：ASCII `:` 不像全角 `：` 那样自带分隔 ⇒ en 下曾渲染 `Source:packages/*`；`sourceLabel` 的 en 列补尾随空格（zh 列逐字不变），并在测试里把 `"Source: "` 连空格一起钉住，使「顺手 trim」在此报红而非静默回归。

## Touches

- tasks/gap-webui-architecture-body-copy-en-zh.md
- packages/quay/src/serve-architecture.ts
- packages/quay/src/serve-i18n.ts
- packages/quay/test/serve-architecture-body-i18n.test.mjs (new)
- packages/quay/test/serve-ac95-views.test.mjs
- packages/quay/test/serve-architecture-zh-chrome.test.mjs (added mid-flight: it pins the pre-re-key `<title>`/`<h1>` tokens and went red on the re-key — Plan 步骤 5 的「先补 Touches 再改」)
