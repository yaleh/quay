---
id: gap-webui-journal-body-copy-en-zh
title: /journal 界面文案在 lang=en 下仍是硬编码中文（标题后缀、升级项区头、陈旧记录提示）——en 下 239 行含中文行绝大多数是
  tick-log/escalations 数据，须先分离再翻译
status: todo
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

**缺口（2026-09-18，真实形态复现：`curl -H 'Cookie: lang=en' /journal`，去 `<style>/<script>`/标签后含中文的行，剔除 endonym「中文」）**：**239 行**——⚠️ **这个数字是上界，不是待翻译量**：`/journal` 渲染的是 `escalations.md` 与 tick-log 的**原文**（用户/manager 写的处置记录、根因分析、提交号），这些是**数据**，不翻译。已能从抽样中识别为界面文案的只有少数几条：

| en 下可见的中文（界面文案，已识别） | 备注 |
|---|---|
| `Journal — 循环最近记录`（标题后缀） | `<title>`/`<h1>` |
| `升级项 (escalations.md)` | 区头，`escalations.md` 是文件名（数据） |
| `⚠️ 陈旧记录 — 最后更新于 2026-08-27（约 21 天前）；升级机制已由 tick-log …` | 陈旧提示，含日期与天数插值 |
| 类似的区头/空态/计数句 | 待 AC1 逐条枚举 |

源码位置 `packages/quay/src/serve-live.ts` 的 `handleJournal` 路径（该文件**非注释中文行 24 条**，与 `/live` 共用；`/live` 独占的部分由 `gap-webui-live-body-copy-en-zh` 处理）。**真实待翻译量 ≤ 24，很可能远小于此。**

**去重（机制，不是症状）**：`tasks/*.md` 无 `/journal` 正文本地化任务。

<!-- dedup-ref -->
**同源系列（traceability）**：`gap-webui-dashboard-body-copy-en-zh`（done，已定 pattern；本任务照抄其「决定记录」①~⑨）。**本页最关键的一步是分离**：把 239 行拆成「界面文案」与「数据」两类，且**分类规则要写成可复算的谓词**（例如：数据 = 来自 `escalations.md` / tick-log 文件内容的行；界面 = 由 `serve-live.ts` 模板渲染的行），⛔ 不靠目测。**陈旧提示里的日期与天数是插值**（决定记录 ②），英文里日期格式与「约 N 天前」的语序都要在模板里整体决定。

## Plan

1. **红基线 + 分离**：`startServer({port:0})`，`Cookie: lang=en` GET `/journal`，得到 239 行；用**可复算的分类谓词**拆成「界面 / 数据」两类并各自列清单——分类依据是把源文件内容（`escalations.md`、tick-log）从响应体里**剔除**后剩余的含 CJK 行。谓词先对 zh 干跑命中。
2. **字典**：`serve-i18n.ts` 新增 `JOURNAL_KEYS` + `JOURNAL_LABELS` + `journalLabelsFor`（同 `DASHBOARD_LABELS` 形；zh 列逐字等于现有字面量；陈旧提示用模板 `最后更新于 {date}（约 {days} 天前）`）。
3. **改 `serve-live.ts` 的 `/journal` 路径**：仅界面文案经字典；标题后缀与页名并列处理；**数据原样输出，⛔ 不做任何翻译或截断**。`/live` 路径一字不动。
4. 局部刷新端点（若有）带语言（决定记录 ⑥）。
5. **既有测试迁移**：`serve.test.mjs` 等被实跑证实变红的测试，钉中文断言改显式 zh；负向断言显式 zh；不在 Touches 的先补 Touches 再改。
6. **新测试** `packages/quay/test/serve-journal-body-i18n.test.mjs`（`@test-group product`）：字典完备 + throw 路径 + 黑盒 en/zh；**用受控的 `escalations.md` fixture**，断言数据行原样出现在 en 页（证明没误翻译数据）。
7. **因果对照**：钳成恒 zh → en 黑盒变红，恢复复绿。
8. **收口**：scoped 门 + `serve-*.test.mjs` + `tsc --noEmit` 绿；重启常驻 serve 并截图。

## AC

- [ ] **AC1（红基线 + 分离，枚举不是布尔）**：贴 239 行按**可复算谓词**拆出的「界面文案」清单与「数据」清单及各自条数，并贴谓词本身；谓词先对 zh 干跑命中。⛔ 不得把 239 当待翻译量。
- [ ] **AC2（en 清零）**：改后「界面文案」类中文行 = 0；「数据」类行与改前**逐字一致**（证明没有误翻译数据）。
- [ ] **AC3（zh 零变化）**：改前后各抓 `lang=zh`，diff 为空（或逐条解释）。
- [ ] **AC4（字典完备且被强制）**：键集闭合；两列非空、`en` 无 CJK；删列 `tsc --noEmit` 报错（贴红读数再恢复）。
- [ ] **AC5（所有渲染路径带语言）**：列出全部渲染入口/刷新端点，`?lang=zh` 下逐个断言仍 zh。
- [ ] **AC6（因果对照）**：钳成恒 zh 后 en 黑盒变红，恢复复绿，两次读数并排贴出。
- [ ] **AC7（既有测试迁移 + 不回归）**：贴实跑变红清单；迁移后全绿；scoped 门、`serve-*.test.mjs`、`tsc --noEmit` 绿；`/live` 输出与改前逐字一致。
- [ ] **AC8（真实浏览器形态）**：重启 serve，截图 `/journal?lang=en` 与 `?lang=zh`，en 图上界面文案全英文、数据保持原文。

## DoD

**REAL LANDING（DIR-026 Reading A）**：真实 `quay serve` 在真实浏览器里，选 EN 后 `/journal` 的界面文案全为英文而数据原文不变，选中文后与改前一致。
1. 读数来自 HTTP 响应体。
2. AC6 实跑；AC1 谓词对 zh 命中过；AC2 证明数据未被误翻译。
3. 不越界：`git diff --stat` 只含 Touches 内文件；`/live` 输出不变。
4. 重启 serve + 截图（AC8）。
5. 可回滚：还原取词调用、删 `JOURNAL_*`。

## Touches

- tasks/gap-webui-journal-body-copy-en-zh.md
- packages/quay/src/serve-live.ts
- packages/quay/src/serve-i18n.ts
- packages/quay/test/serve-journal-body-i18n.test.mjs (new)
- packages/quay/test/serve.test.mjs
