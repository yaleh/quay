---
id: gap-webui-live-body-copy-en-zh
title: /live 正文文案在 lang=en 下仍是硬编码中文（在飞摘要、空态、跨任务阻塞说明）+ serve-live.ts 里 phaseLabel
  的重复副本 —— 正文本地化系列，照 /dashboard 已定 pattern
status: done
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

- [x] **AC1（红基线，枚举不是布尔）**：贴 `lang=en` 下 `/live` **空闲态与有在飞态各一份**界面文案中文行完整清单与条数，并把 24 条源码字面量逐条归类；谓词先对 zh 干跑命中。（读数：en 界面中文行 —— **空闲态 4**（`Live — 循环此刻在做什么` / `· 在飞: 0 / 上限: 5 · CPU 压力 (some avg10): …` / `无跨任务阻塞关系。` / `当前无在飞任务。`）、**有在飞态 23**（再加表头 5 条、阻塞两句、每任务的 状态/阶段/时长/「无」占位）；两态原始含 CJK 行为 6 / 25，差额各 2 条是切换控件 endonym「中文」。**谓词先对 zh 干跑命中**（zh 侧 42 / 44 行）。源码字面量逐条归类：**任务体写的 24 条是立案时读数**，serve-live.ts 现为 **17** 条非注释中文行 —— 差额 7 条由 `gap-webui-journal-body-copy-en-zh` 落地时移出（`24` 在 `eaa9799a0~1`、`17` 在 `eaa9799a0`，同一谓词两次可复算）⇒ 分类为 `/live` 独占 **14** + 与 dashboard 重复的 `phaseLabel` **3** + `/journal` 独占 **0**（该桶已空）。）
- [x] **AC2（en 清零）**：两态改后界面中文行均 = 0；剩余含中文的行逐条归类为用户数据。（读数：空闲态 6 → **2**、有在飞态 25 → **2**，剩余 2 条全是切换控件 endonym「中文」（ROW 4 既定：两种语言下都必须是中文）⇒ 界面中文 **0**。另有**具名残留**：两个 banner 态（running-unwired / 读失败）en 下各剩 **1** 行，是 observation.ts 的 `liveExplanation` / `reason`（读者诊断，本页只 `escapeHtml` 原样渲染）—— 见决定记录③，测试把它钉成事实（`residual.length === 1` 且该行确实是诊断串）而非忽略。）
- [x] **AC3（zh 零变化）**：改前后各抓 `lang=zh`（两态），去动态数据后 diff 为空（或逐条解释）。（读数：改前后各起一个真实 server、两态各抓一次 `lang=zh`，只归一化机器相关的 CPU 读数后 **diff 为空**，两侧均 **70537 字节**。）
- [x] **AC4（字典完备且被强制）**：键集闭合；两列非空、`en` 无 CJK；删列 `tsc --noEmit` 报错（贴红读数再恢复）。（读数：`LIVE_KEYS` **20** 键闭合、两列非空、en 列无 CJK、zh 列含 CJK 或与 en 逐字同（后者是更强的谓词）；删列对照 —— `noInFlight` 去掉 `en` 列 ⇒ `tsc --noEmit` **TS2741: Property 'en' is missing … at serve-i18n.ts:2242**，恢复 ⇒ exit 0。）
- [x] **AC5（刷新端点带语言 + phaseLabel 单一来源）**：`?lang=zh` 下刷新片段仍 zh；`grep` 证明 `serve-live.ts` 内不再有 `phaseLabel` 的第二份中文手抄（贴命中行，⛔ 只报总数不算）。（读数：① /live **没有刷新子端点** —— 唯一路由是精确匹配 `/live`，页面无 `<script>`，`/live/cards` ⇒ **404**；测试把该缺席钉住（新增子端点若不带语言即红，同 /dashboard/cards 先例）。② `grep` 命中行：`serve-live.ts` 内 `实现中|待落地|已落地|Implementing|Awaiting land|Landed` 共 **2** 处，**都在注释里**（`:70`、`:142`），代码路径全部走 `dashboardLabel`（ROW 5）；全仓 `实现中` 的代码字面量只剩 `serve-i18n.ts:598` 一行。测试对两个方向都下断言：三词在两页解析为**同一个值** ∧ LIVE 字典里**没有**第二份（按 key 与按值各一次，值为 exact-match 以免「待落地时长」误伤）。）
- [x] **AC6（因果对照）**：钳成恒 zh 后 en 黑盒变红，恢复复绿，两次读数并排贴出。（读数：`liveLabelsFor` 钳成恒 zh ⇒ en 侧红 **9 条**（新文件 5 条 + `serve-live-implcomplete` AC1 + `live-state` 3 条），**zh 侧用例仍绿** ⇒ 红的是 en 侧而不是整体崩；恢复 ⇒ 全绿（11 / 2 / 4）。）
- [x] **AC7（既有测试迁移 + 不回归）**：贴实跑变红清单；迁移后全绿；scoped 门、`serve-*.test.mjs`、`tsc --noEmit` 绿；`/journal` 输出与改前逐字一致（本任务不越界的证据）。（读数：实跑变红清单 **4 个文件 / 11 条用例** —— `serve-live-implcomplete` AC1（表头/阶段词）、`live-state` 3 条（两个空态 + 读失败）、`serve-live-zh-chrome` 2 条（en baseline 钉了中文 `<h1>` 后缀）、`serve.test.mjs` 7 条 /live 中文断言。迁移后：新文件 11/11、`node --test packages/quay/test/serve-*.test.mjs` **390 pass / 0 fail**（1 skip 是 `QUAY_TEST_LIVE_GITHUB` 默认跳过，与本次无关）、scoped 门 `--for-task` **107 pass / 0 fail**、`tsc --noEmit` 干净。不越界证据：`/journal` 改前后各抓 en+zh（三方：zh / en / 无 cookie），仅归一化 fixture 自己的 commit SHA 后 **diff 为空**（两侧均 **105817 字节**）。Touches 因此新增 3 个文件（`serve-live-zh-chrome.test.mjs`、`serve.test.mjs`、`serve-render.ts`）：前两个是**实跑证实变红**的，非预防性扩大。）
- [x] **AC8（真实浏览器形态）**：重启 serve，截图 `/live?lang=en` 与 `?lang=zh`（至少一张在有在飞任务时抓取），en 图无界面中文。（读数：真实 `quay serve`（fixture 实例，3 个在飞 run + 真 Touches/depends_on 阻塞关系）+ headless Chrome 截图 `/live?lang=en`、`/live?lang=zh`，**两张都在有在飞任务时抓取**；响应体机械复核 en = 2 条 CJK（endonym ×2）⇒ 界面中文 0。截图：`/tmp/live-i18n/live-en.png`、`live-zh.png`。⚠️ fixture 首轮 runId 尾部 `al-a` 被 `runProcessAliveSync` 的「末两段」针命中（长度 ≥4）⇒ 该 run 被判 alive ⇒ 阶段回落 implementing；改用**唯一长尾** runId（既有 implcomplete 测试的 `distinctiveRunId` 惯例）后 awaiting-land 行正常渲染 —— 是 fixture 的针不够独特，不是产品缺陷。）

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
- packages/quay/src/serve-render.ts
- packages/quay/test/serve-live-zh-chrome.test.mjs
- packages/quay/test/serve.test.mjs

