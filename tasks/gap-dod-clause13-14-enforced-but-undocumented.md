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

## Decision (implemented) — Option A: Clauses 13/14 ARE first-class DoD clauses

**Chosen: Option A** — document Clauses 13/14 in `inherited-core.md`'s `## Definition of DoD` as
first-class clauses. The enforcement-with-design check is CORRECT; the drift is real: two standing,
UNCONDITIONAL gates landed in `it0-dod-check.ts` without matching design entries.

**Why A over B (re-scope/demote):**
- The Clause 13/14 enforcement blocks are structurally first-class DoD clauses: they run
  UNCONDITIONALLY every check, are always dispositioned, shell out to a sibling script
  (`workflow-invariant-ownership.mjs`, `workflow-metadata-conformance.mjs`), and mirror the exact
  shape of Clauses 10/11/12. They are not transient task-level gates.
- They are tied to standing directives (DIR-124-A3a invariant-ownership, DIR-124-A4
  workflow-metadata) and are ALREADY in `it0-dod-check.ts`'s operative
  `MECHANICALLY_UNCONDITIONAL_CLAUSES` set (`invariant-ownership`, `workflow-metadata-conformance`).
- Option B would make the check pass by WEAKENING the DoD: the gates would keep running but become
  undocumented executable enforcement — a worse ADR-011 state (enforcement with NO design at all) —
  and it violates the task's own non-goals ("Do NOT disable or reduce the enforcement-with-design
  check"; DoD "No weakening of the enforcement-with-design mechanism").
- The "all 13 clauses" comments were already stale; reality is 15 clauses (0-14). Option A makes the
  documented count match the executable reality (AC3).

**Edits made (this worktree):**
1. `inherited-core.md` DoD code block: added functional `clause13 :: ...` / `clause14 :: ...`
   declarations (matching the surrounding `clauseN :: ...` functional format, `-- UNCONDITIONAL`
   tag) after clause12.
2. `inherited-core.md` summary (line 24): `13 clauses (0-12)` -> `15 clauses (0-14)` + added
   Clause 13/14 summary bullets.
3. `inherited-core.md` header comment: `(all 13 clauses)` -> `(all 15 clauses, 0-14)`.
4. `inherited-core.md` `MECHANICALLY_UNCONDITIONAL_CLAUSES` doc list synced to the script's actual
   9-entry set (doc previously listed only 4; Clauses 8/10/11/13/14 were missing — a pre-existing
   doc/script drift fixed so the documented UNCONDITIONAL set matches the executable one).
5. `it0-dod-check.ts`: header comments only (lines 9-10/82: "14 DoD clauses (0-13)" ->
   "15 DoD clauses (0-14)") — no enforcement logic touched; `it0-enforcement-with-design-check.ts`:
   UNCHANGED (no weakening).
6. `experiments/quay-perpetual-stream/invariant-ownership.md` + `plugin/invariant-ownership.md`
   (byte-identical mirror): `dod-clause-enumeration` rule updated "13 DoD clauses (0-12)" ->
   "15 DoD clauses (0-14)".
7. `experiments/quay-perpetual-stream/scripts/it0-dod-check.sh`: header comment
   "(inherited-core.md clauses 0-12)" -> "(inherited-core.md clauses 0-14)".

**Verification:**
- RED before: `it0-enforcement-with-design-check.ts --root <repo>` -> `FAIL: 2
  enforcement-with-design violation(s) found` (Clause 13, Clause 14 DESIGN-MISSING); the D1
  real-object test failed.
- GREEN after: check exits 0 with `PASS: all 15 DoD clause(s) ...`; full
  `it0-enforcement-with-design-check.test.mjs` suite green.

## Adversarial review (2 rounds, REFUTE-focused)

