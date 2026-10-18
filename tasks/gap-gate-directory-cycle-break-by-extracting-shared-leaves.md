---
id: gap-gate-directory-cycle-break-by-extracting-shared-leaves
title: 断 packages/quay/src/gate 目录级环——父目录与 factories/config 子目录互引，抽 shared 叶子
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

- [x] AC1（能取假）**原判据「fresh analyze 后 `moduleGraph.cycles` 不再含 `gate/config` 或 `gate/factories`」结构上不可满足，已按硬规则 4c 换为穿过中间层的直接量**：fresh analyze 后 `moduleGraph.edges` 不含 `gate/factories → gate`，也不含 `gate/config → gate`——gate 的两个子目录不再 import 父目录，父↔子互引断开。原句不被声称成立：`cycles` 是 Tarjan SCC，被 AC4 的 out-of-scope `""↔gate` 环把一切可达节点并入同一 SCC；实测残余边与 SCC 原样读数见 `## Evidence`。
- [x] AC2（负控制）把 `gate/factories/red-green.ts` 的 `../shared/types.ts` 临时改回 `../types.ts`（并临时补回 `gate/types.ts` 重导出 shim；否则相对路径不可解析、archguard 会 skip 该边，控制变成空转）⇒ `gate/factories → gate` 边重现（实测 present: true，importedNames `["GateFn"]`）；复原后该边消失（present: false）。证明 AC1 的判据能取假。
- [x] AC3（无行为回归）`bash scripts/test.sh --for-task gap-gate-directory-cycle-break-by-extracting-shared-leaves --allow-thin` 绿（EXIT=0；最后一个 bucket 304 tests / 0 fail）；gate/acceptance 相关测试 pass，cli/goal-store/quay-native 消费端不破；`tsc -p packages/quay/tsconfig.json --noEmit` 与 `tsc -p packages/quay-native/tsconfig.json --noEmit` 均干净。
- [x] AC4（范围诚实）剩余环 `["gate/config","gate/factories","gate/shared","gate",""]` 在 `## Evidence` 里点名记录为 out-of-scope，不冒充「全断干净」。

## Definition of Done

gate 两个子目录到父目录的直连 import 边断开（AC1）、负控制成立（AC2）、测试绿（AC3）；残余 SCC（含 `""↔gate` 与三条 `""` 向边）如实记录（AC4）。**SCC 级目标未达成且未冒充达成**：要让 `moduleGraph.cycles` 不再含 `gate/config`/`gate/factories`，必须把 `findConfig`、四个 store（`adr-store`/`document-store`/`contract-validator`/`goal-store`）与 `abi.ts` 的 `Task` 移出 src root，或反转 `gate/config→factories`（gateFactories）与 gate-root→config/factories 的依赖——属另一次分层改造，见 Evidence 的 follow-up。

## Evidence

### 环境与命令
- worktree：`/home/yale/work/quay-worktrees/gap-gate-directory-cycle-break-by-extracting-shared-leaves`（branch `task/gap-gate-directory-cycle-break-by-extracting-shared-leaves`，fork point develop `793acedcc`）。
- archguard analyze：`projectRoot=<worktree>`, `sources=["packages/quay/src"]`, `lang=typescript`, `format=json` ⇒ scope key `09a71934`（baseline 旧树为 `c8e83d41`）。读数落在 `.archguard/query/<scope>/arch.json` 的 `extensions.tsAnalysis.moduleGraph`。
- 本地证据文件：`.quay/ac-cycle-evidence/{post-fix-edges,negative-control,final-reading}.txt`（未跟踪）。

### AC1 — 断掉的边 vs 残余边
```
before (develop 793acedcc, scope c8e83d41):
  cycles = [["gate/config","gate/factories","gate",""]]
  gate/config  -> gate : ["GateFn"]
  gate/factories -> gate : ["GateFn","runAcceptance","verdictFromAcceptance"]

after  (this branch, scope 09a71934):
  cycles = [["gate/config","gate/factories","gate/shared","gate",""]]
  edges TO gate root from inside gate/ : []        <-- 父↔子 back-edge 0 条（本任务的产出）
```
为什么 SCC 仍列出 `gate/config` / `gate/factories`（**不是本任务没做到，是 SCC 口径把 out-of-scope 环合并进来**）——残余边三条：
1. `gate/config → ""`，importedNames `["findConfig"]`（`gate/config/loader.ts` → `../../config.ts`）。
2. `gate/factories → ""`，importedNames `["createAdrStore","Task","createDocumentStore","validateContracts","createGoalStore"]`（factories → `adr-store`/`document-store`/`contract-validator`/`goal-store`/`abi`）。
3. `gate/config → gate/factories`，importedNames `["gateFactories"]`（loader 用工厂表构建 workspace gates）。
再加既有的 `"" → gate`（root 的 `config-validate`/`goal-merge`/`goal-store`/`mcp-handlers` import gate root）与 `gate → gate/config|factories`，这五条把 `gate/config`、`gate/factories` 与 `""`、`gate` 并入同一 SCC。**只要 `""↔gate` 环在，任何从 gate 子目录通向 `""` 的边都会把该子目录拖回 SCC**，与「子目录是否还 import 父目录」无关。

### AC2 — 负控制原文
```
revert one factory to "../types.ts" (+ temporary gate/types.ts re-export shim):
  gate/factories -> gate edge present: True
  {"from":"gate/factories","to":"gate","strength":1,"typeOnlyStrength":1,"valueStrength":0,"importedNames":["GateFn"]}
restored:
  gate/factories -> gate edge present: False
```

### AC4 — 剩余环（out-of-scope，如实记录）
`["gate/config","gate/factories","gate/shared","gate",""]` = `""↔gate` 2 元环 + 上面三条 `""` 向边。不在本任务范围。

### Follow-up（需要一次分层改造，本任务未做）
要让 SCC 级判据成立，至少需要其一：
- 把 `findConfig`、`adr-store.ts`/`document-store.ts`/`contract-validator.ts`/`goal-store.ts`、以及 `abi.ts` 的 `Task` 移出 `packages/quay/src` 根（gate 子目录不再有到 `""` 的边）；或
- 反转依赖：gate root 不再 import `config/loader` + `factories/*`（由外层注入），并把 `gateFactories` 的构建从 `gate/config` 移出；或
- 把 `""→gate` 的四个 root 消费者移出 src 根。
以上任一都会改变 >40 个文件的 import 面，超出本任务 Touches，未实施。

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
- plugin/test/ac260-ac261-delivery-face-ref-source.test.mjs
- plugin/test/ac272-rolling-channel-version-selfproof.test.mjs
- plugin/test/ac341-post-merge-promotion-events-dialect.test.mjs
- plugin/test/workflow-runner-self-hosted-check.test.mjs
- tasks/gap-gate-directory-cycle-break-by-extracting-shared-leaves.md
