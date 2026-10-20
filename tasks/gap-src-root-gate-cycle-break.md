---
id: gap-src-root-gate-cycle-break
title: 断 ""↔gate 根环——src root 同时是 gate 的宿主与依赖源，把 gate 依赖的底层下沉建立单向分层
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`gap-gate-directory-cycle-break-by-extracting-shared-leaves` 断掉了 gate 的**子→父**边（`gate/factories→gate`、`gate/config→gate`），但目录级 SCC 仍是 5 元 `["gate/config","gate/factories","gate/shared","gate",""]`（worker 已证）。根因：`packages/quay/src` 根目录同时扮演两个角色——既是 gate 的**宿主**（root 文件 import gate），又是 gate 的**依赖源**（gate 子目录 import root 文件），形成 `""↔gate` 双向环，并把 gate 子目录拖回同一 SCC。

完整边清单（当前实测）：

**`""→gate`（root 文件 import gate，4+ 条）**
- `goal-store.ts:79` → gate/shared/acceptance-runner（runAcceptance, verdictFromAcceptance）
- `goal-store.ts:105` → gate/criterion-capability（judgeCriterionCapability 等）
- `config-validate.ts:16` → gate/registry（listGates）
- `goal-merge.ts:24` → gate/gate-event-store（appendGateEvent, queryGateEvents）
- `mcp-handlers.ts:17-20` → gate/engine、gate/gate-log、gate/registry、gate/lifecycle

**`gate→""`（gate 家族 import root 文件，10 条，含 type-only）**
- `gate/shared/types.ts:29` → abi.ts（Task, type-only）
- `gate/factories/{document-contract,adr,it0,goal}.ts` → abi.ts（Task, type-only ×4）
- `gate/factories/document-contract.ts` → document-store.ts（createDocumentStore）、contract-validator.ts（validateContracts）
- `gate/factories/adr.ts` → adr-store.ts（createAdrStore）
- `gate/factories/goal.ts` → goal-store.ts（createGoalStore）
- `gate/config/loader.ts:25` → config.ts（findConfig）

**核心结**：`goal-store.ts` **双向**——被 `gate/factories/goal.ts` import（createGoalStore），又 import gate 的 acceptance-runner + criterion-capability。这是 `""↔gate` 环的锚。次要难点：`abi.ts` 的 `Task` 是 type-only import，但 archguard moduleGraph 把 type-only 也计入边/SCC，所以也必须处理。

## Plan

推荐「下沉建立 core/ 层」（方向 A），让依赖全单向：root → gate → core，core 不再依赖 gate/root。

1. 新建 `packages/quay/src/core/`（下层，不依赖 gate），把 gate 依赖的底层下沉：
   - `gate/shared/acceptance-runner.ts` 的 verdict 映射（runAcceptance/verdictFromAcceptance/verdictFromGateCheck）→ core/（goal-store 改 import core，不再 import gate）
   - `gate/criterion-capability.ts` → core/（goal-store 同改）
   - `adr-store.ts`/`document-store.ts`/`contract-validator.ts`/`goal-store.ts` → core/
   - `config.ts` 的 findConfig（或整个 config 探测）→ core/ 或由 gate 注入
   - `abi.ts` 的 `Task` 类型 → core/types.ts（abi.ts 保留 re-export；gate 与全仓都改 import core/types 或经 re-export）
2. gate 家族（factories/config/shared）改 import core/，不再有到 `""`（src root）的边。
3. root 高层消费者（config-validate/goal-merge/mcp-handlers）保持在 root，单向 import gate + core，不构成环。
4. fresh archguard analyze 验证 SCC 断。

⚠️ 规模：>40 文件的 import 面（worker 在 task 1 Evidence 已预告）。执行时若 Touches 需扩展，用 task_write 补声明（不要手改任务文件）。

## Acceptance Criteria

