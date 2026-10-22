---
id: gap-dashboard-snapshot-store-encapsulate-state
title: serve-dashboard + serve-board 的 snapshot/cache 状态散成 9 个模块级 Map + 2 钩子 + 6
  个 clear 自由函数——收进一个 class DashboardSnapshotStore（私有字段 + 生命周期 + 显式单例）
status: ready
labels:
  - gap
  - defect
  - meta
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**事实一（状态簇清单，2026-10-22 实测）**：`packages/quay/src/serve/serve-dashboard.ts` 与
`serve-board.ts` 各自持有一组模块级可变状态，散成自由函数：
- dashboard：`taskSummaryCache` / `dashboardLiveCache` / `dashboardSysCache` / `dashboardMgrLightCache` /
  `dashboardSnapshots` / `dashboardSnapshotRebuilds` / `dashboardSnapshotFollowUps`（7 个 Map）+
  `dashboardSnapshotStepHook`（1 个 `let` 钩子）+ `clearTaskSummaryCache()` / `clearDashboardLiveCache()` /
  `clearDashboardProbeCache()` / `clearDashboardSnapshots()` / `setDashboardSnapshotStepHook()`（5 个
  散落的生命周期函数）。
- board：`boardSnapshots` / `boardSnapshotRebuilds`（2 个 Map）+ `boardSnapshotStepHook`（1 个钩子）+
  `clearBoardSnapshots()` / `setBoardSnapshotStepHook()`。
- 生命周期证据：`dashboardSnapshotRebuilds` / `dashboardSnapshotFollowUps` 有 `.delete()`（rebuild 完成
  后清理）；四个 cache 带 `{at: 时间戳}` TTL——这就是「隐式生命周期」，却没有任何对象把它收拢。

**事实二（为什么这是封装问题，不是风格偏好）**：这正是用户 2026-10-22 裁定的处方——「真正的封装 =
  把散落的属性（状态）+ 方法（行为）收进类，让它们有一致的生命周期」。quay 已经跑通过一次先例：
  `plugin/scripts/worker-pool.ts` 的 `class WorkerPool` 把 retry/backoff 状态收成 `#retryState` /
  `#backoffState` 私有字段。dashboard/board 这一坨是下一个同款靶子：**状态散在模块级、clear 散成自由
  函数、钩子是 `let`**，三样本该是一个对象的私有字段 + 方法。

**事实三（同族检查，硬规则 5b）**：`grep -rEn '^(const|let) [A-Za-z_$]+ = new (Map|Set)' packages/quay/src`
  命中里，除本任务的两个文件外，被 `.set()/.add()/.delete()` 修改的还有 `codeRevCache`（task-transition，
  memoized）、`heldLockPaths`（frontmatter-store-base，锁跟踪 add/delete）、`cachedSink`（config/loader）、
  `driverRuntimePromise`（observation）。这些是 memoized cache / 锁跟踪，生命周期更简单，**不在本任务**
  （单列观察，见「非目标」），避免一次改动拖进四个文件。

## Plan

1. **抽一个类**：新增 `packages/quay/src/serve/snapshot-store.ts`，`class DashboardSnapshotStore`：
   - 私有字段收下 9 个 Map + 2 个钩子（`#taskSummaryCache` / `#liveCache` / `#sysCache` /
     `#mgrLightCache` / `#snapshots` / `#rebuilds` / `#followUps` / `#stepHook`，board 与 dashboard 各持
     自己的一份实例，不共享）；
   - 显式生命周期方法：`clear()`（一次性清 cache + snapshots + rebuilds + followUps）、`setStepHook()`、
     `snapshot()`（读写快照的入口）、`rebuild()`（rebuild 的 promise 去重与清理）、`followUp()`；
   - `clearTaskSummary()` / `clearLive()` 等细粒度清理由一个 `clear()` 的命名参数或独立方法覆盖，**不再有
     模块级自由 `clearXxx()` 函数**。
2. **显式单例 + 可注入**：`export const dashboardSnapshotStore = new DashboardSnapshotStore()` 与
   `boardSnapshotStore`；模块内需要隔离测试时通过参数注入实例（不靠 `let` 重绑定）。
