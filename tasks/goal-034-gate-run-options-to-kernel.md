---
id: goal-034-gate-run-options-to-kernel
title: gate 包环收敛第一刀实现：gate/config/utils.ts 的纯原语 + GateConfig/RunnerOptions 类型下沉
  kernel，删除两个死文件（GOAL-034 落地任务，分支 goal/GOAL-034）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-353
---
**type:** execution

## Proposal

Land GOAL-034's slice on branch `goal/GOAL-034`: move `packages/quay/src/gate/config/utils.ts`'s 4 pure functions (`shQuote`, `DEFAULT_ACCEPTANCE_TIMEOUT_MS`, `resolveAcceptanceTimeoutMs`, `resolveRunnerOptions`) plus the 2 types they need from `gate/config/types.ts` (`GateConfig`, `RunnerOptions`) into a new file `packages/quay/src/kernel/gate-run-options.ts`; re-point every real consumer to import from there; delete the two now-empty/dead files (`gate/config/utils.ts`, and the unrelated already-dead `gate/factories/loader.ts`, which has zero importers repo-wide and is a stale DIR-087 re-export shim). Full investigation, edge inventory, and ownership rationale are in GOAL-034's body — read it first; this task is the implementation of that goal's declared scope, not a fresh investigation.

## Plan

