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

- [ ] AC1（能取假·SCC 断）fresh analyze 后 `moduleGraph.cycles` 中**不存在同时含 `""` 与任意 `gate*` 成员的 SCC**（根环断开；当前 5 元环含二者，故真能取假）。仍含即假。
- [ ] AC2（负控制）恢复一条 goal-store→gate 或 gate→goal-store 的边 ⇒ 根环重现，证明判据能取假。
- [ ] AC3（无行为回归）`bash scripts/test.sh --for-task <本任务id> --allow-thin` 绿（gate/goal-store/cli/mcp-handlers 消费端不破）。
- [ ] AC4（范围诚实）若 `Task` type-only 边因全局 ABI 无法完全下沉（或任一残余边），在 `## Evidence` 如实点名残余边与原因，不冒充「全断干净」。

## Definition of Done

`""↔gate` 根环断开（AC1）、负控制成立（AC2）、测试绿（AC3）；任何残余边如实记录（AC4）。

## Touches

- packages/quay/src/core/types.ts (new)
- packages/quay/src/core/acceptance-verdict.ts (new)
- packages/quay/src/core/criterion-capability.ts (new)
- packages/quay/src/core/goal-store.ts (new)
- packages/quay/src/core/adr-store.ts (new)
- packages/quay/src/core/document-store.ts (new)
- packages/quay/src/core/contract-validator.ts (new)
- packages/quay/src/core/config.ts (new)
- packages/quay/src/goal-store.ts（双向结）
- packages/quay/src/abi.ts（Task 下沉或 re-export）
- packages/quay/src/config.ts（findConfig）
- packages/quay/src/adr-store.ts
- packages/quay/src/document-store.ts
- packages/quay/src/contract-validator.ts
- packages/quay/src/gate/shared/acceptance-runner.ts
- packages/quay/src/gate/criterion-capability.ts
- packages/quay/src/gate/factories/goal.ts
- packages/quay/src/gate/factories/adr.ts
- packages/quay/src/gate/factories/document-contract.ts
- packages/quay/src/gate/factories/it0.ts
- packages/quay/src/gate/config/loader.ts
- packages/quay/src/gate/shared/types.ts
- packages/quay/src/config-validate.ts
- packages/quay/src/goal-merge.ts
- packages/quay/src/mcp-handlers.ts
- tasks/gap-src-root-gate-cycle-break.md