**Round 1:** challenged the Option A decision. Verdict held on factual faithfulness (clause13/14
declarations mirror the enforcement blocks verbatim), Option-vs-Option-B (A is clearly right; B
would leave the gates running but undocumented — worse under ADR-011), future-proofing (parser is
number-based; a future Clause 15 needs only a `clause15 ::` line + a `// --- Clause 15:` marker), and
diff review (PASS). **One completeness defect found:** a live, mechanically-validated manifest
(`experiments/quay-perpetual-stream/invariant-ownership.md` + its byte-identical
`plugin/invariant-ownership.md` mirror) asserted "The 13 DoD clauses (0-12)...", and
`experiments/quay-perpetual-stream/scripts/it0-dod-check.sh`'s header read "clauses 0-12". Fixed:
both manifest copies + the .sh header updated to 15 (0-14).

**Round 2 (re-challenge after round-1 fix):** found ONE further defect — the authoritative
executable's OWN header was stale: `experiments/quay-perpetual-stream/scripts/it0-dod-check.ts`
lines 9-10/82 claimed "runs all 14 DoD clauses (0-13)" / "all 14 gate clauses (0-13)". Fixed to 15
(0-14). Round 2 also EMPIRICALLY verified the mechanism fires both directions for a future Clause 15
(design-missing AND enforcement-missing both produce violations), confirmed no `^clause(\d+)\s*::`
parse ambiguity from the new continuation lines, confirmed the doc's `MECHANICALLY_UNCONDITIONAL_CLAUSES`
is byte-identical (order+content) to the script's Set at it0-dod-check.ts:355, and confirmed all real
checks green (enforcement-with-design exit 0; workflow-invariant-ownership ok:true; test suites
20/20 + 45/45 + dod-fixture-selfcheck 17/17).

Residual (pre-existing, flagged for future, NOT this task's scope): the 9-entry
`MECHANICALLY_UNCONDITIONAL_CLAUSES` set is a duplicated literal in two unguarded places (doc vs
script, no anti-drift gate), and the manifest's `docs/references/inherited-core.md [generated-view]`
owner-path occurrence does not exist (real file is under `experiments/quay-perpetual-stream/`).

## Acceptance Criteria

- [x] AC1: The drift is resolved in one direction or the other (documented decision in the task
  body): either Clause 13/14 added to inherited-core.md's DoD, or their enforcement re-scoped.
  **Chosen: Option A — Clauses 13/14 added to inherited-core.md's DoD (documented above).**
- [x] AC2: `it0-enforcement-with-design-check.ts --root <repo>` reports **0 violations** (or the
  decision deliberately documents why a residual is accepted).
  **Verified GREEN: `PASS: all 15 DoD clause(s) (0-14)`, exit 0.**
- [x] AC3: Both `inherited-core.md` and `it0-dod-check.ts` remain internally consistent (DoD
  clause count comment matches reality).
  **Verified: count comments now `15 clauses (0-14)` / `(all 15 clauses, 0-14)`; parsed clause
  sets agree (core 0-14 == enforced 0-14).**
- [x] AC4: The engine-group full suite is green for this check (no regression elsewhere).
  **Scoped: `it0-enforcement-with-design-check.test.mjs` 20/20 pass; `it0-dod-check.test.mjs`
  45/45 pass; `workflow-invariant-ownership.mjs` ok:true. Full `scripts/test.sh` not run per task
  instruction.**

## Definition of Done

- [x] Decision documented (intended-DoD vs re-scope) with the reasoning.
  **Option A (intended-DoD) documented above with rationale.**
- [x] Check green on real repo; full-suite contribution recorded.
  **`it0-enforcement-with-design-check.ts --root <repo>` exits 0 (15 clauses).**
- [x] No weakening of the enforcement-with-design mechanism.
  **`it0-dod-check.ts` and `it0-enforcement-with-design-check.ts` untouched; enforcement blocks
  for Clauses 13/14 unchanged.**

## Touches

- experiments/quay-perpetual-stream/inherited-core.md
- experiments/quay-perpetual-stream/scripts/it0-dod-check.ts
- (as needed) experiments/quay-perpetual-stream/scripts/it0-enforcement-with-design-check.ts

## Related

- B3-2 `gap-test-suite-has-no-layer-grouping` surfaced this check.
- ADR-021 (enforcement-with-design principle), ADR-011.
- [[gap-dod-clause-sync]] (any sibling clause-sync gap).
