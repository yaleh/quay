---
id: gap-webui-goal-body-copy-en-zh
title: /goal 列表与详情正文文案在 lang=en 下仍是硬编码中文（AC 达成/挂靠任务/未挂靠/未记录 等列头与状态词）——
  正文本地化系列（大页），照 /dashboard 已定 pattern
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

- [x] **AC1（红基线 + 分离，枚举不是布尔）**：贴 `lang=en` 下 `/goal` 列表与 `/goal/<id>` 详情按可复算谓词拆出的「界面文案」与「数据」清单与条数，并把 22 条源码字面量逐条归类；谓词先对 zh 干跑命中。
- [x] **AC2（en 清零）**：列表与详情改后「界面文案」类中文行 = 0；「数据」类行与改前逐字一致。
- [x] **AC3（zh 零变化）**：改前后各抓 `lang=zh`（列表 + 详情），去动态数据后 diff 为空（或逐条解释）。
- [x] **AC4（字典完备且被强制）**：键集闭合；两列非空、`en` 无 CJK；删列 `tsc --noEmit` 报错（贴红读数再恢复）。
- [x] **AC5（所有渲染路径带语言）**：列表、详情、Tab 切换、局部刷新端点在 `?lang=zh` 下逐个断言仍 zh，`?lang=en` 下逐个断言 en（⛔ Tab 指示器要从渲染体断言，不从源码 grep）。
- [x] **AC6（因果对照）**：钳成恒 zh 后 en 黑盒变红，恢复复绿，两次读数并排贴出。
- [x] **AC7（既有测试迁移 + 不回归）**：贴实跑变红清单；迁移后全绿；scoped 门、`serve-*.test.mjs`、`tsc --noEmit` 绿。
- [x] **AC8（真实浏览器形态）**：重启 serve，截图 `/goal?lang=en`、`/goal/<id>?lang=en` 与对应 `?lang=zh`，en 图上界面文案全英文。

## DoD

**REAL LANDING（DIR-026 Reading A）**：真实 `quay serve` 在真实浏览器里，选 EN 后 `/goal` 列表与详情的界面文案全为英文而 goal/AC 数据原文不变，选中文后与改前一致。
1. 读数来自 HTTP 响应体。
2. AC6 实跑；AC1 谓词对 zh 命中过。
3. 不越界：`git diff --stat` 只含 Touches 内文件。
4. 重启 serve + 截图（AC8，列表与详情各一）。
5. 可回滚：还原取词调用、删 `GOAL_*`。

## 证据（改后读数）

**方法（可复算，不是叙述）**：`.quay/goal-i18n-probe.mjs`（两份 fixture 差分 + 三个边界态），
读数落 `.quay/goal-i18n-{before,after}-{en,zh}.txt`。谓词 = 去 `<style>/<script>`/标签后按行取含
CJK 的行，**减去**切换控件 endonym「中文」（并断言真的减到了东西 —— 否则「减负」是空操作）。

**AC1 红基线 + 分离**：`before-en.txt` 13 个 route×fixture 用例共 **150** 行 CJK。

| 类 | 用例 | 行数 | 归属 |
|---|---|---|---|
| C（记录数据全 ASCII） | 列表 goal/criterion 两 tab、过滤空、详情 GOAL、详情 AC | 6 / 10 / **0** / 10 / 5 | **界面文案**（数据里没有中文可漏 ⇒ 按构造只能是文案） |
| D（记录标题中文） | 同上 | 7 / 12 / — / 11 / 6 | 差集 = **数据**（`三层塔缩`/`体验流`/`体验流 2` 三个标题） |
| E（边界态） | 空目录 / 过滤空 / 详情无 criterion | 6 / 6 / 5 | **界面文案** |

零计数对照：同一谓词对 zh 干跑，同一用例命中 **44–51** 行（远大于 0）。
源码侧位置判据（剥注释后按行）扫 `serve-goal.ts`：非注释中文行 **恰好 22 条**（与任务体一致），
逐条归类 —— **列表 13 条**（`:65/:67` 未记录、`:200` 未读到、`:206` 未挂靠、`:216` 计数、`:271`
两个 `<th>`、`:457` 标题后缀、`:458` 读失败、`:461–463` draft 横幅三行一句、`:464` 跨 tab 提示、
`:473` 空态两句、`:474` 指针注）· **详情 9 条**（`:526/:527` 两前缀、`:536` criterion 标题、
`:538` 空态、`:540` `<th>`、`:552` 最近 verdict、`:554` 挂靠任务前缀）。
⚠️ 真实工作区复测（同一谓词，`/goal`）读到 **99** 行 —— 与任务体的 37 不同源（后者时间更早、且
分标签方式不同）；两者同形，**均以数据行为主**。本报告一律用本次复算的读数。

