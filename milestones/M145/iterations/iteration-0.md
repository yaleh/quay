# M145 Iteration 0 Report

**Task:** DIR-097
**Charter:** M145-dir097-gate-fix.md
**Class:** methodology (governance-integrity)
**Cadence:** exploit

## Summary

Removed 3 gate agents (acceptance/dod-meta, impl-row, audit-indep) from the
execute-milestone Workflow Gate phase. These gates require outer-loop context
(task store, full filesystem, backlog state) that is not reliably available
inside workflow subagent environments, causing 6 consecutive milestones
(M139-M144) to require manual landing.

## Changes

### .claude/workflows/execute-milestone.js

**Deleted** (3 gate agents removed from `parallel([...])` in Gate phase):
- `impl-row` -- `it0-impl-row-check.sh` (requires full backlog.md context)
- `dod-meta` -- `quay gate ${args.taskId}` acceptance gate (extra.acceptance not reliably available in subagent env)
- `audit-indep` -- DIR-093 inline audit-independence check (requires audit artifact filesystem access and session-id pass-through)

**Retained** (5 gates still run):
- `vmeta-lag` -- V_meta ledger lag check
- `dash-budget` -- dashboard line budget check
- `tree` -- tree hygiene check
- `worktree` -- worktree branch hygiene check
- `split-or-commit` -- DIR-026 split-or-commit validation

**Updated**: Audit session ID warning log message (line 130) to reflect that
audit-indep gate is removed from Workflow and runs at fan-in ABSORB instead.

### Verification

- **Verify phase**: unchanged (all 5 it0 checks intact)
- **Build phase**: unchanged
- **Audit phase**: unchanged
- **Gate phase**: 3 gates removed, 5 retained
- **Land phase**: unchanged (both concurrent and serial paths)

Tests: Core quay tests (gate, CLI, MCP, action-delivery) all pass.

## Done-when checklist

| # | Item | Status |
|---|------|--------|
| 1 | Gate phase no longer runs acceptance, impl-row, or audit-indep | DONE |
| 2 | One full milestone lands via Workflow without manual intervention | Next milestone will prove |
| 3 | Remaining gates (vmeta-lag, dash-budget, tree, worktree, split-or-commit) still run | DONE (verified) |
| 4 | Verify, Build, Audit phases unchanged | DONE (verified) |

## Touched files

- `.claude/workflows/execute-milestone.js`
