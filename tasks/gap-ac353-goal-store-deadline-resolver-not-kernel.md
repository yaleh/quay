---
id: gap-ac353-goal-store-deadline-resolver-not-kernel
title: AC-353 判据回归：goal-store.ts 改经 acceptance-runner 取 deadline，破了「直连
  kernel/gate-run-options.ts」护栏——把 record-aware deadline 解析族下沉 kernel 恢复
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-353
---
**type:** execution

## Proposal

AC-353 的判据本轮**直接重跑**为假（不是台账尾巴）：`CAUSE=consumer-not-converged -- goal-store.ts does not import kernel/gate-run-options.ts`。这不是判据全部转假——本轮逐条复跑，判据的其余部分（4 函数 + 2 类型的单一定义、`gate/config/utils.ts` 与 `gate/factories/loader.ts` 两个死文件已删、`gate/config/loader.ts` 的 config 加载函数与 `../factories/index.ts` 装配边未动、`abi.ts` 未动、out-of-scope pathspec 的 diff 为空）**全部通过**；`need` 八元组里唯一 MISS 的就是第一条 `goal-store.ts`。缺口是单点、可复现。

复现读数（本轮实测，八元组逐条）：

```
OK   cli/gate.ts               -> ../kernel/gate-run-options.ts
OK   gate/acceptance-runner.ts -> ../kernel/gate-run-options.ts
OK   gate/registry.ts          -> ../kernel/gate-run-options.ts
OK   gate/config/loader.ts     -> ../../kernel/gate-run-options.ts
OK   gate/config/index.ts      -> ../../kernel/gate-run-options.ts
OK   gate/factories/utils.ts   -> ../../kernel/gate-run-options.ts
OK   gate/factories/goal.ts    -> ../../kernel/gate-run-options.ts
MISS goal-store.ts             -> ./kernel/gate-run-options.ts
```

**为何上一次修复没保住（这是 done 任务，不是 in-flight，故不构成重复）**：GOAL-034 的落地任务 `goal-034-gate-run-options-to-kernel`（status: done）当时**确实**让 `goal-store.ts` 直接 `import { resolveAcceptanceTimeoutMs } from "./kernel/gate-run-options.ts"`（commit `56ba0b61b` 的 diff 逐字可见）。此后一次**无关重构** `411bb34c7`（2026-10-13「goal-driver/meta-driver: derive the outer goal-store child bound from the record's own deadline; clean the orphaned lock on a kill」）把 `goal-store.ts` 的 deadline 解析从 `resolveAcceptanceTimeoutMs`（kernel）换成 record-aware 的 `resolveAcceptanceTimeout`（定义在 `gate/acceptance-runner.ts`，经 `./gate/acceptance-runner.ts` import）——于是 `goal-store.ts` 对 kernel 的直接 import 消失，而护栏结构上仍要求它存在，判据转假。

**这不是要回退 `411bb34c7` 的行为修复**：record 自身的 `timeoutMs` 必须继续被尊重（该 commit 的意图正确）。要修的是**归属**：`resolveAcceptanceTimeout` 是一个纯函数（签名只吃 `recordTimeoutMs` + 一个可注入 env），其底座 `resolveAcceptanceTimeoutMs` 与唯一默认字面量 `DEFAULT_ACCEPTANCE_TIMEOUT_MS` **已经在** `kernel/gate-run-options.ts`——同一个「acceptance 超时解析」族被劈在两个文件里，正是这条护栏转假的根因。把 record-aware 半边放回 kernel leaf，goal-store 就恢复成 kernel 的真实消费者，护栏重新成立。

## Plan

1. 把 record-aware deadline 解析族从 `packages/quay/src/gate/acceptance-runner.ts` **逐字**下沉到 kernel leaf `packages/quay/src/kernel/gate-run-options.ts`（行为不变）：
   - `ACCEPTANCE_TIMEOUT_ENV`（常量 `"QUAY_ACCEPTANCE_TIMEOUT_MS"`）
   - `AcceptanceTimeout`（interface）
   - `resolveAcceptanceTimeout(recordTimeoutMs?: unknown, env: NodeJS.ProcessEnv = process.env)`
   - `timeoutKnobHint(t)`

   ⛔ kernel 文件必须继续保持**零 import**（leaf 边界，`import-graph-check.ts` 第四规则）：`resolveAcceptanceTimeout` 落在 kernel 后只需**同文件**的 `DEFAULT_ACCEPTANCE_TIMEOUT_MS`，不新增任何 import；把 `ACCEPTANCE_TIMEOUT_ENV` 也搬过去是必须的——若留在 acceptance-runner 而 kernel 反向 import 它，就会造出 kernel→gate 的环。

