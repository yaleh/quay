---
id: gap-webui-system-body-copy-en-zh
title: /system 正文文案在 lang=en 下仍是硬编码中文（含 <title>/<h1> 的中文后缀）—— 正文本地化系列，照
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

**缺口（2026-09-18，真实形态复现：`curl -H 'Cookie: lang=en' /system`，去掉 `<style>/<script>`/标签后含中文的文本行，剔除切换控件的 endonym「中文」）**：**7 行**，全部是界面文案而非数据：

| en 下可见的中文 | 备注 |
|---|---|
| `quay — System — 系统状态`（`<title>`）、`System — 系统状态`（`<h1>`） | 名称 `System` 已英文，**后缀「— 系统状态」是硬编码**；AC-293 只接了 nav 当前项与页名，没接这段后缀 |
| `数据源：` / `（稳定机读 JSON 输出）` | 页内说明 |
| `：资源充足，可以跑` / `阈值按…动态计算显示，不写死当前机器上的数字。` | 资源判定句 |

源码位置：`packages/quay/src/serve-system.ts`（**非注释中文行 17 条**；该文件同时承载 `/manager`，见下）。

**去重（机制，不是症状）**：`tasks/*.md` 无 `/system` 正文本地化任务。

<!-- dedup-ref -->
**同源系列（traceability，不构成依赖）**：`gap-webui-dashboard-body-copy-en-zh`（done，已定 pattern：`serve-i18n.ts` ROW 5~9 的 `DASHBOARD_KEYS/DASHBOARD_LABELS/dashboardLabelsFor`、`fillLabel` 模板、`CHROME_LABELS`）；本任务**照抄其「决定记录」①~⑨，不重新设计**。`/manager` 也在 `serve-system.ts` 里，由 `gap-webui-manager-body-copy-en-zh` 单独处理——两条在该文件与 `serve-i18n.ts` 上 Touches 重叠，由驱动串行，互不越界（本条只动 `handleSystem` 及其独占的渲染串）。

## Plan

1. **红基线**：自起 `startServer({port:0})`（⛔ 不探询常驻实例），`Cookie: lang=en` GET `/system`，去 `<style>/<script>`/标签后逐行列出含 CJK 的行（剔除 `中文` endonym），贴完整清单——即「待清零集合」。同一谓词先对 `lang=zh` 干跑，确认能命中（零计数必须先对已知真样本验证谓词）。
2. **字典**：`serve-i18n.ts` 新增一行 `SYSTEM_KEYS` + `SYSTEM_LABELS: Record<SystemKey,{en,zh}>`（形同 `DASHBOARD_LABELS`：闭合键集、缺列编译期报错、**zh 列逐字等于现有字面量**）与 `systemLabelsFor(lang)`；带插值的行用两列都含 `{name}` 的模板 + 既有 `fillLabel`，⛔ 不在调用点拼「中文 + 数据」。
3. **改 `serve-system.ts` 的 `/system` 路径**：全部走字典；`<title>`/`<h1>` 的后缀一并处理（页名 `System` 走既有 `pageNameFor`，后缀走本页字典，两者是并列关系，不要合并）。
4. **该页若有局部刷新/异步替换端点**：必须带语言（dashboard 决定记录 ⑥：退回默认语言会让 zh 页几秒后变英文，而页面自身 HTML 是对的，单次抓取的探针看不见）；客户端脚本里的串没有字典，走参数传入（⑦）。
5. **既有测试迁移**：默认 en ⇒ 钉中文的断言改为显式 `lang:"zh"` / `?lang=zh`；负向断言必须显式 zh（en 下变恒真空转）。先**实跑**找红清单，⛔ 不靠 grep 猜；红的文件不在 Touches 里就**先补 Touches 再改**。
6. **新测试** `packages/quay/test/serve-system-body-i18n.test.mjs`（`// @test-group product`）：字典完备性 + 取词两条 throw 路径 + 黑盒 en/zh 两态（en 下界面 CJK = 0，同一谓词对 zh 干跑必须命中）。
7. **因果对照**：临时把 `systemLabelsFor` 钳成恒 zh，en 黑盒变红；恢复复绿。
8. **收口**：`scripts/test.sh --for-task gap-webui-system-body-copy-en-zh` 绿 + `node --test packages/quay/test/serve-*.test.mjs` 绿 + `tsc --noEmit` 绿；落地后**重启常驻 serve**（不会自动重载）并 headless Chrome 截图核对。

