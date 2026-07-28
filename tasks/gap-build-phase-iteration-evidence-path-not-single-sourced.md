---
id: gap-build-phase-iteration-evidence-path-not-single-sourced
title: execute-milestone.js's Build-phase EVIDENCE step hand-derives the
  milestones/ path from prose instead of calling gate_resolve_milestone_root() —
  recurred 3 times this session (M179, M185, M188)
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
  - human-steered
parent: null
children: []
extra:
  schema: v1
---
## Proposal

Change the Build-phase EVIDENCE instruction in `execute-milestone.js` (both mirrors) to explicitly
call `gate_resolve_milestone_root`, the same single-sourced resolver Audit/Land already use, instead
of bare prose that leaves the Build agent to re-derive the `milestones/` path itself — the exact
class of bug `gap-absorb-charter-audit-not-committed` was filed to eliminate. See `## Finding`/
`## Requested action` below for the full root cause and fix.

## Plan

N/A — directive resolved via a human-steered milestone (this touches
`.claude/workflows/execute-milestone.js`, a driver execution-chain script — quay-directive skill
step-4 override applies). Small, surgical change (one instruction line, both mirrors); no separate
`docs/plans/*.md` needed.

## Finding

Real, root-caused recurrence, not a one-off: the Build-phase's own `iteration-0.md` report has been
filed under the WRONG (legacy `experiments/quay-perpetual-stream/milestones/`) path prefix 3 times
this session — M179 (DIR-070-F), M185 (DIR-116), M188 (DIR-119-A) — each caught by a subsequent
audit and fixed with `git mv` after the fact. The Audit phase and Land phase have NEVER exhibited
this bug in the same session.

**Root cause, directly read from `.claude/workflows/execute-milestone.js`**: the Build phase's own
EVIDENCE instruction (line ~162) is bare prose with no delegation to the single-sourced resolver:

```
4. EVIDENCE: Write iteration report to milestones/M<NN>/iterations/iteration-0.md (extract milestone number from charter path).
```

Compare to the Audit phase (line ~221) and Land phase (lines ~305/356), which BOTH explicitly
instruct: `source experiments/quay-perpetual-stream/scripts/gate-script-lib.sh &&
gate_resolve_milestone_root ${_milestone}` — the single-sourced, ADR-004 path-prefix rule
established by `gap-absorb-charter-audit-not-committed`/M176. The Build phase is the ONLY one of
the three phases that writes a `milestones/` path without calling this function — it just says
"milestones/M<NN>/..." and leaves the Build agent to interpret/derive the actual path itself,
which has empirically gone wrong 3/3+ times this session's Build dispatches that reached this step.

This is the exact same class of bug `gap-absorb-charter-audit-not-committed` was filed to eliminate
(a path convention re-derived ad-hoc in one place instead of calling the one authoritative
function) — it just wasn't caught in that fix's own scope because the Build phase's instruction
wasn't audited at the time.

## Requested action

1. Change the Build-phase EVIDENCE instruction (execute-milestone.js line ~162, both
   `.claude/workflows/` and `plugin/workflows/` mirrors) to explicitly instruct: `source
   experiments/quay-perpetual-stream/scripts/gate-script-lib.sh && gate_resolve_milestone_root
   ${_milestone}` before writing the iteration report — same pattern already used by Audit/Land.
2. Verify via a real subsequent milestone dispatch: the Build phase's own `iteration-0.md`/
   `iteration-N.md` lands at the correct top-level path on the FIRST try, with no manual `git mv`
   needed afterward.

## Acceptance Criteria
- [ ] Build-phase EVIDENCE prompt text explicitly references `gate_resolve_milestone_root`, matching
  Audit/Land's own phrasing — grep-confirmable.
- [ ] A real (non-fixture) milestone dispatch after this fix shows the Build phase's own iteration
  report filed at the correct top-level `milestones/M<NN>/` path with no subsequent `git mv` needed.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [ ] Landed on `master`, verified via a real dispatch, not asserted.
- [ ] Because this touches `.claude/workflows/execute-milestone.js` (driver execution-chain
  script), resolving it must run under human-steered discipline.

## Human verification when exp5 marks this task done
1. Does a real milestone's Build phase now file its own evidence at the correct path on the first
   try, without a follow-up `git mv`?

## Touches

- .claude/workflows/execute-milestone.js
- plugin/workflows/execute-milestone.js
