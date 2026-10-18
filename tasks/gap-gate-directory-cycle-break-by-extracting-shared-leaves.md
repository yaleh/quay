---
id: gap-gate-directory-cycle-break-by-extracting-shared-leaves
title: 断 packages/quay/src/gate 目录级环——父目录与 factories/config 子目录互引，抽 shared 叶子
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

archguard 目录级 moduleGraph 实测（scope 26b300e9，2026-10-11）报 4 元目录环 `["gate/config","gate/factories","gate",""]`，根因是**父目录 ↔ 子目录互引**：
- 父→子：`gate/registry.ts` import `./factories/{document-contract,goal}.ts`（makeDocumentContractGate/makeGoalGate）与 `./config/loader.ts`
- 子→父：`gate/factories/*.ts` 9 个文件 import `../types.ts`（GateFn）、6 个 import `../acceptance-runner.ts`（runAcceptance）；`gate/config/loader.ts` import `../types.ts`
- 关键：`types.ts` 与 `acceptance-runner.ts` 都是**干净叶子**（types.ts 只 import `../abi.ts`；acceptance-runner.ts 只 import `../kernel/{gate-run-options,load-avg}.ts` 与 `./types.ts`），不碰 factories/config ⇒ 移出父目录即可断环。

## Plan

1. 新建 `packages/quay/src/gate/shared/`，把 `types.ts` 与 `acceptance-runner.ts` 移入（git mv，保留历史）。
2. 更新 gate 内 import：factories 9 个文件的 `../types.ts`→`../shared/types.ts`、6 个的 `../acceptance-runner.ts`→`../shared/acceptance-runner.ts`；config/loader.ts 的 `../types.ts`；gate 根的 registry.ts / engine.ts / lifecycle.ts 的 `./types.ts`/`./acceptance-runner.ts`→`./shared/...`；acceptance-runner 自身的 `./types.ts`（已在 shared/ 内，无需改）。
3. 更新 gate 外真实消费者（value import，非注释）：`cli/gate.ts:11`、`goal-store.ts:79`、`quay-native/src/mcp-server.ts:26`、`test/{acceptance-env,acceptance,gate-ergonomics,goal-gate-verdict-mapping,goal-criterion-timeout-resolution,adr-gate,kernel-load-avg}.test.mjs` 的路径。注释里的路径引用（kernel/gate-run-options.ts、kernel/load-avg.ts、ac28x/ac29x/ac30x 测试）同步或忽略由执行者按「不误导」原则处理。
4. 重跑 archguard analyze 验证环断开。

## Acceptance Criteria

- [ ] AC1（能取假·环消失）fresh analyze 后 src scope 的 `moduleGraph.cycles` 不再含 `gate/config` 或 `gate/factories`（gate 内 3 向环断开）；仍含即假。
- [ ] AC2（负控制）把任一 factories 文件的 `../shared/types.ts` 临时改回 `../types.ts` ⇒ 环重现，证明判据能取假。
- [ ] AC3（无行为回归）`bash scripts/test.sh --for-task <本任务id> --allow-thin` 绿（gate/acceptance 相关测试 pass，cli/goal-store/quay-native 消费端不破）。
- [ ] AC4（范围诚实）剩余 `""↔gate`（src root 桶 ↔ gate）2 元环若仍在，在 evidence 里点名记录为 out-of-scope，不冒充「全断干净」。

## Definition of Done

gate 内 3 向目录环断开（AC1）、负控制成立（AC2）、测试绿（AC3）；src-root↔gate 剩余环如实记录（AC4）。

## Touches

- packages/quay/src/gate/shared/types.ts（新，自 gate/types.ts 移入）
- packages/quay/src/gate/shared/acceptance-runner.ts（新，自 gate/acceptance-runner.ts 移入）
- packages/quay/src/gate/types.ts（移走）
- packages/quay/src/gate/acceptance-runner.ts（移走）
- packages/quay/src/gate/factories/coverage-floor.ts
- packages/quay/src/gate/factories/fixed-script.ts
- packages/quay/src/gate/factories/adr.ts
- packages/quay/src/gate/factories/document-contract.ts
- packages/quay/src/gate/factories/index.ts
- packages/quay/src/gate/factories/test-pass.ts
- packages/quay/src/gate/factories/it0.ts
- packages/quay/src/gate/factories/red-green.ts
- packages/quay/src/gate/factories/goal.ts
- packages/quay/src/gate/config/loader.ts
- packages/quay/src/gate/registry.ts
- packages/quay/src/gate/engine.ts
- packages/quay/src/gate/lifecycle.ts
- packages/quay/src/cli/gate.ts
- packages/quay/src/goal-store.ts
- packages/quay-native/src/mcp-server.ts
- packages/quay/test/acceptance-env.test.mjs
- packages/quay/test/acceptance.test.mjs
- packages/quay/test/gate-ergonomics.test.mjs
- packages/quay/test/goal-gate-verdict-mapping.test.mjs
- packages/quay/test/goal-criterion-timeout-resolution.test.mjs
- packages/quay/test/adr-gate.test.mjs
- packages/quay/test/kernel-load-avg.test.mjs
- tasks/gap-gate-directory-cycle-break-by-extracting-shared-leaves.md