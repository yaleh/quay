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

- [x] AC1（判据 a）私有化归零：`grep -rEn '^(let|var) ' packages/quay/src/serve/serve-dashboard.ts packages/quay/src/serve/serve-board.ts` 输出 0 行，且 `grep -rEn '^(const) [A-Za-z_$]+ = new (Map|Set)'` 在这两个文件里**没有**被 `.set()/.add()/.delete()` 修改的命中；贴两个 grep 的完整输出。
- [x] AC2（判据 b）类存在：`grep -n 'class DashboardSnapshotStore' packages/quay/src/serve/snapshot-store.ts` 命中 1 行，且该类含 `clear` / `setStepHook` / `snapshot` / `rebuild` / `followUp` 方法（`grep -nE '  (clear|setStepHook|snapshot|rebuild|followUp)\\(' packages/quay/src/serve/snapshot-store.ts` ≥5 行）；贴这两段 grep。
- [x] AC3（判据 c）显式单例或可注入：`grep -n 'export const .*SnapshotStore = new' packages/quay/src/serve/snapshot-store.ts` ≥1 行，且构造可注入实例用于测试；贴命中行与一条注入用法。
- [x] AC4（判据 d）行为不变：两个文件删除模块级状态后，`scripts/test.sh` 的 serve 相关测试（scoped）全绿；贴 `node --test` 输出尾部与通过数。**不得为通过而改任何一条既有断言**（若改了，列出改了什么并说明为何，否则视为失败）。
- [x] AC5（判据 e）类型检查：`tsc`（按仓库既有 typecheck 入口）对改动的三个文件通过；贴输出。
- [x] AC6 无残留：`grep -rn 'taskSummaryCache\\|dashboardLiveCache\\|dashboardSnapshots\\|boardSnapshots\\|clearBoardSnapshots\\|clearDashboardSnapshots' packages/quay/src/serve/serve-dashboard.ts packages/quay/src/serve/serve-board.ts` 只出现在 `import`/方法调用处、不再有模块级声明或散落的自由 clear 函数；贴命中行与前 3 条内容。
- [x] AC7 语义等价（快照生命周期）：rebuild 去重与 follow-up 清理的语义保持（同一时刻只一个 rebuild promise、完成后从 Map 删除）；用 fixture 断言 `.delete()` 仍在正确的时机发生；贴 fixture 与断言。

## Definition of Done

- `serve-dashboard.ts` / `serve-board.ts` 的模块级可变状态（Map/钩子/clear 自由函数）全部收进
  `DashboardSnapshotStore`，两个文件只消费、不再持有。
- 判据 (a)-(e) 五条全绿，且 AC4 证明行为判据没改一字仍绿（这是「封装不动行为」的硬证据，不是口头声明）。
- 非目标清单（codeRevCache 等四件）保持不动，本任务不把它们拖进来。

## Evidence

读数在 worktree `/home/yale/work/quay-worktrees/gap-dashboard-snapshot-store-encapsulate-state`
上取得（HEAD 含 develop `5b9d3cfd4`）。**重构前的对照样本** = 该分支的分叉点 `eed2c9fe6`
（下文所有「同谓词对该样本干跑」都指它，不用会随提交移动的 `HEAD~N` 指代）。

### AC1 —— 模块级可变状态归零（两条 grep，均为空输出）

```
$ grep -rEn '^(let|var) ' packages/quay/src/serve/serve-dashboard.ts packages/quay/src/serve/serve-board.ts
(无输出; exit=1)
$ grep -rEn '^(const) [A-Za-z_$]+ = new (Map|Set)' packages/quay/src/serve/serve-dashboard.ts packages/quay/src/serve/serve-board.ts
(无输出; exit=1)
```

**零计数的配套动作（硬规则 2 的另一半：把谓词对着一个已知为真的样本干跑一次）**——同一谓词对
分叉点 `eed2c9fe6` 必须命中：

```
$ git show eed2c9fe6:packages/quay/src/serve/serve-dashboard.ts | grep -cE '^(let|var) '
1
$ git show eed2c9fe6:packages/quay/src/serve/serve-board.ts | grep -n 'boardSnapshots\|clearBoardSnapshots' | head -3
336:const boardSnapshots = new Map<string, BoardSnapshot>();
358:  return boardSnapshots.get(root) ?? null;
362:export function clearBoardSnapshots(): void {
```