## AC

- [x] **AC1（红基线，枚举不是布尔）**：贴 `lang=en` 下 `/system` 界面文案中文行的**完整清单与条数**；⛔ 不得只报总数；谓词先对 zh 干跑命中。
- [x] **AC2（en 清零）**：改后同一判据界面中文行 = 0；剩余含中文的行逐条列出并归类为用户数据（若无剩余，写明「无」）。
- [x] **AC3（zh 零变化）**：改前 commit 与改后各抓一次 `lang=zh` 响应，去动态数据后 diff 为空（或差异逐条解释）。
- [x] **AC4（字典完备且被强制）**：键集闭合；测试断言两列非空、`en` 列无 CJK；删任一列 `tsc --noEmit` 报错（贴一次删列红读数，再恢复）。
- [x] **AC5（所有渲染路径与刷新端点带语言）**：列出该页全部渲染入口/局部刷新端点，逐个在 `?lang=zh` 下抓取并断言仍是 zh。
- [x] **AC6（因果对照）**：`systemLabelsFor` 钳成恒 zh 后 en 黑盒变红，恢复复绿，两次读数并排贴出。
- [x] **AC7（既有测试迁移 + 不回归）**：贴**实跑变红的清单**；迁移后全绿；scoped 门、`serve-*.test.mjs`、`tsc --noEmit` 全绿。
- [x] **AC8（真实浏览器形态）**：重启 serve 后 headless Chrome 截图 `/system?lang=en` 与 `?lang=zh`，贴路径；en 图无界面中文。

## DoD

**REAL LANDING（DIR-026 Reading A）**：真实 `quay serve` 在真实浏览器里，选 EN 后 `/system` 的界面文案（含标题后缀）全为英文，选中文后与改前一致。
1. 落地对象：AC2/AC3 读数来自 HTTP 响应体，⛔ 不读渲染函数返回值当「响应」。
2. 可被打红：AC6 实跑；AC1 谓词对 zh 命中过。
3. 不越界：`git diff --stat` 只含 Touches 内文件；`/manager` 与其余页正文一字不动。
4. 生效核对：重启 serve + 截图（AC8），⛔ 不以「代码已落地」代替「页面已变」。
5. 可回滚：还原取词调用、删 `SYSTEM_*`，纯本地代码。

## 证据（改后读数，2026-09-18）

探针：自起 `startServer({port:0})`（`/tmp/system-i18n/probe.mjs`，cwd = 本 worktree，⛔ 不探询常驻实例），
`Cookie: lang=en|zh` 抓 `/system`，去 `<style>/<script>`/标签后逐行判 CJK（Han + CJK 标点 + 全角形式）。

- **AC1 红基线（改前）**：`lang=en` 含 CJK 文本行 **9** 条 —— 界面文案 **7** 条：
  ① `<title>` 尾部（`… — System — 系统状态`）② `<h1>`（`System — 系统状态`）③ `数据源：` ④ `（稳定机读 JSON 输出）`
  ⑤ `：资源充足，可以跑` ⑥ `阈值按` ⑦ `动态计算显示，不写死当前机器上的数字。`；
  另 2 条为切换控件 endonym `中文`（ROW 4 既定设计，⛔ 不计入）。**零计数对照**：同一谓词对 zh 响应命中 **44** 条。
  读数：`/tmp/system-i18n/before-en.cjk.txt` / `before-zh.cjk.txt`。
- **AC2 改后**：同一判据 en 界面中文行 = **0**；剩余含中文行 **2** 条，**逐条归类**：`中文` ×2 =
  语言切换控件的 endonym（ROW 4：它在两种语言下都必须读作「中文」，用户数据 0 条）。读数 `/tmp/system-i18n/after-en.cjk.txt`。
- **AC3 zh 零变化**：`lang=zh` 改前/改后响应 **raw HTML diff 5 处、可见文本 diff 6 处，全部是实时机器读数**
  （`cpu_stall avg300` 3.49→2.26、`loadavg` 2.7→3.62、`mem_avail` 9206→10132 MB、`nproc/node_procs` 16/70→16/68、
  `in_use` 1→0、`available` 15→16）；`<title>`/`<h1>`/两条 meta/横幅/阈值句 **字节相同**
  （`… — 系统 — 系统状态`、`数据源：…（稳定机读 JSON 输出）`、`…</strong>：资源充足，可以跑`、`阈值按 <code>nproc</code> 动态计算显示…`）。
