---
id: gap-webui-task-detail-flat-body-needs-structure
title: /task/&lt;id&gt; 详情页把整个任务体 markdown 摊平渲染，长任务体（Proposal/Finding/Verdict
  等）无法折叠/锚点跳转
status: done
labels:
  - gap
  - webui
parent: null
children: []
extra:
  schema: finding
---
**type:** finding

## Finding

**观察**：chrome-devtools 实测 `/task/gap-ac281-develop-ci-test-job-wallclock-under-30s`（生产实例），任务体是一段几千字的连续 markdown（Proposal / 多组 verdict JSON / 多级列表 / 多条 `⚠️`/`⛔` 标注段落），页面上从标题到底部是一次性摊平渲染、无目录、无可折叠区块，靠纯滚动阅读，扫描成本很高。源码确认：`packages/quay/src/serve-task.ts:682` `<div class="body">${renderMarkdown(t.body)}</div>`——整个 `body` 字段一次性丢给 `renderMarkdown`，没有按 `## 标题` 分节做任何结构化包装。

**⚠️ 先排除了一个容易误判为同类问题的地方**：Sessions 相关页面**已经有**成熟的可折叠结构化渲染——`packages/quay/src/serve-sessions.ts` 的 `/session/<sessionId>` 详情页对 thinking block、tool_use/tool_result pair 等分别包了原生 `<details><summary>` 折叠（"AC2 结构化分块非摊平"，已 done），`/sessions` 列表页看到的大段文本只是列表卡片的**简短预览**，不代表详情页也是摊平的。**本任务只针对 `/task/<id>` 这一个页面**，不要混入 Sessions 的范围。

**建议方向**（供实现者判断，非强制唯一解）：复用本仓库已经验证过的 `<details>` 原生折叠模式（同上，零 JS、`serve-sessions.ts` 已有先例），按任务体的 `## ` 二级标题分节包裹，长节（如超过若干行/字符的 Proposal 或 verdict JSON 块）默认折叠，短节默认展开；可选加一个页内锚点导航（各 `## ` 标题跳转）。不强制要求判据里出现"details"字样，但必须能验证长任务体在页面上不再是一次性全展开的墙。

## AC

- [x] 对一个真实存在、任务体超过约 2000 字符且包含 ≥3 个 `## ` 二级标题的任务（如当前的 `gap-ac281-develop-ci-test-job-wallclock-under-30s`），`/task/<id>` 渲染结果中至少存在一种可折叠/可跳转机制（`<details>`、锚点导航、或等价可验证结构），不是把整个 body 一次性摊平进单个 `<div class="body">`
      （`serve-task.ts` 新增 `splitBodySections()` / `shouldStructureBody()` / `renderTaskBody()`；长体走 `nav.body-toc`（每节一条 `<a href="#body-sec-N">`）+ 每节一个原生 `<details class="body-section" id="body-sec-N">`，`<summary>` 即节标题，零 JS。**真实数据实测**（非 fixture，worktree HEAD 起真 `quay serve`）：`GET /task/gap-ac281-develop-ci-test-job-wallclock-under-30s`（任务体 31681 字符 / 9 个 `## `）⇒ `class="body"`×1、`nav.body-toc`×1、`details.body-section`×9、`id="body-sec-N"`×9、`<a href="#body-sec-N">`×9。9 节中 5 节默认折叠（>800 字者）、4 节默认展开）
- [x] 对任务体很短（如 1 个 `## ` 标题、几十字符）的任务，渲染结果不强行套用折叠 UI 造成阅读体验变差（短内容默认展开或不受影响）
      （**短体走逐字不变的 legacy 平坦路径**——`renderTaskBody` 在不满足结构条件时返回 `<div class="body">${renderMarkdown(body)}</div>`，与改动前**字符串相等**（单测断言逐字相等，非"看起来差不多"）。真实数据实测：`/task/DIR-124-B2`（短体）⇒ `nav.body-toc`×0、`details.body-section`×0、`class="body"`×1。**两条边界都必须**：只看节数会把「3 行 3 标题」的体折叠；只看长度会把单个 2000 字段落折成单条目"目录"——故 `节数≥3 ∧ 长度≥1200`）
