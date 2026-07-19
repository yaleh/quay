---
id: exp5-M-CRYST-E1
title: E1 quay ADR-MANAGEMENT capability + concise .epicd-style ADR form + index
status: todo
labels:
  - milestone-candidate
  - crystallization
parent: exp5-M-CRYST
children: []
extra: {}
---
## Proposal
Extend quay to manage ADRs as a first-class object kind (label:adr / kind:adr, riding the B1 schema + D1 doc-mgmt + web). Concise form: frontmatter + Context(2-4 lines) + Decision(invariant, λ-line ok) + Consequences/Scope. Provide an index/generated view.
## Acceptance Criteria
- [ ] An ADR is created+listed+web-rendered via quay; the form validator passes; index view generated.
## Definition of Done
Real: a real ADR is managed through quay.