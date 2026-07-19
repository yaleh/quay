# Fixture: checklist-all-checked-compliant-stub.md — synthetic COMPLIANT milestone whose
# checklist-form AC is fully ticked (`- [x]`) at ABSORB

This is a synthetic charter+ABSORB-entry stub for a FAKE milestone `M90B-fake-checklist-checked`,
built for `scripts/it0-dod-check.{sh,mjs}` regression testing (DIR-020/M34-ac-dod-checklist-writeback,
2026-07-19). It is NOT a real milestone and must never be SELECTed or dispatched. This is the
mirror-compliant pair to `checklist-unchecked-box-stub.md` — identical shape, except every AC box is
`- [x]` (fully confirmed by the acceptance-audit write-back), so Clause 0's unchecked-box sub-check
correctly PASSes (no remaining `- [ ]` item) and demonstrates the checklist form is accepted, not
merely rejected when incomplete.

## Charter excerpt

**Milestone id:** M90B-fake-checklist-checked

### Deliverable
This milestone ships a small operational change (not design-only): a helper function fix plus a unit
test. No self-exemption language for any DoD clause.

### Explicitly OUT of scope
- Ordinary scope note that names/exempts no DoD clause (should NOT trigger clause 5).

## ABSORB-entry excerpt

ABSORB log entry for M90B-fake-checklist-checked (synthetic, for fixture-testing only) — explicit
dispositions for clauses 1-7:

- Adversarial-audit gate: NO REFUTATION FOUND — the audit confirmed all three AC items and ticked
  `- [x]` for each via write-back (see below), citing evidence for each tick in its own report.
- V_meta consolidation-lag gate: clear — no v-meta-ledger.md rows past the K=2 threshold at this
  ABSORB.
- Line-budget gate: PASS — small scope, no phase/stage plan required.
- Impl-row gate: N/A — not design-only, ships operational work.
- Escrow-Δv gate: N/A — not design-only, no Δv claim to escrow.
- Test-floor gate: N/A — surface:method-infra, non-product-touching.

No self-exemption language for any of the 6 mechanically-checked DoD clauses appears in the charter
excerpt above, so no WAIVER line is required or present.

## Backlog row

| M90B-fake-checklist-checked | Fake milestone with a fully-ticked AC checklist at ABSORB — ships operational work, not design-only | DONE | explore | milestone-candidate, surface:method-infra |

## Acceptance Criteria

Authored in the NEW checklist form (DIR-020). All three items confirmed and ticked by the
(simulated) acceptance-audit write-back — the compliant pair to checklist-unchecked-box-stub.md:
- [x] The helper function returns the corrected value on the fixed input (confirmed: unit test
  output pasted in the audit report).
- [x] A unit test covers the corrected path (confirmed: diff shows the new test case).
- [x] The regression test suite is green on CI (confirmed: CI run link pasted in the audit report).

## Definition of Done

References the standard DoD (the five clauses in `inherited-core.md` — adversarial-audit, V_meta-lag,
line-budget, impl-row, no-self-exemption) plus:
- Standard DoD clauses 1-5 all satisfied (see ABSORB-entry dispositions above) — every AC box ticked.