1. Create `packages/quay/src/kernel/gate-run-options.ts` containing (moved verbatim, behavior unchanged): `GateConfig`, `RunnerOptions` (types, from `gate/config/types.ts`), `shQuote`, `DEFAULT_ACCEPTANCE_TIMEOUT_MS`, `resolveAcceptanceTimeoutMs`, `resolveRunnerOptions` (from `gate/config/utils.ts`). Remove `GateConfig`/`RunnerOptions` from `gate/config/types.ts` (its other 8 types — `GateSource`, `GateDiagnostic`, `It0Entry`, `FixedEntry`, `TestPassEntry`, `CoverageFloorEntry`, `RedGreenEntry`, `GatesConfig` — stay put, untouched).
2. Delete `packages/quay/src/gate/config/utils.ts` entirely (no shim left behind — methodology's anti-shell-move rule).
3. Delete `packages/quay/src/gate/factories/loader.ts` entirely (dead file, zero importers — verify with `grep -rn "factories/loader" packages/quay/src --include="*.ts"` before deleting, should show 0 hits besides itself).
4. Re-point these 7 real consumers to import from `kernel/gate-run-options.ts` instead of `gate/config/utils.ts` / `gate/config/types.ts`:
   - `packages/quay/src/goal-store.ts` (`resolveAcceptanceTimeoutMs`)
   - `packages/quay/src/cli/gate.ts` (`resolveRunnerOptions`)
   - `packages/quay/src/gate/acceptance-runner.ts` (`shQuote`, `DEFAULT_ACCEPTANCE_TIMEOUT_MS`)
   - `packages/quay/src/gate/registry.ts` (`resolveRunnerOptions` — keep its existing `discoverWorkspaceRoot`/`loadWorkspaceGates`/`loadWorkspaceGateMetadata` imports from `./config/loader.ts` UNCHANGED)
   - `packages/quay/src/gate/config/loader.ts` (`GateConfig`, `resolveRunnerOptions` — keep its own exported functions `discoverWorkspaceRoot`/`loadWorkspaceGates`/`loadWorkspaceGateMetadata`/`readGatesConfig` and its import of `../factories/index.ts` UNCHANGED)
   - `packages/quay/src/gate/config/index.ts` (the barrel: change `export { shQuote, resolveRunnerOptions } from "./utils.ts"` to source from `../../kernel/gate-run-options.ts`; its re-export of the other 8 types from `./types.ts` stays unchanged)
   - `packages/quay/src/gate/factories/goal.ts` (`resolveRunnerOptions`)
5. **Deliberate exception — do NOT touch these 6 files**: `gate/factories/{fixed-script,it0,coverage-floor,test-pass,red-green,adr}.ts` all import `GateConfig`/`resolveRunnerOptions`/`shQuote` from the SAME-DIRECTORY `./utils.ts` (i.e. `gate/factories/utils.ts`, not the deleted `gate/config/utils.ts` — different file, same basename). Instead, re-point `gate/factories/utils.ts` itself (just that one file) to source its two re-export lines from `../../kernel/gate-run-options.ts` instead of `../config/{utils,types}.ts`. The 6 sibling files then need zero changes. This is documented in GOAL-034's body as a deliberate in-directory-barrel exception to the anti-shell-move rule, not an oversight — do not "fix" it by touching the 6 files.
6. Do NOT touch (non-goals, explicitly out of scope — touching any of these is a stop-and-reconsider signal, not a thing to "clean up along the way"): `gate/engine.ts`, `gate/lifecycle.ts`, `gate/driver.ts`, `gate/types.ts`, `abi.ts`, anything under `fan-in/`, the `discoverWorkspaceRoot`/`loadWorkspaceGates`/`loadWorkspaceGateMetadata` functions themselves, the `gate/config/loader.ts → gate/factories/index.ts` wiring import.
7. Run the regression suite for the 7 affected test files: `node --no-warnings --experimental-strip-types --test packages/quay/test/gate-config-loader.test.mjs packages/quay/test/gate.test.mjs packages/quay/test/goal-store.test.mjs packages/quay/test/acceptance.test.mjs packages/quay/test/acceptance-env.test.mjs packages/quay/test/gate-diagnostics.test.mjs packages/quay/test/gate-ergonomics.test.mjs` — must be all green before landing.
8. Run `npx tsc --noEmit` (or this repo's equivalent typecheck gate) to confirm no type errors from the relocation.
9. Evaluate AC-353 and AC-354 on this branch (`quay goal gate AC-353`, `quay goal gate AC-354`) — both must read exit 0 before this task is considered done. AC-355 is post-merge and is NOT expected to pass yet from this branch.

## Acceptance Criteria

- [x] `packages/quay/src/kernel/gate-run-options.ts` exists and is the sole definition site of `shQuote`, `DEFAULT_ACCEPTANCE_TIMEOUT_MS`, `resolveAcceptanceTimeoutMs`, `resolveRunnerOptions`, `GateConfig`, `RunnerOptions`. —— AC-353 判据 exit 0；`defOnly` 在 `packages/quay/src/**/*.ts` 全树内对 4 函数各找到恰好 1 处定义，且都在新文件。
- [x] `packages/quay/src/gate/config/utils.ts` and `packages/quay/src/gate/factories/loader.ts` are both deleted (`git status` shows them removed, not emptied). —— `git status --short` 两行 `D`；AC-353 的 `[ ! -e ]` 两条均通过（无 shim）。
- [x] The 7 consumers listed in Plan step 4 import from `kernel/gate-run-options.ts`; `gate/factories/utils.ts` imports from `kernel/gate-run-options.ts` (Plan step 5) while its 6 sibling consumers are untouched. —— AC-353 的 `need` 八元组逐条通过；6 个同族文件的 `git diff --name-only develop...HEAD` 为空。
- [x] `gate/config/loader.ts` still defines `discoverWorkspaceRoot`/`loadWorkspaceGates`/`loadWorkspaceGateMetadata` and still imports `../factories/index.ts`. —— loader.ts:114 / :471 / :331 三个定义仍在；:13 装配 import 仍在（AC-353 的 `nongoal` + `wiring-edge` 两段通过）。
- [x] `abi.ts`, `gate/engine.ts`, `gate/lifecycle.ts`, `gate/driver.ts`, `gate/types.ts`, and anything under `fan-in/` are untouched (`git diff --name-only develop...HEAD` does not list them). —— 该 pathspec 的 `git diff --name-only develop...HEAD` 输出为空。
- [x] The 7 regression test files (Plan step 7) all pass. —— 7 文件 + 本刀新触达的 2 个测试文件共 **230/230 pass, 0 fail**（`env -u QUAY_GOAL_ACCEPTANCE_ACTIVE`，见 `## Evidence` 的 env 说明）。
- [x] Typecheck passes. —— `npx tsc --noEmit -p tsconfig.json` exit 0。
- [x] `quay goal gate AC-353` reads exit 0 on this branch. —— 直接跑判据原文：`PASS: kernel/gate-run-options.ts holds the single definitions of the 4 functions + 2 types; …`，exit 0。
- [x] `quay goal gate AC-354` reads exit 0 on this branch. —— 直接跑判据原文：`{"fork_point":"162f8c38…","before":{"root_to_gate_config":1,"factories_to_config_lines":5},"after":{"root_to_gate_config":0,"factories_to_config_lines":0},"negative_control_count_on_scratch_regression":1}` + `PASS: root->gate/config edge count 1 -> 0; …`，exit 0。

## Definition of Done

The slice lands on `goal/GOAL-034` with AC-353 and AC-354 both reading exit 0 when evaluated on this branch, the 7-file regression suite green, and no out-of-scope file touched. This task does not merge the goal branch into develop (that is a separate human-triggered `quay goal merge` step per the methodology) and does not evaluate AC-355 (post-merge only).

## Touches

- packages/quay/src/kernel/gate-run-options.ts
- packages/quay/src/gate/config/utils.ts
- packages/quay/src/gate/config/types.ts
- packages/quay/src/gate/config/loader.ts
- packages/quay/src/gate/config/index.ts
- packages/quay/src/gate/factories/loader.ts
- packages/quay/src/gate/factories/utils.ts
- packages/quay/src/gate/factories/goal.ts
- packages/quay/src/gate/acceptance-runner.ts
- packages/quay/src/gate/registry.ts
- packages/quay/src/goal-store.ts
- packages/quay/src/cli/gate.ts
- packages/quay/test/goal-criterion-timeout-resolution.test.mjs
- packages/quay/test/goal-gate-verdict-mapping.test.mjs
- tasks/goal-034-gate-run-options-to-kernel.md

## Evidence

### 两个测试文件为何进入 Touches（Plan 第 4 步之外的真实消费点，机械必然）

`grep -rn "config/utils" packages/quay/test` 命中两处**真实 import**（不是注释），二者都不在 Plan 第 7 步的 7 文件清单里，但删掉 `gate/config/utils.ts` 后必然变红：

- `packages/quay/test/goal-criterion-timeout-resolution.test.mjs:42` —— import `resolveAcceptanceTimeoutMs`/`DEFAULT_ACCEPTANCE_TIMEOUT_MS`；其 AC2 静态不变量还**行走 `src/gate/`** 断言「字面量只在一处定义」，随常量一起搬到 `src/kernel/`，故 walk 与期望值同步跟随。
- `packages/quay/test/goal-gate-verdict-mapping.test.mjs:54` —— import `DEFAULT_ACCEPTANCE_TIMEOUT_MS`。

两处都是「消费点改口」的机械延伸（改的是 import 路径与随之迁移的常量 home，未改断言语义），故按 `anti-drift-touches-check` 的 arm (a) 如实**加宽 `## Touches`**，而不是回退掉合法必需的文件。

### 结构读数（AC-353 / AC-354 的载体）

- 新文件 `packages/quay/src/kernel/gate-run-options.ts`（6120 B，kernel leaf，零 import）持有 4 函数 + 2 类型的**单一**定义；`GateConfig`/`RunnerOptions` 已从 `gate/config/types.ts` 移除（其余 8 类型原处未动）。
- 两个死文件确实消失：`git diff --name-status develop...HEAD` ⇒ `D packages/quay/src/gate/factories/loader.ts`；`gate/config/utils.ts` 因内容足够相似被 git 判为 **rename**（`R059 packages/quay/src/gate/config/utils.ts → packages/quay/src/kernel/gate-run-options.ts`）——文件本身已不在树上，无 shim 残留（AC-353 的 `[ ! -e ]` 直接证）。
- 7 个真实消费点 + `gate/factories/utils.ts`（唯一有意保留的同目录 barrel）全部改口 `kernel/gate-run-options.ts`；`gate/factories/{fixed-script,it0,coverage-floor,test-pass,red-green,adr}.ts` 六个同族文件**零改动**。
- 非目标未动：`gate/config/loader.ts` 仍定义 `discoverWorkspaceRoot`(:114)/`loadWorkspaceGates`(:471)/`loadWorkspaceGateMetadata`(:331)，并仍 `import { gateFactories } from "../factories/index.ts"`(:13)；`git diff --name-only develop...HEAD -- gate/engine.ts gate/lifecycle.ts gate/driver.ts gate/types.ts abi.ts fan-in` 输出为空。

### 判据运行（逐字）

- AC-353：`PASS: kernel/gate-run-options.ts holds the single definitions of the 4 functions + 2 types; gate/config/utils.ts and gate/factories/loader.ts are both gone (no shell-move shim); seven real consumers converged; non-goal files (loader.ts config-loading functions, the config-to-factories wiring import, abi.ts) are untouched` ⇒ exit 0（`quay goal gate AC-353` 同 verdict=pass）。
- AC-354：`{"fork_point":"162f8c380ed1dd9267167cc791ef8727fd13269d","before":{"root_to_gate_config":1,"factories_to_config_lines":5},"after":{"root_to_gate_config":0,"factories_to_config_lines":0},"negative_control_count_on_scratch_regression":1}` + `PASS: root->gate/config edge count 1 -> 0; gate/factories->gate/config line count 5 -> 0 (file deletion + 2 real redirects); negative control on a scratch regression correctly re-detects the old edge` ⇒ exit 0。负对照实测计数 = 1（把旧 import 注回 scratch 副本后计数确实回升）⇒ 计数法可证伪。

### 测试 / 类型

- 9 个测试文件（Plan 第 7 步的 7 个 + 上节加宽进来的 2 个）：`ℹ tests 230 / ℹ pass 230 / ℹ fail 0`，exit 0。
- `npx tsc --noEmit -p tsconfig.json` exit 0。

### ⚠️ 负控制：goal-store.test.mjs 的 8 红是**环境**不是代码（硬规则 4b / 3b）

第一次直接跑出现 8 红（I5 ×3、AC4 负控制、AC-242 successor ×4，全部 `achievedButFailing: []`）。这是本 worker 会话 shell 里泄漏的 `QUAY_GOAL_ACCEPTANCE_ACTIVE=1`（`goal-store.ts` 的准则重入守卫）毒化 in-process 准则读取所致——`checkAchievedFailing` 返回 `evaluated:false`，与「跑过且全过」的 `[]` 同形。

- 判别命令：`env -u QUAY_GOAL_ACCEPTANCE_ACTIVE node --test …` ⇒ 8 红全消。
- 已对照 pristine `goal/GOAL-034` worktree 与 pristine `develop` worktree：同样 8 红（同样在毒化 env 下），**证明与 delta 无关**。
- `scripts/test.sh` 入口已 `unset QUAY_GOAL_ACCEPTANCE_ACTIVE`（该修复 2026-09-24 落地 `b566e683`），故 scoped 门/suite 走 test.sh 时不受影响；受影响的只有绕过入口的裸 `node --test`。