⇒ 谓词不是恒假：它命中重构前的真实声明，在新版本上才归零。

### AC2 —— 类与生命周期方法

```
$ grep -n 'class DashboardSnapshotStore' packages/quay/src/serve/snapshot-store.ts
110:export class DashboardSnapshotStore<S> {

$ grep -nE '  (clear|setStepHook|snapshot|rebuild|followUp)\(' packages/quay/src/serve/snapshot-store.ts
184:  snapshot(root: string): S | null {
202:  setStepHook(hook: (() => Promise<void>) | null): void {
241:  rebuild(root: string, build: () => Promise<S>): Promise<void> {
258:  followUp(root: string, policy: RebuildPolicy, build: () => Promise<S>): Promise<void> {
294:  clear(): void {
```
（1 行 + 5 行，满足 ≥5）

### AC3 —— 显式单例 + 可注入

```
$ grep -n 'export const .*SnapshotStore = new' packages/quay/src/serve/snapshot-store.ts
320:export const dashboardSnapshotStore = new DashboardSnapshotStore<DashboardSnapshot>();
323:export const boardSnapshotStore = new DashboardSnapshotStore<BoardSnapshot>();
```

**注入用法**（`packages/quay/test/snapshot-store.test.mjs` —— 每个用例构造自己的实例，不重绑定 `let`）：

```js
const s = new DashboardSnapshotStore();
assert.equal(s.taskSummary("r", 60_000), null, "an unwritten cache is a miss, never a fabricated empty value");
```
另有隔离性用例 `an injectable constructible instance is isolated from the module singletons`：
`local.publish("iso-root", …)` 之后 `dashboardSnapshotStore.snapshot("iso-root")` 仍为 `null`。

### AC4 —— 行为不变（scoped 全绿）+ 断言零改动

```
$ bash scripts/test.sh --for-task gap-dashboard-snapshot-store-encapsulate-state --allow-thin
（scoped 静态检查全部 PASS；exit=0）
ℹ tests 181
ℹ suites 0
ℹ pass 181
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

其中包含本任务的 10 条新用例与 7 个既有测试文件的全部用例（`gap-ac136-web-truth-source`、
`gap-ac179-criterion-cold-miss-dashboard-snapshot`、`gap-ac292-board-request-path-cold-build`、
`gap-dashboard-goal-card-provider-backed`、`gap-dashboard-parallelize`、
`gap-dashboard-taskcard-multistatus-minitable`、`gap-webui-goal-task-rollup-via-shared-summary-cache`）。

**断言零改动（机械判据，不是口头声明）**——7 个既有测试文件的 diff 共 36 增 / 39 删，**每一行都是同一个
句柄改名**；直接数含 `assert` 的增删行：

```
$ git diff develop -U0 -- <the 7 test files> | grep -E '^[-+].*assert' | wc -l
0
```

改名样例：

```
-import { readTaskSummary, clearTaskSummaryCache } from "../src/serve/serve-handlers.ts";
+import { readTaskSummary, dashboardSnapshotStore } from "../src/serve/serve-handlers.ts";
-    clearTaskSummaryCache();
+    dashboardSnapshotStore.clearTaskSummary();
-  setDashboardSnapshotStepHook(async () => { entered = true; await held; });
+  dashboardSnapshotStore.setStepHook(async () => { entered = true; await held; });
-  clearBoardSnapshots();
+  boardSnapshotStore.clearSnapshot();
```

**如实列出非断言的两处文字改动**（AC4 要求列出）：
1. 两条 **test 标题**改名（`clearDashboardSnapshots drops every snapshot …` →
   `dashboardSnapshotStore.clearSnapshot drops every snapshot …`；`… after clearDashboardSnapshots …` →
   `… after clearSnapshot …`）。理由：原标题点名了一个已不存在的自由函数。
2. 一行**注释** `// clearTaskSummaryCache() forces a fresh read.` →
   `// dashboardSnapshotStore.clearTaskSummary() forces a fresh read.`，同上。
   ⛔ 两者的断言体逐字未动（上面那条 `grep … assert | wc -l = 0` 就是它的机械证明）。

### AC5 —— 类型检查（仓库既有入口：`.quay/config.yml` 的 `ts-typecheck` = per-package 循环）

