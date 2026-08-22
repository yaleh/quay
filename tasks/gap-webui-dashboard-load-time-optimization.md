---
id: gap-webui-dashboard-load-time-optimization
title: webui dashboard 加载慢优化（manager 探针轻量化砍 pool 地板 + taskList 并行 + 任务摘要 30s TTL 缓存）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：manager 投立案草稿（人反馈 dashboard 打开仍几十秒，已读代码定位根因链，人核实数据同意投递）。

**证据链（读代码实测）**：`handleDashboard`（`serve-handlers.ts:2542`）执行链：`readLive()`（快）→ `Promise.all([readSystem(), readManager()])`（:2556 已并行）→ `readTests()`（同步串行）→ `readGitHistory()`（同步串行）→ `client.taskList({includeBody:false})`（:2574 串行）。

**① manager 地板 = slot-refill 探针（~9s，最贵）**：`observation.ts:1223` 注释已写死根因——cold-calling slot-refill 每 run 都 `--experimental-strip-types` 重 strip 整 import graph。已有 30s TTL（`:1212 SLOT_REFILL_CACHE_TTL_MS=30_000`），冷时仍付 ~9s。

**② dashboard 的 mgrCard 不展示 slot-refill 数据**（`serve-handlers.ts:2470-2475`）：只用 `loopDriver.verdict` + 存活会话数，`pool/floor/deficit/cap` 一个字段都没上卡片——为一份自己不展示的数据付最贵代价。`readManager`（`observation.ts:1272`）四探针并行，但被 pool 拖底。

**③ taskCard 只显示状态计数 + 最近 5 条，却全量遍历 1368 个任务文件**（`serve-handlers.ts:2477/2489`）。`taskList` 底层 `listIds()`（`store.ts:466`）+ `walkTasks()`（`:852` 逐 id `get()` = readFileSync+statSync+YAML.parse），无缓存，每次 `/dashboard`/`/tasks` 全量重扫。任务数本次会话内 1309→1368，只会继续涨。

**④ taskList 排在 sys/mgr Promise.all 之后串行**，但互相独立，本可并行——AC2 并行化没覆盖到它。

**为什么 inner 执行**：改 `packages/quay/src/` + `packages/quay-native/src/`（产品 web 代码）→ inner 域。

## Plan

按人优先级（先砍不看的，再缓存常看的）：
1. **① dashboard 轻量 manager 探针**：mgrCard 只要 `loopDriver.verdict` + 存活会话数，不要 pool——slot-refill 探针限定 `/manager` 详情页才调用，dashboard 走不含 pool 的轻量路径（砍 ~9s 地板）。
2. **② taskList 并入并行组**：和 sys/mgr 一起 `Promise.all`，不等它们完事再串行读。
3. **③ 任务摘要短 TTL 缓存**：复用 `slotRefillCache` 范式（30s TTL 按 workspaceRoot 分桶），给「状态计数 + 最近 5 条」缓存，避免每次全量重扫 1368 文件。
4. **④ readTests 验证非瓶颈**（验证性质，不优先动——它最贴合人需求「关心运行的 suite 测试」）。

## Acceptance Criteria

- [ ] AC1：dashboard 的 manager 探针不再 cold-call slot-refill（轻量路径只 loopDriver + 存活会话），`/manager` 详情页仍走含 pool 的完整探针。
- [ ] AC2：taskList 与 sys/mgr 并行（`Promise.all`），不再串行接在其后。
- [ ] AC3：任务摘要（状态计数 + 最近 5 条）有 30s TTL 缓存，命中时不全量重扫任务文件（可机械核：缓存命中时 `walkTasks` 不执行）。
- [ ] AC4：readTests 确认非 dashboard 主要瓶颈（实测，非断言）。

## Definition of Done

- [ ] dashboard 加载路径砍掉 slot-refill 地板 + taskList 并行 + 摘要缓存；AC1-4 全勾；land 到 develop。

## Touches

- packages/quay/src/serve-handlers.ts（handleDashboard：readManagerLight + readTaskSummary 并入 Promise.all；readTaskSummary 30s TTL 缓存）
- packages/quay/src/observation.ts（新增 readManagerLight 轻量路径）
- packages/quay/test/gap-dashboard-parallelize.test.mjs（AC1/AC2/AC3 结构+行为测试更新与新增）
- tasks/gap-webui-dashboard-load-time-optimization.md（自身）

> Touches 扩充说明：任务摘要缓存落在 Core serve 层（serve-handlers.ts 的 readTaskSummary，缓存 client.taskList 结果），
> 故 `packages/quay-native/src/store.ts` 未改动（provider 的 walkTasks 在缓存命中时根本不会被调用，无需在 store 内加缓存）。
