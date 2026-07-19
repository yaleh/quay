---
id: exp5-M-CRYST-B7-LOADBEARING-TEST-GATE
title: "B7 Enforce ADR-TDD clause 2: gate that flags a load-bearing
  scripts/*.mjs lacking a sibling *.test.mjs"
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
ADR-TDD Decision clause 2 requires load-bearing method-infra (validators/gates/meters that other code depends on) to be fixture-first + ≥80% covered, but this is enforced NOWHERE — the Clause-7 test-floor only triggers on `surface:` product labels. Per ADR-DILUTION, a rule enforced only as prose is molten. Build a mechanical check: flag any "load-bearing" `experiments/**/scripts/*.mjs` that lacks a sibling `*.test.mjs` (or coverage below floor). "Load-bearing" = imported by another script, wraps/backs a `quay gate`, or gates `milestone_counter++`. Follow the single-source template (a `scripts/*.mjs` check wrappable by a future `quay gate --gate <name>`, never reimplemented).

## Plan
N/A — one check module + selfcheck fixtures (RED-then-GREEN per ADR-TDD); no staged docs/plans doc warranted.

## Acceptance Criteria
- [ ] A check enumerates load-bearing scripts and FAILs when one lacks a sibling `*.test.mjs`; a covered one PASSes; fixtures pin both; the check itself is fixture-first + covered (dogfoods ADR-TDD).
- [ ] `task-schema.mjs` (and the other current load-bearing gates) PASS the check — the debt paid in the ADR-TDD increment is confirmed by the gate, not just asserted.
## Definition of Done
References the standard inherited-core DoD clauses. Real landing:
- [ ] The gate HARD-flags a real load-bearing script with no test; single-source (script) + wrappable by quay, no logic duplicated.
- [ ] Cited by ADR-TDD as the mechanical enforcement of its Decision clause 2.