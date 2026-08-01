---
id: DIR-124-F4d
title: "AC3 prose reconciliation (five fact classes → 8-category enumeration + ADR-020 note)"
status: todo
labels:
  - directive
  - milestone-candidate
parent: DIR-124-F4
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

Split from DIR-124-F4 (M260, ProposalReview disposition `split-recommended` /
`split-multi-mechanism`) — the **AC3 prose reconciliation**. The parent task body carries three
inconsistent fact-class counts: "five fact classes" (Requested-action item 1), the "sixth fact
class" (problem framing), and the 8 seed-doc sections (chosen mechanism). This child owns
correcting that prose to ONE canonical enumeration — the 8-category set, with `evidence-surface` as
"class 6 of 8" — and appending a note to `adr/ADR-020` recording the amendment. It depends on F4-M5
(the Touches self-amendment, which declares `tasks/DIR-124-F.md` and `adr/ADR-020` in the parent's
`## Touches` so this child's Plan `- Files:` lines pass preflight).

### Chosen mechanism

1. **Prose reconciliation (parent task body)** — update the parent DIR-124-F task body's "five
   fact classes" language to the canonical 8-category enumeration; `evidence-surface` is class 6 of
   8 (the "sixth fact class" reconciled into the 8-set, not a separate count). No count drift
   remains.
2. **ADR-020 append-only note** — append a note to `adr/ADR-020-runtime-contract-ground-truth-registry.md`
   recording the amendment by this child's milestone (the parent M260 split reassigns the original
   M260 amendment to this child, M273). Append-only: no prior ADR content is rewritten.
3. **No registry/TS/data changes** — the registry module, data file, and seed doc are read-only
   inputs.

**WIRING-CLAIM (F4d-PROSE-RECONCILIATION):** the "five fact classes" prose in the parent task body
is corrected to the canonical 8-category enumeration (`evidence-surface` = class 6 of 8) and
`adr/ADR-020` carries an append-only amendment note, so no count-drift prose remains in the
authoritative task body. → AC1: prose reconciled; ADR-020 note appended.

## Acceptance Criteria

- [ ] The "five fact classes" prose in the parent task body is corrected to the canonical
  8-category enumeration (no count drift).
- [ ] `evidence-surface` is described as class 6 of 8, reconciled into the 8-set.
- [ ] `adr/ADR-020` carries an append-only amendment note recording the reconciliation (prior ADR
  content untouched).
- [ ] `tasks/DIR-124-F.md` and `adr/ADR-020` are declared in the parent F4 task's `## Touches`
  (via the F4-M5 self-amendment) before PlanAuthor.

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] Landed on `master` under human-steered discipline.
- [ ] A real prepare-milestone preflight passes with `- Files:` lines naming `tasks/DIR-124-F.md`
  and `adr/ADR-020` (real dispatch evidence; depends on F4-M5).
- [ ] A fresh independent audit finds no refutation.

## Touches

- `tasks/DIR-124-F.md`
- `adr/ADR-020-runtime-contract-ground-truth-registry.md`
- `docs/plans/M273-dir-124-f4d.md`
