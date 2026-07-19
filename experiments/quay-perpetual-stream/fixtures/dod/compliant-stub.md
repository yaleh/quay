# Fixture: compliant-stub.md — synthetic COMPLIANT milestone for it0-dod-check testing

This is a synthetic charter+ABSORB-entry stub for a FAKE milestone `M98-fake-compliant`, built for
`scripts/it0-dod-check.{sh,mjs}` end-to-end testing (charter M25-dod-meta-enforcer, Stage 2.3). It
is NOT a real milestone and must never be SELECTed or dispatched.

Constructed so it REALLY has no clause silently skipped — every one of the 4 gate clauses has an
explicit disposition statement below (not merely absent-therefore-assumed-fine), and the milestone
ships operational work (mirroring this very milestone's own self-check), so the impl-row gate
N/A-passes for a real, stated reason rather than by omission.

## Charter excerpt

**Milestone id:** M98-fake-compliant

### Deliverable
This milestone ships a working, operational script (not a design document) — it is NOT
design-only: no "design delivered"/"design-doc only" wording, and no "Done-when clauses a future
implementing milestone would need" checklist appears anywhere in this charter, because there is no
follow-up implementation to defer.

### Explicitly OUT of scope
- DIR-017 Steps 2-3 are out of scope for this fixture's fake milestone (ordinary scope note — does
  not name or exempt any of the 4 DoD clauses, should NOT trigger clause 5).
- Retroactive sweep of past milestones is out of scope (ordinary scope note, same as above).

## ABSORB-entry excerpt

ABSORB log entry for M98-fake-compliant (synthetic, for fixture-testing only) — explicit
dispositions for all 4 gate clauses, per the compliant-stub spec:

- Adversarial-audit gate: documented no-op — neither cadence-rule condition applied (not
  VT-scoring, no VT Δv appended; iteration-0 did not recommend skipping iteration-1), and that
  non-firing is itself stated here explicitly per the gate's own "documented no-op" discipline.
- V_meta consolidation-lag gate: clear — no v-meta-ledger.md rows past the K=2 threshold at this
  ABSORB (all rows currently `consolidated` or `proposed`, none `confirmed`-but-not-`consolidated`).
- Line-budget gate: PASS — small-scope charter, well under the small-milestone norm, no phase/stage
  plan required.
- Impl-row gate: N/A — this milestone is not design-only (ships operational work), so the impl-row
  rule does not apply; `it0-impl-row-check.sh` is expected to PASS on this basis.

No self-exemption language for any of the 4 DoD clauses appears in the charter excerpt above, so no
WAIVER line is required or present.

## Backlog row

Synthetic backlog row for this fixture (fed to `it0-impl-row-check.sh` via a materialized temp
backlog file) — this row contains NO "design delivered"/"design-doc only" marker, so the impl-row
clause correctly N/A-passes (rule does not apply):

| M98-fake-compliant | Fake compliant milestone for it0-dod-check fixture testing — ships operational work, not design-only | DONE | explore | milestone-candidate, surface:method-infra |

## Acceptance Criteria

Synthetic AC for this fixture (clause-0 source) — each concrete and checkable:
- The operational script exits 0 on compliant input and 1 on violating input.
- A unit test covers both the pass and fail paths.
- `--help` documents the new flag.

## Definition of Done

References the standard DoD (the five clauses in `inherited-core.md`'s "Definition of Done" section —
adversarial-audit, V_meta-lag, line-budget, impl-row, no-self-exemption) plus this task's own extra:
- Standard DoD clauses 1-5 all satisfied (see ABSORB-entry dispositions above).
- Task-specific: the shipped script carries ≥80% test coverage on its own new lines.
