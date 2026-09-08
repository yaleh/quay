---
id: gap-webui-goal-list-sort-and-column-set
title: /goal 的列集合、排序与取数：origin 散文列（中位 191/max 2775 字符）撑爆排版、账本已算出的时刻一列没渲染、排序写死在
  store 层、?goal= 筛选被 handler 丢弃；且不带筛选取一次即可把 2 次 goalList 降为 1 次并白得 AC 达成 rollup
status: done
labels:
  - gap
  - webui
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-webui-goal-detail-no-entity-links
---
**type:** execution

## Proposal

**来源**：人 2026-09-08 走查 `/goal` 后提出四点（缺排序 / origin 破坏排版 / 应显示时间信息 / 应统计相关任务），
并在看过实测数据后逐条裁定；随后追问「dashboard 页会显示 goal 的 AC 达成情况，在 goals 列表页可以显示吗？」
本任务承接**列表页与详情页的列集合、排序、取数**；goal↔**task** 的挂靠统计因取数路径完全不同，另立
`gap-webui-goal-task-rollup-via-shared-summary-cache`。

**人的裁定（2026-09-08，逐条）**：
① origin **直接从列表页删掉**（详情页保留，但要换个呈现形态）；
② 时间语义**只上 `lastProgressAt` + `firstEvidenceAt`**，两者都从账本派生，**不用 mtime**；
③ 详情页也要提供同样的时间信息。

**机制（四个，全部落在同两个文件内，故合为一条）**：

**M1 — 列集合从未按「扫读价值」设计过。** `serve-goal.ts:55-70` 的 8 列里，`origin` 是整段散文：
实测 65 条记录的 origin 长度（**用 YAML 解析器读，不用正则**）
**min 75 / 中位 191 / p90 759 / max 2775（GOAL-007）** 字符，占据 394px 列宽，
把行高顶到 **109–156px**（表头行仅 40px），59 行 ⇒ 整页 **15,213px**，表格总宽 **1538px** > `<main>` 容器 870px
⇒ 整页横向溢出（`scrollWidth 1825` vs `clientWidth 1440`，越界元素 122 个）。
与此同时，**唯一有时序意义的量一列都没有**——`lastProgressAt` 早已在 `goal-store.ts:411-423` 算出来喂给
fresh/stale 徽标，从未渲染成列。

> ⚠️ **数字更正（2026-09-08，立案后复核）**：本任务初稿写的是「min 29 / 中位 96 / p90 232 / max 368」，
> 那是用正则 `^origin:\s*(?:[|>]-?\s*\n((?:  .*\n)+)|(.*))` 测的——它要求块标量恰好 2 空格缩进，
> 遇到更深缩进或块内空行即在第一行不匹配处截断。改用 YAML 解析器复测，真值大 **约 7.5 倍**
> （p90 232→759，max 368→2775）。硬规则 2 的实例：**引用一个计数前要把谓词对着真样本干跑一次**。
> 实现时请以 YAML 解析的读数为准。
> **额外后果**：详情页把 origin 整块塞进单个 `<p class="meta">`——实测 `/goal/GOAL-008` 的
> 最长 `p.meta` 达 **1138 字符**，而该 goal 的 `<article>` 文本长度为 **0**（正文全空、内容都在 frontmatter）
> ⇒ 详情页目视就是「一大坨说明文字」。详情页的 origin 呈现形态也应一并收拾（不是删，是别塞进 `<p class="meta">`）。
> **产生侧**（为什么会有 5/8 个 goal 正文为空）另由 `gap-goal-record-completeness-undefined` 处理，本任务只管呈现。

**M2 — 排序写死在 store 层，显示层无入口。** `goal-store.ts:337` 是
`.sort((a, b) => String(a.id).localeCompare(String(b.id)))`，硬编码 id 字典序；
`serve-goal.ts` 里 `sort` / `orderBy` / `localeCompare` **零命中**，页面上没有任何排序控件。
后果是 8 条 `kind: goal` 散落在 57 条 `kind: criterion` 之间（AC-143、AC-144…GOAL-001…AC-150），
而 `/board` 同页族已有服务端筛选（`serve-render.ts:656 buildHref()`）却也没有排序。

**M3 — `goal` 筛选一路支持到 store，却在 handler 处被丢弃。**
`goal-store.ts:338` 有 `.filter(g => filter.goal ? g.goal === filter.goal : true)`，
ABI `goalList(filter: Record<string, unknown>)`（`provider-client.ts:171`）原样透传，
**而 `handleGoalList` 只从 query string 读 `status` 与 `kind`**，从不读 `goal`。
实测 `curl "/goal?goal=GOAL-008"` 与 `curl "/goal"` **都返回 66 行**——参数被静默忽略。

**M4 — AC 达成 rollup 在列表页缺席，而它是纯内存运算，且接上后取数次数不增反减。**
人问「dashboard 能显示 AC 达成，列表页可以吗」——可以，且是净加速。
dashboard 的 `renderGoalCard`（`serve-dashboard.ts:688`）算法逐字是：

    const acs = goals.filter((r) => String(r.goal ?? "") === gid);
    const achieved = acs.filter((r) => r.status === "achieved").length;

