---
id: gap-webui-journal-body-copy-en-zh
title: /journal 界面文案在 lang=en 下仍是硬编码中文（标题后缀、升级项区头、陈旧记录提示）——en 下 239 行含中文行绝大多数是
  tick-log/escalations 数据，须先分离再翻译
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

### 实测对立案前提的两处更正（AC1 的产物，不是计划变更）

1. **239 → 241**：同一谓词（真实 workspace、真实 `startServer({port:0})`、`Cookie: lang=en`）实测 **241** 行含 CJK。差额是数据漂移（立案时的 escalations/tick-log 与测量时不同），⛔ 不是谓词差异。**结论不变且更强**：241 里界面文案只有 **6 条**，235 条是数据 —— 「把 241 清到 0」是一个会**破坏数据**的目标。
2. **陈旧提示不在 `serve-live.ts`**：它由 `observation.ts` 的 `staleBanner()` 生成**成品 markdown 串**（含中文）后 prepend 进 `escalations.markdown`。⇒ 渲染层拿到它时措辞**已经写死在数据里**，任何 renderer 都不可能用请求的语言说出它。这是本任务唯一需要动到 Touches 之外的文件的原因（Plan 第 5 条预授权：「不在 Touches 的先补 Touches 再改」）。

## Plan

1. **红基线 + 分离**：`startServer({port:0})`，`Cookie: lang=en` GET `/journal`；用**可复算的分类谓词**拆成「界面 / 数据」两类并各自列清单。谓词先对 zh 干跑命中。
2. **字典**：`serve-i18n.ts` 新增 `JOURNAL_KEYS` + `JOURNAL_LABELS` + `journalLabelsFor`（同 `DASHBOARD_LABELS` 形；zh 列逐字等于现有字面量；陈旧提示用模板）。
3. **改 `serve-live.ts` 的 `/journal` 路径**：仅界面文案经字典；**数据原样输出，⛔ 不做任何翻译或截断**。`/live` 路径一字不动。
4. 局部刷新端点（若有）带语言（决定记录 ⑥）。
5. **既有测试迁移**：被实跑证实变红的测试，钉中文断言改显式 zh；不在 Touches 的先补 Touches 再改。
6. **新测试** `packages/quay/test/serve-journal-body-i18n.test.mjs`（`@test-group product`）：字典完备 + throw 路径 + 黑盒 en/zh；**用受控的 `escalations.md` fixture**，断言数据行原样出现在 en 页。
7. **因果对照**：钳成恒 zh → en 黑盒变红，恢复复绿。
8. **收口**：scoped 门 + `serve-*.test.mjs` + `tsc --noEmit` 绿；重启常驻 serve 并截图。

## AC