3. **两个文件改成消费者**：`serve-dashboard.ts` / `serve-board.ts` 删除各自的模块级 Map/钩子/clear 函数，
   改为 `import { dashboardSnapshotStore / boardSnapshotStore }` 调用其方法。
4. **判据（对方 2026-10-22 提供的 (a)-(e) 模板，逐条落地为 AC）**：
   - (a) 模块级可变状态 = 0（`let`/`var` 与「被修改的 `const Map/Set`」都归零）；
   - (b) `class DashboardSnapshotStore` 存在、有显式生命周期方法；
   - (c) 导出显式单例或可注入；
   - (d) 既有行为判据不改一字仍绿（serve 路由、dashboard/board 渲染、快照 rebuild 语义不变）；
   - (e) tsc/typecheck。
5. **非目标**：`codeRevCache` / `heldLockPaths` / `cachedSink` / `driverRuntimePromise`（memoized cache /
   锁跟踪，生命周期简单）；`gateRegistry`（已封装注册表，别误伤）；`integration-batch-merge.ts` 的
   CLI-flag globals（那是「argv→options 对象」另一类，不是状态簇）。

## Acceptance Criteria

- [ ] AC1（判据 a）私有化归零：`grep -rEn '^(let|var) ' packages/quay/src/serve/serve-dashboard.ts packages/quay/src/serve/serve-board.ts` 输出 0 行，且 `grep -rEn '^(const) [A-Za-z_$]+ = new (Map|Set)'` 在这两个文件里**没有**被 `.set()/.add()/.delete()` 修改的命中；贴两个 grep 的完整输出。
- [ ] AC2（判据 b）类存在：`grep -n 'class DashboardSnapshotStore' packages/quay/src/serve/snapshot-store.ts` 命中 1 行，且该类含 `clear` / `setStepHook` / `snapshot` / `rebuild` / `followUp` 方法（`grep -nE '  (clear|setStepHook|snapshot|rebuild|followUp)\(' packages/quay/src/serve/snapshot-store.ts` ≥5 行）；贴这两段 grep。
- [ ] AC3（判据 c）显式单例或可注入：`grep -n 'export const .*SnapshotStore = new' packages/quay/src/serve/snapshot-store.ts` ≥1 行，且构造可注入实例用于测试；贴命中行与一条注入用法。
- [ ] AC4（判据 d）行为不变：两个文件删除模块级状态后，`scripts/test.sh` 的 serve 相关测试（scoped）全绿；贴 `node --test` 输出尾部与通过数。**不得为通过而改任何一条既有断言**（若改了，列出改了什么并说明为何，否则视为失败）。
- [ ] AC5（判据 e）类型检查：`tsc`（按仓库既有 typecheck 入口）对改动的三个文件通过；贴输出。
- [ ] AC6 无残留：`grep -rn 'taskSummaryCache\|dashboardLiveCache\|dashboardSnapshots\|boardSnapshots\|clearBoardSnapshots\|clearDashboardSnapshots' packages/quay/src/serve/serve-dashboard.ts packages/quay/src/serve/serve-board.ts` 只出现在 `import`/方法调用处、不再有模块级声明或散落的自由 clear 函数；贴命中行与前 3 条内容。
- [ ] AC7 语义等价（快照生命周期）：rebuild 去重与 follow-up 清理的语义保持（同一时刻只一个 rebuild promise、完成后从 Map 删除）；用 fixture 断言 `.delete()` 仍在正确的时机发生；贴 fixture 与断言。

## Definition of Done

- `serve-dashboard.ts` / `serve-board.ts` 的模块级可变状态（Map/钩子/clear 自由函数）全部收进
  `DashboardSnapshotStore`，两个文件只消费、不再持有。
- 判据 (a)-(e) 五条全绿，且 AC4 证明行为判据没改一字仍绿（这是「封装不动行为」的硬证据，不是口头声明）。
- 非目标清单（codeRevCache 等四件）保持不动，本任务不把它们拖进来。

## Touches

- packages/quay/src/serve/snapshot-store.ts
- packages/quay/src/serve/serve-dashboard.ts
- packages/quay/src/serve/serve-board.ts
- packages/quay/test/snapshot-store.test.mjs
- tasks/gap-dashboard-snapshot-store-encapsulate-state.md