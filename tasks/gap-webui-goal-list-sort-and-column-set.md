---
id: gap-webui-goal-list-sort-and-column-set
title: /goal 的列集合与排序：origin 散文列（中位 191/max 2775 字符）占 394px 把行高顶到
  156px，而账本已算出的时刻一列都没渲染；排序写死在 store 层 goal-store.ts:337 的 id 字典序、显示层无任何入口；?goal=
  筛选一路支持到 store 却在 handler 处被丢弃
status: todo
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
并在看过实测数据后逐条裁定。本任务承接前三点中的**前两点半**（列集合 + 排序 + 时间列，列表页与详情页）；
第四点（任务统计）因取数路径与代价约束完全不同，另立
`gap-webui-goal-task-rollup-via-shared-summary-cache`。

**人的裁定（2026-09-08，逐条）**：
① origin **直接从列表页删掉**（详情页 `serve-goal.ts:141` 的 `origin:` 一行保留）；
② 时间语义**只上 `lastProgressAt` + `firstEvidenceAt`**，两者都从账本派生，**不用 mtime**；
③ 详情页也要提供同样的时间信息。

**机制（三个，全部落在同两个文件内，故合为一条）**：

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

**M2 — 排序写死在 store 层，显示层无入口。** `goal-store.ts:337` 是
`.sort((a, b) => String(a.id).localeCompare(String(b.id)))`，硬编码 id 字典序；
`serve-goal.ts` 里 `sort` / `orderBy` / `localeCompare` **零命中**，页面上没有任何排序控件。
后果是 8 条 `kind: goal` 散落在 57 条 `kind: criterion` 之间（AC-143、AC-144…GOAL-001…AC-150），
而 `/board` 同页族已有服务端筛选（`serve-render.ts:656 buildHref()`）却也没有排序。

**M3 — `goal` 筛选一路支持到 store，却在 handler 处被丢弃（2026-09-08 人报「详情页看不到 AC」时连带查出）。**
`goal-store.ts:338` 有 `.filter(g => filter.goal ? g.goal === filter.goal : true)`，
ABI `goalList(filter: Record<string, unknown>)`（`provider-client.ts:171`）原样透传，
**而 `handleGoalList` 只从 query string 读 `status` 与 `kind`**（`serve-goal.ts` 的
`url.searchParams.get("status")` / `("kind")`），从不读 `goal`。
实测 `curl "/goal?goal=GOAL-008"` 与 `curl "/goal"` **都返回 66 行**——参数被静默忽略。
这与 M1/M2 同族：**能力早已存在，只差显示层最后一跳没接**。它也是当前「想看某个 goal 的 AC 清单」
唯一可能的绕法，接上后即便详情页的 AC 区块尚未落地（`gap-webui-goal-detail-no-entity-links`），
人也有办法把一个 goal 的 AC 全部列出来。

**⚠️ 时间语义的坑（这条必须照做，否则做出来是个会说谎的列）**：
goal/AC 的 frontmatter **没有 `createdAt`**；store 暴露的 `updatedAt` 是
`fs.statSync(p).mtimeMs`（`goal-store.ts:322`）——**文件 mtime**。而 `goal-store.ts:32-34` 的 SPEC 注释已明令：

> `lastProgressAt` = 其 ACs 在 `.quay/gate-events.jsonl` 里的最近 goal-gate 事件时刻（DERIVED never stored）
> —— **NEVER the goal's own `updatedAt`（硬规则 4b：被测对象自己产生的量不能用来判断它自己）**

一次重排版、一次 driver 改写都会让 mtime «变新» 而 goal 毫无进展。**故两列都取账本，不取 mtime。**

**代价：零额外 I/O（已核实，非估计）**。`ledgerEvidenceMap`（`goal-store.ts:105`）在 `list()` 的第一行
（`:327`）每请求调用一次，实测解析 `.quay/gate-events.jsonl`（**6.87MB / 29,856 行，其中 gate=goal 29,471 条**）
耗时 **183ms**，已包含在 `/goal` 当前的 0.60–0.75s 里。其循环 `:121` 只做 `map.set(id, {at, verdict, reading})`
（后写覆盖 ⇒ 保留最后一条）；`firstEvidenceAt` 只需**在同一趟循环里多留一个 min 字段**，
不增加任何一次读盘。

**修法方向**：

1. 列表页删 `origin` 列（`serve-goal.ts:67`）；详情页的 origin 改为独立区块而非 `<p class="meta">`；
2. `ledgerEvidenceMap` 的 value 增加 `firstAt`（同一趟循环取 min），view-model 暴露
   `lastProgressAt` / `firstEvidenceAt`；列表页各加一列（相对时间 + `title` 挂绝对时刻），详情页同样两行；
3. 排序在 **handler 侧**做（65 条，重排成本可忽略），读 `?sort=<col>&dir=<asc|desc>` query param，
   复用 `serve-render.ts:656 buildHref()` 的形态，零客户端 JS；**不给 store 的 `list()` 加排序参数**
   ——排序是显示关切，不该长进 Provider ABI；`goal-store.ts:337` 的硬编码 sort 保留为稳定的默认输入；