- [x] **AC1（红基线 + 分离，枚举不是布尔）**：谓词是**两台真服务器的结构性对照**（不是关键词、不是目测）：A=真实 workspace（真 stale escalations.md + 真 2MB tick-log.md + 真提交日志），B=**orchestration/ 为空、提交信息 ASCII** 的 workspace。CJK 行同时出现在 A 与 B ⇒ 只可能是模板渲染（B 根本没有数据可渲染）。实测：A 含 CJK 文本行 **241**，其中**界面文案 6 条**（逐条见证据）、**数据 235 条**。陈旧提示由第二条判据（源文件可追溯性）从数据类里取出：它由 `observation.ts` 生成、⛔ 不在任何源文件里，却在改前被 prepend 进 markdown ⇒ 归界面类。
- [x] **AC2（en 清零）**：改后同一谓词：界面文案 CJK **6 → 0**；剩余含 CJK 行 **2 条，全是切换控件 endonym「中文」**（ROW 4 的既定设计：英文页也必须写「中文」，否则需要它的人找不到它）。**数据类 235 → 234**，集合 diff 只有一条 —— 移出的正是那条陈旧提示（它已改由渲染层用英文说出）。数据行**零改动**。
- [x] **AC3（zh 零变化）**：改前/改后各抓 `lang=zh` 的**原始 HTML**，`diff` 输出**为空**（69081 bytes，逐字节相同）。见证据。
- [x] **AC4（字典完备且被强制）**：`JOURNAL_KEYS` 8 键、`JOURNAL_LABELS` 为 `Record<JournalKey,{en,zh}>`（缺列即编译错）；测试断言键集闭合、两列非空、en 列无 CJK、zh 列已译或与 en 逐字同。删 `titleSuffix` 的 `zh` 列 ⇒ `tsc` 报 **TS2741**（`serve-i18n.ts:779`，指向 `:777` 的 `Record<JournalKey,{en,zh}>`），恢复后干净。
- [x] **AC5（所有渲染路径带语言）**：`/journal` 的渲染入口**有且只有一个** —— `serve-handlers.ts:225` 的 `handleJournal(req, res, reqCfg)`，`reqCfg` 携带 dispatcher 解析出的 `cfg.lang`。`renderJournalPage` 是模块私有（未 export），**唯一调用点** `serve-live.ts:245`，⛔ 不存在第二条渲染路径可以漏掉语言。`/journal` **没有**局部刷新端点（区别于 `/dashboard/cards`）—— 实测 `grep -rn '"/journal"' packages/quay/src/` 只命中路由分派一处。`?lang=zh` 下逐条断言仍 zh：见 AC3 的逐字 diff 与新测试的 4 条 zh 字面量断言。
- [x] **AC6（因果对照）**：把 `journalLabelsFor` 钳成恒返回 `JOURNAL_LABELS[key].zh` ⇒ en 黑盒 **2 个测试变红**（`en /journal's CJK lines are exactly …`、`en renders the stale banner in English`）；恢复 ⇒ 8/8 复绿。两次读数见证据。
- [x] **AC7（既有测试迁移 + 不回归）**：实跑变红清单 **5 条**（3 个文件）：`serve.test.mjs` 两条 `/journal` 空态断言（`无数据`→`No data`）、`observation.test.mjs` 陈旧 banner 断言（改判 `staleSource` 事实）、`serve-journal-zh-chrome.test.mjs` 两条把 en `<h1>` 钉成改前字面量的断言（AC-296 自己的「en 基线不许漂移」护栏，本任务**故意**移动了那个字节）。迁移后：`serve-*.test.mjs` + `observation.test.mjs` **335/335 绿**、新测试 **8/8 绿**、`tsc --noEmit` 绿。`/live` 输出与改前逐字一致 —— 唯一 diff 是实时的活动计数（`10 条提交`→`9 条提交`）。
- [x] **AC8（真实浏览器形态）**：真实 `quay serve` CLI（`packages/quay/bin/quay.ts serve`，根在本任务 worktree）+ 真实 headless Chrome 截图两态。en 图：`<h1>Journal — recent loop record</h1>`、三个区头英文、陈旧提示英文、**escalations 数据原文保持中文不动**；zh 图与改前一致。截图与响应体：`/tmp/journal-i18n/ac8/journal-{en,zh}.{png,html}`。

## DoD

**REAL LANDING（DIR-026 Reading A）**：真实 `quay serve` 在真实浏览器里，选 EN 后 `/journal` 的界面文案全为英文而数据原文不变，选中文后与改前一致。
1. 读数来自 HTTP 响应体（真实 `startServer`，⛔ 不读渲染函数返回值）。
2. AC6 实跑；AC1 谓词对 zh 命中过（zh 页 CJK ≥ 4 条，同谓词）；AC2 证明数据未被误翻译（数据行在 en 页逐字出现）。
3. 不越界：`git diff --stat` 只含 Touches 内文件；`/live` 输出不变。
4. 重启 serve + 截图（AC8）。⚠️ 常驻实例的重启归 fan-in/manager —— 本任务的代码此刻**只在任务分支上**，尚未合入 develop；此刻重启常驻 serve 会加载**旧代码**。故 AC8 用**本 worktree 起的一台真 serve**（同一份产品代码、同一 CLI、真实浏览器），落地后常驻实例由 driver 的 fan-in 换装。
5. 可回滚：还原取词调用、删 `JOURNAL_*`、恢复 `staleSource`。

## 决定记录（pattern 的 /journal 实例 —— 后续页面照抄）

**① 字典**：`serve-i18n.ts` **ROW 10** 新增 `JOURNAL_KEYS` + `JOURNAL_LABELS` + `journalLabelsFor`（同 ROW 8 形）。单位是**一个渲染串**：区头里的文件名（`escalations.md`）与中文写在**同一行两列里**，⛔ 不在调用点拼 —— 那种拼法会让 en 列静默丢掉文件名，而文件名是运维唯一的指路标。

**② 取词**：渲染函数开头 `const L = journalLabelsFor(lang)` 一次取整表；唯一带插值的行（陈旧提示）用 `fillLabel(L.staleBanner, {date, days})`。缺参数 throw（`fillLabel` 既有行为），测试显式覆盖 `{date}` 与 `{days}` 两条。

