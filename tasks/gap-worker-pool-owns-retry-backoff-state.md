---
id: gap-worker-pool-owns-retry-backoff-state
title: WorkerPool 聚合 retry/backoff 状态：worker-driver.ts 去掉两个闭包局部变量，状态与转移收进 export
  class WorkerPool（GOAL-909/AC-914）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-914
---
## Proposal

**立案读数（2026-10-22，当前树）**：GOAL-909/AC-914 的 criterion 逐字执行为 exit 1：

```
CAUSE=worker-driver.ts still declares 2 retry/backoff state local(s); want 0 (owned by WorkerPool)
```

两处来源已实测：`plugin/scripts/worker-driver.ts:6040` 的 `const retryState: RetryState = { counts: new Map(), needsHuman: new Set() };` 与 `:6058` 的 `const backoffState = newQuickDeathBackoffState();`。`plugin/scripts/worker-pool.ts` 当前不存在。

**要做什么**：新建 `plugin/scripts/worker-pool.ts`，用 `export class WorkerPool` 以 ES 私有字段（`#retryState` / `#backoffState`）拥有这两类状态；`runResidentLoop` 改为只持有一个 `pool` 实例，所有状态转移（重试计数、needs-human 翻转、快速死亡退避、在飞排除读面）经该类方法完成，`onWorkerFinished` 闭包不再直接读写 `Map`/`Set`。

**为什么不能只「搬代码」**：AC-914 明确把「把同样的闭包变量换个文件继续以模块级变量存在」判为不达成。因此本任务的可取假判据同时要求：(a) `worker-driver.ts` 零 `const/let retryState|backoffState`；(b) `worker-pool.ts` 零模块级同名变量，状态只在类体内以 `#` 字段声明；(c) 转移只能经方法——测试用 `Object.keys(new WorkerPool())` 断言状态字段结构上不可从外部持有。

**为什么现在做**：DIR-133（人 2026-10-22 裁定）把 worker-driver.ts 的并发争用（派发器改选 5 次 + 真实合并冲突 6 次）定为设计类改进的合法触发器；R2 第一刀就是这个聚合。

<!-- dedup-ref -->
相关而非重复：`goal-035-needs-human-transition-unify`（done）已把三条 needs-human 路径收敛到 `applyNeedsHumanTransition`；`goal-036-dispatch-exclusion-single-source`（done）已把在飞排除集合收敛到 `computeDispatchExclusion`。本任务不重做这两个纯函数，只把它们与 retry/backoff 状态一起收进 `WorkerPool` 的方法面。立案 dedup：`tasks/` 中无任务声明 `goal_ac: AC-914`；`task-granularity-advice.ts` 对下述 Touches 返回 `peers: []` ⇒ 无合并候选，独立立案。

## Plan

1. **新建 `plugin/scripts/worker-pool.ts`**：
   - 从 `./driver-filters.ts` 引入已收敛的纯函数 `RetryState` / `advanceRetryCap` / `applyNeedsHumanTransition` / `reconcileNeedsHumanWithDisk` / `computeDispatchExclusion`（GOAL-035/036 的单一真相源，⛔ 不复制实现）。
   - 把 `runResidentLoop` 用到的快速死亡退避状态容器与转移函数（`QuickDeathBackoffState` / `newQuickDeathBackoffState` / `recordQuickDeathBackoff` / `isBackedOff`）迁入本文件；⛔ 不得反向 `import` `worker-driver.ts`（会形成 import cycle）。
   - `export class WorkerPool` 提供方法面：`needsHuman(id)` / `advanceRetryCap(taskIds, maxRetries)` / `applyNeedsHumanTransition(rootDir, write)` / `reconcileNeedsHumanWithDisk(rootDir)` / `recordQuickDeath(...)` / `isBackedOff(id, nowMs)` / `consecutiveQuickDeaths(id)` / `consecutiveTransientDeaths(id)` / `dispatchExclusion(running, coldInflight)`。签名逐字沿用现有纯函数（用 `Parameters`/返回类型推断，⛔ 不手抄一份类型）。