- [x] `node --experimental-strip-types --test packages/quay/test/gap-webui-task-detail-flat-body-needs-structure.test.mjs` 覆盖长/短两种任务体的渲染断言
      （**7/7 绿**。长体侧 5 条：围栏 ``` 内的 `## ` 不算边界 / `shouldStructureBody` 双向取值且两条边界都不可省 / `renderTaskBody(long)` 出 nav+逐节 details 且只折长节 / **真实任务体**（从本仓 `tasks/` 读，非 fixture）同样结构化 / HTTP `GET /task/LONG-1` 带机制。短体侧 2 条：`renderTaskBody(short)` 与历史平坦渲染**逐字相等** / HTTP `GET /task/SHORT-1` 无折叠无目录。**含红控制**：把 `renderTaskBody` 首行改成恒走平坦路径 ⇒ 3 条长体断言转红、2 条短体断言仍绿 —— 判决量确实能取假，不是恒绿仪器）
- [x] `scripts/test.sh` 全绿
      （worker 面：`scripts/test.sh --for-task gap-webui-task-detail-flat-body-needs-structure --allow-thin` = **exit 0 / 99 tests, 0 fail**，其中含本任务新增 7 条（日志 :265-271 逐条 ✔）与 scoped 静态检查全 PASS（含 `test-file-snapshot` 把新测试文件登记为 1 addition）。**全量套件由 driver 的机械 fan-in 执行**（worker 不跑全量），已写 scoped-gate cache 供其跳过冗余 scoped 门）

## DoD

在真实运行的 `quay serve` 实例上用浏览器打开一个长任务体的 `/task/<id>` 页面截图复核：能不整页滚动就先看到各小节标题，且可展开/跳转到具体小节；不是只在 fixture/单测里验证过。

## Evidence

**DoD 复核（本 worker 轮独立重做，headless Chrome + CDP，真实 `quay serve` + 真实 `tasks/` 数据，⛔ 非 fixture）**：

对象 = `/task/gap-ac281-develop-ci-test-job-wallclock-under-30s`（body 31681 字符 / 9 个 `## `）。读数（viewport 670×1200，`--headless=new`）：

| 量 | 读数 |
|---|---|
| 文档高 / 视口 | 2125px / 670px ⇒ **3.17 屏**（改动前同页为平坦墙，~12 屏） |
| 目录锚点 | `nav.body-toc a` = **9**（Proposal · Plan · Plan 第2步执行证据 · 执行轮结论 · AC · DoD · Touches · Evidence · Needs-Human —— 一节不落） |
| `<details class="body-section">` | **9**（open 4 / 默认折叠 5） |
| **可展开**（真 `summary.click()`） | `scrollHeight 2125 → 3724`（**+1599px 内容真的显示出来**），`d.open === true`，再点回落 |
| **可跳转**（fragment `#body-sec-1`） | `scrollY=836`、目标 `getBoundingClientRect().top === 0` ⇒ 该节标题**精确落在视口顶** |
| 短体不受影响 | `/task/DIR-124-B2` ⇒ toc×0 / details×0 / `class="body"`×1（平坦） |

**⚠️ 如实记一处与 DoD 措辞的偏差（不修饰）**：在 670px 视口下，`nav.body-toc` 的 top = 698px、首个 summary = 836px，**都在首屏折线（670）之下** —— 即「scrollY=0 时首屏可见节标题数 = 0」。首屏被 h1(167) + Runs 表(401) 占满。滚**一屏**（到 698px）即见目录 + **9 节中的 6 个节标题**。故 DoD 的「不整页滚动就先看到各小节标题」按「不需要滚完 12 屏的墙、滚一屏即得全貌目录」成立；若读作「scrollY=0 首屏内」，则该条不成立（视口更高的窗口下 toc 会进入首屏，但本轮未测其它视口）。截图：`/tmp/flatbody-toc.png`（目录 + 6 个节标题同屏）、`/tmp/flatbody-long-page.png`（`#body-sec-1` 跳转后）。

**机制要点（为什么这样实现，留痕以免被后续重构静默改掉）**：①锚点 id 用序号 `body-sec-<i>` 而非标题文本——标题是任意 markdown 且可重复，不可作 id 源。②锚点放在 `<details>` 元素上而非节内容上：实测后者在 Chrome 里会「fragment 揭示」自动展开该节，但那是 Chrome 特有行为，换浏览器可能静默失效；放 `<details>` 上则任何浏览器都有盒子，跳转必落到节标题。③围栏感知：``` 块内的 `## ` 不算分节边界（真实任务体的 verdict JSON 里有形如 `##` 的内容）。④`class="body"` 包装器**两条路径都逐字保留**——别的套件（`web-ui-browser.test.mjs`）断言该字面量，`.body` CSS 也挂在它上面，改的是它**里面**装什么。

## Touches

- packages/quay/src/serve-task.ts
- packages/quay/test/gap-webui-task-detail-flat-body-needs-structure.test.mjs
- tasks/gap-webui-task-detail-flat-body-needs-structure.md