**AC2 en 清零**：改后同一 13 用例共 **6** 行 CJK，**全部落在 D 类**，且逐行都是记录标题（数据）：

```
D 列表 goal-tab      三层塔缩 / 三层塔缩 2      ← 两条 GOAL 的 title
D 列表 criterion-tab 体验流 2 / 体验流          ← 两条 AC 的 title
D 详情 GOAL-001      GOAL-001: 三层塔缩
D 详情 AC-028        AC-028: 体验流
```
⇒ **C 类 5 个用例 + E 类 3 个用例全部 0**；**界面文案 = 0，数据不变**（`after-en.txt`）。
数据不变这一点另有独立判据：新测试的 AC3 臂在**中文数据** fixture 上断言标题在两种语言下逐字出现。

**AC3 zh 零变化**：`before-zh.txt` 与 `after-zh.txt` 各 1056 行可见文本，逐行 diff —— 唯一的差异是
fixture 临时目录名（探针自己引入的动态量），**文本内容 0 处不同**。⚠️ 为此把 draft 横幅那句
**源码换行产生的空白也留在字典行里**（ROW 7「zh 列逐字等于提取前的字面量」按字面执行）：把三行
折成一行会静默吃掉 HTML 会渲染出来的两个空格，那是 zh 字节变化 —— 实测过那一版，diff 里正是这两处。

**AC4 字典完备 + 被类型强制**：`GOAL_KEYS` 23 键闭合，两列非空、en 无 CJK、仅 1 行语言中立
（`pageSubtitleCriteria`，其 zh 列**本来就**是 ASCII，故 `zhArmOk` 用「与 en 逐字相同」这一**更强**
谓词而非放宽）。**删列对照**：删 `colAcRollup` 的 `zh` 列 ⇒ `tsc --noEmit` **exit 1**：

```
packages/quay/src/serve-i18n.ts:2613:3 - error TS2741: Property 'zh' is missing in type '{ en: string; }'
  but required in type '{ en: string; zh: string; }'.
 2605  export const GOAL_LABELS: Record<GoalKey, { en: string; zh: string }> = {
```
恢复后 **exit 0、0 行输出**（读数存 `.quay/goal-i18n-ac4-tsc-{mutant,restored}.txt`）。

**AC5 所有渲染路径带语言**：新测试逐条断言（列表两 tab / 详情 GOAL 与 AC 与 draft / 过滤空 / 读失败
横幅 / Tab 指示器 / `<h1>` 两种后缀各 en+zh）；**Tab 指示器从渲染体读**（`<p class="meta">Tab:
<strong>…`），不从源码 grep。**共享 `renderBackLink` 的三个调用点**各自声明语言：en 下三页都是
`← Back to list`，zh 下三页都是 `← 返回列表` —— 只改 `/goal` 会让 `/adr/<id>`、`/doc/<id>` 的
`?lang=zh` 渲染英文回链（硬规则 3b：静默默认与「接好了」同形），故一并接线。
**命名残留（登记不静默）**：① `Criteria` tab 标签在 zh 下仍是英文（AC-301 登记的、需第三个
PAGE_LABELS 条目）；② 无 identity 时 `pageTitle` 的 `未接入项目身份 — ` 前缀在**两种语言下都是中文**
（22 个调用点的共享外壳，dashboard 任务先登记过）—— 本任务**构造了该态并断言残留在场**，而不是
沿用「实测页面不含」。

**AC6 因果对照**：把 `goalLabelsFor` 与 `chromeLabel` 两处同时钳成恒 zh（先 grep 确认两个 mutant
真的落进文件：各 1 处，否则对照不生效）：

| 读数 | 钳恒 zh（mutant） | 恢复后 |
|---|---|---|
| `serve-goal-body-i18n.test.mjs` | **fail 9 / pass 7**（en 侧臂全红，含 AC2 黑盒清零臂） | **fail 0 / pass 17** |
| 4 个迁移后的既有测试 | **fail 13 / pass 29** | **fail 0 / pass 58** |
| `serve-*.test.mjs`（全量） | — | **fail 0 / pass 418** |
| `tsc --noEmit` | — | **干净** |

（原始档存 `.quay/goal-i18n-ac6-{new-test,migrated}-mutant.txt`。）

