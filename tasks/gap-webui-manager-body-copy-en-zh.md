---
id: gap-webui-manager-body-copy-en-zh
title: /manager 正文文案在 lang=en 下仍是硬编码中文（三层状态卡、Monitor 注册表、观测指标说明）—— 正文本地化系列，照
  /dashboard 已定 pattern
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

**缺口（2026-09-18，真实形态复现：`curl -H 'Cookie: lang=en' /manager`，去 `<style>/<script>`/标签后含中文的行，剔除 endonym「中文」）**：**16 行**，几乎全是界面文案：

| en 下可见的中文（例） |
|---|
| `Manager / Outer / Inner — 三层状态`（标题后缀） |
| `三层自适应探测：多信号加权判定，缺失信号诚实标注「未检测到」…`（页首说明） |
| `Loop / 会话` · `Monitor 注册表` · `本仓库（项目类）` · `兄弟项目` · `读` · `单一登记表。` · `主要观测指标` |
| `未接入/无数据`（多处重复的同一状态词）· `— …/loop-driver-check.sh 缺失（产品安装无 methodology 层 → 未接入）` |
| `pool/floor/deficit/cap 读` · `（promotion-driver round 记录，cap 默认 5，floor = cap × 4）` · `release=… · develop 领先 0 提交` |

源码位置：`packages/quay/src/serve-system.ts` 的 `handleManager` 路径（该文件非注释中文行共 17 条，与 `/system` 共用文件）。

**去重（机制，不是症状）**：`tasks/*.md` 无 `/manager` 正文本地化任务。

<!-- dedup-ref -->
**同源系列（traceability）**：`gap-webui-dashboard-body-copy-en-zh`（done，已定 pattern，本任务照抄其「决定记录」①~⑨，不重新设计）。`/system` 在同一文件，由 `gap-webui-system-body-copy-en-zh` 处理；两条 Touches 重叠、由驱动串行，本条只动 `/manager` 独占的渲染串。**同一状态词出现在多处（`未接入/无数据`）——按「一个渲染串一行」共用字典行，不是每处一行**（决定记录 ①）；若与 dashboard 已有的同义行（`DASHBOARD_LABELS` 里的「未接入/无数据」）语义完全相同，**复用同一字典行的做法要显式评估**：跨表引用会制造耦合，优先在本页新增自己的行，并在任务体记录取舍。

## Plan

1. **红基线**：`startServer({port:0})`，`Cookie: lang=en` GET `/manager`，逐行列出含 CJK 的行（剔 endonym），贴完整清单；同一谓词先对 zh 干跑命中。
2. **字典**：`serve-i18n.ts` 新增 `MANAGER_KEYS` + `MANAGER_LABELS` + `managerLabelsFor`（同 `DASHBOARD_LABELS` 形；zh 列逐字等于现有字面量；插值行用模板 + `fillLabel`，例如 `release={v} · develop 领先 {n} 提交`）。
3. **改 `handleManager` 路径**：全部经字典；标题后缀与页名并列处理（页名走 `pageNameFor`，后缀走本页字典）。**读失败/缺失诊断串**（如 `loop-driver-check.sh 缺失…`）里 `<script 名>` 是数据、其余是文案，按模板拆开。
4. 该页若有局部刷新端点：必须带语言（决定记录 ⑥）；客户端脚本串走参数（⑦）。
5. **既有测试迁移**：`serve-manager.test.mjs`、`serve-ac95-views.test.mjs` 等钉中文的断言改显式 zh；负向断言必须显式 zh；先实跑找红清单，不在 Touches 的先补 Touches。
6. **新测试** `packages/quay/test/serve-manager-body-i18n.test.mjs`（`@test-group product`）：字典完备 + throw 路径 + 黑盒 en/zh。
7. **因果对照**：`managerLabelsFor` 钳成恒 zh → en 黑盒变红，恢复复绿。
8. **收口**：scoped 门 + `serve-*.test.mjs` + `tsc --noEmit` 绿；落地后重启常驻 serve 并 headless Chrome 截图。