2. `packages/quay/src/gate/acceptance-runner.ts`：删除这四个定义；其余不变——`runAcceptance`/`runAcceptanceCapture`/`verdictFromAcceptance` 等，以及它自己的 `import { shQuote, DEFAULT_ACCEPTANCE_TIMEOUT_MS } from "../kernel/gate-run-options.ts"` 保持原样。

3. `packages/quay/src/goal-store.ts`：把 `resolveAcceptanceTimeout` / `timeoutKnobHint` 的 import 源从 `./gate/acceptance-runner.ts` 改为 `./kernel/gate-run-options.ts`（`runAcceptance` / `verdictFromAcceptance` / `FAILURE_REASON_MAX_CHARS` 仍来自 acceptance-runner）。只改 import 行与指向旧 home 的注释措辞，**不改任何调用点语义**。

4. `packages/quay/test/goal-gate-verdict-mapping.test.mjs`：其 `resolveAcceptanceTimeout` / `ACCEPTANCE_TIMEOUT_ENV` 的 import 源同步改到 `../src/kernel/gate-run-options.ts`——这两个符号的**测试消费点**，机械必然随之改口，不是顺手扩大范围。

4b. **（worker 复核补记，2026-10-13）第二个生产消费者**：`packages/quay-native/src/mcp-server.ts`（`goal_gate` MCP 工具）也从 `../../quay/src/gate/acceptance-runner.ts` 消费 `resolveAcceptanceTimeout` / `timeoutKnobHint`。原 Plan §1 的审计只 grep 了 `packages/quay/src`，遗漏了 quay-native（硬规则 5b：缺陷成簇、兄弟实例常在别处）。删定义而不同步改口这条 import 会让 quay-native 编译失败、`npx tsc --noEmit` 转红 ⇒ 机械必然随之改口，已加入 `## Touches`。

5. ⛔ 非目标（碰任一即停手回调查，不「顺手清理」）：`gate/engine.ts` / `gate/lifecycle.ts` / `gate/driver.ts` / `gate/types.ts` / `abi.ts` / `fan-in/*`；`gate/config/loader.ts` 的 `discoverWorkspaceRoot`/`loadWorkspaceGates`/`loadWorkspaceGateMetadata` 定义与其 `../factories/index.ts` 装配 import；`resolveAcceptanceTimeoutMs` / `resolveRunnerOptions` / `shQuote` / `GateConfig` / `RunnerOptions` 的定义与位置；任何 gate 的运行时行为 / 退出码 / 错误文案；⛔ 不回退 `411bb34c7` 的 record-aware 行为。

6. 回归（本刀触达的运行时路径）：`node --no-warnings --experimental-strip-types --test packages/quay/test/goal-gate-verdict-mapping.test.mjs packages/quay/test/goal-criterion-timeout-resolution.test.mjs packages/quay/test/goal-store.test.mjs packages/quay/test/acceptance.test.mjs packages/quay/test/acceptance-env.test.mjs packages/quay/test/gate.test.mjs packages/quay/test/gate-config-loader.test.mjs` 全绿；`npx tsc --noEmit` exit 0。⚠️ 直调 `node --test` 前先 `env -u QUAY_GOAL_ACCEPTANCE_ACTIVE`（worker 会话 shell 常泄漏该变量，`goal-store.test.mjs` 会在它存在时假红 8 条拒跑，与 delta 无关；`scripts/test.sh` 入口已自带 unset）。

7. 在本分支上直跑 AC-353 判据原文须 exit 0（等价 `quay goal gate AC-353` verdict=pass）。

## AC

