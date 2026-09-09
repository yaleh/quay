---
id: gap-webui-tests-page-timeline-gantt-truncated
title: /tests 页「测试时间线」甘特图硬编码 TIMELINE_MAX_BARS=50，超过 50 个文件的轮次只画最慢 50 个，其余不可见
status: done
labels:
  - gap
  - webui
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**来源**：人 2026-09-09 走查 `/tests` 页后提出「怀疑测试时间线未显示这轮测试的所有测试文件」，经排查确认属实。

**现状（2026-09-09 对当前代码实测，非目测）**：`/tests` 页「测试时间线」甘特图由
`renderPerFileTimelineSvg()`（`packages/quay/src/serve-tests.ts:496-589`）渲染，数据源是
`.quay/verification-round.jsonl` 该轮记录的 `perFile` 字段（全泳道 static/serial/lowconc/main 汇总，
字段本身完整，非本任务的问题）。但渲染函数内部硬编码：

```ts
// serve-tests.ts:487
const TIMELINE_MAX_BARS = 50;
```

并在 `:503-509` 先按 `durationMs` 降序取**最慢的 50 个文件**，再按 `startedAtMs` 升序重排作图；
其余文件（当一轮 `perFile.length > 50` 时，多出的部分）**完全不出现在这张 SVG 里**——图上没有任何空白
或占位提示"这里本该有一条但被删掉了"，只有标题文字追加一句「仅显示最慢 N / M 个文件」（`:587`）说明
发生了截断。截断的选取标准是"最慢"而不是"时间窗口"，所以被丢弃的通常是大量运行很快的文件，时间线在
视觉上出现"稀疏/跳跃"的假象，与"完整时间线"的直觉不符。

该行为是 `gap-webui-tests-page-unpaginated-tables`（done）落地时**有意为之**的设计——那个任务量化过
「288 个文件 → 119,381 字节 SVG」的传输量问题，但它的验收范围（AC4 的 `grep -rn "<table"` 枚举）明确
只覆盖 `<table>` 元素，没有覆盖这张 `<svg>` 甘特图，所以甘特图从未被纳入"哪些视图已接分页"的枚举——是
硬规则 5b「修好一处不等于只有一处」的又一实例：分页原语（`serve-render.ts` 的 `DEFAULT_PAGE_SIZE`/
`buildHref`）已经用于同页下方的 `perFile` 明细表（`renderPerFileTable`，独立的 `?perFilePage`/
`?perFilePageSize` 命名空间），却没有接到时间线图上。

**修法方向**：给时间线图接上与 `perFile` 表同构的服务端分页（独立的 query-param 命名空间，例如
`?ganttPage`/`?ganttPageSize`，默认 pageSize 维持 `TIMELINE_MAX_BARS` 现有的 50 这个量级，以保留原
任务解决的传输量问题），但分页依据改为**按 `startedAtMs` 升序切片**（保持时间线本身的时间语义），
而不是当前"先取最慢 50、再按时间重排"的选取方式——这样翻到最后一页时，用户能看到本轮**全部**测试
文件的起止时刻，而不是只有最慢的一个子集。默认首页展示最早开始的一批文件（与 `perFile` 表默认按
耗时降序不同，两者排序目的不同，各自保留互不影响）。

## Acceptance Criteria

- [x] AC1 取假对照：对一个 `perFile.length > 50` 的真实/构造轮次，加载 `/tests`，断言改动前 SVG
      （`aria-label="Per-file test timeline (gantt)"`）内 `<rect` 元素个数 **< 该轮 perFile 中同时
      具备 `startedAtMs`/`endedAtMs` 的条目数**（复现"部分文件不可见"）；改动后，翻遍全部分页页面，
      `<rect>` 元素总数之和 **等于** 该条目数。
- [x] AC2 分页控件存在且可用：时间线图区域出现 `Page size` 档位链接与 `Next »` 链接（独立 query-param
      命名空间，不与既有 `page`/`perFilePage` 冲突）；点击 `Next »` 后断言当前页第一根 bar 对应的
      文件名与翻页前不同。
- [x] AC3 时间语义保留：断言每一页内的 bar 按 `startedAtMs` 升序排列；断言跳到最后一页时，该页最后
      一根 bar 的 `endedAtMs` 等于该轮 perFile（含时间戳的条目）里的全局最大值（证明分页切的是完整
      时间轴的尾段，不是仍然按耗时过滤后的子集）。
- [x] AC4 单页字节预算不劣化：断言默认 pageSize 下单次响应体中该 `<svg>` 片段字节数 **< 30,000**
      （对照 `gap-webui-tests-page-unpaginated-tables` 量化的"288 文件 119,381 字节"问题不能重演）。
- [x] AC5 标题文字不再是"仅显示最慢 N/M"这类暗示"其余不可见"的措辞，改为准确反映当前页范围，例如
      "第 X/Y 页 · 本页 A–B / 共 N 个文件"；断言渲染出的标题字符串不含"仅显示最慢"。
- [x] AC6 `bash scripts/test.sh --for-task gap-webui-tests-page-timeline-gantt-truncated` 退出码 0。

## Definition of Done

在真实运行的实例上打开 `/tests`（选一轮 `perFile.length > 50` 的真实数据），翻到时间线图的最后一页，
截图证明能看到本轮最晚结束的那个文件的 bar；同时贴上 AC1 的"改动前 `<rect>` 数 < 总数、改动后翻遍
全部分页后 `<rect>` 总数 = 总数"这组前后对照读数。**"加了分页函数 + 单测绿"不算达成，必须是真实实例
上的读数对照。**

## Touches

- packages/quay/src/serve-tests.ts
- packages/quay/test/gap-webui-tests-page-timeline-gantt-truncated.test.mjs
- packages/quay/test/gap-webui-tests-page-unpaginated-tables.test.mjs
- tasks/gap-webui-tests-page-timeline-gantt-truncated.md

## Evidence

- 真实实例 round 1363（565 个含 `startedAtMs`/`endedAtMs` 的 perFile 条目，> 50）上 `/tests?round=1363`：
  改动前只画最慢 50 根 bar；改动后翻遍 12 页（50×11 + 15），`<rect>` bar 总数 = 565 = 该轮 timed 总数。
- 最后一页（第 12 页）最后一根 bar = `plugin/test/obligation-ledger-check.test.mjs`，其 `endedAtMs` 为该轮全局最大值。
- 截图：`gantt-timeline-last-page-round1363.png`（第 12/12 页 · 本页 551–565 / 共 565 个文件）。