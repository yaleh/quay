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
extra:
  schema: v1
---
## Proposal
Extend quay to manage repeatable method documents/decisions as first-class objects with contracts/validation + generated views (resolves decision①→quay; §7 concrete). The contract-validator is a quay capability, not an exp5 script. Unblocks D2/D3-§9 (contracts validated BY quay) and E2 back-links. Reuse the E1 ADR-kind pattern (a doc kind with a self-verifying `contracts:` block; single-source module wrapped by a gate).
## Plan
N/A — product code across packages (a Core doc-management kind + contract-validator, reached via the Provider ABI, like E1); strict TDD per ADR-001 (red→green, ≥80% coverage); no staged docs/plans doc warranted.
## Acceptance Criteria
- [ ] quay validates a document's self-`contracts:` (grep/not-grep, `target:self`) and surfaces conformance; a non-conforming doc is flagged (not silently passed).
- [ ] A real method doc (e.g. a skill or OUTER-LOOP) is managed + validated through quay end-to-end; single-source (the contract logic lives once, a gate wraps it).
## Definition of Done
References the standard inherited-core DoD clauses. Real landing:
- [ ] A REAL method doc is managed + validated through quay (not a fixture) — the contract-validator flags a real non-conforming doc.
- [ ] Strict TDD (product code); no dual source (validator logic once, wrapped by a gate); unblocks D2/D3-§9/E2.

## Not selected (M41)
DIR-030 explicitly requires the observe-and-enforce cluster (G1→E3→DIR022-REMAINING→INV) to land BEFORE D1, with D1 not selectable until ≥3 of the four have landed. Not selected this pass (0/4 landed so far) — foundational but per DIR-030's steer, deferred until the window closes.