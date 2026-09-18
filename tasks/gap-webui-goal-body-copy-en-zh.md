---
id: gap-webui-goal-body-copy-en-zh
title: /goal 列表与详情正文文案在 lang=en 下仍是硬编码中文（AC 达成/挂靠任务/未挂靠/未记录 等列头与状态词）——
  正文本地化系列（大页），照 /dashboard 已定 pattern
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

**缺口（2026-09-18，真实形态复现：`curl -H 'Cookie: lang=en' /goal`，去 `<style>/<script>`/标签后含中文的行，剔除 endonym「中文」）**：**37 行**，其中**大多是目标标题/AC 文本（数据）**（如 `self-hosted CI test job 墙钟压到 30 秒内——…`、`三层塌缩 —— 会话退役，机制承接`）。已识别的界面文案：

| en 下可见的中文（界面文案，已识别） |
|---|
| `Goals — 阶段目标 (24)`（`<h1>` 后缀，含计数插值） |
| `AC 达成` · `挂靠任务` · `未挂靠` · `未记录`（列头/状态词，多行重复出现） |
| 待 AC1 枚举的其余项：Tab 指示器、空态、详情页各区块标题 |

源码位置：`packages/quay/src/serve-goal.ts`（**非注释中文行 22 条**，同时承载 `/goal` 列表与 `/goal/<id>` 详情）。**待翻译量 ≤ 22；37 是含数据的上界。**

**去重（机制，不是症状）**：`tasks/*.md` 无 `/goal` 正文本地化任务。相关但不同机制：`gap-webui-goal-list-tab-split-goal-ac`、`gap-webui-goal-list-sort-and-column-set`（列表结构与排序，与语言无关）。

<!-- dedup-ref -->
**同源系列（traceability）**：`gap-webui-dashboard-body-copy-en-zh`（done，已定 pattern；本任务照抄其「决定记录」①~⑨）。**本页特有**：① `未挂靠`/`未记录` 等状态词**每行渲染一次**，按「一个渲染串一行」共用字典行（决定记录 ①）；② 标题后缀带计数：`阶段目标 ({n})` 用模板（决定记录 ②）；③ 已有测试 `gap-webui-goal-list-tab-split-goal-ac.test.mjs` **钉着 Tab 指示器的中文字面量**（记忆里记过：`/goal` 的 Tab 指示器是内页裸字面量，按调用点 grep 会漏），必须**从渲染出的 en 体反推**而不是靠 grep 源码；④ 目标标题、AC 文本、挂靠的任务标题是数据，不翻译；⑤ **`/goal/<id>` 详情页**同文件，范围含列表与详情两个入口。

## Plan

1. **红基线 + 分离**：`startServer({port:0})`（fixture 里放若干含中文标题的 goal 与挂靠/未挂靠任务），`Cookie: lang=en` GET `/goal` 与 `/goal/<id>`，用**可复算谓词**拆成「界面文案」与「数据」（数据 = 来自 goal/任务记录内容的行），各列清单；把 22 条源码字面量逐条归类：列表 / 详情 / Tab。谓词先对 zh 干跑命中。
2. **字典**：`serve-i18n.ts` 新增 `GOAL_KEYS` + `GOAL_LABELS` + `goalLabelsFor`（同 `DASHBOARD_LABELS` 形；zh 列逐字等于现有字面量；`阶段目标 ({n})` 用模板）。
3. **改 `serve-goal.ts`**：界面文案全走字典（列表与详情两条路径）；数据原样；标题后缀与页名并列处理。
4. 局部刷新端点（若有）带语言（决定记录 ⑥）；客户端脚本串走参数（⑦）。
5. **既有测试迁移**：`gap-webui-goal-list-tab-split-goal-ac.test.mjs`、`serve-goal-doc.test.mjs`、`gap-webui-goal-list-sort-and-column-set.test.mjs`、`gap-webui-goal-detail-no-entity-links.test.mjs` 中被**实跑**证实变红的，钉中文断言改显式 zh；负向断言显式 zh；不在 Touches 的先补 Touches 再改。
6. **新测试** `packages/quay/test/serve-goal-body-i18n.test.mjs`（`@test-group product`）：字典完备 + throw 路径 + 黑盒 en/zh（列表与详情各一）。
7. **因果对照**：钳成恒 zh → en 黑盒变红，恢复复绿。
8. **收口**：scoped 门 + `serve-*.test.mjs` + `tsc --noEmit` 绿；重启常驻 serve 并截图。

## AC

- [ ] **AC1（红基线 + 分离，枚举不是布尔）**：贴 `lang=en` 下 `/goal` 列表与 `/goal/<id>` 详情按可复算谓词拆出的「界面文案」与「数据」清单与条数，并把 22 条源码字面量逐条归类；谓词先对 zh 干跑命中。
- [ ] **AC2（en 清零）**：列表与详情改后「界面文案」类中文行 = 0；「数据」类行与改前逐字一致。
- [ ] **AC3（zh 零变化）**：改前后各抓 `lang=zh`（列表 + 详情），去动态数据后 diff 为空（或逐条解释）。
- [ ] **AC4（字典完备且被强制）**：键集闭合；两列非空、`en` 无 CJK；删列 `tsc --noEmit` 报错（贴红读数再恢复）。
- [ ] **AC5（所有渲染路径带语言）**：列表、详情、Tab 切换、局部刷新端点在 `?lang=zh` 下逐个断言仍 zh，`?lang=en` 下逐个断言 en（⛔ Tab 指示器要从渲染体断言，不从源码 grep）。
- [ ] **AC6（因果对照）**：钳成恒 zh 后 en 黑盒变红，恢复复绿，两次读数并排贴出。
- [ ] **AC7（既有测试迁移 + 不回归）**：贴实跑变红清单；迁移后全绿；scoped 门、`serve-*.test.mjs`、`tsc --noEmit` 绿。
- [ ] **AC8（真实浏览器形态）**：重启 serve，截图 `/goal?lang=en`、`/goal/<id>?lang=en` 与对应 `?lang=zh`，en 图上界面文案全英文。

## DoD

**REAL LANDING（DIR-026 Reading A）**：真实 `quay serve` 在真实浏览器里，选 EN 后 `/goal` 列表与详情的界面文案全为英文而 goal/AC 数据原文不变，选中文后与改前一致。
1. 读数来自 HTTP 响应体。
2. AC6 实跑；AC1 谓词对 zh 命中过。
3. 不越界：`git diff --stat` 只含 Touches 内文件。
4. 重启 serve + 截图（AC8，列表与详情各一）。
5. 可回滚：还原取词调用、删 `GOAL_*`。

## Touches

- tasks/gap-webui-goal-body-copy-en-zh.md
- packages/quay/src/serve-goal.ts
- packages/quay/src/serve-i18n.ts
- packages/quay/test/serve-goal-body-i18n.test.mjs (new)
- packages/quay/test/serve-goal-doc.test.mjs
- packages/quay/test/gap-webui-goal-list-tab-split-goal-ac.test.mjs