2. **改 `plugin/scripts/worker-driver.ts`**：删掉 `:6040` / `:6058` 两个局部声明，改持 `const pool = new WorkerPool();`；把 `:6040` 起的全部 `retryState.*` / `backoffState.*` / 以其为第一参的纯函数调用（`:6333 :6349 :6364 :6379 :6401-6407 :6435 :6447 :6656 :6750 :6796`）改为 `pool.*` 方法。保留旧导出面（从 `worker-pool.ts` re-export `QuickDeathBackoffState` / `newQuickDeathBackoffState` / `recordQuickDeathBackoff` / `isBackedOff`），使 `plugin/test/helpers/worker-driver-fan-in-harness.mjs` 与既有测试的 import 不必改动。
3. **新增 `plugin/test/worker-pool.test.mjs`**：① `Object.keys(new WorkerPool())` 不含 `retryState`/`backoffState`；② `advanceRetryCap` 达 `maxRetries` 返回该 id；③ `applyNeedsHumanTransition` 返回 committed 且 needs-human 生效；④ `recordQuickDeath` + `isBackedOff` 的「阈值后设 backoff、窗口内 true/窗口外 false、非快速死亡复位」；⑤ `dispatchExclusion` 过滤 needsHuman 在飞任务。
4. **注册**：在 `plugin/scripts/capability-catalog-declarations.json` 为 `worker-pool.ts` 补 QUESTION / CADENCE / INVALIDATION / LAST_REAFFIRMED / MATCHING / CONSUMER 六表条目，使 catalog 的 `unclassified` 保持 0。
5. **负控制**（真载体，⛔ 不写回 store）：`cp` 备份 `worker-driver.ts` → 在 `runResidentLoop` 里粘回 `const retryState: RetryState = { counts: new Map(), needsHuman: new Set() };` → AC-914 判据必须 exit 1 并打出 `CAUSE=worker-driver.ts still declares`；`cp` 恢复后 `md5sum` 与改前一致且判据 exit 0。
6. **验证**：`scripts/test.sh --for-task <id>`（含 scoped 静态检查与 capability-catalog 门）与 affected suites。

## AC

- [x] AC1 判据取真：在任务 worktree 内逐字执行 `quay goal show AC-914 --json` 取出的 criterion ⇒ exit 0 且 stdout 含 `OK: retry/backoff state owned by WorkerPool`（贴 criterion 全文与读数）
- [x] AC2 闭包局部变量清零：`grep -cE '^\s*(const|let) (retryState|backoffState)\b' plugin/scripts/worker-driver.ts || true` ⇒ `0`；同一条 grep 对 `git show develop:plugin/scripts/worker-driver.ts` 的临时副本 ⇒ `2`（零计数配套干跑，证明谓词非恒零）
- [x] AC3 类存在且唯一：`grep -cE '^export class WorkerPool\b' plugin/scripts/worker-pool.ts` ⇒ `1`
- [x] AC4 状态确由类私有拥有（不是搬家）：`grep -cE '^\s*(const|let) (retryState|backoffState)\b' plugin/scripts/worker-pool.ts || true` ⇒ `0`，且 `grep -cE '^\s*#(retryState|backoffState)\b' plugin/scripts/worker-pool.ts` ⇒ `2`，且 `plugin/test/worker-pool.test.mjs` 的 `Object.keys(new WorkerPool())` 断言 pass（贴三处读数）
- [x] AC5 转移经方法（行为面）：`node --experimental-strip-types --test plugin/test/worker-pool.test.mjs` ⇒ 0 fail，覆盖 Plan 第 3 步的 ①-⑤ 五个断言（贴 `# pass`/`# fail` 读数）
- [x] AC6 既有行为不回归：`node --experimental-strip-types --test plugin/test/worker-driver-fan-in-s05.test.mjs plugin/test/worker-driver.test.mjs` ⇒ 0 fail（re-export 面保持）
- [x] AC7 反向能取假（负控制，真载体）：按 Plan 第 5 步执行 ⇒ 改回后判据 exit 1 且 stderr 含 `CAUSE=worker-driver.ts still declares`；`cp` 恢复后 `md5sum` 与改前一致且判据 exit 0（贴两侧读数；⛔ 不用 `git checkout` 恢复）
- [x] AC8 注册完整：`bash plugin/scripts/capability-catalog.sh --json` ⇒ exit 0、`unclassified` 为 `0`、输出中含 `worker-pool.ts` 且其 `question` 非 null（贴三处读数）
- [x] AC9 scoped 门通过：`bash scripts/test.sh --for-task <id>` ⇒ exit 0；`node --experimental-strip-types plugin/scripts/select-static-checks-for-touches.ts --task <id> --check-registration --json` ⇒ `ok:true`（贴读数）
- [x] AC10 schema：`node plugin/scripts/task-schema-check.ts tasks/<id>.md` ⇒ exit 0

## DoD

AC-914 在 goal-driver 下一轮读数为 `pass`（`.quay/goal-round.jsonl` 或 goal store 的 evidence），且达成形态是 **状态由 `WorkerPool` 的 `#` 私有字段拥有、外部只能经方法转移**——仅让 grep 变绿而状态仍是闭包/模块级变量 ⇒ 不算达成；AC4/AC7 是这条的判据。任务改动经 fan-in 落地 `develop`，`worker-pool.ts` 随 plugin 包发布。

## Touches

- plugin/scripts/worker-pool.ts（新：`export class WorkerPool`，`#retryState`/`#backoffState` 私有持有 + 转移方法）
- plugin/scripts/worker-driver.ts
- plugin/test/worker-pool.test.mjs（新：私有所有权 + 转移行为）
- plugin/test/worker-driver-fan-in-s04.test.mjs（跟随：唯一归一化点 `normalizeAssertionSignature` 随快速死亡退避整簇迁入 worker-pool.ts ⇒ s04 的「唯一正本点」源码针改为按两文件合计计数并钉死各自落点；不迁则该针计数 0，suite 恒红）
- plugin/scripts/capability-catalog-declarations.json
- tasks/gap-worker-pool-owns-retry-backoff-state.md