**纯内存数组运算、零 I/O，且已经是 export 的函数**；列表页手里本来就有这个数组。

⚠️ **但直接照搬会做出一个恒零的列**：`handleGoalList` 现在把 `status`/`kind` **交给服务端过滤**，
一旦用户点 `?kind=goal`，criterion 全被过滤掉 ⇒ 内存里算出的达成数恒为 0，
**与「这个 goal 没有 AC」同形**（硬规则 3b）。所以必须**不带筛选取一次、再在内存里筛**。

而这恰好省一次调用：`handleGoalList` 现在发 **2** 次 `goalList`（一次带筛选 + 一次专为算 draft 数）。
`list()` 的实现是**先 readdir 读全部 65 个文件、再在内存 filter**，所以带筛选与不带筛选**一样贵**
⇒ 不带筛选取一次后，**筛选视图 + draft 计数 + AC 达成 rollup 三者全在内存里派生**：

| | 现在 | 改后 |
|---|---|---|
| `goalList` 调用次数 | **2** | **1** |
| 实测/估算耗时 | 0.41–0.50s | **≈ −0.2s** |
| AC 达成列 | 无 | 有 |

（单次调用 ≈0.2s 是从 `/goal` 0.41s÷2 次 与 `/goal/<id>` 0.22s÷1 次 两个实测**推出的估算**，
不是直接测的单次调用——实现时请当场重测。）

**⚠️ 时间语义的坑（这条必须照做，否则做出来是个会说谎的列）**：
goal/AC 的 frontmatter **没有 `createdAt`**；store 暴露的 `updatedAt` 是
`fs.statSync(p).mtimeMs`（`goal-store.ts:322`）——**文件 mtime**。而 `goal-store.ts:32-34` 的 SPEC 注释已明令：

> `lastProgressAt` = 其 ACs 在 `.quay/gate-events.jsonl` 里的最近 goal-gate 事件时刻（DERIVED never stored）
> —— **NEVER the goal's own `updatedAt`（硬规则 4b：被测对象自己产生的量不能用来判断它自己）**

一次重排版、一次 driver 改写都会让 mtime «变新» 而 goal 毫无进展。**故两列都取账本，不取 mtime。**

**代价：零额外 I/O（已核实，非估计）**。`ledgerEvidenceMap`（`goal-store.ts:105`）在 `list()` 的第一行
（`:327`）每请求调用一次，实测解析 `.quay/gate-events.jsonl`（**6.87MB / 29,856 行，其中 gate=goal 29,471 条**）
耗时 **183ms**，已包含在 `/goal` 当前的 0.41–0.50s 里。其循环 `:121` 只做 `map.set(id, {at, verdict, reading})`
（后写覆盖 ⇒ 保留最后一条）；`firstEvidenceAt` 只需**在同一趟循环里多留一个 min 字段**，
不增加任何一次读盘。

**修法方向**：

1. `handleGoalList` 改为**不带筛选调一次** `client.goalList()`，`status`/`kind`/`goal` 三种筛选
   与 draft 计数、AC rollup 全在内存里对 65 条做——**调用次数由 2 降到 1**；
2. 列表页删 `origin` 列（`serve-goal.ts:67`）；详情页的 origin 改为独立区块而非 `<p class="meta">`；
3. `ledgerEvidenceMap` 的 value 增加 `firstAt`（同一趟循环取 min），view-model 暴露
   `lastProgressAt` / `firstEvidenceAt`；列表页各加一列（相对时间 + `title` 挂绝对时刻），详情页同样两行；
4. `kind:goal` 行增加「AC 达成 N/M」列——**复用 `renderGoalCard` 已有的口径**，不自己再写一份计数逻辑；
5. 排序在 **handler 侧**做（65 条，重排成本可忽略），读 `?sort=<col>&dir=<asc|desc>` query param，
   复用 `serve-render.ts:656 buildHref()` 的形态，零客户端 JS；**不给 store 的 `list()` 加排序参数**
   ——排序是显示关切，不该长进 Provider ABI；
6. 列表的 `goal` 列渲染成指向 `/goal?goal=<id>` 的链接（M3 的 UI 入口）；
7. 默认序改为 `kind:goal` 置顶 → 其后按 `goal` 分组 → 组内 AC 编号降序。

**已知同文件重叠（按 memory `dispatch-order-by-touches-overlap-direction` 钉死顺序）**：
`gap-webui-goal-detail-no-entity-links`（本任务 `depends_on` 它）在详情页引入「本 goal 的 criterion 列表」区块
并把 `goalGet` 换成一次 `goalList`，本任务的时间信息要挂在那个区块的行上；
下游 `gap-webui-goal-task-rollup-via-shared-summary-cache` 与
`gap-webui-list-table-no-overflow-container` 均 `depends_on` 本任务。

## Acceptance Criteria