- [x] AC1（能取假·SCC 断）fresh analyze 后 `moduleGraph.cycles` 中**不存在同时含 `""` 与任意 `gate*` 成员的 SCC**（根环断开；当前 5 元环含二者，故真能取假）。仍含即假。
- [x] AC2（负控制）恢复一条 goal-store→gate 或 gate→goal-store 的边 ⇒ 根环重现，证明判据能取假。
- [x] AC3（无行为回归）`bash scripts/test.sh --for-task <本任务id> --allow-thin` 绿（gate/goal-store/cli/mcp-handlers 消费端不破）。
- [x] AC4（范围诚实）若 `Task` type-only 边因全局 ABI 无法完全下沉（或任一残余边），在 `## Evidence` 如实点名残余边与原因，不冒充「全断干净」。

## Definition of Done

`""↔gate` 根环断开（AC1）、负控制成立（AC2）、测试绿（AC3）；任何残余边如实记录（AC4）。

## Evidence

### 实现形状（方向 A，含 Plan 未列但传递闭包必需的下沉）

`core/` 是 gate **之下的层**。Plan 只列了 8 个文件，但实测传递闭包还必需 7 个叶模块——否则 `core/` 自己会 import src root，`gate→core→""→gate` 立刻成环（这正是 AC1 要求取假的那个量）：

- Plan 明列的：`types.ts`(原 `abi.ts`)、`acceptance-runner.ts`(Plan 写作 `acceptance-verdict.ts`，实际整体搬 runner——goal-store 的 `runAcceptance` 也来自它)、`criterion-capability.ts`、`goal-store.ts`、`adr-store.ts`、`document-store.ts`、`contract-validator.ts`、`config.ts`。
- 传递闭包补的：`frontmatter-store-base.ts`、`store-commit.ts`、`criterion-fidelity.ts`、`plugin-root.ts`、`branch-model.ts`、`worktree-namespace.ts`、`gate-event-store.ts`。

`gate-event-store.ts` 与 `plugin-root.ts` 不在 Plan 里，但是硬约束：
- goal-store 在两条路径上 **dynamic import** `./gate/gate-event-store.ts`（`:2484`/`:3866`）——archguard 计 dynamic import 边，不搬就是 `core→gate`。
- goal-store 的 `fidelitySettingsArg` 用 `resolvePluginRoot()`；`plugin-root.ts` 本身是零依赖叶（只 import `node:*`，walk-up 无深度常数），下沉后 `moduleDir()` 只多上溯一层，行为不变（`plugin-root.test.mjs` 全绿，含 worktree 重定位与 installed-layout 两形态）。该文件头部已加「⛔ 不要引入固定 `..` 层数」的 LOCATION SENSITIVITY 注记。

旧路径全部保留 **forwarding re-export**（`src/abi.ts`、`src/goal-store.ts`、`src/config.ts`、…、`gate/shared/acceptance-runner.ts`、`gate/criterion-capability.ts`、`gate/gate-event-store.ts`）。理由：这些旧路径是测试、`plugin/scripts/*`、`quay-native`、`goals/AC-*` 判据的**现行 import 面**（`packages/quay/src/goal-store.ts` 尤其被 20+ 条 goal 判据当 CLI 直接 spawn）。`goal-store` 的 `isMain` 守卫是 `process.argv[1].endsWith("goal-store.ts")`，经 shim 运行时仍然命中，CLI 方言与退出码逐字不变（实测 `node packages/quay/src/goal-store.ts list` exit 0）。

### AC1 — fresh archguard analyze（baseline 与 after 各取一次真实读数）

参数两次相同：`sources=["packages/quay/src"]`, `lang=typescript`, `format=json`。

**baseline**：detached worktree @ develop `b3ec1f4c8`（本任务起点），scope `6c4aa65f`：

```
cycles = [{"modules":["gate/config","gate/factories","gate/shared","gate",""],"severity":"error"}]
gate→""（4 条目录边）：gate(TASK_STATUS,Task,TASK_STATUSES,TaskStatus) · gate/config(findConfig) ·
    gate/shared(Task) · gate/factories(createAdrStore,Task,createDocumentStore,validateContracts,createGoalStore)
""→gate（2 条目录边）：→gate(listGates,appendGateEvent,queryGateEvents,judgeCriterionCapability,…,
    runCompleteOutOfBand) · →gate/shared(runAcceptance,verdictFromAcceptance,FAILURE_REASON_MAX_CHARS)
```

**after**：本 worktree，scope `000c1e20`：