## AC

- [x] **AC1（红基线，枚举不是布尔）**：贴 `lang=en` 下 `/manager` 界面文案中文行完整清单与条数；谓词先对 zh 干跑命中。
- [x] **AC2（en 清零）**：改后界面中文行 = 0；剩余含中文的行逐条归类为用户数据（无则写「无」）。
- [x] **AC3（zh 零变化）**：改前后各抓一次 `lang=zh` 响应，去动态数据后 diff 为空（或逐条解释）。
- [x] **AC4（字典完备且被强制）**：键集闭合；测试断言两列非空、`en` 无 CJK；删任一列 `tsc --noEmit` 报错（贴红读数再恢复）。
- [x] **AC5（所有渲染路径带语言）**：列出该页全部渲染入口/刷新端点，逐个在 `?lang=zh` 下抓取断言仍 zh。
- [x] **AC6（因果对照）**：钳成恒 zh 后 en 黑盒变红，恢复复绿，两次读数并排贴出。
- [x] **AC7（既有测试迁移 + 不回归）**：贴实跑变红清单；迁移后全绿；scoped 门、`serve-*.test.mjs`、`tsc --noEmit` 绿。
- [x] **AC8（真实浏览器形态）**：重启 serve，headless Chrome 截图 `/manager?lang=en` 与 `?lang=zh`，en 图无界面中文。

## DoD

**REAL LANDING（DIR-026 Reading A）**：真实 `quay serve` 在真实浏览器里，选 EN 后 `/manager` 界面文案全为英文，选中文后与改前一致。
1. 读数来自 HTTP 响应体，⛔ 不读渲染函数返回值。
2. AC6 因果对照实跑；AC1 谓词对 zh 命中过。
3. 不越界：`git diff --stat` 只含 Touches 内文件；`/system` 与其余页正文不动。
4. 重启 serve + 截图（AC8），⛔ 不以「已落地」代替「页面已变」。
5. 可回滚：还原取词调用、删 `MANAGER_*`。

## 决定记录（pattern 照抄 dashboard ①~⑨；本页各自的取舍见下列 ④/⑤/⑥）

**① 字典**：`serve-i18n.ts` 末尾新增 **ROW 16** + `MANAGER_KEYS` + `MANAGER_LABELS: Record<ManagerKey,{en,zh}>`。单位是**一个渲染串**，不是组件。
**11 行 = `renderManagerPage` 的 11 条非注释中文行**（1:1）。这 11 行里只有 **8 行**在健康渲染中可见，另 **3 行**对「去标签数文本行」的探针**结构上不可见**：`metaDescription`（在属性里）、`colSession` / `recentPromotions`（潜伏行）。这个分解可逐个核对，不是感觉。

**② 取词**：`const L = managerLabelsFor(lang)` 一次取整表；插值行两列都是 `{name}` 模板，由 `fillLabel` 填；**缺参数 throw**（ROW 6）。本页三行带参数：`registryNote`/`poolSourceNote` 的 `{file}`（调用方传入已包 `<code>` 的片段，ROW 14 ①）与 `releaseLine` 的 `{version}`/`{n}`。

**③ 页名与副标题并列，不合并**（ROW 14 ③）：`pageNameFor` 收的是裸 token `Manager / Outer / Inner`（ROW 3），` — 三层状态` 走 ROW 16。⛔ 传预合成串会让 ROW 3 的查表**落空并静默回落**（硬规则 3b）。
⚠️ 本页 `<title>` **不带副标题**（与 ROW 15 的 /sessions 相反），故行名取 `h1Subtitle` 而非 `pageSubtitle`。

**④ 潜伏行入册**（ROW 16 ④）：`colSession`（liveness 表首列）与 `recentPromotions`（晋升列表）只在数据非空时渲染。**`recentPromotions` 在新测试里是可见的**——fixture 写 `.quay/promotion-round.jsonl`，经一次真实 HTTP 渲染断言（⛔ 不是靠读字典自证）。`colSession` 的渲染点在当前树里**结构上不可达**（liveness reader 于 2026-09-03 退役、恒返回 `sessions: []`），测试**明确具名**这件事并断言 `<th>Session</th>` 确实不出现——而不是假装覆盖了它。