```
$ for d in packages/*/; do npx tsc --noEmit -p "$d" || exit 1; done
== packages/quay/
== packages/quay-backlog/
== packages/quay-github/
== packages/quay-native/
（四个包均无输出 ⇒ exit 0）
```

### AC6 —— 无残留

```
$ grep -rn 'taskSummaryCache\|dashboardLiveCache\|dashboardSnapshots\|boardSnapshots\|clearBoardSnapshots\|clearDashboardSnapshots' packages/quay/src/serve/serve-dashboard.ts packages/quay/src/serve/serve-board.ts
(无输出; exit=1)
```

**这不是「0 命中看着像通过」**——它比 AC 的要求更严：连 `import`/方法调用处都没有，因为那些标识符本身
已不存在，两个文件只出现 `dashboardSnapshotStore` / `boardSnapshotStore` 这两个**新**句柄。同一谓词对
重构前样本的干跑（硬规则 2 另一半）：

```
$ git show eed2c9fe6:packages/quay/src/serve/serve-board.ts | grep -n 'boardSnapshots\|clearBoardSnapshots' | head -3
336:const boardSnapshots = new Map<string, BoardSnapshot>();
358:  return boardSnapshots.get(root) ?? null;
362:export function clearBoardSnapshots(): void {
```

### AC7 —— 快照生命周期语义等价（`.delete()` 的时机）

fixture/断言在 `packages/quay/test/snapshot-store.test.mjs`，核心两条：

```js
// 同一时刻只一个 rebuild promise，且 .delete() 在【settle 那一刻】发生（不是迟滞标志）
const p1 = s.followUp("r", "skip", build);
assert.equal(s.isRebuilding("r"), true);            // 构建中：marker 在
const p2 = s.followUp("r", "skip", build);
assert.equal(p2, p1);                               // 沿用 incumbent，不启第二个
assert.equal(started, 1);
release();
await p1;
assert.equal(s.isRebuilding("r"), false);           // settle 后 marker 被删除
assert.deepEqual(s.snapshot("r"), { n: 1 });        // 结果已安装
// 再建一次 ⇒ marker 重新置位（delete 是 per-build，不是一次性闩锁）
```

```js
// follow-up 合并：多个 after 调用者共享同一个排队构建，且队列项在 follow-up 【开始】时退场
const a1 = s.followUp("r", "after", build);
const a2 = s.followUp("r", "after", build);
assert.equal(a1, a2);
assert.equal(started, 1);
assert.equal(s.isFollowUpQueued("r"), true);
gates[0]();                                          // incumbent settle
assert.ok(await until(() => started === 2));         // follow-up 才开始
assert.equal(s.isFollowUpQueued("r"), false);        // 队列项在【开始】时退场
gates[1]();
await a1;
assert.deepEqual(s.snapshot("r"), { n: 2 });
```

失败构建保留上一快照（`a failed build keeps the previous snapshot`）与两个 reset 作用域
（`clearSnapshot()` 只清生命周期、`clear()` 全清）也各有用例。10/10 通过。

### ADR-007 暗轴记录

该轴仍暗,理由:git-lens 的 L_D/L_G 三个探针已于 2026-09-07 归档为零调用脚本（archive/2026-09-07-zero-call-scripts/），本轮没有可运行的 L_D/L_G 探针；可得的等价机械读数是 import-graph-check（valueSccs=0 typeSccs=0 reverseEdges=0，与基线同值，证明这次抽取没有引入依赖环），但它只覆盖依赖环一个信号，不冒充 L_D/L_G 总读数。

## Touches

- packages/quay/src/serve/snapshot-store.ts
- packages/quay/src/serve/serve-dashboard.ts
- packages/quay/src/serve/serve-board.ts
- packages/quay/test/snapshot-store.test.mjs
- packages/quay/test/gap-ac136-web-truth-source.test.mjs
- packages/quay/test/gap-ac179-criterion-cold-miss-dashboard-snapshot.test.mjs
- packages/quay/test/gap-ac292-board-request-path-cold-build.test.mjs
- packages/quay/test/gap-dashboard-goal-card-provider-backed.test.mjs
- packages/quay/test/gap-dashboard-parallelize.test.mjs
- packages/quay/test/gap-dashboard-taskcard-multistatus-minitable.test.mjs
- packages/quay/test/gap-webui-goal-task-rollup-via-shared-summary-cache.test.mjs
- tasks/gap-dashboard-snapshot-store-encapsulate-state.md