- **AC4 字典完备且被强制**：`SYSTEM_KEYS`/`SYSTEM_LABELS` 闭合 6 键；测试断言两列非空、en 列无 CJK。
  删列对照：删 `pageSubtitle` 的 `zh` 列 ⇒ `tsc` 报 `TS2741: Property 'zh' is missing … but required in type '{ en: string; zh: string; }'`
  （`serve-i18n.ts:1356`，指向 `:1353` 的 `Record<SystemKey, {en,zh}>`）；恢复后 `tsc --noEmit` 干净。
- **AC5 渲染入口枚举**：HTTP 侧**只有 1 个** —— `serve-handlers.ts:138` 的 `/system`（无 `/dashboard/cards` 式局部刷新端点，
  新测试把 `/system/cards` **实测 404** 钉住）；该路由在 `?lang=zh` 下仍为 zh（测试断言）。服务端侧另有一处**单次抓取探不到的状态**：
  `renderBar` 的 `（未知上限）` marker（只在「有值但分母不可评估」时出现）—— 直接调用双向断言（en `(unknown limit)` 且无 CJK；zh 为原字面量）。
- **AC6 因果对照**：把 `systemLabelsFor` + `systemLabel` 钳成恒 zh（**先确认 mutant 落盘**：`serve-i18n.ts:1386` / `:1401`）
  ⇒ 新测试 **11 中 5 红**（AC4 取值、AC2 en 黑盒、AC2 英文文案、AC3、AC5 renderBar），
  且 en HTTP 探针**逐条复现原红基线**（9 条，清单与 AC1 完全一致）；恢复 ⇒ **11/11 绿**。
  读数并排：`/tmp/system-i18n/ac6-mutant.txt` / `ac6-restored.txt`。
- **AC7 既有测试迁移**：**实跑红清单 = 6 条 / 3 文件** —— `serve-system.test.mjs` 4 条（AC-dict、AC-black-box、AC-en-baseline、
  AC-scope）、`serve-ac95-views.test.mjs` 1 条（六路由标题）、`gap-webui-meter-limit-param-doubles-as-display-string.test.mjs`
  1 条（unknown marker）—— 第三个**不在原 Touches 里，已先补 Touches 再改**（`task_write` 提交 `bdd5ad27d`）。
  扩面复核（导入 `serve-system` 的全部测试 + 含被移动文案的全部测试 + 全部 `*-zh-chrome`，80 条）**80/80 绿 ⇒ 无额外红**。
  迁移后：三文件 **31/31 绿**；`node --test packages/quay/test/serve-*.test.mjs` **330 条 329 绿 / 0 红**；
  **scoped 门 `scripts/test.sh --for-task … --allow-thin` exit 0，132/132 绿**（含本任务新增/迁移的四个文件）；`tsc --noEmit` 干净。
- **AC8 真实浏览器形态**：worktree 内起**真实** `quay serve --host 127.0.0.1 --port 4319`（加载本分支代码），
  headless Chrome 1500×2200 截图：`/tmp/system-i18n/system-en.png`（83368 B）、`/tmp/system-i18n/system-zh.png`（86140 B）。
  en 图界面文案全英文（`System — system status` / `Data source: … (stable machine-readable JSON output)` /
  `⇒ GO: resources sufficient, safe to run` / `Thresholds are computed from nproc …`），仅余切换控件的 `中文` endonym；
  zh 图与改前一致。⛔ **未重启常驻 :4173 serve**：它服务**共享主检出**，本改动在 fan-in 落地前不在那里（同 dashboard 任务的处理）。
- **不越界**：`git diff --stat develop...HEAD` 只有 Touches 内 6 个文件；`serve-system.ts` 的 `/manager` 段一行未动。

## Touches

- tasks/gap-webui-system-body-copy-en-zh.md
- packages/quay/src/serve-system.ts
- packages/quay/src/serve-i18n.ts
- packages/quay/test/serve-system-body-i18n.test.mjs (new)
- packages/quay/test/serve-system.test.mjs
- packages/quay/test/serve-ac95-views.test.mjs
- packages/quay/test/gap-webui-meter-limit-param-doubles-as-display-string.test.mjs
