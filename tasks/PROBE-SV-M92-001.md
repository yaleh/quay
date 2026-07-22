---
id: PROBE-SV-M92-001
title: "defect: built-in acceptance gate ignores workspaceRoot/--cwd; always
  runs in process.cwd() (DIR-046 regression)"
status: todo
labels:
  - milestone-candidate
  - defect
  - milestone:M-94
parent: null
children: []
extra:
  schema: v1
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    PROBE-SV-M92-001
    experiments/quay-perpetual-stream/charters/M94-acceptance-gate-cwd-fix.md
    /tmp/m94-absorb-entry.md
---
## Finding

**WHAT:** The built-in `acceptance` gate in `packages/quay/src/gate/registry.ts` (line ~482) calls `resolveRunnerOptions()` with NO `gateConfig` argument, so `cwd` always resolves to `process.env.QUAY_ACCEPTANCE_CWD || process.cwd()`. The `GateFn` signature is `(task, client)` — `workspaceRoot` is never threaded in.

**WHERE:** `packages/quay/src/gate/registry.ts`, the `acceptance:` entry in `gateRegistry` (lines 468–484):
```ts
const { cwd, timeoutMs } = resolveRunnerOptions();   // ← no gateConfig, no workspaceRoot
const { ok, reason } = runAcceptance({ command, cwd, timeoutMs });
```

**WHY it matters:** DIR-046 documents that `quay gate <task>` should run the acceptance command in the **worktree** (not `process.cwd()`) via `--cwd <worktree>`. The loop-driver SKILL.md says "gate runs against the BUILT worktree, not workspaceRoot — DIR-046". The CLI passes `--cwd` → `workspaceRoot` → `engine.runGate({ workspaceRoot })`, but `engine.runGate` never passes `workspaceRoot` into the `GateFn` closure. So for a task whose acceptance command assumes a worktree path, the gate silently runs in the wrong directory, producing a false PASS or false FAIL against the unbuilt master tree instead of the built worktree.

**Concrete reproduction:**
1. Create a task with `extra.acceptance: "ls worktree-only-file.txt"`.
2. Add `worktree-only-file.txt` only in a worktree (not in master).
3. Run `quay gate <task> --gate acceptance --cwd <worktree>`.
4. The command runs in `process.cwd()` (the driver's cwd, NOT the worktree) → fails on the worktree content, passes on the master content, or vice versa.

**Note:** `QUAY_ACCEPTANCE_CWD` env var is an escape hatch but is not set by the CLI `--cwd` flag, and the SKILL.md does not document it as the mechanism. The architectural fix is to thread `workspaceRoot` into the `GateFn` signature or to set `QUAY_ACCEPTANCE_CWD` from the CLI's `--cwd` flag in the engine invocation path.

## Proposal

Wire `workspaceRoot` (from `--cwd` CLI flag) through to the `acceptance` gate's `resolveRunnerOptions()` call, so the gate runs in the correct directory. See quay-task-to-plan output for the adjudicated proposal.

## Plan

N/A — quay-task-to-plan pipeline will settle the implementation approach (GateFn signature threading vs env-var path) and write back the reconciled proposal + plan. Development-class milestone.

## Acceptance Criteria
- [ ] `quay gate <task> --gate acceptance --cwd <worktree>` runs the acceptance command with `cwd === <worktree>`, not `process.cwd()` — confirmed by a test that creates a worktree-only file and verifies the gate result.
- [ ] `QUAY_ACCEPTANCE_CWD` env var is either documented as the canonical mechanism or replaced by direct threading; behavior is deterministic and doesn't rely on undocumented env vars.
- [ ] No regression in existing gate tests.

## Definition of Done
References the standard inherited-core DoD clauses; the bar is REAL LANDING, not artifacts:
- [ ] `quay gate <task> --gate acceptance --cwd <worktree>` uses the worktree cwd; confirmed by a real gate run (not a fixture) with pasted output showing correct cwd resolution.
- [ ] TDD per ADR-001: test that exercises the `--cwd` flag and verifies acceptance command runs in the specified directory.
- [ ] Plugin re-vendored + bumped if any plugin scripts were touched.
- [ ] Fresh-context adversarial audit confirms the fix and that no other gate types have the same cwd-threading gap.
- [ ] Per DIR-026 SPLIT-OR-COMMIT: the cwd-threading fix lands done-or-`needs-human`.

## Not selected (M93)

Not selected M93 — exp5-M-ARCH-AUDIT-M93-EXPLORE selected (mandatory explore slot; this defect is an exploit candidate, deferred to M94+ post-explore reset).
