---
id: exp5-M-CRYST-D1
title: D1 quay DOCUMENT-MANAGEMENT capability (contract-validator as a quay
  feature; formalized-style + self-verifying contracts enforced by quay)
status: todo
labels:
  - milestone-candidate
  - crystallization
parent: exp5-M-CRYST
children: []
extra: {}
---
## Proposal
Extend quay to manage repeatable method documents/decisions as first-class objects with contracts/validation + generated views (resolves decision①→quay; §7 concrete). The contract-validator is a quay capability, not an exp5 script.
## Acceptance Criteria
- [ ] quay validates a document's self-contracts (grep/not-grep target:self) and surfaces conformance; a non-conforming doc is flagged.
## Definition of Done
Real: a real method doc is managed+validated through quay.