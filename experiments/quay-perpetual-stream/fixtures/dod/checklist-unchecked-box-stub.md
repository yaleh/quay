# Fixture: checklist-unchecked-box-stub.md — synthetic milestone whose checklist-form AC still has
# an unchecked `- [ ]` box at ABSORB

This is a synthetic charter+ABSORB-entry stub for a FAKE milestone `M90-fake-checklist-unchecked`,
built for `scripts/it0-dod-check.{sh,mjs}` regression testing (DIR-020/M34-ac-dod-checklist-writeback,
2026-07-19). It is NOT a real milestone and must never be SELECTed or dispatched.

**What this fixture isolates:** it is compliant on every DoD clause 1-7 (explicit dispositions below,
no self-exemption, not design-only, non-product-touching) EXCEPT that its `## Acceptance Criteria`
section is authored as a GFM checklist (the new required form) with ONE item still `- [ ]`
(unchecked) at ABSORB time — i.e. the per-milestone acceptance-audit write-back either never happened
or could not confirm that item. Per `inherited-core.md`'s Clause 0 unchecked-box HARD-block semantics
(DIR-020), `it0-dod-check` MUST catch this and exit non-zero, naming the specific unchecked item in
its failure output — exactly as an unmet criterion HARD-blocks today. This is the mirror-compliant
pair to `checklist-all-checked-compliant-stub.md`, which is identical except every box is `- [x]`.

## Charter excerpt

**Milestone id:** M90-fake-checklist-unchecked

### Deliverable
This milestone ships a small operational change (not design-only): a helper function fix plus a unit
test. No self-exemption language for any DoD clause.

### Explicitly OUT of scope
- Ordinary scope note that names/exempts no DoD clause (should NOT trigger clause 5).

## ABSORB-entry excerpt

ABSORB log entry for M90-fake-checklist-unchecked (synthetic, for fixture-testing only) — explicit
dispositions for clauses 1-7:

- Adversarial-audit gate: CONCERNS — the audit confirmed the first two AC items (ticked `- [x]` via
  write-back, see below) but could NOT confirm the third ("the regression test suite is green on
  CI") — that item remains `- [ ]` unchecked. Per Clause 0/Clause 1's unchecked-box-blocks semantics
  this is REFUTED-equivalent for that item and HARD-blocks `milestone_counter++` until resolved.
- V_meta consolidation-lag gate: clear — no v-meta-ledger.md rows past the K=2 threshold at this
  ABSORB.
- Line-budget gate: PASS — small scope, no phase/stage plan required.
- Impl-row gate: N/A — not design-only, ships operational work.
- Escrow-Δv gate: N/A — not design-only, no Δv claim to escrow.
- Test-floor gate: N/A — surface:method-infra, non-product-touching.

No self-exemption language for any of the 6 mechanically-checked DoD clauses appears in the charter
excerpt above, so no WAIVER line is required or present — the ONLY intended failure is Clause 0's new
unchecked-box sub-check.

## Backlog row

| M90-fake-checklist-unchecked | Fake milestone with an unchecked AC checklist box at ABSORB — ships operational work, not design-only | SELECTED | explore | milestone-candidate, surface:method-infra |

## Acceptance Criteria

Authored in the NEW checklist form (DIR-020). Two items confirmed and ticked by the (simulated)
acceptance-audit write-back; the third remains unconfirmed/unchecked — this is the deliberate
failure case:
- [x] The helper function returns the corrected value on the fixed input (confirmed: unit test
  output pasted in the audit report).
- [x] A unit test covers the corrected path (confirmed: diff shows the new test case).
- [ ] The regression test suite is green on CI (audit could NOT confirm — no CI run evidence found;
  left unchecked deliberately by this fixture).

## Definition of Done

References the standard DoD (the five clauses in `inherited-core.md` — adversarial-audit, V_meta-lag,
line-budget, impl-row, no-self-exemption) plus:
- Standard DoD clauses 1-5 satisfied except the deliberately-unconfirmed third AC item above, which
  is exactly what Clause 0's unchecked-box sub-check must catch.
