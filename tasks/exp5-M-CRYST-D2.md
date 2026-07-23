---
id: exp5-M-CRYST-D2
title: D2 Rewrite skills (/quay-directive, quay-task-to-plan) in baime
  formalized style (λ-Spec + contracts:)
status: todo
labels:
  - milestone-candidate
  - crystallization
parent: exp5-M-CRYST
children: []
extra: {}
---
## Proposal
Rewrite the skills in the formalized style (§9): ## Spec λ-block + self-verifying contracts: + reference/ offload. Apply code-over-prompt (Axis 2′) — deterministic steps become code, prompt shrinks to judgment.
## Acceptance Criteria
- [ ] Each rewritten skill has a ≤30-line Spec + ≥3 self-contracts that quay (D1) validates; net line count down.
## Definition of Done
Real: the rewritten skills are validated and produce correct objects end-to-end.

## Not selected (M121)

Not selected — `exp5-DEFECT-QUAY-CORE-SEA-BUILD-CRASH` selected instead: higher DIR-004-urgency
priority and an explicit chart-2 Δv mover. This candidate also lacks a stamped `## Plan`/AC-checklist
schema (`extra.schema` unset) — would need re-authoring to pass `task-schema-check.sh` before dispatch
regardless; deferred, not blocked.