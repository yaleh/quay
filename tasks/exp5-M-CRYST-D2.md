---
id: exp5-M-CRYST-D2
title: D2 Rewrite skills (/quay-directive, quay-task-to-plan) in baime
  formalized style (λ-Spec + contracts:)
status: done
labels:
  - milestone-candidate
  - crystallization
  - milestone:M-130
parent: exp5-M-CRYST
children: []
extra:
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    exp5-M-CRYST-D2
    experiments/quay-perpetual-stream/charters/M130-cryst-d2-skills-rewrite.md
    /tmp/m130-absorb-entry.md
  schema: v1
---
## Proposal

Rewrite the loop's skills (/quay-directive, quay-task-to-plan) in the formalized style (§9):
## Spec λ-block + self-verifying contracts: + reference/ offload. Apply code-over-prompt
(Axis 2′) — deterministic steps become code, prompt shrinks to judgment.

## Plan

N/A — methodology-class. Rewrite two skills to formalized baime style; validate end-to-end.

## Acceptance Criteria
- [x] Each rewritten skill has a ≤30-line Spec + ≥3 self-contracts
- [x] Rewritten skills produce correct objects end-to-end (validated against real tasks)
- [x] Net line count down vs pre-rewrite baseline
- [x] `it0-split-or-commit-check.ts .` + standard non-flaky suite stay green

## Definition of Done
Standard inherited-core DoD clauses apply.
- [x] Both skills rewritten and validated end-to-end
- [x] it0 DoD meta-enforcer passes all clauses

## Not selected (M121)

Not selected — `exp5-DEFECT-QUAY-CORE-SEA-BUILD-CRASH` selected instead: higher DIR-004-urgency
priority and an explicit chart-2 Δv mover. This candidate also lacks a stamped `## Plan`/AC-checklist
schema (`extra.schema` unset) — would need re-authoring to pass `task-schema-check.sh` before dispatch
regardless; deferred, not blocked.

## Not selected (M126)

Not selected — `exp5-M-PRODUCTIZED-DELIVERY-A` selected instead via the DIR-066 Round-1 deliverable
governor's first real exercise: streak=2 (carried from M125), floor=0.333, dSeats=1/nSeats=3 (S_max=4).
Both this task and PRODUCTIZED-DELIVERY-A classified `deliverable:yes`; PRODUCTIZED-DELIVERY-A ranked
higher in Round 2 — it is a direct chart-2 S2 (Delivery-completeness, weight 30, cov=0.00) mover,
DIR-004-urgent-adjacent, and unblocks two dependent children (-B, -C). This candidate remains a good
next D pick; still lacks a stamped `## Plan`/AC-checklist schema (`extra.schema` unset).