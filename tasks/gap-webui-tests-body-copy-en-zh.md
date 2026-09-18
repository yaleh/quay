---
id: gap-webui-tests-body-copy-en-zh
title: /tests 正文文案在 lang=en 下仍是硬编码中文（数据源说明、时间轴/负载曲线标题、空态）—— 正文本地化系列（大页），照
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

**缺口（2026-09-18，真实形态复现：`curl -H 'Cookie: lang=en' /tests`，去 `<style>/<script>`/标签后含中文的行，剔除 endonym「中文」）**：**75 行**，其中相当一部分是界面文案、其余是验证轮记录里的**数据**（失败测试名、runId、错误输出）。已识别的界面文案：

| en 下可见的中文（例） |
|---|
| `quay — Tests — 验证轮记录`（`<title>`）· `Tests — 验证轮记录`（`<h1>`） |
| `数据源：` · `（每轮 suite 完成时追加，红绿皆入账）` · `（每轮一段，红=red · 绿=green，锚定最近一轮结束时刻）` · `（suite 运行期采样，结束即停）` |
| `最近测试记录分段时间轴` · `时间轴窗口（过去 3h）：` |
| `负载曲线（round #1924 · 15:27Z）` · `loadavg (1m) · suite 运行期采样` · `测试时间线（round #1924 · 15:27Z）` |

源码位置：`packages/quay/src/serve-tests.ts`（**非注释中文行 37 条**）。**待翻译量 ≤ 37；75 是含数据的上界。**

**去重（机制，不是症状）**：`tasks/*.md` 无 `/tests` 正文本地化任务。相关但不同机制：`gap-webui-tests-page-*`（表格/时间轴的布局缺陷，与语言无关）。

<!-- dedup-ref -->
**同源系列（traceability）**：`gap-webui-dashboard-body-copy-en-zh`（done，已定 pattern；本任务照抄其「决定记录」①~⑨）。**三个本页特有的点**：① `renderTimelineBarSvg` 是 dashboard 与本页**共享**的——dashboard 任务「决定记录 ⑧」已让它的 aria-label 随语言并要求本页传 `lang`；本任务要**核实**这一传递在本页所有调用点都成立（不传不报错，默认 en 会让 zh 页渲染英文 aria-label，硬规则 3b），⛔ 不重复改该共享函数；② `round #{n} · {time}` 等是**带插值的模板**（决定记录 ②）；③ 该页有大量**运行时诊断串/失败测试名**（数据），不翻译，与 `observation.readTests().reason` 同属 dashboard 记录 ⑤ 里已划出的「数据」类。

## Plan

1. **红基线 + 分离**：`startServer({port:0})`（fixture 里放一份含红/绿轮的 `verification-round.jsonl`），`Cookie: lang=en` GET `/tests`，得到含 CJK 的行；用**可复算谓词**拆成「界面文案」与「数据」（数据 = 来自载体记录内容的行），各列清单；并把 37 条源码字面量逐条归类。谓词先对 zh 干跑命中。**空态也要量**（无验证轮记录时的空态文案，`serve-tests-empty-state.test.mjs` 已钉着一部分）。
2. **字典**：`serve-i18n.ts` 新增 `TESTS_KEYS` + `TESTS_LABELS` + `testsLabelsFor`（同 `DASHBOARD_LABELS` 形；zh 列逐字等于现有字面量）。
3. **改 `serve-tests.ts`**：界面文案全走字典；数据原样；标题后缀与页名并列处理；核实 `renderTimelineBarSvg` 所有调用点已传 `lang`。
4. 局部刷新端点（若有）带语言（决定记录 ⑥）；客户端脚本串走参数（⑦）。
5. **既有测试迁移**：`serve-tests-empty-state.test.mjs`、`serve-ac95-views.test.mjs`、`gap-webui-tests-page-*.test.mjs` 中被**实跑**证实变红的，钉中文断言改显式 zh；负向断言显式 zh；不在 Touches 的先补 Touches 再改。
6. **新测试** `packages/quay/test/serve-tests-body-i18n.test.mjs`（`@test-group product`）：字典完备 + throw 路径 + 黑盒 en/zh（有记录态与空态各一）。
7. **因果对照**：钳成恒 zh → en 黑盒变红，恢复复绿。
8. **收口**：scoped 门 + `serve-*.test.mjs` + `tsc --noEmit` 绿；重启常驻 serve 并截图。

## AC

- [ ] **AC1（红基线 + 分离，枚举不是布尔）**：贴 `lang=en` 下 `/tests` 按可复算谓词拆出的「界面文案」与「数据」清单与条数（有记录态与空态各一），并把 37 条源码字面量逐条归类；谓词先对 zh 干跑命中。
- [ ] **AC2（en 清零）**：两态改后「界面文案」类中文行 = 0；「数据」类行与改前逐字一致。
- [ ] **AC3（zh 零变化）**：改前后各抓 `lang=zh`（两态），去动态数据后 diff 为空（或逐条解释）。
- [ ] **AC4（字典完备且被强制）**：键集闭合；两列非空、`en` 无 CJK；删列 `tsc --noEmit` 报错（贴红读数再恢复）。
- [ ] **AC5（共享组件传语言）**：列出本页对 `renderTimelineBarSvg` 的**全部**调用点及其 `lang` 实参（贴命中行，⛔ 不只报总数）；`?lang=zh` 下时间轴 aria-label 仍是 zh。
- [ ] **AC6（因果对照）**：钳成恒 zh 后 en 黑盒变红，恢复复绿，两次读数并排贴出。
- [ ] **AC7（既有测试迁移 + 不回归）**：贴实跑变红清单；迁移后全绿；scoped 门、`serve-*.test.mjs`、`tsc --noEmit` 绿；`/dashboard` 输出与改前逐字一致。
- [ ] **AC8（真实浏览器形态）**：重启 serve，截图 `/tests?lang=en` 与 `?lang=zh`，en 图上界面文案全英文。

## DoD

**REAL LANDING（DIR-026 Reading A）**：真实 `quay serve` 在真实浏览器里，选 EN 后 `/tests` 的界面文案全为英文而数据原文不变，选中文后与改前一致。
1. 读数来自 HTTP 响应体。
2. AC6 实跑；AC1 谓词对 zh 命中过。
3. 不越界：`git diff --stat` 只含 Touches 内文件；`renderTimelineBarSvg` 本体与 `/dashboard` 输出不变。
4. 重启 serve + 截图（AC8）。
5. 可回滚：还原取词调用、删 `TESTS_*`。

## Touches

- tasks/gap-webui-tests-body-copy-en-zh.md
- packages/quay/src/serve-tests.ts
- packages/quay/src/serve-i18n.ts
- packages/quay/test/serve-tests-body-i18n.test.mjs (new)
- packages/quay/test/serve-tests-empty-state.test.mjs
- packages/quay/test/serve-ac95-views.test.mjs
