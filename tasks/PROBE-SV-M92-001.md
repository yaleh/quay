---
id: PROBE-SV-M92-001
title: "defect: built-in acceptance gate ignores workspaceRoot/--cwd; always runs in process.cwd() (DIR-046 regression)"
status: todo
labels:
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
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

**Note:** `QUAY_ACCEPTANCE_CWD` env var is an escape hatch but is not set by the CLI `--cwd` flag, and the SKILL.md does not document it as the mechanism. The architectural fix is to thread `workspaceRoot` into the `GateFn` signature (a breaking change to the gate ABI) or to use `QUAY_ACCEPTANCE_CWD` as a pinned env var in the acceptance gate invocation path.

## Acceptance Criteria
- [ ] `quay gate <task> --gate acceptance --cwd <worktree>` runs the acceptance command with `cwd === <worktree>`, not `process.cwd()` — confirmed by a test that creates a worktree-only file and verifies the gate result.
