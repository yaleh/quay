---
id: gap-webui-needs-human-body-copy-en-zh
title: /needs-human 正文文案在 lang=en 下仍是硬编码中文（说明段、待办/升级台账标题、空态）—— 正文本地化系列，照
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

**缺口（2026-09-18，真实形态复现：`curl -H 'Cookie: lang=en' /needs-human`，去 `<style>/<script>`/标签后含中文的行，剔除 endonym「中文」）**：**7 行**：

| en 下可见的中文 |
|---|
| `Needs Human — 待人类决定`（标题后缀） |
| `人机接口的显式承接者：一条 … 产生后，无需读任何 transcript，在此页即可看到。上面是「当前待办」，下面是「升级台账」…`（说明段，含内联 `<code>` 拆出的多个文本片段） |
| `当前待办（` / `升级台账（`（带计数的小节标题）· `阻碍原因`（表头） |
| `当前无 needs-human 任务（升级台账见下）。`（空态） |

源码位置：`packages/quay/src/serve-needs-human.ts`（**非注释中文行 10 条**）。

**去重（机制，不是症状）**：`tasks/*.md` 无 `/needs-human` 正文本地化任务。

<!-- dedup-ref -->
**同源系列（traceability）**：`gap-webui-dashboard-body-copy-en-zh`（done，已定 pattern；本任务照抄其「决定记录」①~⑨，不重新设计）。**注意说明段被 `<code>` 切成多个文本片段**：英文语序不一定与中文同序，⛔ 不要把一句话按 `<code>` 边界拆成多个字典行拼接——整句作为一个带 `{name}` 占位符的模板（决定记录 ②）。

## Plan

1. **红基线**：`startServer({port:0})`，`Cookie: lang=en` GET `/needs-human`，逐行列出含 CJK 的行（剔 endonym），贴完整清单；同一谓词先对 zh 干跑命中。**两种状态都要量**：有 needs-human 任务与无任务（空态），因为空态文案只在无任务时渲染，一次抓取看不到另一态。
2. **字典**：`serve-i18n.ts` 新增 `NEEDS_HUMAN_KEYS` + `NEEDS_HUMAN_LABELS` + `needsHumanLabelsFor`（同 `DASHBOARD_LABELS` 形；zh 列逐字等于现有字面量）；带计数的标题用模板（`当前待办（{n}）`）。
3. **改 `serve-needs-human.ts`**：全部经字典；标题后缀与页名并列处理。
4. 局部刷新端点（若有）带语言（决定记录 ⑥）；客户端脚本串走参数（⑦）。
5. **既有测试迁移**：`serve-needs-human.test.mjs` 及被实跑证实变红的测试，钉中文断言改显式 zh；负向断言显式 zh；不在 Touches 的先补 Touches 再改。
6. **新测试** `packages/quay/test/serve-needs-human-body-i18n.test.mjs`（`@test-group product`）：字典完备 + throw 路径 + 黑盒 en/zh **含空态与非空态**。
7. **因果对照**：钳成恒 zh → en 黑盒变红，恢复复绿。
8. **收口**：scoped 门 + `serve-*.test.mjs` + `tsc --noEmit` 绿；重启常驻 serve 并截图。

## AC

- [x] **AC1（红基线，枚举不是布尔）**：贴 `lang=en` 下 `/needs-human` **有任务态与空态各一份**界面文案中文行完整清单与条数；谓词先对 zh 干跑命中。
- [x] **AC2（en 清零）**：两态下改后界面中文行均 = 0；剩余含中文的行逐条归类为用户数据。
- [x] **AC3（zh 零变化）**：改前后各抓 `lang=zh` 响应（两态），去动态数据后 diff 为空（或逐条解释）。
- [x] **AC4（字典完备且被强制）**：键集闭合；两列非空、`en` 无 CJK；删列 `tsc --noEmit` 报错（贴红读数再恢复）。
- [x] **AC5（所有渲染路径带语言）**：列出全部渲染入口/刷新端点，`?lang=zh` 下逐个断言仍 zh。
- [x] **AC6（因果对照）**：钳成恒 zh 后 en 黑盒变红，恢复复绿，两次读数并排贴出。
- [x] **AC7（既有测试迁移 + 不回归）**：贴实跑变红清单；迁移后全绿；scoped 门、`serve-*.test.mjs`、`tsc --noEmit` 绿。
- [x] **AC8（真实浏览器形态）**：重启 serve，截图 `/needs-human?lang=en` 与 `?lang=zh`，en 图无界面中文。

