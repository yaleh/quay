---
id: gap-dod-clause13-14-enforced-but-undocumented
title: "DoD Clause 13/14 are enforced in it0-dod-check.ts but absent from
  inherited-core.md's Definition of DoD — a real ADR-011 drift the grouping
  surfaced, not a checker bug"
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

The layer-grouping glob extension (B3-2) made `it0-enforcement-with-design-check` run in the
default engine group. It now reports 2 real **DESIGN-MISSING** violations on the current repo:

```
FAIL: 2 enforcement-with-design violation(s) found:
  - DESIGN-MISSING: Clause 13 has an enforcement block in it0-dod-check.mjs but NO
    corresponding '### Clause 13' heading in inherited-core.md '## Definition of DoD'
  - DESIGN-MISSING: Clause 14 has an enforcement block in it0-dod-check.mjs but NO
    corresponding '### Clause 14' heading in inherited-core.md '## Definition of DoD'
```

This is a **genuine ADR-011 drift**, not a checker defect. The checker's `parseInheritedCoreClauses`
correctly extracts both the `### Clause N` heading format and the `clauseN :: Task -> ...`
functional format (lines 42-90 of the .ts); `inherited-core.md`'s DoD section contains functional
declarations for **clause0 through clause12 only** (13 clauses, matching its own "all 13 clauses"
comment at the `SINGLE executable source` line). Meanwhile `it0-dod-check.ts` enforces:

- **Clause 13: Invariant-ownership gate** (DIR-124-A3a) — `it0-dod-check.ts:861`
- **Clause 14: Workflow-metadata conformance** (DIR-124-A4) — `it0-dod-check.ts:891`

So two enforcement blocks were added to the executable DoD without a corresponding design entry in
`inherited-core.md` — the exact class ADR-021's "enforcement must land WITH design in the same
milestone" exists to catch. The grouping made the previously-invisible check visible; the violation
is real and predates it (reproduces on master main checkout).

## Requested action

Fix the drift — **both directions must be reconciled**. The correct resolution depends on whether
Clauses 13/14 are intended first-class DoD clauses or transient task-level gates; decide and
document:

1. **If they are intended DoD clauses**: add `### Clause 13` / `### Clause 14` headings (and the
   functional `clause13 :: ...` / `clause14 :: ...` declarations, matching the surrounding
   functional format) to `inherited-core.md`'s `## Definition of DoD` section, and update the
   "all 13 clauses" comment. The check then passes because both directions agree.
2. **If they are NOT intended DoD clauses** (i.e. they were task-scoped gates that outgrew the
   DoD): reconcile the OTHER direction — demote/remove the Clause 13/14 enforcement markers in
   `it0-dod-check.ts` (or re-scope them as non-DoD gates with their own documentation), so the
   check passes with enforcement matching documented design.
3. Either way: the check must go green AND the two files must stay in agreement. Do NOT mute the
   check — it caught a real drift.

**Non-goals:** Do not disable or reduce `it0-enforcement-with-design-check` (it correctly catches
ADR-011 violations). Do not just edit the test's expectations.

## Acceptance Criteria

- [ ] AC1: The drift is resolved in one direction or the other (documented decision in the task
  body): either Clause 13/14 added to inherited-core.md's DoD, or their enforcement re-scoped.
- [ ] AC2: `it0-enforcement-with-design-check.ts --root <repo>` reports **0 violations** (or the
  decision deliberately documents why a residual is accepted).
- [ ] AC3: Both `inherited-core.md` and `it0-dod-check.ts` remain internally consistent (DoD
  clause count comment matches reality).
- [ ] AC4: The engine-group full suite is green for this check (no regression elsewhere).

## Definition of Done

- [ ] Decision documented (intended-DoD vs re-scope) with the reasoning.
- [ ] Check green on real repo; full-suite contribution recorded.
- [ ] No weakening of the enforcement-with-design mechanism.

## Touches

- experiments/quay-perpetual-stream/inherited-core.md
- experiments/quay-perpetual-stream/scripts/it0-dod-check.ts
- (as needed) experiments/quay-perpetual-stream/scripts/it0-enforcement-with-design-check.ts

## Related

- B3-2 `gap-test-suite-has-no-layer-grouping` surfaced this check.
- ADR-021 (enforcement-with-design principle), ADR-011.
- [[gap-dod-clause-sync]] (any sibling clause-sync gap).