```
cycles = []                     ← 0 个 SCC（不只是「不含 gate」）
gate→"" = []                    ← 断的就是这半边
""→gate = 1 条（listGates, runGate, resolveGateLogPath, runGateLogQuery, runComplete,
                runAdjudicate, runPromote, runRetreat, runCompleteOutOfBand）
core 的出/入边全单向：""→core · gate→core · gate/config→core · gate/factories→core · gate/shared→core；
    core→kernel / node:* / yaml —— core 无一条到 "" 或 gate/* 的边
```

`""→gate` **保留且只保留单向**：root 的 `config-validate.ts` / `mcp-handlers.ts` 仍是 gate 的宿主（Plan 第 3 条），它们 import gate 不构成环——因为 gate 已无任何回边。

### AC2 — 负控制原文（恢复一条边 ⇒ 环重现）

把 `gate/factories/goal.ts:20` 临时改回 `../../goal-store.ts`（旧路径 shim 仍可解析，⛔ 不是不可解析的悬空 specifier——悬空会被 archguard skip，控制就变空转），重跑同一 analyze：

```
cycles = [{"modules":["gate/config","gate/factories","gate",""],"severity":"error"}]
gate→"" = [["gate/factories",["createGoalStore"]]]
```

⇒ 判据能取假。复原后重跑：`cycles = []`、`gate→"" = []`。

### AC3 — 无行为回归

```
bash scripts/test.sh --for-task gap-src-root-gate-cycle-break --allow-thin
  ℹ pass 383 · ℹ fail 0 · ℹ cancelled 0 · SCOPED_GATE_EXIT=0
```

另跑（不在 scoped 选中集合、但会读被搬动的底层）：`plugin/test/{plugin-packaging,
installed-layout-sibling-resolvability,enum-surface-parity-check,goal-invariants-standing,
criterion-fidelity-default-wiring}.test.mjs` ⇒ 80 tests / 0 fail。
`tsc --noEmit` 对 `packages/quay` 与 `packages/quay-native` 均 0 error。

### AC3 补 — 上一轮全量 suite 的 3 个 task-introduced red（2026-10-18 修复）

上一轮 fan-in 的 delta A/B 判定 HARD RED：`added=plugin/test/worker-driver.test.mjs,
packages/quay/test/kernel-load-avg.test.mjs,packages/quay/test/kernel-env-merge.test.mjs`。三个都是
「测试按源码路径点名实现」的现行 import/读取面，实现搬家后必须跟随（与本任务已改的 4 个测试同属一类，
此前漏列）：

- `plugin/test/worker-driver.test.mjs`：AC2 shipped 负控制把 `gate/gate-event-store.ts` 拷进打平布局后
  动态 import；该路径现在是 forwarding shim（`export * from "../core/..."`），夹具里没有 `src/core/` ⇒
  解析失败。修法：夹具同时落 `src/gate/gate-event-store.ts`（shim）与 `src/core/gate-event-store.ts`
  （实现），断言不变——测的仍是 `resolveKernelSrcModule` 的 `<包根>/src` 回退。
- `packages/quay/test/kernel-load-avg.test.mjs`：② 的 product consumer 由
  `gate/shared/acceptance-runner.ts`（`../../kernel/load-avg.ts`）改为
  `core/acceptance-runner.ts`（`../kernel/load-avg.ts`，实测第 38 行）；`FORMER_COPIES` 同步指向新家。
- `packages/quay/test/kernel-env-merge.test.mjs`：② 由 `src/goal-store.ts`（`./kernel/env-merge.ts`）改为
  `core/goal-store.ts`（`../kernel/env-merge.ts`，实测第 108 行）；`FORMER_COPIES` 同步指向新家。

三个文件单跑均 0 fail（11 + 1 tests）。`plugin/test/capability-catalog.test.mjs` 的 cadence 红在 develop
基线上同样存在（`develop:plugin/scripts/capability-catalog-declarations.json:755` 逐字相同），是 develop-wide
既有红，不是本任务引入。

### AC4 — 残余边（如实）