- [x] AC1 origin 已删且排版恢复（生产载体读数）：加载 `/goal`，断言表头**不含** `origin`、
      表格最大行高 **< 60px**、表格总宽 <= `<main>` 容器宽、`documentElement.scrollWidth == clientWidth`。
      取假：改动前实测行高 109/156px、表宽 1538 > 870、`scrollWidth 1825 vs 1440`。
- [x] AC2 两个时间列确为账本派生（能取假）：对任取 3 条有 verdict 的 AC，断言页面渲染的 `lastProgressAt`
      == 该 id 在 `.quay/gate-events.jsonl` 中 `gate=goal` 事件 timestamp 的**最大值**、
      `firstEvidenceAt` == **最小值**。不一致时打印 `(id, 页面值, 账本值)` 三元组清单。
- [x] AC3 时间列不是 mtime（硬规则 4b 的负控制，缺它视为没验）：对某个 goal 文件执行
      `touch`（只改 mtime、不产生任何 gate 事件）后重载 `/goal`，断言该行两个时间列的值**逐字未变**；
      同时断言其 `updatedAt`（mtime）**已变**——两个方向都断言，证明取的不是 mtime。
- [x] AC4 「未记录」是独立取值（硬规则 6：缺值=未查不是为假）：喂一个在账本中无任何事件的记录，
      断言两列渲染出一个可判定的 `未记录` 标记，且**不含任何时间戳、也不等于 `—`**；
      再喂一个有事件但很旧的记录，断言它渲染的是真实时刻而非该标记。两侧都断言。
- [x] AC5 排序是服务端且真的生效：对至少 4 个列各发 `?sort=<col>&dir=asc` 与 `dir=desc` 两次 `curl`，
      断言两次响应体的**首行 id 不同**；并断言响应中不含新增的客户端排序脚本
      （`grep -c "addEventListener"` 相对改动前不增加）。
- [x] AC6 默认序：无 query param 时断言前 8 行的 `kind` **全部为 `goal`**，其后按 `goal` 字段分组连续、
      组内 AC 编号降序。失败时打印实际前 12 行的 `(id, kind, goal)`。
- [x] AC7 取数次数不增反减（M4 的核心判据，能取假）：断言单次 `/goal` 请求中
      `client.goalList` 调用次数 **== 1**（spy 计数，取假：改动前为 **2**）、
      `ledgerEvidenceMap` 调用次数 **== 1**；且 `/goal` 的 p50 响应时间
      **<= 改动前基线**（实测 0.41 / 0.49 / 0.50 s，取中位 0.49s）——**不允许变慢**。
- [x] AC8 AC 达成 rollup 正确且在筛选下不塌成 0（回答硬规则 3b）：断言 `kind:goal` 行显示的
      「达成/总数」与 `renderGoalCard` 对同一份数据算出的值**逐条相等**；
      再加 `?kind=goal` 筛选后**重测一次**，断言数值**与不加筛选时相同**。
      取假：若沿用服务端筛选，加 `?kind=goal` 后全部塌成 `0/0`。
- [x] AC9 `?goal=<id>` 筛选接线（M3）：断言 `curl "/goal?goal=GOAL-008"` 的 `<tr>` 行数
      **严格小于**无筛选时的行数，且返回的每一行 `goal` 列均为 `GOAL-008`（枚举打印不符的行）。
      取假：改动前两者实测**都是 66 行**。并断言列表的 `goal` 列渲染为指向该筛选的链接（UI 入口存在）。
- [x] AC10 详情页同样提供：`/goal/<id>` 上断言两个时间信息存在且与列表页对同一 id 取值相等；
      并断言详情页不再有单个长度 > 400 字符的 `<p class="meta">`（取假：改动前 `/goal/GOAL-008` 实测 1138）。
- [x] AC11 `bash scripts/test.sh --for-task gap-webui-goal-list-sort-and-column-set` 退出码 0。

## Definition of Done

在**真实运行的实例**上截 `/goal`（默认序 + 一次点击列头改序 + 一次 `?goal=` 筛选 + 一次 `?kind=goal` 筛选）与
`/goal/<id>` 两页：列表无 origin 列、行高回到单行量级、两个时间列可读、`kind:goal` 置顶且带「AC 达成 N/M」、
加 `?kind=goal` 后该列**不塌成 0**、点 `goal` 列能只看该 goal 的 AC；
AC1/AC7/AC8/AC9 的前后读数对照（行高 156→<60、表宽 1538→<=870、scrollWidth 1825→1440、
goalList 调用 2→1、p50 0.49s→?、筛选 66→<66）与 AC3 的 `touch` 负控制输出一并贴进提交信息。
**单测绿不算达成。**

## Touches

- `packages/quay/src/serve-goal.ts`
- `packages/quay/src/goal-store.ts`
- `packages/quay/test/gap-webui-goal-list-sort-and-column-set.test.mjs`
- `packages/quay/test/serve-goal-doc.test.mjs`
- `tasks/gap-webui-goal-list-sort-and-column-set.md`
