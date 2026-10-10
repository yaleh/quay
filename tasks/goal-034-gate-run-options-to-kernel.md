---
id: goal-034-gate-run-options-to-kernel
title: gate 包环收敛第一刀实现：gate/config/utils.ts 的纯原语 + GateConfig/RunnerOptions 类型下沉
  kernel，删除两个死文件（GOAL-034 落地任务，分支 goal/GOAL-034）
status: ready
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

- [ ] `packages/quay/src/kernel/gate-run-options.ts` exists and is the sole definition site of `shQuote`, `DEFAULT_ACCEPTANCE_TIMEOUT_MS`, `resolveAcceptanceTimeoutMs`, `resolveRunnerOptions`, `GateConfig`, `RunnerOptions`.
- [ ] `packages/quay/src/gate/config/utils.ts` and `packages/quay/src/gate/factories/loader.ts` are both deleted (`git status` shows them removed, not emptied).
- [ ] The 7 consumers listed in Plan step 4 import from `kernel/gate-run-options.ts`; `gate/factories/utils.ts` imports from `kernel/gate-run-options.ts` (Plan step 5) while its 6 sibling consumers are untouched.
- [ ] `gate/config/loader.ts` still defines `discoverWorkspaceRoot`/`loadWorkspaceGates`/`loadWorkspaceGateMetadata` and still imports `../factories/index.ts`.
- [ ] `abi.ts`, `gate/engine.ts`, `gate/lifecycle.ts`, `gate/driver.ts`, `gate/types.ts`, and anything under `fan-in/` are untouched (`git diff --name-only develop...HEAD` does not list them).
- [ ] The 7 regression test files (Plan step 7) all pass.
- [ ] Typecheck passes.
- [ ] `quay goal gate AC-353` reads exit 0 on this branch.
- [ ] `quay goal gate AC-354` reads exit 0 on this branch.

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
- tasks/goal-034-gate-run-options-to-kernel.md