**③ 陈旧提示：reader 报【事实】，renderer 说【话】**。这是本页唯一的结构性改动，也是本页真正的教训：原实现把**成品句子**在数据层拼好，等于在知道语言之前就把措辞烧死了。`JournalSection.staleSource = {date, days}` 取代它。**zh 逐字节不变**的实现要点：renderer 把 banner 重新拼回**同一个 markdown 串**、走**同一条 `renderMarkdown`**（`### ` 留在调用点，它是 heading 层级、不是文案）。⚠️ 家族警告：任何 `reader` 里的**面向人的成品串**都有这个形状 —— 本文件里还有 `readRecentCommits` 的 `工作区不是 git 仓库（无提交记录）` 等诊断串，属 dashboard 决定记录 ⑤ 划定的「数据」类，本任务按同一条线**不翻译**（并因此在测试 fixture 里 git-init，让那条诊断不出现、en 记账不留豁免洞）。

**④ 既有测试迁移**：默认 en ⇒ 钉中文字面量的断言改**显式** zh，原断言不变（成为 zh 回归护栏），另补 en 侧断言。⚠️ **负向/依赖子串的断言要先确认它没有变成空转**：`serve.test.mjs:1784` 原断言 `body.includes("升级项")` 在改后**仍然绿**——因为它匹配到的是 fixture 自己的小节标题 `测试升级项`（数据），即它早已不再测它要测的区头。本任务把它拆成 zh 侧（逐字）与 en 侧（英文区头）两条。

**⑤ en 基线护栏的归属**：`serve-journal-zh-chrome.test.mjs` 把 en `<h1>` 钉成 `Journal — 循环最近记录`。它拦住的正是本任务**故意**做的那个字节移动 ⇒ 迁移时保留它「en 基线不许静默漂移」的意图，只把被本任务拥有的那一个后缀换掉，并在注释里点名拥有者。

## Touches

- tasks/gap-webui-journal-body-copy-en-zh.md
- packages/quay/src/serve-live.ts
- packages/quay/src/serve-i18n.ts
- packages/quay/src/observation.ts (补充：陈旧提示改报事实，Plan 第 5 条预授权)
- packages/quay/test/serve-journal-body-i18n.test.mjs (new)
- packages/quay/test/serve.test.mjs
- packages/quay/test/observation.test.mjs (补充：陈旧断言改判 staleSource)
- packages/quay/test/serve-journal-zh-chrome.test.mjs (补充：en 基线里的后缀由本任务拥有)

## 证据（改后读数）

### AC1 · 谓词与分离清单

谓词（可复算，两台真服务器 + 一次集合差分；A\B 之外不再需要任何判断）：

```
A = startServer 根在真实 workspace（真 stale escalations.md + 真 2MB tick-log.md + 真提交日志）
B = startServer 根在 orchestration/ 为空、提交信息 ASCII 的 workspace  ← 任何还能渲染的 CJK 行都只能来自模板
textLines(X) = 去 <style>/<script> → 去标签 → 解实体 → 按行 trim → 丢空行
CJK(L)       = /\p{Script=Han}/u.test(L)
interfaceCopy = { L ∈ textLines(A) : CJK(L) ∧ L ∈ textLines(B) }
data          = { L ∈ textLines(A) : CJK(L) ∧ L ∉ textLines(B) }
```

**界面文案（改前，6 条，全列）**：`中文`×2（endonym）、`Journal — 循环最近记录`、`升级项 (escalations.md)`、`Tick 记录 (tick-log.md)`、`最近提交 (git log)`。
**B 的对照价值**：B 里还单列出 `无数据`——它在 A 里不出现（数据齐全），但它是本页的空态文案，⛔ 只测 A 的探针看不见它 ⇒ 空态/错误态（`无数据`/`读失败`/`暂无内容。`）一并进字典。
**陈旧提示（第 7 条界面文案）**：differential 把它判成「数据」（它随数据消失），但它**在源文件里不存在**（由 `observation.ts` 生成）⇒ 用源可追溯性取出，归界面类。这正是立案表里点名的那个串。
**数据（235 条）**：`escalations.md` / `tick-log.md` / `git log` 的原文（处置记录、根因分析、提交号）。⛔ 不逐条粘贴：改后它们的**集合 diff 只有那条陈旧提示**，比粘贴 235 行更强。（谓词脚本：`/tmp/journal-i18n/{probe,classify}.mjs`，`node --experimental-strip-types probe.mjs <dir> && node classify.mjs <dir>`；输出 `ac1-classification.json`。）
**谓词对 zh 干跑命中**：zh 页同谓词命中 ≥ 4 行（新测试 `AC3` 断言）⇒ en 的 0 是测量，不是坏掉的匹配器。

