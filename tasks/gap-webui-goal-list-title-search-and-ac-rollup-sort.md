---
id: gap-webui-goal-list-title-search-and-ac-rollup-sort
title: /goal 列表缺 /tasks 已有的标题搜索，且排序不含 AC 达成率——找特定 goal 只能肉眼扫，按「哪个 goal 离达成最近」也排不了
status: done
labels:
  - gap
  - webui
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**现状（人 2026-09-24 对比 `/tasks` 与 `/goal` 两页）**：`/tasks` 有前缀/状态过滤、排序与标题搜索框；`/goal` 只有 status 过滤与既有的 `sort`/`dir` 参数（`handleGoalList` 已读取，列头链接可点），**没有搜索**；可排序列集里也**没有 AC 达成**——该列是渲染时由完整 `all` 数组现算的 rollup（`renderGoalsTable` 内的 `rollupFor`，口径 `isAcRollupCounted`），不在 store 行上，所以 store 层排序够不到它。

<!-- dedup-ref -->相关（不同机制、已完成）：`gap-webui-goal-list-sort-and-column-set` 建立了 sort/dir 参数与「一次 goalList()」不变式；本任务在其之上加搜索与 rollup 排序，不改 store 层排序。

**方案**：
a) `?q=` 大小写不敏感子串搜索：Goals 页签匹配 goal id + title；Criteria 页签匹配 AC id + title + 所属 goal id。搜索框复用 `/tasks` 的表单结构与 i18n 词条；列头排序链接与 status 过滤链接都保留 `q`。不加分页（27 个 goal / 178 条 AC）。
b) 「AC 达成」列可排序（`?sort=acRollup`）：在 handler 内、rollup 算出之后按 `achieved/total` 比值排序，**复用列渲染同一个 `rollupFor`/`isAcRollupCounted`，不复制第二份口径**；`total=0`（0/0，即「无 AC」，不是 0%）无论 asc/desc 都排最后（硬规则 3：无法评估不与 0% 共用取值）。
c) 保持既有 AC6 不变式：每个请求仍只调用一次 `goalList()`。
d) 搜索无匹配时渲染明确的「无匹配」空态，区别于「一个 goal 都没有」的空态。

## AC

- [x] `node --experimental-strip-types --test packages/quay/test/gap-webui-goal-list-title-search-and-ac-rollup-sort.test.mjs` exit 0：fixture 含 ≥3 个 goal、其中恰 1 条 title 含目标片段；`/goal?q=<片段>` 行数 = 手算的 1；`q` 大小写不敏感；Criteria 页签按 AC id 与所属 goal id 也能命中（先打印前 3 行实际内容再引用计数）。
- [x] 同一测试：`q` 无匹配时渲染「无匹配」空态，文案与「0 个 goal」空态不同；`q` 与 `status` 过滤是 AND；列头排序链接与 status 过滤链接的 href 都保留 `q=`（逐个断言 href）。
- [x] 同一测试：`?sort=acRollup&dir=desc` 与 `dir=asc` 的行序都等于 fixture 手算顺序，`total=0` 的行两种方向都排最后；`0/0` 行不被当作 0%。
- [x] `node --experimental-strip-types --test packages/quay/test/gap-webui-goal-list-tab-split-goal-ac.test.mjs packages/quay/test/gap-webui-goal-list-sort-and-column-set.test.mjs packages/quay/test/serve-goal-zh-chrome.test.mjs` exit 0（含每请求一次 `goalList()` 的既有 spy 断言）；zh 页搜索框 placeholder/按钮/空态走 serve-i18n 词条。

## DoD

在运行中的生产 `/goal` 上真实操作：搜索一个已知存在的 goal id 片段与一个不存在的串，贴两次结果（行数 ≥1 与「无匹配」空态）；`?sort=acRollup&dir=desc` 的首行 id 与从 `/goal` 现有 AC 达成列手算的最大比值行一致。fixture 断言只是必要而不充分。

**DoD 读数（2026-09-24，真实 205 条 goal 记录，证据全文 `.quay/gap-goal-list-search-dod/evidence.md` 与可重跑探针 `dod-probe.mjs`）**：实例 = 本任务 worktree 里 `quay.ts serve --host 127.0.0.1 --port 28311`，其 `goals/` 与主检出 `diff -rq` **完全相同**（逐字节），即与运行中的生产 daemon（pid 2035152，cwd = 主检出 = 改动前代码）**同一批** 27 个 goal / 178 条 AC。
- ① `?q=GOAL-02` → **8 行**（`GOAL-020 7/8`、`GOAL-022 3/4`、`GOAL-026 0/0`、`GOAL-027 0/0`、`GOAL-021 3/3` …）。
- ② `?q=zzz-no-such-goal-xyz` → **0 行**，空态 = `No matches for “zzz-no-such-goal-xyz” clear the search`（与同一页上并存的两个「待裁定」banner 是不同句子）。
- ③ `?sort=acRollup&dir=desc` 首行 = `GOAL-001 (11/11)`；从 `/goal` 现有 AC 达成列手算的最大比值行 = `GOAL-001 (11/11 = 1.0000)` —— **一致**。`dir=asc` 首行 = `GOAL-022 (3/4 = 0.75)`；两种方向的末尾三行都是那批 `0/0`（`GOAL-004`/`GOAL-005`/`GOAL-006`/`GOAL-026`/`GOAL-027`），即「无 AC」不被当成 0%。
- 负控制：对运行中的生产 daemon 只读探测 `/goal`（27 行）—— `name="q"` 计数 = 0、`sort=acRollup` 计数 = 0；同一批记录在本 worktree 实例上 = 1、1。

## Touches

- packages/quay/src/serve-goal.ts
- packages/quay/src/serve-i18n.ts
- packages/quay/test/gap-webui-goal-list-title-search-and-ac-rollup-sort.test.mjs
- packages/quay/test/gap-webui-goal-list-tab-split-goal-ac.test.mjs
- packages/quay/test/gap-webui-goal-list-sort-and-column-set.test.mjs
- packages/quay/test/serve-goal-zh-chrome.test.mjs
- tasks/gap-webui-goal-list-title-search-and-ac-rollup-sort.md
