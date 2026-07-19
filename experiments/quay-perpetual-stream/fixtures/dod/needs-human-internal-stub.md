# Fixture: needs-human-internal-stub.md — ILLEGITIMATE in-project needs-human reason (DIR-026 Clause 9) -> expected exit 1

## Charter excerpt

**Milestone id:** M42C-fake-needs-human-internal

### Deliverable
Ships working operational code (NOT design-only — no "design delivered"/"design-doc only" wording,
no "Done-when clauses a future implementing milestone would need" checklist), so the impl-row and
escrow-Δv gates N/A-pass for a real stated reason.

### Explicitly OUT of scope
- Ordinary scope note that names/exempts no DoD clause (should NOT trigger clause 5).

## Proposal
Real approach text for this synthetic milestone, long enough to satisfy clause 8's minimum-content
check: fetch and reconcile records from the upstream data source, then materialize them locally.

## Plan
N/A — small mechanical fixture, no phased implementation plan needed.

## ABSORB-entry excerpt

OUTCOME: needs-human — the existing architecture is a mismatch and the algorithm is too complex to finish cleanly this milestone.

Explicit dispositions for all gate clauses (synthetic):
- Adversarial-audit gate: documented no-op — neither cadence condition applied.
- V_meta consolidation-lag gate: clear — no ledger rows past K=2.
- Line-budget gate: PASS — small scope, no phase/stage plan required.
- Impl-row gate: N/A — not design-only (ships operational work).
No self-exemption language for any DoD clause appears in the charter excerpt above.

## Backlog row

| M42C-fake-needs-human-internal | Synthetic needs-human fixture — ships operational work, not design-only | needs-human | explore | milestone-candidate, surface:method-infra |

## Acceptance Criteria

Checklist-form AC (INTENTIONALLY unchecked — this milestone did not complete; it marks the terminal
needs-human outcome, so clause 0's unchecked-box block is waived and clause 9 validates the reason):
- [ ] The reconcile step round-trips every upstream record into the local store.
- [ ] A unit test covers the pass and fail paths.

## Definition of Done

References the standard DoD (the five clauses in `inherited-core.md`'s "Definition of Done" section)
plus this task's extra:
- Standard DoD clauses 1-5 satisfied or N/A per their triggers (see ABSORB dispositions above).
