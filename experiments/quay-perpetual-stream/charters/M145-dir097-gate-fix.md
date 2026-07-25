# M145 — Fix systemic Gate phase failures in execute-milestone Workflow

**Task:** DIR-097
**Milestone counter:** 145
**Chart:** 2
**Class:** methodology (governance-integrity — control mechanism fix)
**Value type:** governance-integrity
**Cadence:** exploit
**Deliverable:** no (driver infrastructure)
**Charter tokens:** ~0.4 K
**type:** learning

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ = 0 (driver infrastructure). Real value: 6 consecutive milestones (M139-M144)
required manual landing because 3 gates (acceptance, impl-row, audit-indep) consistently
fail inside Workflow execution. Removing them from the Workflow's Gate phase eliminates
the systemic blocker. These gates are designed for the outer loop's fan-in ABSORB step
which has full context.

## Scope

One file, delete-only change:

`.claude/workflows/execute-milestone.js` — remove 3 Gate agents (acceptance/dod-meta,
impl-row, audit-indep) that are not Workflow-safe. Keep the 4 remaining gates
(vmeta-lag, dash-budget, tree-hygiene, worktree-branch-hygiene, split-or-commit).

## Touches
- .claude/workflows/execute-milestone.js

## Done-when (binary)

1. execute-milestone.js Gate phase no longer runs acceptance, impl-row, or audit-indep.
2. One full milestone lands via Workflow without manual intervention.
3. Remaining gates (vmeta-lag, dash-budget, tree, worktree, split-or-commit) still run.
4. Verify, Build, Audit phases unchanged.

## Inner termination

Done-when-complete OR external HALT.

## it0 systematic-explore checks

See HARD GATES block by-reference (inherited-core.md).
