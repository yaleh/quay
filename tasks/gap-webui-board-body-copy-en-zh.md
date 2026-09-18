---
id: gap-webui-board-body-copy-en-zh
title: /board 正文文案在 lang=en 下仍是硬编码中文（三源列头、默认视图说明、「done 但未落地」等状态词）—— 正文本地化系列，照
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

**缺口（2026-09-18，真实形态复现：`curl -H 'Cookie: lang=en' /board`，去 `<style>/<script>`/标签后含中文的行，剔除 endonym「中文」）**：**21 行**，全是界面文案（其中 `done 但未落地` 因每行一次而重复多次，去重后约 12 个不同的串）：

| en 下可见的中文（例） |
|---|
| `quay — Board — 三源 join 看板`（`<title>`）· `Board — 意图 / 执行 / 落地`（`<h1>`） |
| `意图: 任务库 (Provider ABI)` · `执行:` · `落地:` · `· 0 实现中 · 0 待落地` · `· 扫描 2287 任务`（三源摘要，含计数插值） |
| `默认视图：只显示「执行」或「落地」列非空的行 —— 9 行（全部 2287 行）。` · `显示全部 2287 行（含历史任务）` |
| 表头 `意图` / `执行` / `落地` · 单元格状态词 `done 但未落地` |

源码位置：`packages/quay/src/serve-board.ts`（**非注释中文行 29 条**）。

**去重（机制，不是症状）**：`tasks/*.md` 无 `/board` 正文本地化任务。相关但不同机制：`gap-ac292-board-request-path-cold-build`（/board 冷构建耗时，与语言无关）。

<!-- dedup-ref -->
**同源系列（traceability）**：`gap-webui-dashboard-body-copy-en-zh`（done，已定 pattern；本任务照抄其「决定记录」①~⑨）。**本页特有**：① 状态词（`done 但未落地`）**每行渲染一次**，是**一个渲染串一行字典**的典型（决定记录 ①），⛔ 不要为每个出现位置写一行；② 摘要行 `· {n} 实现中 · {m} 待落地`、`· 扫描 {n} 任务`、`默认视图：… —— {k} 行（全部 {n} 行）` 全是**带计数的模板**（决定记录 ②），英文语序需要在模板里整体决定；③ 该页 `Board` 已在 `serve-board.ts` 里有与 dashboard 同义的「未落地/实现中」状态概念——**不跨表复用 `DASHBOARD_LABELS` 的行**，在本页新增自己的行并在任务体记录取舍。

## Plan

1. **红基线**：`startServer({port:0})`，`Cookie: lang=en` GET `/board`（默认视图）与 `/board?all=1`（若展开开关是 query；以源码为准）各一次，逐行列出含 CJK 的行（剔 endonym），贴完整清单并去重计数；谓词先对 zh 干跑命中。
2. **字典**：`serve-i18n.ts` 新增 `BOARD_KEYS` + `BOARD_LABELS` + `boardLabelsFor`（同 `DASHBOARD_LABELS` 形；zh 列逐字等于现有字面量；计数行用模板 + `fillLabel`）。
3. **改 `serve-board.ts`**：全部经字典；标题后缀与页名并列处理；该页的 30s TTL 冷构建路径（`gap-ac292-board-request-path-cold-build`）与语言无关，⛔ 不顺手改。
4. 局部刷新端点（若有）带语言（决定记录 ⑥）；客户端脚本串走参数（⑦）。
5. **既有测试迁移**：`serve-board.test.mjs` 及被实跑证实变红的测试，钉中文断言改显式 zh；负向断言显式 zh；不在 Touches 的先补 Touches 再改。
6. **新测试** `packages/quay/test/serve-board-body-i18n.test.mjs`（`@test-group product`）：字典完备 + throw 路径 + 黑盒 en/zh（默认视图与展开全部各一）。
7. **因果对照**：钳成恒 zh → en 黑盒变红，恢复复绿。
8. **收口**：scoped 门 + `serve-*.test.mjs` + `tsc --noEmit` 绿；重启常驻 serve 并截图。

## AC

- [ ] **AC1（红基线，枚举不是布尔）**：贴 `lang=en` 下 `/board` 默认视图与展开全部**各一份**界面文案中文行完整清单、去重条数；谓词先对 zh 干跑命中。
- [ ] **AC2（en 清零）**：两种视图改后界面中文行均 = 0；剩余含中文的行逐条归类为用户数据（任务标题）。
- [ ] **AC3（zh 零变化）**：改前后各抓 `lang=zh`（两种视图），去动态数据后 diff 为空（或逐条解释）。
- [ ] **AC4（字典完备且被强制）**：键集闭合；两列非空、`en` 无 CJK；删列 `tsc --noEmit` 报错（贴红读数再恢复）。
- [ ] **AC5（所有渲染路径带语言）**：列出全部渲染入口/刷新端点，`?lang=zh` 下逐个断言仍 zh。
- [ ] **AC6（因果对照）**：钳成恒 zh 后 en 黑盒变红，恢复复绿，两次读数并排贴出。
- [ ] **AC7（既有测试迁移 + 不回归）**：贴实跑变红清单；迁移后全绿；scoped 门、`serve-*.test.mjs`、`tsc --noEmit` 绿。
- [ ] **AC8（真实浏览器形态）**：重启 serve，截图 `/board?lang=en` 与 `?lang=zh`，en 图无界面中文。

## DoD

**REAL LANDING（DIR-026 Reading A）**：真实 `quay serve` 在真实浏览器里，选 EN 后 `/board` 界面文案全为英文，选中文后与改前一致。
1. 读数来自 HTTP 响应体。
2. AC6 实跑；AC1 谓词对 zh 命中过。
3. 不越界：`git diff --stat` 只含 Touches 内文件；冷构建路径不动。
4. 重启 serve + 截图（AC8）。
5. 可回滚：还原取词调用、删 `BOARD_*`。

## Touches

- tasks/gap-webui-board-body-copy-en-zh.md
- packages/quay/src/serve-board.ts
- packages/quay/src/serve-i18n.ts
- packages/quay/test/serve-board-body-i18n.test.mjs (new)
- packages/quay/test/serve-board.test.mjs
- packages/quay/test/gap-webui-board-transient-columns-drowned-by-history.test.mjs
