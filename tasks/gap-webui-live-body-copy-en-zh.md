---
id: gap-webui-live-body-copy-en-zh
title: /live 正文文案在 lang=en 下仍是硬编码中文（在飞摘要、空态、跨任务阻塞说明）+ serve-live.ts 里 phaseLabel
  的重复副本 —— 正文本地化系列，照 /dashboard 已定 pattern
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

**缺口（2026-09-18，真实形态复现：`curl -H 'Cookie: lang=en' /live`，去 `<style>/<script>`/标签后含中文的行，剔除 endonym「中文」）**：当前空闲态下 **4 行**：`Live — 循环此刻在做什么`（标题后缀）· `· 在飞: 0 / 上限: 5 · CPU 压力 (some avg10): 0.00` · `无跨任务阻塞关系。` · `当前无在飞任务。`。

⚠️ **这是低估**：/live 的大部分文案只在**有在飞任务**时渲染（阶段标签、耗时、实现中/待落地、每任务卡片），当前 0 在飞抓不到。源码位置 `packages/quay/src/serve-live.ts`（**非注释中文行 24 条**，与 `/journal` 共用该文件），远多于当前可见的 4 条；因此**红基线必须在「有在飞任务」的状态下抓**（自造 fixture：起真 workspace、造 1~2 个在飞 worktree/outcome 记录），⛔ 不能拿当前空闲态的 4 行当待清零集合。

**已知的硬规则 5b 兄弟实例（dashboard 任务「决定记录 ⑤」已记录、明确留给本页）**：`serve-live.ts` 里有一份自己的 `phaseLabel` 副本，与 dashboard 已提取的对应串是**同一批中文词的第二份手抄**。本任务要把它并入字典，而不是再给它做一份英文副本（否则同一个阶段词在两个页面各有一套翻译，改一处漏一处）。

**去重（机制，不是症状）**：`tasks/*.md` 无 `/live` 正文本地化任务。

<!-- dedup-ref -->
**同源系列（traceability）**：`gap-webui-dashboard-body-copy-en-zh`（done，已定 pattern；本任务照抄其「决定记录」①~⑨）。`/journal` 在同一文件，由 `gap-webui-journal-body-copy-en-zh` 处理；Touches 重叠由驱动串行，本条只动 `/live` 独占的渲染串。**`phaseLabel` 的去重取舍要在任务体显式记录**：dashboard 的字典里是否已有可复用的阶段词行、复用会引入的跨页耦合、最终选择及理由。

## Plan

1. **红基线**：自造「有 1~2 个在飞任务」的 workspace fixture（`startServer({port:0})`），`Cookie: lang=en` GET `/live` **空闲态与有在飞态各一次**，逐行列出含 CJK 的行（剔 endonym），贴完整清单；并把 `serve-live.ts` 24 条非注释中文行逐条归类：`/live` 独占 / `/journal` 独占 / 与 dashboard 重复的 `phaseLabel`。谓词先对 zh 干跑命中。
2. **字典**：`serve-i18n.ts` 新增 `LIVE_KEYS` + `LIVE_LABELS` + `liveLabelsFor`（同 `DASHBOARD_LABELS` 形；zh 列逐字等于现有字面量）；`phaseLabel` 副本并入，记录取舍。
3. **改 `serve-live.ts` 的 `/live` 路径**：全部经字典；标题后缀与页名并列处理。`/journal` 路径一字不动。
4. **局部刷新/轮询端点**：/live 是「实时」页，极可能有周期刷新片段——必须带语言（决定记录 ⑥：zh 页几秒后变英文，而首屏 HTML 是对的，单次抓取探针看不见）。
5. **既有测试迁移**：`serve-live-implcomplete.test.mjs`、`live-state.test.mjs` 及被实跑证实变红的测试，钉中文断言改显式 zh；负向断言显式 zh；不在 Touches 的先补 Touches 再改。
6. **新测试** `packages/quay/test/serve-live-body-i18n.test.mjs`（`@test-group product`）：字典完备 + throw 路径 + 黑盒 en/zh（**空闲态与有在飞态各一**，刷新片段一次）。
7. **因果对照**：钳成恒 zh → en 黑盒变红，恢复复绿。
8. **收口**：scoped 门 + `serve-*.test.mjs` + `tsc --noEmit` 绿；重启常驻 serve 并截图（在飞态需真有在飞任务时抓，或用 fixture 实例）。

## AC

- [ ] **AC1（红基线，枚举不是布尔）**：贴 `lang=en` 下 `/live` **空闲态与有在飞态各一份**界面文案中文行完整清单与条数，并把 24 条源码字面量逐条归类；谓词先对 zh 干跑命中。
- [ ] **AC2（en 清零）**：两态改后界面中文行均 = 0；剩余含中文的行逐条归类为用户数据。
- [ ] **AC3（zh 零变化）**：改前后各抓 `lang=zh`（两态），去动态数据后 diff 为空（或逐条解释）。
- [ ] **AC4（字典完备且被强制）**：键集闭合；两列非空、`en` 无 CJK；删列 `tsc --noEmit` 报错（贴红读数再恢复）。
- [ ] **AC5（刷新端点带语言 + phaseLabel 单一来源）**：`?lang=zh` 下刷新片段仍 zh；`grep` 证明 `serve-live.ts` 内不再有 `phaseLabel` 的第二份中文手抄（贴命中行，⛔ 只报总数不算）。
- [ ] **AC6（因果对照）**：钳成恒 zh 后 en 黑盒变红，恢复复绿，两次读数并排贴出。
- [ ] **AC7（既有测试迁移 + 不回归）**：贴实跑变红清单；迁移后全绿；scoped 门、`serve-*.test.mjs`、`tsc --noEmit` 绿；`/journal` 输出与改前逐字一致（本任务不越界的证据）。
- [ ] **AC8（真实浏览器形态）**：重启 serve，截图 `/live?lang=en` 与 `?lang=zh`（至少一张在有在飞任务时抓取），en 图无界面中文。

## DoD

**REAL LANDING（DIR-026 Reading A）**：真实 `quay serve` 在真实浏览器里，选 EN 后 `/live` 界面文案（空闲态与在飞态）全为英文，选中文后与改前一致。
1. 读数来自 HTTP 响应体。
2. AC6 实跑；AC1 谓词对 zh 命中过；**在飞态确实被覆盖**（不是只测空闲态）。
3. 不越界：`git diff --stat` 只含 Touches 内文件；`/journal` 输出不变。
4. 重启 serve + 截图（AC8）。
5. 可回滚：还原取词调用、删 `LIVE_*`。

## Touches

- tasks/gap-webui-live-body-copy-en-zh.md
- packages/quay/src/serve-live.ts
- packages/quay/src/serve-i18n.ts
- packages/quay/test/serve-live-body-i18n.test.mjs (new)
- packages/quay/test/serve-live-implcomplete.test.mjs
- packages/quay/test/live-state.test.mjs
