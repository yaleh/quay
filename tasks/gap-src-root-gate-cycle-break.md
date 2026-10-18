---
id: gap-src-root-gate-cycle-break
title: 断 ""↔gate 根环——src root 同时是 gate 的宿主与依赖源，把 gate 依赖的底层下沉建立单向分层
status: ready
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

- [ ] AC1（能取假·SCC 断）fresh analyze 后 `moduleGraph.cycles` 中**不存在同时含 `""` 与任意 `gate*` 成员的 SCC**（根环断开；当前 5 元环含二者，故真能取假）。仍含即假。
- [ ] AC2（负控制）恢复一条 goal-store→gate 或 gate→goal-store 的边 ⇒ 根环重现，证明判据能取假。
- [ ] AC3（无行为回归）`bash scripts/test.sh --for-task <本任务id> --allow-thin` 绿（gate/goal-store/cli/mcp-handlers 消费端不破）。
- [ ] AC4（范围诚实）若 `Task` type-only 边因全局 ABI 无法完全下沉（或任一残余边），在 `## Evidence` 如实点名残余边与原因，不冒充「全断干净」。

## Definition of Done

`""↔gate` 根环断开（AC1）、负控制成立（AC2）、测试绿（AC3）；任何残余边如实记录（AC4）。

## Evidence

### 实现形状（方向 A，含 Plan 未列但传递闭包必需的下沉）

`core/` 是 gate **之下的层**。Plan 只列了 8 个文件，但实测传递闭包还必需 6 个叶模块——否则 `core/` 自己会 import src root，`gate→core→""→gate` 立刻成环（这正是 AC1 要求取假的那个量）：

- Plan 明列的：`types.ts`(原 `abi.ts`)、`acceptance-runner.ts`(Plan 写作 `acceptance-verdict.ts`，实际整体搬 runner——goal-store 的 `runAcceptance` 也来自它)、`criterion-capability.ts`、`goal-store.ts`、`adr-store.ts`、`document-store.ts`、`contract-validator.ts`、`config.ts`。
- 传递闭包补的：`frontmatter-store-base.ts`、`store-commit.ts`、`criterion-fidelity.ts`、`plugin-root.ts`、`branch-model.ts`、`worktree-namespace.ts`、`gate-event-store.ts`。

`gate-event-store.ts` 与 `plugin-root.ts` 不在 Plan 里，但是硬约束：
- goal-store 在两条路径上 **dynamic import** `./gate/gate-event-store.ts`（`:2484`/`:3866`）——archguard 计 dynamic import 边，不搬就是 `core→gate`。
- goal-store 的 `fidelitySettingsArg` 用 `resolvePluginRoot()`；`plugin-root.ts` 本身是零依赖叶（只 import `node:*`，walk-up 无深度常数），下沉后 `moduleDir()` 只多上溯一层，行为不变（`plugin-root.test.mjs` 的 24 条路径用例全绿，含 worktree 重定位与 installed-layout 两形态）。

旧路径全部保留 **forwarding re-export**（`src/abi.ts`、`src/goal-store.ts`、`src/config.ts`、…、`gate/shared/acceptance-runner.ts`、`gate/criterion-capability.ts`、`gate/gate-event-store.ts`）。理由：这些旧路径是测试、`plugin/scripts/*`、`quay-native`、`goals/AC-*` 判据的**现行 import 面**（`packages/quay/src/goal-store.ts` 尤其被 20+ 条 goal 判据当 CLI 直接 spawn）。`goal-store` 的 `isMain` 守卫是 `process.argv[1].endsWith("goal-store.ts")`，经 shim 运行时仍然命中，CLI 方言与退出码逐字不变。

### AC1 — fresh archguard analyze（scope `000c1e20`，`sources=["packages/quay/src"]`）

```
before（本任务的 develop 起点，5 元环）：
  cycles = [["gate/config","gate/factories","gate/shared","gate",""]]

after（本 worktree，fresh analyze）：
  moduleGraph.cycles = []                      ← 0 个 SCC（不只是「不含 gate」）
  gate → "" 的目录边数 = 0                     ← 断的就是这半边
  ""  → gate 的目录边数 = 1（importedNames: listGates, runGate, resolveGateLogPath,
       runGateLogQuery, runComplete, runAdjudicate, runPromote, runRetreat, runCompleteOutOfBand）
```

`""→gate` **保留且只保留单向**：root 的 `config-validate.ts` / `mcp-handlers.ts` 仍是 gate 的宿主（Plan 第 3 条），它们 import gate 不构成环——因为 gate 已无任何回边。

### AC2 — 负控制原文（恢复一条边 ⇒ 环重现）

把 `gate/factories/goal.ts:20` 临时改回 `../../goal-store.ts`（旧路径 shim 仍可解析，⛔ 不是不可解析的悬空 specifier——悬空会被 archguard skip，控制就变空转），重跑同一 analyze：

```
cycles = [{"modules":["gate/config","gate/factories","gate",""],"severity":"error"}]
gate → "" = [["gate/factories",["createGoalStore"]]]
```

⇒ 判据能取假。复原后重跑：`cycles = []`、`gate → "" = 0`。

### AC4 — 残余边（如实）

- **目录级残余边 0 条**（`gate→""`），故「全断干净」在本口径下成立，不是冒充。
- **文件级新指向**：`core/` 内 14 个文件是原 root 文件的移动（`git mv`，历史连续），root 与 gate/shared/gate 保留了 13 个 forwarding shim。这些 shim 是**显式声明**的兼容面，不是隐藏的第二实现（每个 shim 只有一行 `export *`）。
- **Plan 与实现的命名差异**：Plan 写 `core/acceptance-verdict.ts`，实现是 `core/acceptance-runner.ts`（整体搬运，因为它同时提供 `runAcceptance`；拆一个只含 verdict 映射的文件会把一次搬迁拆成两处实现面）。

### 连带改动的理由（都在 Touches 内）

- `plugin/scripts/enum-surface-parity-check.ts`：从 `abi.ts`/`adr-store.ts`/`document-store.ts`/`goal-store.ts` **读数组字面量**做真源比对——读 shim 会「读不到」而非「匹配」，必须指向 `core/`（否则 checker 变 NOT-EVALUATED/红）。
- `plugin/scripts/worktree-namespace-literal-check.ts` + 其 mutation case：`RESOLVER_REL` 是「唯一允许拼字面量的文件」，随实现移到 `core/worktree-namespace.ts`；mutation case 的 fixture 布局同步（否则 case 读不到声明 ⇒ INFRASTRUCTURE exit 2）。
- `plugin/scripts/runner-static-gate.ts`：`@static-object` 登记表跟随 checker 的实际读取面。
- `packages/quay/test/{goal-store,plugin-root,ac197,goal-criterion-timeout-resolution}.test.mjs`：四个文件**按源码路径读取/拷贝**（不是 import），路径必须跟随实现；`goal-criterion-timeout-resolution` 的 walk 同时加上 `core/`，否则「60000 只在一处」的守卫在实现搬家后变成只查 shim 的空转。
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
- goals/AC-197-kind-tasks-goals-meta-adr-docs-managed-commitstorewrite-5.md
- tasks/gap-src-root-gate-cycle-break.md