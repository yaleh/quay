---
id: exp5-M-CRYST-B6-VALIDATOR-COVERAGE
title: "B6 Validator coverage: assert directive Finding/Requested-action;
  document semantic-emptiness non-goal (review C1)"
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
Adversarial review of the first wave (2026-07-19) found a validator coverage gap: `task-schema.mjs` asserts `## Proposal`/`## Plan`/AC-checklist/DoD-checklist/Resolution/no-scaffolding, but does NOT assert the directive-template sections `## Finding` and `## Requested action`, and — being purely structural — cannot detect a semantically-empty-but-structurally-valid AC/DoD box (a meaningless `- [ ]` box with ≥40 chars passes). Tighten the structural half where it is mechanically decidable: add a directive-kind section-presence check for `## Finding` + `## Requested action` (they are required by the /quay-directive template). The semantic-emptiness gap is irreducibly a human/DoD-audit concern — document it as an explicit non-goal of the structural gate rather than pretending to close it.

## Plan
N/A — extend `checkTask` with one label-aware section-presence assertion + a fixture; no staged docs/plans doc warranted.

## Acceptance Criteria
- [ ] For kind=directive, a task missing `## Finding` OR `## Requested action` FAILs; a compliant directive PASSes; fixtures pin both; `task-schema-selfcheck.sh` exits 0.
- [ ] The header-comment schema view is regenerated to list the new assertion (comment stays a generated view of the code, no drift).
- [ ] The semantic-emptiness limitation is stated as an explicit non-goal in the module header (structural gate cannot judge meaning; that is the DoD audit's job).
## Definition of Done
References the standard inherited-core DoD clauses. Real landing:
- [ ] The validator HARD-fails a real directive missing Finding/Requested-action; existing 5 marked tasks still PASS (no regression in the sweep).
- [ ] Non-goal documented; no false claim that the structural gate detects semantic emptiness.