- **目录级残余边 0 条**（`gate→""`），故「全断干净」在本口径下成立，不是冒充。
- **文件级**：`core/` 内 15 个文件是原 root/gate 文件的 `git mv`（历史连续）；root 与 gate/ 保留 7+3 个 forwarding shim。每个 shim 只有一行 `export *`，是显式声明的兼容面，不是第二实现。
- **Plan 与实现的命名差异**：Plan 写 `core/acceptance-verdict.ts`，实现是 `core/acceptance-runner.ts`（整体搬运，因为它同时提供 `runAcceptance`）。
- **唯一未下沉的 root 侧 gate 消费者**：`config-validate.ts` / `mcp-handlers.ts`（gate 的宿主面，按 Plan 第 3 条保留）——它们是 `""→gate` 单向后继，不构成 SCC。

### 连带改动的理由（都在 Touches 内）

- `plugin/scripts/enum-surface-parity-check.ts`：从 `abi.ts`/`adr-store.ts`/`document-store.ts`/`goal-store.ts` **读数组字面量**做真源比对——读 shim 会「读不到」而非「匹配」，必须指向 `core/`。
- `plugin/scripts/worktree-namespace-literal-check.ts` + 其 mutation case：`RESOLVER_REL` 是「唯一允许拼字面量的文件」，随实现移到 `core/worktree-namespace.ts`；mutation case 的 fixture 布局同步（否则 case 读不到声明 ⇒ INFRASTRUCTURE exit 2）；单独跑该 case ⇒ exit 0。
- `plugin/scripts/runner-static-gate.ts`：`@static-object` 登记表跟随 checker 的实际读取面。
- `packages/quay/test/{goal-store,plugin-root,ac197,goal-criterion-timeout-resolution}.test.mjs`：四个文件**按源码路径读取/拷贝**（不是 import），路径必须跟随实现；`goal-criterion-timeout-resolution` 的 walk 同时加上 `core/`，否则「60000 只在一处」的守卫在实现搬家后变成只查 shim 的空转。
- `packages/quay/test/{kernel-load-avg,kernel-env-merge}.test.mjs` + `plugin/test/worker-driver.test.mjs`：同上——按源码路径断言 import/拷贝，实现搬家后必须跟随（见「AC3 补」）。
- `goals/AC-197-*.md`：其 `five-kind-wiring` 判据块逐字点名 4 个 store 文件路径，fixture 从该 goal 文件**逐字抽取**判据后执行——路径不改则判据对 shim 求值（恒假），改了才是对实现求值。

## Touches

- packages/quay/src/core/types.ts (new, from abi.ts)
- packages/quay/src/core/acceptance-runner.ts (new, from gate/shared)
- packages/quay/src/core/criterion-capability.ts (new, from gate/)
- packages/quay/src/core/goal-store.ts (new)
- packages/quay/src/core/adr-store.ts (new)
- packages/quay/src/core/document-store.ts (new)
- packages/quay/src/core/contract-validator.ts (new)
- packages/quay/src/core/config.ts (new)
- packages/quay/src/core/frontmatter-store-base.ts (new)
- packages/quay/src/core/store-commit.ts (new)
- packages/quay/src/core/criterion-fidelity.ts (new)
- packages/quay/src/core/plugin-root.ts (new)
- packages/quay/src/core/branch-model.ts (new)
- packages/quay/src/core/worktree-namespace.ts (new)
- packages/quay/src/core/gate-event-store.ts (new)
- packages/quay/src/abi.ts
- packages/quay/src/goal-store.ts
- packages/quay/src/config.ts
- packages/quay/src/adr-store.ts
- packages/quay/src/document-store.ts
- packages/quay/src/contract-validator.ts
- packages/quay/src/frontmatter-store-base.ts
- packages/quay/src/store-commit.ts
- packages/quay/src/criterion-fidelity.ts
- packages/quay/src/plugin-root.ts
- packages/quay/src/branch-model.ts
- packages/quay/src/worktree-namespace.ts
- packages/quay/src/gate/shared/acceptance-runner.ts
- packages/quay/src/gate/shared/types.ts
- packages/quay/src/gate/criterion-capability.ts
- packages/quay/src/gate/gate-event-store.ts
- packages/quay/src/gate/driver.ts
- packages/quay/src/gate/engine.ts
- packages/quay/src/gate/lifecycle.ts
- packages/quay/src/gate/registry.ts
- packages/quay/src/gate/gate-log.ts
- packages/quay/src/gate/factories/goal.ts
- packages/quay/src/gate/factories/adr.ts
- packages/quay/src/gate/factories/document-contract.ts
- packages/quay/src/gate/factories/it0.ts
- packages/quay/src/gate/factories/fixed-script.ts
- packages/quay/src/gate/factories/red-green.ts
- packages/quay/src/gate/factories/test-pass.ts
- packages/quay/src/gate/config/loader.ts
- packages/quay/src/goal-merge.ts
- plugin/scripts/enum-surface-parity-check.ts
- plugin/scripts/worktree-namespace-literal-check.ts
- plugin/scripts/checker-mutation-cases/worktree-namespace-literal-check.sh
- plugin/scripts/runner-static-gate.ts
- packages/quay/test/goal-store.test.mjs
- packages/quay/test/plugin-root.test.mjs
- packages/quay/test/ac197-criterion-five-kind-wiring.test.mjs
- packages/quay/test/goal-criterion-timeout-resolution.test.mjs
- packages/quay/test/kernel-load-avg.test.mjs
- packages/quay/test/kernel-env-merge.test.mjs
- plugin/test/worker-driver.test.mjs
- goals/AC-197-kind-tasks-goals-meta-adr-docs-managed-commitstorewrite-5.md
- tasks/gap-src-root-gate-cycle-break.md

