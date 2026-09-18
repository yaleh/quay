---
id: gap-webui-sessions-body-copy-en-zh
title: /sessions 正文文案在 lang=en 下仍是硬编码中文（数据源说明、会话生命周期/driver 操作说明与表单）——
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
5. **既有测试迁移**：`serve-sessions.test.mjs`、`serve-ac95-views.test.mjs`、`serve-handlers.test.mjs` 中被**实跑**证实变红的，钉中文断言改显式 zh；负向断言显式 zh；不在 Touches 的先补 Touches 再改。
6. **新测试** `packages/quay/test/serve-sessions-body-i18n.test.mjs`（`@test-group product`）：字典完备 + throw 路径 + 黑盒 en/zh（GET 首屏 + 每个 POST 反馈）。
7. **因果对照**：钳成恒 zh → en 黑盒变红，恢复复绿。
8. **收口**：scoped 门 + `serve-*.test.mjs` + `tsc --noEmit` 绿；重启常驻 serve 并截图。

## AC

- [ ] **AC1（红基线 + 分离，枚举不是布尔）**：贴 `lang=en` 下 `/sessions` GET 首屏与**每个 POST 端点响应**按可复算谓词拆出的「界面文案」与「数据」清单与条数，并把 24 条源码字面量逐条归类；谓词先对 zh 干跑命中。
- [ ] **AC2（en 清零）**：GET 与全部 POST 反馈改后「界面文案」类中文行 = 0；「数据」类行与改前逐字一致。
- [ ] **AC3（zh 零变化）**：改前后各抓 `lang=zh`（GET + 各 POST 反馈），去动态数据后 diff 为空（或逐条解释）。
- [ ] **AC4（字典完备且被强制）**：键集闭合；两列非空、`en` 无 CJK；删列 `tsc --noEmit` 报错（贴红读数再恢复）。
- [ ] **AC5（POST 反馈与刷新端点带语言）**：`?lang=zh`/`Cookie: lang=zh` 下每个 POST 反馈仍是 zh；`lang=en` 下均为 en（分别断言，⛔ 不只测 GET）。
- [ ] **AC6（因果对照）**：钳成恒 zh 后 en 黑盒变红，恢复复绿，两次读数并排贴出。
- [ ] **AC7（既有测试迁移 + 不回归）**：贴实跑变红清单；迁移后全绿；scoped 门、`serve-*.test.mjs`、`tsc --noEmit` 绿。
- [ ] **AC8（真实浏览器形态）**：重启 serve，截图 `/sessions?lang=en` 与 `?lang=zh`，并在浏览器里实际触发一次表单提交后再截一张；en 图上界面文案全英文。

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
- packages/quay/test/serve-ac95-views.test.mjs
