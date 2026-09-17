---
id: gap-webui-task-detail-flat-body-needs-structure
title: /task/&lt;id&gt; 详情页把整个任务体 markdown 摊平渲染，长任务体（Proposal/Finding/Verdict
  等）无法折叠/锚点跳转
status: todo
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

- [ ] 对一个真实存在、任务体超过约 2000 字符且包含 ≥3 个 `## ` 二级标题的任务（如当前的 `gap-ac281-develop-ci-test-job-wallclock-under-30s`），`/task/<id>` 渲染结果中至少存在一种可折叠/可跳转机制（`<details>`、锚点导航、或等价可验证结构），不是把整个 body 一次性摊平进单个 `<div class="body">`
- [ ] 对任务体很短（如 1 个 `## ` 标题、几十字符）的任务，渲染结果不强行套用折叠 UI 造成阅读体验变差（短内容默认展开或不受影响）
- [ ] `node --experimental-strip-types --test packages/quay/test/gap-webui-task-detail-flat-body-needs-structure.test.mjs` 覆盖长/短两种任务体的渲染断言
- [ ] `scripts/test.sh` 全绿

## DoD

在真实运行的 `quay serve` 实例上用浏览器打开一个长任务体的 `/task/<id>` 页面截图复核：能不整页滚动就先看到各小节标题，且可展开/跳转到具体小节；不是只在 fixture/单测里验证过。

## Touches

- packages/quay/src/serve-task.ts
- packages/quay/test/gap-webui-task-detail-flat-body-needs-structure.test.mjs
- tasks/gap-webui-task-detail-flat-body-needs-structure.md