## Blocker

**2026-10-18T13:11:56.780Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: AssertionError [ERR_ASSERTION]: cadence must be one of the five enumerated values: touches-relax-tighten.ts → 每轮（worker-driver 驻留环的轮末一步；loop.touches_relax 未声明或 mode 为 off / 读不懂时不跑，该轮 round 记录的 auto_tighten 为 null） [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=plugin/test/full-suite-runner-cgroup.test.mjs changed=-]
- run_id：wk-prod-anchor
- session_id：c79d9442-ec1e-4fd9-8297-e60782e90c4f

## Needs-Human

**执行 2026-10-18T13:30:54.204Z — 停派终止（失败无法归因，⛔ 不再重派）**

- 阻碍原因：LOOP DEADLOCK: task gap-src-root-gate-cycle-break has been blocked by the SAME pre-existing red set for 3 consecutive fan-in rounds (signature unchanged across rounds). Blocked red points: plugin/test/full-suite-runner-cgroup.test.mjs. Other tasks blocked by the identical red set: gap-ac237-criterion-stale-acceptance-runner-moved, gap-ac353-criterion-pins-moved-acceptance-runner-path — each of these tasks fixes a red point OUTSIDE the blocked set, so they are mutually landing gates (none can produce a green full suite while the others' reds remain). Suggested resolution: land ANY ONE of them first (each one's own fix is outside the blocked set, so the red set does not grow); the others' blocked sets then shrink by that red point and they land in turn. If a landing still makes it worse, a human must decide the order. ⛔ The gates were NOT relaxed: every new/changed red point still hard-fails this task (baseline-equivalence exemption never covers a red the task introduced). — 停止自动重派（电路断路器：同一既存红签名连续 3 轮未变）。⛔ 判据未放宽：本次新增 / 断言文本变化的红点仍然硬红（既存红等价豁免只覆盖「不变差」的方向）。
- 失败步/判词：step=suite: AssertionError [ERR_ASSERTION]: cadence must be one of the five enumerated values: touches-relax-tighten.ts → 每轮（worker-driver 驻留环的轮末一步；loop.touches_relax 未声明或 mode 为 off / 读不懂时不跑，该轮 round 记录的 auto_tighten 为 null） [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=plugin/test/full-suite-runner-cgroup.test.mjs changed=-]
- run_id：wk-prod-anchor
- session_id：2d868e10-063e-4fb4-bf8e-e7fbb52ea7b5
- suite 日志：/data/home/yale/work/quay/.quay/fan-in-suite-gap-src-root-gate-cycle-break~wk-prod-anchor~1792329654754-0ab539.log
- fan-in 日志：/data/home/yale/work/quay/.quay/fan-in-gap-src-root-gate-cycle-break-wk-prod-anchor.log