### AC2 · 改后读数

```
A text lines / CJK : 398 / 241   →   398 / 236
  interface copy (在 B 也出现) : 6  →  2      ← 剩下的 2 条都是 endonym「中文」
  data (随数据消失)            : 235 → 234    ← 集合 diff = 仅那条陈旧提示；无新增
```
数据类逐条比对：`removed = [陈旧提示]`，`added = []`。⛔ 没有一条数据被翻译、截断或改写。

### AC3 · zh 零变化

`diff before/journal-D-real-zh.html after/journal-D-real-zh.html` → **无输出**（两者同为 69081 bytes，逐字节相同）。两次抓取都在**本任务提交之前**（git log 数据相同，故差异只可能来自代码）。

### AC4 · 删列红读数

```
packages/quay/src/serve-i18n.ts:779:3 - error TS2741: Property 'zh' is missing in type
  '{ en: string; }' but required in type '{ en: string; zh: string; }'.
779   titleSuffix: { en: "recent loop record" },
      ~~~~~~~~~~~
packages/quay/src/serve-i18n.ts:777:63 - 'zh' is declared here.
```
恢复后 `npx tsc --noEmit -p packages/quay/` 退出 0。

### AC6 · 因果对照（并排）

```
钳成 journalLabelsFor ⇒ 恒 JOURNAL_LABELS[key].zh ：
  ℹ tests 8 / pass 6 / fail 2
  ✖ AC2: en /journal's CJK lines are exactly the endonym + the two data lines — zero interface copy
  ✖ AC-306: the stale banner is ENGLISH on lang=en and the pre-change literal on lang=zh …
恢复：
  ℹ tests 8 / pass 8 / fail 0
```

### AC7 · 迁移清单与全量读数

实跑变红 5 条（3 文件）→ 迁移后：
```
node --test packages/quay/test/serve-*.test.mjs packages/quay/test/observation.test.mjs
  ℹ tests 336 / pass 335 / fail 0
node --test packages/quay/test/serve-journal-body-i18n.test.mjs
  ℹ tests 8 / pass 8 / fail 0
npx tsc --noEmit -p packages/quay/     → exit 0
```
`/live` 逐字对照：唯一 diff 是 `有活动信号（最近 30 分钟有 10 条提交）` → `（… 9 条提交）`，即实时活动计数；`/live` 的**文案零改动**。

### AC8 · 真实浏览器形态

真实 `quay serve` CLI（`node --experimental-strip-types packages/quay/bin/quay.ts serve --host 127.0.0.1 --port <free>`，cwd = 本任务 worktree）+ 真实 headless Chrome（`--headless=new --window-size=1440,2600`）。产物：`/tmp/journal-i18n/ac8/journal-{en,zh}.{png,html}`。

**en 响应体（界面的原文）**：
```
<h1>Journal — recent loop record</h1>
<h2>Escalations (escalations.md)</h2>
<h2>Tick log (tick-log.md)</h2>
<h2>Recent commits (git log)</h2>
<h4>⚠️ Stale record — last updated 2026-08-27 (~21d ago); the escalation channel has been
    superseded by tick-log and is kept for reference only</h4>
```
**en 页同谓词 CJK = 236 行**，与 `startServer` 探针完全一致（同一份产品代码，CLI 路径与测试路径同源）；前 2 行是 endonym，其余全部是 escalations/tick-log 数据原文（中文），⛔ 一条界面文案都没有。
**zh 响应体**：`<h1>日志 — 循环最近记录</h1>`、`<h2>升级项 (escalations.md)</h2>`、`<h2>Tick 记录 (tick-log.md)</h2>`、`<h2>最近提交 (git log)</h2>`、`<h4>⚠️ 陈旧记录 — 最后更新于 2026-08-27（约 21 天前）；升级机制已由 tick-log 取代，此处仅供参考</h4>` —— 与改前字面量逐字一致。
**截图目视**：en 图上导航/标题/区头/陈旧提示全英文，正文数据保持中文原文；zh 图与改前一致。