**⑤ `obsNote` 的共享状态词【不在】本页字典内——这是本任务对去重注记作出的裁决，理由如下**：
它是 `serve-render.ts` 的**共享 chrome**（7 个页面共用），ROW 15 ⑥ 已把它归入系列的共享残余清单。本页 echoed 了它 3 次，**这正是任务体把「16 行」写成那 16 行的原因**：那个计数是按【响应内 CJK 行数】量的，而**响应行数分不出「本页文案」与「本页渲染的共享外壳」**。
- 在本页为它单开一行 = 同一个词的**第二个副本**，正是 ROW 9（`CHROME_LABELS`）存在的理由所要防的漂移；
- 直接改 `obsNote` = 移动其余 7 页的 `lang=en` 输出，并弄红 `serve-architecture-body-i18n.test.mjs` 的空态臂——那条断言（`r.body.includes("未接入/无数据")` under **en**）是**刻意**写的，注释原话是「使其不被后来的『全面翻译』改动悄悄改写」。
⇒ 它的归宿是将来一条**共享 chrome 行**（ROW 9 同族），不是某一页的私有行。**本任务不越界。**

**⑥ `<meta name="description">` 入册**（ROW 16 ②）：它在**属性**里，任何「去标签后数文本行」的探针都读不到它。不入册就会永远漏掉且没有任何检查会报——这正是「用一把看不见它的尺子量本地化」的形态。

**⑦ 既有测试迁移**：默认 en ⇒ 钉中文的 **en 基线**断言改钉新的 en 输出（中文断言在 en 下会变成恒真空转）；**zh 侧断言原样保留**（它们因此成为 zh 回归护栏）；并补一条**分离断言**（en `<h1>` 不含中文副标题），使 zh 断言不只是「en 也能过」。负向断言一律显式 zh。

**⑧ 测试形态**：新文件三层 —— 闭合集（11 条，且断言条数）+ 两列规则（en 无 CJK、zh 含 CJK 或与 en **逐字同**）+ 取词/填参的两条 throw + 黑盒两态（en 本页 CJK = 0，**同一谓词对 zh 干跑必须命中**）+ 潜伏行 + 单入口（无刷新端点）。

**⑨ 可回滚**：还原 `renderManagerPage` 的取词调用、删 `MANAGER_*`；纯本地代码，无外部状态。

## 证据（改后读数）

**AC1 红基线**（真实 workspace fixture，`startServer({port:0})`，`Cookie: lang=en`）：
`totalTextLines=80 cjkLines=20`。**谓词先对 zh 干跑 = 56 命中**（零计数对照成立）。20 行分类 —— endonym `中文`×2；共享外壳 `obsNote` 状态词 `未接入/无数据`×3；**数据** 5（reader 诊断 `— …/loop-driver-check.sh 缺失（…）`、`— .quay/promotion-round.jsonl 尚无 round 记录（…）`、registry note `本仓库（项目类）`/`兄弟项目`×2）；**本页文案 10 个可见片段 = 8 条渲染串**（`读 <code>…</code> 单一登记表。` 被去标签拆成 2 行）。**真机 :4173 复查得到同一集合**（同样 20 行）。⚠️ 另有 **3 条本页文案对可见文本探针不可见**：`metaDescription` 在属性里，`colSession`/`recentPromotions` 是潜伏行 —— 8 + 3 = **11**，与源码 11 条非注释中文行逐条对应。

**AC2 改后**：同一判据 `cjkLines` 20 → **10**；10 行分类 —— endonym ×2、共享外壳 ×3、registry note ×3、reader 诊断 ×2 ⇒ **本页文案 = 0**（新测试断言 `residual === []`）。零计数对照：同一谓词对 zh 响应命中 **56 > 10**。