**AC7 既有测试迁移**：**实跑**得到的变红清单 = **4 个文件 13 条**（Touches 内 2 个 + 实跑补 2 个）：

| 文件 | 变红条数 | 处置 |
|---|---|---|
| `serve-goal-doc.test.mjs` | 1 | draft 横幅钉中文 + 两条负向断言改显式 zh，补 en 侧 |
| `gap-webui-goal-list-tab-split-goal-ac.test.mjs` | 3 | 两个列头 + 两个方向的 draft 提示改显式 zh，补 en 侧 |
| `gap-webui-goal-list-sort-and-column-set.test.mjs` | 3 | `AC 达成`/`未记录`/`最近进展:`+`首次证据:` 改显式 zh，补 en 侧 |
| `gap-webui-goal-task-rollup-via-shared-summary-cache.test.mjs` | 6 | 三态直接 import 调用改传 `goalLabelsFor("zh")`；HTTP 臂加 `lang=zh`；AC4 计时臂显式 `lang=en` 并把「渲染完整」守卫改钉 en 列头 |

**扩面**（硬规则 5b：不在被报出来的那一处收手）：全部 `serve-*.test.mjs`（15 个文件）+ 所有触及
`/goal`/`serve-goal` 的 `gap-*` 候选 → **无新增变红**（其余候选 251 条全绿）。
**scoped 门 216/216 绿、exit 0**；`tsc --noEmit` 干净。

**AC8 真实浏览器**：本分支起真实 `quay serve --host 127.0.0.1 --port 4327`（加载的是**本 worktree**
的 `serve-*.ts` —— 已用 `AC achieved` / `attached tasks` 字串核实是本次改动后的码），headless Chrome
1500×2400 截图（`?lang=` 因 headless 不带 Cookie；首次用 Cookie 抓到的 en/zh 两张**字节数相同**，
即语言根本没生效 —— 换成查询参数后 en 239013 B / zh 243079 B，确实不同）：
`.quay/goal-en.png`、`.quay/goal-zh.png`、`.quay/detail-en.png`、`.quay/detail-zh.png`。
en 列表图界面文案全英文（`Goals — stage goals (24)` / `Tab: Goals Criteria` /
`id status title AC ac… last progress first evidence attach…` / `not recorded` / `not att…`），
余下的中文只有 24 条 goal 标题（数据）；en 详情图 `← Back to list` / `last progress:` /
`first evidence:` / `attached tasks: 17 (done 17)` / `criteria of this goal (16)` / 列头
`ATTACHED TASKS`，余下中文是记录标题、`origin` 摘要与记录正文（数据）。zh 两图与改前逐页一致
（`← 返回列表` / `最近进展:` / `本 goal 的 criterion (16)` / `挂靠任务` 都在原位）。
⛔ **未重启 :4173 常驻 serve**：它服务的是**共享主检出**，把未落地的 worktree 指过去会改掉其他层
正在读的工作区（且落地发生在 fan-in 之后）。与 dashboard 任务同一条理由。

## Touches

- tasks/gap-webui-goal-body-copy-en-zh.md
- packages/quay/src/serve-goal.ts
- packages/quay/src/serve-i18n.ts
- packages/quay/src/serve-render.ts
- packages/quay/src/serve-handlers.ts
- packages/quay/src/serve-adr.ts
- packages/quay/src/serve-doc.ts
- packages/quay/test/serve-goal-body-i18n.test.mjs (new)
- packages/quay/test/serve-goal-doc.test.mjs
- packages/quay/test/gap-webui-goal-list-tab-split-goal-ac.test.mjs
- packages/quay/test/gap-webui-goal-list-sort-and-column-set.test.mjs
- packages/quay/test/gap-webui-goal-task-rollup-via-shared-summary-cache.test.mjs

<!-- Touches 扩容理由（AC7 实跑读数，不是预估）：Touches 内 4 个测试文件先红 13 条；扩面到
     gap-*/serve-* /goal 相关全量后，确认变红集合恰为 4 个文件（其余候选 251 条全绿）。
     serve-render.ts / serve-handlers.ts / serve-adr.ts / serve-doc.ts 是共享 `renderBackLink`
     （3 个详情页共用）与 dispatch 传参的承重文件：AC2 要求本页界面文案清零、AC3 要求 zh 零变化，
     二者只有把该共用的「← 返回列表」行按 ROW 9 的 CHROME_LABELS 落地、并让三个调用点各自
     声明自己的语言才能同时成立（只改 /goal 会让另两页的 ?lang=zh 变成英文回链，硬规则 3b）。-->