4. `handleGoalList` 补读 `goal` query param 并透传给 `client.goalList`，列表的 `goal` 列渲染成
   指向 `/goal?goal=<id>` 的链接（UI 入口）；
5. 默认序改为 `kind:goal` 置顶 → 其后按 `goal` 分组 → 组内 AC 编号降序。

**已知同文件重叠（按 memory `dispatch-order-by-touches-overlap-direction` 钉死顺序）**：
`gap-webui-goal-detail-no-entity-links`（本任务 `depends_on` 它）在详情页引入「本 goal 的 criterion 列表」区块，
本任务的时间信息要挂在那个区块的行上——**反序会让本任务先造一个它随后要重写的列表**；
下游 `gap-webui-goal-task-rollup-via-shared-summary-cache` 与
`gap-webui-list-table-no-overflow-container` 均 `depends_on` 本任务（后者要钳制的散文列在此被删掉，
反序等于先给一个即将删除的 `<td>` 加 max-width）。

## Acceptance Criteria

- [ ] AC1 origin 已删且排版恢复（生产载体读数）：加载 `/goal`，断言表头**不含** `origin`、
      表格最大行高 **< 60px**、表格总宽 <= `<main>` 容器宽、`documentElement.scrollWidth == clientWidth`。
      取假：改动前实测行高 109/156px、表宽 1538 > 870、`scrollWidth 1825 vs 1440`。
- [ ] AC2 两个时间列确为账本派生（能取假）：对任取 3 条有 verdict 的 AC，断言页面渲染的 `lastProgressAt`
      == 该 id 在 `.quay/gate-events.jsonl` 中 `gate=goal` 事件 timestamp 的**最大值**、
      `firstEvidenceAt` == **最小值**。不一致时打印 `(id, 页面值, 账本值)` 三元组清单。
- [ ] AC3 时间列不是 mtime（硬规则 4b 的负控制，缺它视为没验）：对某个 goal 文件执行
      `touch`（只改 mtime、不产生任何 gate 事件）后重载 `/goal`，断言该行两个时间列的值**逐字未变**；
      同时断言其 `updatedAt`（mtime）**已变**——两个方向都断言，证明取的不是 mtime。
- [ ] AC4 「未记录」是独立取值（硬规则 6：缺值=未查不是为假）：喂一个在账本中无任何事件的记录，
      断言两列渲染出一个可判定的 `未记录` 标记，且**不含任何时间戳、也不等于 `—`**；
      再喂一个有事件但很旧的记录，断言它渲染的是真实时刻而非该标记。两侧都断言。
- [ ] AC5 排序是服务端且真的生效：对至少 4 个列各发 `?sort=<col>&dir=asc` 与 `dir=desc` 两次 `curl`，
      断言两次响应体的**首行 id 不同**；并断言响应中不含新增的客户端排序脚本
      （`grep -c "addEventListener"` 相对改动前不增加）。
- [ ] AC6 默认序：无 query param 时断言前 8 行的 `kind` **全部为 `goal`**，其后按 `goal` 字段分组连续、
      组内 AC 编号降序。失败时打印实际前 12 行的 `(id, kind, goal)`。
- [ ] AC7 零额外 I/O（回答「代价」那一段，能取假）：断言单次 `/goal` 请求中 `ledgerEvidenceMap` 的调用次数
      **仍为 1**（可用计数器或 spy），且 `/goal` 的 p50 响应时间 <= **改动前基线 + 50ms**
      （改动前实测 0.60 / 0.75 / 0.60 s，取三次中位 0.60s）。
- [ ] AC8 详情页同样提供：`/goal/<id>` 上断言两个时间信息存在且与列表页对同一 id 取值相等；
      并断言详情页不再有单个长度 > 400 字符的 `<p class="meta">`（取假：改动前 `/goal/GOAL-008` 实测 1138）。
- [ ] AC9 `?goal=<id>` 筛选接线（M3）：断言 `curl "/goal?goal=GOAL-008"` 的 `<tr>` 行数
      **严格小于**无筛选时的行数，且返回的每一行 `goal` 列均为 `GOAL-008`（枚举打印不符的行）。
      取假：改动前两者实测**都是 66 行**。并断言列表的 `goal` 列渲染为指向该筛选的链接（UI 入口存在）。
- [ ] AC10 `bash scripts/test.sh --for-task gap-webui-goal-list-sort-and-column-set` 退出码 0。

## Definition of Done

在**真实运行的实例**上截 `/goal`（默认序 + 至少一次点击列头改序 + 一次 `?goal=` 筛选结果）与
`/goal/<id>` 两页：列表无 origin 列、行高回到单行量级、两个时间列可读、`kind:goal` 置顶、
未记录态显式可辨、点 `goal` 列能只看该 goal 的 AC；
AC1/AC7/AC9 的前后读数对照（行高 156→<60、表宽 1538→<=870、scrollWidth 1825→1440、
p50 0.60s→?、筛选 66→<66）与 AC3 的 `touch` 负控制输出一并贴进提交信息。**单测绿不算达成。**

## Touches

- `packages/quay/src/serve-goal.ts`
- `packages/quay/src/goal-store.ts`
- `packages/quay/test/gap-webui-goal-list-sort-and-column-set.test.mjs`
- `tasks/gap-webui-goal-list-sort-and-column-set.md`
