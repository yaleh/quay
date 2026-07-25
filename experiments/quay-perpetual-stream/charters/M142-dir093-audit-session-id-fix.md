# M142 — Fix audit-indep gate session-ID matching in execute-milestone.js

**Task:** DIR-093
**Milestone counter:** 142
**Chart:** 2
**Class:** methodology (governance-integrity — control mechanism fix)
**Value type:** governance-integrity
**Cadence:** exploit
**Deliverable:** no (driver infrastructure)
**Charter tokens:** ~0.5 K
**type:** learning

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ = 0 (driver infrastructure — fixes a control mechanism that is systemically
blocking all milestone ABSORB). Real value: audit-indep gate passes reliably on
the first workflow run, eliminating the ~1M token / 10 min waste per milestone
from re-dispatches. Unblocks M139/M140/M141 which have correct implementations
but failed at the broken gate.

## Scope

One file, narrow change:

`.claude/workflows/execute-milestone.js` — add session-ID write-back step between
Audit and Gate phases. After Audit agent returns its structured output (which includes
its session ID), append the ID to both:
1. The absorb entry's dispatch record (`/tmp/m<NN>-absorb-entry.md`)
2. The audit artifact header (`milestones/M<NN>/audits/iteration-0-acceptance-audit.md`)

## Touches
- .claude/workflows/execute-milestone.js

## Done-when (binary)

1. Audit agent's session ID is appended to absorb entry dispatch record before Gate runs.
2. Audit artifact header includes embedded session ID.
3. `audit-independence-check.sh` passes on first workflow run for a new milestone.
4. Anti-forgery property preserved: orchestrator appends Audit agent's returned session ID, never self-generates.
5. Existing gate scripts and workflow phases continue to work (no regression).

## Inner termination

Done-when-complete OR external HALT.

## it0 systematic-explore checks

See HARD GATES block by-reference (inherited-core.md).
