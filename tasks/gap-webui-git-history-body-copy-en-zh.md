---
id: gap-webui-git-history-body-copy-en-zh
title: /git-history 正文文案在 lang=en 下仍是硬编码中文（视图切换、图例说明、客户端脚本里的加载提示）—— 正文本地化系列，照
  /dashboard 已定 pattern
status: ready
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

**缺口（2026-09-18，真实形态复现：`curl -H 'Cookie: lang=en' /git-history`，去 `<style>/<script>`/标签后含中文的行，剔除 endonym「中文」）**：**12 行**：

| en 下可见的中文 |
|---|
| `Git History — 提交纵向时间轴`（标题后缀） |
| `视图切换：` · `git 拓扑` · `任务分组` · `（默认 git 拓扑；任务分组是项目特定启发式）` |
| `纵轴 = git 发射顺序（新的在上）。` · `每行一个提交；分支标签只在 ref 指向的那个提交上内联显示（git decorate 语义）…` |
| `。在图表容器内滚动到底部自动加载更早的提交（加载较多后改为点击加载）。` · `父提交连线（圆角正交）` |
| `加载更早提交…` · `↓ 更多提交`（**这两条由内联客户端脚本渲染**，不是服务端模板） |

源码位置：`packages/quay/src/serve-git.ts`（**非注释中文行 27 条**，多于可见的 12 行：另有分页续载片段/JSON 端点相关串，逐条归类见 AC1）。

**去重（机制，不是症状）**：`tasks/*.md` 无 `/git-history` 正文本地化任务。

<!-- dedup-ref -->
**同源系列（traceability）**：`gap-webui-dashboard-body-copy-en-zh`（done，已定 pattern；本任务照抄其「决定记录」①~⑨）。**两个本页特有的坑**：① `加载更早提交…` / `↓ 更多提交` 在**内联客户端脚本**里，浏览器端没有字典——走「服务端渲染时把词作为参数写进脚本常量」（决定记录 ⑦），⛔ 不在脚本里内嵌整张字典；② 分页续载（`?before=`/JSON 端点）返回的**片段**若含文案，必须随请求语言渲染，否则 zh 页翻到第 2 页就变英文而首屏 HTML 正确，单次抓取探针看不见（决定记录 ⑥ 的同形态）。该页含大量 git 相关**数据**（分支名、提交信息、任务分组名），不翻译。

## Plan

1. **红基线**：`startServer({port:0})`（建一个含多于一页提交的临时 git 仓库以触发分页），`Cookie: lang=en` GET `/git-history` 首屏 + 一次续载请求，逐行列出含 CJK 的行（剔 endonym）；贴完整清单，并把 27 条源码字面量逐条归类：服务端模板 / 客户端脚本串 / 续载片段 / 注释外的数据处理。谓词先对 zh 干跑命中。
2. **字典**：`serve-i18n.ts` 新增 `GIT_HISTORY_KEYS` + `GIT_HISTORY_LABELS` + `gitHistoryLabelsFor`（同 `DASHBOARD_LABELS` 形；zh 列逐字等于现有字面量）。
3. **改 `serve-git.ts`**：服务端模板全走字典；客户端脚本串按 ⑦ 作为参数注入（缺参数时降级为**中性占位**，⛔ 不替调用方选语言）；续载端点带语言。
4. **既有测试迁移**：本页有一大批 `gap-git-graph-*.test.mjs` 钉图形/布局，其中**少数**钉中文文案——先**实跑**找红清单（⛔ 不靠 grep 猜、⛔ 不预填全部 git-graph 测试进 Touches），红的先补 Touches 再改；钉中文的改显式 zh，负向断言显式 zh。
5. **新测试** `packages/quay/test/serve-git-history-body-i18n.test.mjs`（`@test-group product`）：字典完备 + throw 路径 + 黑盒 en/zh（首屏与续载片段各一）。
6. **因果对照**：钳成恒 zh → en 黑盒变红，恢复复绿。
7. **收口**：scoped 门 + `serve-*.test.mjs` + `tsc --noEmit` 绿；重启常驻 serve 并截图。

## AC

- [ ] **AC1（红基线，枚举不是布尔）**：贴 `lang=en` 下首屏与续载片段界面文案中文行的完整清单与条数，并把 `serve-git.ts` 的 27 条非注释中文行逐条归类；谓词先对 zh 干跑命中。
- [ ] **AC2（en 清零）**：首屏与续载改后界面中文行均 = 0；剩余含中文的行逐条归类为用户数据。
- [ ] **AC3（zh 零变化）**：改前后各抓 `lang=zh` 首屏与续载响应，去动态数据后 diff 为空（或逐条解释）。
- [ ] **AC4（字典完备且被强制）**：键集闭合；两列非空、`en` 无 CJK；删列 `tsc --noEmit` 报错（贴红读数再恢复）。
- [ ] **AC5（续载与客户端脚本带语言）**：`?lang=zh` 下的续载响应与内联脚本里的两条加载提示仍是 zh；`?lang=en` 下均为 en（分别断言，⛔ 不只测首屏）。
- [ ] **AC6（因果对照）**：钳成恒 zh 后 en 黑盒变红，恢复复绿，两次读数并排贴出。
- [ ] **AC7（既有测试迁移 + 不回归）**：贴实跑变红清单；迁移后全绿；scoped 门、`serve-*.test.mjs`、`tsc --noEmit` 绿。
- [ ] **AC8（真实浏览器形态）**：重启 serve，截图 `/git-history?lang=en` 与 `?lang=zh`，并滚动触发一次续载后再截一张；en 图无界面中文。

## DoD

**REAL LANDING（DIR-026 Reading A）**：真实 `quay serve` 在真实浏览器里，选 EN 后 `/git-history` 首屏与续载的界面文案全为英文，选中文后与改前一致。
1. 读数来自 HTTP 响应体。
2. AC6 实跑；AC1 谓词对 zh 命中过。
3. 不越界：`git diff --stat` 只含 Touches 内文件。
4. 重启 serve + 截图（AC8，含续载一次）。
5. 可回滚：还原取词调用、删 `GIT_HISTORY_*`。

## Touches

- tasks/gap-webui-git-history-body-copy-en-zh.md
- packages/quay/src/serve-git.ts
- packages/quay/src/serve-i18n.ts
- packages/quay/test/serve-git-history-body-i18n.test.mjs (new)
- packages/quay/test/serve-git-history-zh-chrome.test.mjs
- packages/quay/test/gap-git-graph-no-bounded-scroll-panel.test.mjs
- packages/quay/test/gap-git-graph-scroll-loader-self-chain-blocked-by-loadingolder-flag.test.mjs
- packages/quay/test/gap-git-graph-scroll-panel-no-visual-affordance.test.mjs
- packages/quay/test/gap-git-graph-task-view-aggregate-commits-by-task-id.test.mjs
- packages/quay/test/serve-handlers.test.mjs
