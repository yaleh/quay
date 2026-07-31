# M214 — DIR-123: real per-milestone worktree isolation for execute-milestone.js

**Task:** DIR-123 · **Class:** development · **Value type:** capabilityGrowth
**Deliverable:** yes · **Charter tokens:** ~0.3 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ > 0 (capability-growth, deliverable, method-infra surface). Two execute-milestone
dispatches for file-disjoint tasks cannot run concurrently today — both operate directly
on the same shared working tree with no isolation boundary. This child adds opt-in
`isolationMode:'worktree'` routing: Build creates a real git worktree, Audit/Gate run
against it, Land merges back + cleans up. Legacy path (no isolationMode) unchanged.
Enables genuine concurrent milestone dispatch once proven on real disjoint candidates.

## Prepared-gate note

Dispatched under the M195/DIR-117-B enforced-by-default Prepared gate: carries a real
`prepare-milestone.js` receipt consumed by its `execute-milestone.js` dispatch.

## Scope

Per `tasks/DIR-123.md`'s own Requested action / Acceptance Criteria / Definition of Done —
not duplicated here. In short: opt-in `$a.isolationMode:'worktree'` arg; Build creates
worktree (`git worktree add`), threads path through Audit/Gate; Land merges + removes;
legacy path golden-replay identical; real concurrent-dispatch proof (two file-disjoint
milestones with overlapping Build timestamps); same-file-conflict fixture; reuse
`touches-orthogonality-check.ts` for eligibility; fix stale Land prompt text.

## Touches

Per `tasks/DIR-123.md`'s own `## Touches` list — not duplicated here.

## Done-when

Per `tasks/DIR-123.md`'s own AC/DoD. Most important: two real, file-disjoint milestones
dispatched with `isolationMode:'worktree'` show genuinely overlapping Build-phase
timestamps and both Land correctly with independent, uncorrupted commits.

## Inner termination

Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ 26b651746d5f85f9fa317b65e204932089b75a16