## 证据（改后读数）

**AC1 红基线**（真实 `startServer({port:0})`，`Cookie: lang=en`，探针 `/tmp/nh-i18n/probe.mjs`；三态，因为空态文案与 `未记录` 各自只在一种状态下渲染）：

| 状态 | en 含 CJK 文本行 | 其中界面文案 | 其中用户数据 | zh 对照（谓词干跑） |
|---|---|---|---|---|
| 有任务（有阻碍原因） | 9 | 8 | 1（seeded reason） | 45 ✅ 命中 |
| 空态（无任务、无台账） | 11 | 11 | 0 | 47 ✅ 命中 |
| 有任务、无阻碍原因 | 9 | 8（含 `未记录` ×1） | 1 | 45 ✅ 命中 |

界面文案并集（去重后 9 条，即 `NEEDS_HUMAN_KEYS` 的 9 行）：`待人类决定`（h1 后缀）· `Quay needs-human — 显式人机承接界面`（meta description，**文本探针看不到，靠原始 HTML 扫描量到**）· 说明段首 · 说明段尾 · `当前待办（`+`）` · `阻碍原因` · `当前无 needs-human 任务（升级台账见下）。` · `升级台账（`+`）` · `无 needs-human 升级记录（`+`）。` · `未记录`（单元格文本与 `title` 属性同值，**属性同样只有原始 HTML 扫描能看见**）。
⚠️ 与 Proposal 的「7 行」不同的原因：Proposal 量的是常驻实例的真实工作区页，本探针量的是夹具页且把内联 `<code>` 拆成独立行（`当前待办（` 与 `）` 各算一行）。两者都是同一集合的不同机械切法，不是分歧。

**AC2 en 清零**：三态界面 CJK 分别 **0 / 0 / 0**。剩余行逐条归类：有任务态余 1 行 = 夹具自己 seed 的 `阻碍原因` 文本（**用户数据**，页面按数据原样渲染，见下面的正控制）；空态与无原因态余 0 行。原始 HTML 扫描（覆盖 `title=`/`<meta>` 等属性位）：**en 三态对 9 条界面字面量命中 0 条，zh 三态分别命中 7/9/7 条**（同一谓词在 zh 上命中 ⇒ 该扫描不是恒零的空转）。

**AC3 zh 零变化**：`git stash` 取改前源码、改后同一探针各跑一次，`lang=zh` 三态逐行 diff：
- 可见文本行数 65 / 63 / 65 → 65 / 63 / 65（**逐行 diff 仅 1 处差异，是 mktemp 工作区目录名**，即夹具噪声）
- 原始 HTML 行数 705 / 697 / 705 → 705 / 697 / 705
- zh 含 CJK 行数 47 / 49 / 47 → 47 / 49 / 47
⇒ 界面文案**无一处变化**。

**AC4 字典完备且被强制**：`NEEDS_HUMAN_KEYS`（9 键）与 `Object.keys(NEEDS_HUMAN_LABELS)` 集合相等、无重复；9 行两列非空、`en` 列无 CJK、`zh` 列含 CJK 或与 en 逐字同；4 条 `{code}` 模板行两列都带洞、其余 5 行两列都无洞；`needsHumanLabelsFor("en") !== needsHumanLabelsFor("zh")` 且无参会话默认解析到 en。**删列实验**：`colReason` 删掉 `zh` 列（改动前先断言 mutant 落盘：`mutant landed: True`）⇒ `tsc --noEmit` 报 `src/serve-i18n.ts:2065 - error TS2741: Property 'zh' is missing in type '{ en: string; }' but required in type '{ en: string; zh: string; }'`，`:2049` 指向 `Record<NeedsHumanKey, {en,zh}>`；恢复后 `tsc --noEmit` CLEAN。

