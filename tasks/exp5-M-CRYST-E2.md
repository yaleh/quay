---
id: exp5-M-CRYST-E2
title: E2 Extract ADRs from proposals + DIR tasks (single-source DIR-002→028,
  split-or-commit DIR-026, single-branch DIR-027, proposal→plan DIR-014,
  AC/DoD-in-task DIR-020, QENG, Provider ABI, ...)
status: todo
labels:
  - milestone-candidate
  - crystallization
parent: exp5-M-CRYST
children: []
extra:
  schema: v1
---
## Proposal
Extract the load-bearing decision invariants scattered across proposals + DIR tasks into concise ADRs (the E1 `adr/` kind, authored via `quay adr new`); back-link task/proposal → ADR. Candidates: single-source DIR-002→028, split-or-commit DIR-026, single-branch DIR-027, proposal→plan DIR-014, AC/DoD-in-task DIR-020, QENG, the Provider ABI. Where a decision is mechanizable, seed its `enforcement` stub for E3.
## Plan
N/A — authoring ADRs into the existing `adr/` store (E1 done); no code, no staged docs/plans doc warranted.
## Acceptance Criteria
- [ ] ≥1 real recurring decision is captured as an ADR (kind=adr, schema-valid) that a reader can act on WITHOUT re-reading the source proposal; task/proposal → ADR back-links resolve.
- [ ] Each extracted ADR seeds an `enforcement` note (real gate id, or explicit N/A) so E3 can later wire it — no ADR that should be enforced left with a dangling stub.
## Definition of Done
References the standard inherited-core DoD clauses. Real landing:
- [ ] The captured ADRs are the usable SINGLE source for their decisions (the source proposal/DIR points at the ADR, not vice-versa) — verified on ≥1 real recurring decision.
- [ ] Mechanizable ADRs carry an enforcement pointer (feeds E3); non-mechanizable ones are marked N/A honestly.

## Not selected (M46)
Considered alongside the crystallization epic's usual candidate set, compared against
`exp5-M-DIR033-WORKTREE-HYGIENE` (fresh pending directive, live measured present-drift evidence).
No new urgency signal on E2 this pass (unchanged since last considered); deferred again — remains
open.