## 决定记录（本页相对 pattern 的四处取舍）

**① `phaseLabel` 的重复：复用 ROW 5，不建第二份。** dashboard 的字典里**已经有**可复用的行
（`phaseImplementing` / `phaseAwaitingLand` / `phaseLanded`）。复用引入的跨页耦合是真实的
（dashboard 改一个阶段词，/live 跟着动），**仍然选择复用**：两页渲染的是**同一个 `InFlightPhase` 枚举**、
同一个角色（在飞任务的阶段标签），所以「两页各留一份翻译」正是本系列要消灭的形态（任务体原文：
改一处漏一处）。⛔ 这**不是**「以后都共享」的许可 —— ROW 11 ③「每页自有」的通则继续有效：本页的
`liveStateRunningUnwired` / `liveStateNotRunning` / `readFailed` 与 ROW 5 的行逐字相同，却**仍然分开**，
因为它们不是本合同点名的重复。测试对两个方向都下断言（两页得到同一个词 ∧ LIVE 字典里没有第二份）。
`fan-in` 与 `—` 是**语言中立**字面量（dashboard 自己的 phaseLabel 也这么处理 `fan-in`）⇒ ⛔ 不为它们建行。

**② 删掉 `LIVE_STATE_*`（硬规则 5b 兄弟清扫）。** 任务点名的兄弟实例只有 phaseLabel，但同一条原则还有
第二个适用点：`serve-render.ts` 里两个「每页都 import 的模块」持有的 /live 专用中文常量。5b 的产物是
「grep 该原则的其它适用点，把命中数与前几条贴出来」：全仓提到这两个名字的文件 **3 个** —— 定义
（`serve-render.ts:39-40`）、`serve-i18n.ts` 的两处注释、唯一消费者 `serve-live.ts`；**无测试引用**
⇒ 移入 ROW 19 并把常量删除。⛔ 不删的话它们会变成零消费者的死导出，而「别的页面以后可以复用」
正是它当初被放在共享模块里的理由 —— 那正是要拆掉的东西。

**③ 读者诊断不翻译（具名残留，不是遗漏）。** `liveExplanation`（遥测为空时**如何判定**的说明）与
`reason`（读失败的原因）由 `observation.ts` 产生，本页只 `escapeHtml` 原样渲染。它们**不在 Touches 内**，
且 /dashboard、/journal、/board、/architecture 四次对同一类串做了同款分类（reader 诊断 = 数据）。
⇒ 两个 banner 态在 en 下各剩 **1 行**中文，测试把它钉成事实（`residual.length === 1` ∧ 该行确实是诊断串），
而不是让它读起来像没做完。**另有具名残留**：`<meta name="description">`（两种语言下都已英文、
不经过任何字典；动它会改 zh 输出，AC3 禁止；/architecture 同款）。

**④ 既有测试迁移。** 默认语言是 en ⇒ 钉中文字面量的断言改**显式** `lang: "zh"` / `Cookie: lang=zh`，
原断言不变（因此成为 zh 回归护栏），另补 en 侧断言。⚠️ **负向断言（`!includes("中文")`）必须留在 zh 侧**：
在 en 下它恒真、且原因是错的（恒真空转）。这是 Touches 新增 `serve-live-zh-chrome.test.mjs` 与
`serve.test.mjs` 的由来 —— **实跑证实变红**才纳入，不是预防性扩大。