**AC5 所有渲染路径带语言**：入口**恰好两个**，均已带语言——
① `serve-handlers.ts:263` 的 `/needs-human` 路由 → `handleNeedsHuman(req,res,client,manifest,cfg)` → `cfg.lang`（HTTP 臂，被全部黑盒用例覆盖）；
② `serve-needs-human.ts` 的 `renderNeedsHumanPage(active,ledger,manifest,identity,lang)`（唯一渲染函数，默认 `DEFAULT_LANG`=en，两臂都被直接调用断言）。
**该页没有局部刷新/JSON 子端点**（与 `/dashboard/cards` 不同——后者 30 s 后整卡替换 DOM，退回默认语言会让 zh 页几秒后变英文而页面自身 HTML 仍正确）。该「没有」被**钉死**而非假定：`GET /needs-human/cards` → **404**，且 404 体不含本页任何文案。

**AC6 因果对照**：`needsHumanLabelsFor` 与 `needsHumanLabel` 两处钳成恒返回 zh 列（**改后先 grep 确认 mutant 真的落盘：2 处**，否则对照不生效）⇒ 新文件 **7 条转红 / 5 条绿**（含 AC2 三条黑盒、AC5 两臂、`{code}` 缺参 throw、roster-per-lang）；迁移文件 **4 条转红 / 3 条绿**。恢复后 **12/12 绿** 与 **7/7 绿**。

**AC7 既有测试迁移**：真实跑（⛔ 非 grep 猜）——`serve-needs-human.test.mjs` 改造后 **4 条转红**（`AC1+AC2 两段小节`、`degradation 空态两条 none note`、`AC-295 black-box 的 en <h1>`、`AC-295 en-baseline 的 en <h1>`）。**A/B 对照**：同一命令在原始源码上 **7/7 全绿** ⇒ 4 条确由本次改动引起。迁移方式照决定记录 ④：钉中文的断言改为**显式** `Cookie: lang=zh`（原断言逐字不变，因此成为 zh 回归护栏）并补 en 侧断言；en 基线里那两条是**本任务有意移动的**字面量，改为钉新的英文字面量（⛔ 不从字典读回，避免自证）。
扩面：`packages/quay/test/serve-*.test.mjs` **44 文件 379/379 绿**；含 `needs-human` 或任一被移动字面量的候选文件 **31 文件 246/246 绿**；导入 `serve-i18n` 的文件（含全部 body-i18n/zh-chrome 系列）**42 文件 434/434 绿**。`scripts/test.sh --for-task gap-webui-needs-human-body-copy-en-zh --allow-thin` **exit 0，109/109 绿**；`tsc --noEmit` CLEAN。`git diff --stat develop...HEAD` 只含 Touches 内 4 个代码文件。

**AC8 真实浏览器形态**：worktree 起真实 `quay serve --host 127.0.0.1 --port 4419`（加载本分支的 `serve-*.ts`）+ headless Chrome 截图：
`/tmp/nh-i18n/browser/needs-human-en.png`（80824 B）与 `needs-human-zh.png`（80697 B）。
en 图界面文案全英文（`Needs Human — Awaiting human decision` / `The explicit owner of the human interface…` / `Currently awaiting (status: needs-human)` / `Blocking reason` / `Escalation ledger (action: needs-human)`），仅余用户数据（任务阻碍原因）与切换控件 endonym `中文`；zh 图与改前逐页一致。
⛔ **未重启 :4173 常驻 serve**（pid 3357036，`--host 0.0.0.0`）：它服务的是**共享主检出**，把未落地的 worktree 指过去会改掉其他层正在读的工作区（且落地发生在 fan-in 之后）。落地后重启常驻 serve 属收尾步骤，已记录为待办。

## DoD

**REAL LANDING（DIR-026 Reading A）**：真实 `quay serve` 在真实浏览器里，选 EN 后 `/needs-human` 界面文案（两态）全为英文，选中文后与改前一致。
1. 读数来自 HTTP 响应体。
2. AC6 实跑；AC1 谓词对 zh 命中过。
3. 不越界：`git diff --stat` 只含 Touches 内文件。
4. 重启 serve + 截图（AC8）。
5. 可回滚：还原取词调用、删 `NEEDS_HUMAN_*`。

## Touches

- tasks/gap-webui-needs-human-body-copy-en-zh.md
- packages/quay/src/serve-needs-human.ts
- packages/quay/src/serve-i18n.ts
- packages/quay/test/serve-needs-human-body-i18n.test.mjs (new)
- packages/quay/test/serve-needs-human.test.mjs
