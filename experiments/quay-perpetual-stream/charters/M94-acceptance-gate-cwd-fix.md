# Charter M94-acceptance-gate-cwd-fix — Acceptance gate cwd threading fix (PROBE-SV-M92-001)

**Milestone id:** M94  
**Task:** `tasks/PROBE-SV-M92-001.md` (milestone-candidate, defect)  
**Surface:** `packages/quay/src/gate/registry.ts` — `acceptance` gate's `resolveRunnerOptions()` call  
**Type:** development-class / defect (DIR-046 regression)  
**Charter authored:** 2026-07-22  
**Base commit:** master HEAD (see `git rev-parse HEAD` at dispatch time)  
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

The built-in `acceptance` gate in `packages/quay/src/gate/registry.ts` calls `resolveRunnerOptions()` with NO `gateConfig` argument (lines ~468–484):

```ts
const { cwd, timeoutMs } = resolveRunnerOptions();   // ← no gateConfig, no workspaceRoot
const { ok, reason } = runAcceptance({ command, cwd, timeoutMs });
```

`resolveRunnerOptions()` without `gateConfig` falls back to:
```ts
cwd = process.env.QUAY_ACCEPTANCE_CWD || process.cwd()
```

DIR-046 documents that `quay gate <task>` must run the acceptance command in the **worktree** directory when called with `--cwd <worktree>`. The CLI passes `--cwd` → `workspaceRoot` → `engine.runGate({ workspaceRoot })`, but `engine.runGate` never passes `workspaceRoot` into the `GateFn` closure (signature: `(task, client)`). The worktree path is silently discarded.

Filed as PROBE-SV-M92-001 by the self-validation probe at M92.

## Scope

**In scope:**
1. Thread `workspaceRoot` from `engine.runGate({ workspaceRoot })` into the `acceptance` gate's `resolveRunnerOptions()` call, so `cwd` is the worktree when `--cwd` is supplied.
2. Two implementation options (adjudicated via quay-task-to-plan):
   - **Option A (signature thread):** Change `GateFn` to `(task, client, opts: { workspaceRoot?: string })` and pass through to `resolveRunnerOptions({ workspaceRoot })`.
   - **Option B (env-var path):** Set `QUAY_ACCEPTANCE_CWD` from the CLI `--cwd` flag in the engine invocation path — no signature change but relies on env-var side channel.
3. TDD per ADR-001: a test that creates a worktree-only artifact, runs `gate` with `--cwd <worktree>`, and verifies the acceptance command runs in the specified directory (not `process.cwd()`).
4. Confirm no regression in existing gate tests.

**Out of scope:**
- Fixing other gate types (startMcpServer, etc.) for cwd threading — scope is `acceptance` gate only.
- QUAY_ACCEPTANCE_CWD documentation (only if Option B is adopted by the adjudicator).
- ARCH-M93-* findings (god-package, god-functions, ABI violation) — separate milestones.

## Class routing

**Development-class** — product code change in `packages/quay/src/gate/`. MUST go through `quay-task-to-plan` pipeline (N independent blank-slate proposals → adjudication → reconciled proposal → milestone-level plan) BEFORE dispatch to `baime:iteration-executor`. Per OUTER-LOOP.md step 5a.

## Acceptance Criteria

- [ ] `quay gate <task> --gate acceptance --cwd <worktree>` runs the acceptance command with `cwd === <worktree>`, not `process.cwd()` — confirmed by a test that creates a worktree-only file and verifies gate result.
- [ ] `QUAY_ACCEPTANCE_CWD` env var is either documented as the canonical mechanism or replaced by direct threading; behavior is deterministic.
- [ ] No regression in existing gate tests.

## Definition of Done

References the standard inherited-core DoD clauses; the bar is REAL LANDING, not artifacts:
- [ ] `quay gate <task> --gate acceptance --cwd <worktree>` uses the worktree cwd; confirmed by a real gate run (not a fixture) with pasted output showing correct cwd resolution.
- [ ] TDD per ADR-001: test exercises the `--cwd` flag and verifies acceptance command runs in the specified directory.
- [ ] Plugin re-vendored + bumped if any plugin scripts were touched.
- [ ] Fresh-context adversarial audit confirms the fix and that no other gate types have the same cwd-threading gap.
- [ ] Per DIR-026 SPLIT-OR-COMMIT: the cwd-threading fix lands done-or-`needs-human`.

## GATE-HASH-REF

`33de7bbae2cda1eaea5e31cd9199da82c65b1a391042ce7638d81157fed92deb`  
(SHA-256 of `experiments/quay-perpetual-stream/scripts/it0-dod-check.mjs` at charter time — the iteration-0 agent MUST verify this matches before running gates)
