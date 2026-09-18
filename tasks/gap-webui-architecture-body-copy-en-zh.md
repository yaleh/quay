---
id: gap-webui-architecture-body-copy-en-zh
title: /architecture 正文文案在 lang=en 下仍是硬编码中文（数据源说明、组件状态图例、变更表头）—— 正文本地化系列，照
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

- [ ] **AC1（红基线，枚举不是布尔）**：贴 `lang=en` 下 `/architecture` 界面文案中文行完整清单与条数，并与 `serve-architecture.ts` 的 9 条非注释中文行逐条对应；谓词先对 zh 干跑命中。
- [ ] **AC2（en 清零）**：改后界面中文行 = 0；剩余含中文的行逐条归类为用户数据（无则写「无」）。
- [ ] **AC3（zh 零变化）**：改前后各抓 `lang=zh`，去动态数据后 diff 为空（或逐条解释）。
- [ ] **AC4（字典完备且被强制）**：键集闭合；两列非空、`en` 无 CJK；删列 `tsc --noEmit` 报错（贴红读数再恢复）。
- [ ] **AC5（所有渲染路径带语言）**：列出全部渲染入口/刷新端点，`?lang=zh` 下逐个断言仍 zh。
- [ ] **AC6（因果对照）**：钳成恒 zh 后 en 黑盒变红，恢复复绿，两次读数并排贴出。
- [ ] **AC7（既有测试迁移 + 不回归）**：贴实跑变红清单；迁移后全绿；scoped 门、`serve-*.test.mjs`、`tsc --noEmit` 绿。
- [ ] **AC8（真实浏览器形态）**：重启 serve，截图 `/architecture?lang=en` 与 `?lang=zh`，en 图无界面中文。

## DoD

**REAL LANDING（DIR-026 Reading A）**：真实 `quay serve` 在真实浏览器里，选 EN 后 `/architecture` 界面文案全为英文，选中文后与改前一致。
1. 读数来自 HTTP 响应体。
2. AC6 实跑；AC1 谓词对 zh 命中过。
3. 不越界：`git diff --stat` 只含 Touches 内文件。
4. 重启 serve + 截图（AC8）。
5. 可回滚：还原取词调用、删 `ARCHITECTURE_*`。

## Touches

- tasks/gap-webui-architecture-body-copy-en-zh.md
- packages/quay/src/serve-architecture.ts
- packages/quay/src/serve-i18n.ts
- packages/quay/test/serve-architecture-body-i18n.test.mjs (new)
- packages/quay/test/serve-ac95-views.test.mjs
- packages/quay/test/serve-architecture-zh-chrome.test.mjs (added mid-flight: it pins the pre-re-key `<title>`/`<h1>` tokens and went red on the re-key — Plan 步骤 5 的「先补 Touches 再改」)