**AC3 zh 零变化**：**同一** fixture workspace 路径下改前（主检出 source）/改后各抓一次 `lang=zh`：**raw HTML diff = 0 行，可见文本 diff = 0 行**（逐字节相同，无需解释任何差异）。

**AC4 字典被强制**：删 `MANAGER_LABELS.colSession` 的 `en` 列 ⇒ `tsc --noEmit` 报 `TS2741: Property 'en' is missing … but required in type '{ en: string; zh: string; }'`（`serve-i18n.ts:1789`，指向 `:1748` 的 `Record<ManagerKey, {en,zh}>`）；恢复后 `tsc` 干净（exit 0）。

**AC5 单入口**：该页唯一渲染入口是 `serve-handlers.ts:143`（`url.pathname === "/manager"`），**无刷新端点**（测试断言 `/manager/cards`、`/manager.json`、`/manager/refresh` 均非 200）。`Cookie: lang=zh` 与 `?lang=zh` 两条路径都抓过并断言仍 zh。
⇒ **本页没有 /dashboard ⑥ 那种「30 秒后整卡替换」的端点**，故不存在「页面正确但刷新后变语言」的那类缺陷；这一点以断言形式留下，新增端点会红。

**AC6 因果对照**：`managerLabelsFor` 钳成恒返 zh 列（**先 `grep -n "MUTANT (AC6 control)"` 确认 mutant 真的落盘：1 处**）⇒ 新测试 **4 条转红**（含黑盒 en 臂：`en residual` 由 `[]` 变为 11 条中文；以及 `recentPromotions` 真实渲染臂、`three-layer status` 缺席臂）；恢复后 **11/11 绿**。

**AC7 既有测试迁移**：改造后实跑 **42 个候选文件**（`packages/quay/test/serve-*.test.mjs` 41 个 + `gap-webui-goal-detail-no-entity-links.test.mjs`，后者也遍历全部路由）= **350 tests，实红 2 条**，均在 `packages/quay/test/serve-manager.test.mjs`（两处把中文副标题当成 en 基线：`AC-black-box` 与 `AC-en-baseline`）；迁移后 **361 tests / 0 fail**。scoped 门 `bash scripts/test.sh --for-task gap-webui-manager-body-copy-en-zh --allow-thin` **129/129 绿、exit 0**；`tsc --noEmit` 干净。已写 scoped-gate cache（`developSha=c1d856f1f6dacf0776e7ceeb714cc60fec7f0e16`）。

**AC8 真实浏览器形态**：worktree 起真实 `quay serve --host 127.0.0.1 --port 4331`（加载本分支的 `serve-*.ts`），headless Chrome 1500×3200 截图：
`/tmp/mgr-i18n/manager-en.png`（130770 B）与 `/tmp/mgr-i18n/manager-zh.png`（128161 B）。
en 图正文全英文（`Manager / Outer / Inner — three-layer status` / `Three-layer adaptive probing…` / `Loop / sessions` / `Monitor registry` / `Primary observability metrics` / `Reads the single registration table observer-registry.conf.` / `release=0.10.0-dev · develop is 0 commits ahead`），残余中文只有 endonym `中文`、`obsNote` 共享状态词（按 ⑤ 出界）与 registry/reader 数据；zh 图与改前逐页一致。
⛔ **未重启 :4173 常驻 serve**：它服务的是**共享主检出**，把未落地的 worktree 指过去会改掉其他层正在读的工作区；落地后重启属收尾步骤，已记录为待办。

**DoD 3 不越界**：`git diff --stat` = `serve-i18n.ts` / `serve-system.ts` / `serve-manager.test.mjs` + 新增 `serve-manager-body-i18n.test.mjs`，**全在 Touches 内**；`/system` 与其余 14 页正文一字未动。

## Touches

- tasks/gap-webui-manager-body-copy-en-zh.md
- packages/quay/src/serve-system.ts
- packages/quay/src/serve-i18n.ts
- packages/quay/test/serve-manager-body-i18n.test.mjs (new)
- packages/quay/test/serve-manager.test.mjs
- packages/quay/test/serve-ac95-views.test.mjs