- [x] `packages/quay/src/kernel/gate-run-options.ts` 持有 `ACCEPTANCE_TIMEOUT_ENV` / `AcceptanceTimeout` / `resolveAcceptanceTimeout` / `timeoutKnobHint` 的单一定义，且文件仍**零 import**（leaf）。—— `grep -nE '^export (const ACCEPTANCE_TIMEOUT_ENV|interface AcceptanceTimeout|function resolveAcceptanceTimeout|function timeoutKnobHint)' packages/quay/src/kernel/gate-run-options.ts` 四条全中；`grep -cE '^import ' packages/quay/src/kernel/gate-run-options.ts` 输出 `0`。
- [x] `packages/quay/src/gate/acceptance-runner.ts` 不再定义这四个符号。—— `grep -nE 'export (const ACCEPTANCE_TIMEOUT_ENV|interface AcceptanceTimeout|function resolveAcceptanceTimeout\b|function timeoutKnobHint)' packages/quay/src/gate/acceptance-runner.ts` 零命中。
- [x] `packages/quay/src/goal-store.ts` 直接 import `./kernel/gate-run-options.ts`（AC-353 的 `need` 第一条转 OK），且其 `runAcceptance` 仍来自 `./gate/acceptance-runner.ts`。—— `grep -nE 'from "\./kernel/gate-run-options\.ts"' packages/quay/src/goal-store.ts` 命中；`grep -nE 'from "\./gate/acceptance-runner\.ts"' packages/quay/src/goal-store.ts` 仍命中。
- [x] AC-353 判据原文在本分支上 exit 0。—— 原样重跑判据脚本 exit 0（或 `quay goal gate AC-353` verdict=pass）。
- [x] 回归测试文件全绿，且 `npx tsc --noEmit` exit 0。—— `env -u QUAY_GOAL_ACCEPTANCE_ACTIVE node --no-warnings --experimental-strip-types --test <7 文件>` 报 `fail 0`；`npx tsc --noEmit` exit 0。
- [x] 非目标零改动。—— `git diff --name-only develop...HEAD -- packages/quay/src/gate/engine.ts packages/quay/src/gate/lifecycle.ts packages/quay/src/gate/driver.ts packages/quay/src/gate/types.ts packages/quay/src/abi.ts packages/quay/src/fan-in` 输出为空。

## DoD

四个 record-aware deadline 解析符号在 `kernel/gate-run-options.ts` 有唯一定义、`gate/acceptance-runner.ts` 不再定义它们、`goal-store.ts` 直连 kernel 取 deadline；AC-353 判据在本分支上**原样直跑 exit 0**；本刀触达的运行时路径回归全绿；out-of-scope pathspec 的 diff 为空。落地即达成（AC-353 是 pre-merge 判据）——⛔ 本任务不请求合并、不评估 GOAL-034 的 post-merge AC-355。**REAL LANDING 的判据是「判据原文在分支树上重跑 exit 0」，不是「测试存在」。**

## Touches

- packages/quay/src/kernel/gate-run-options.ts
- packages/quay/src/gate/acceptance-runner.ts
- packages/quay/src/goal-store.ts
- packages/quay/test/goal-gate-verdict-mapping.test.mjs
- packages/quay-native/src/mcp-server.ts
- tasks/gap-ac353-goal-store-deadline-resolver-not-kernel.md

## Evidence

（filing 轮读数，供 worker 复核起点）本轮直跑 AC-353 判据的 `need` 八元组：7 OK + 1 MISS（`goal-store.ts`）；判据整体 `CAUSE=consumer-not-converged -- goal-store.ts does not import kernel/gate-run-options.ts`。定位到破护栏的重构为 `411bb34c7`（`git log -S'./kernel/gate-run-options.ts' -- packages/quay/src/goal-store.ts` 只回两条：`56ba0b61b` 加入、`411bb34c7` 移除）。四个待搬符号的消费者审计：`grep -rn '\b(resolveAcceptanceTimeout|timeoutKnobHint|AcceptanceTimeout|ACCEPTANCE_TIMEOUT_ENV)\b' packages/quay/src` ⇒ 生产侧仅 `goal-store.ts`；测试侧仅 `goal-gate-verdict-mapping.test.mjs`。

**（worker 落地轮，2026-10-13）** 上面的消费者审计**不完备**：它只覆盖 `packages/quay/src`，遗漏了 `packages/quay-native/src/mcp-server.ts`（`goal_gate` MCP 工具从 `../../quay/src/gate/acceptance-runner.ts` 消费 `resolveAcceptanceTimeout`/`timeoutKnobHint`，两处调用点 L534/L539）。已同步改口到 kernel，并加入 `## Touches`。落地轮实测读数：AC-353 判据原文 exit 0（PASS 行）；7 个回归文件 `pass 202 / fail 0`；`npx tsc --noEmit` exit 0；out-of-scope pathspec diff 为空。
