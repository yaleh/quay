# Fixture: test-floor-violating-stub.md — synthetic product-touching milestone with NO recorded
# test-coverage disposition

This is a synthetic charter+ABSORB-entry stub for a FAKE milestone `M93-fake-testfloor-violating`,
built for `scripts/it0-dod-check.{sh,mjs}` regression testing (M32-dod-escrow-testfloor, DIR-017
Step 2). It is NOT a real milestone and must never be SELECTed or dispatched.

**What this fixture isolates:** it is compliant on every DoD clause 0-6 EXCEPT that its backlog row
carries `surface:cli` (product-touching per Clause 7's trigger condition) AND its ABSORB-entry text
records NEITHER a ≥80% test-coverage disposition NOR a dated, reasoned test-floor WAIVER line. Per
`inherited-core.md`'s new Clause 7 (product-work test-floor gate, M32/DIR-017 Step 2),
`it0-dod-check` MUST catch this silent gap and exit non-zero — product-touching work must never ship
with an undeclared test-coverage gap.

Not design-only (ships operational code directly), so Clause 6 legitimately N/A-passes and does not
interfere with isolating Clause 7 as the sole intended failure.

## Charter excerpt

**Milestone id:** M93-fake-testfloor-violating

### Deliverable
This milestone ships a real CLI flag-parsing fix directly to `packages/quay/bin/quay.js` (not
design-only, not method-infra) — genuinely product-touching, `surface:cli`.

### Explicitly OUT of scope
- Ordinary scope note that names/exempts no DoD clause (should NOT trigger clause 5).

## ABSORB-entry excerpt

ABSORB log entry for M93-fake-testfloor-violating (synthetic, for fixture-testing only):

- Adversarial-audit gate: NO REFUTATION FOUND — audit re-ran the DoD checks, no criterion refuted.
- V_meta consolidation-lag gate: clear — no v-meta-ledger.md rows past the K=2 threshold at this
  ABSORB.
- Impl-row gate: not design-only, ships operational work — N/A, gate does not apply.
- (Deliberately: this ABSORB-entry section says NOTHING about test coverage for the shipped CLI
  change — no percentage, no "tests exist" statement, and no `WAIVER:` line naming this milestone
  and the test-floor clause anywhere in this file. This is exactly the silent gap Clause 7 exists
  to catch on product-touching work.)

No self-exemption language for any of the 6 pre-existing DoD clauses appears in the charter excerpt
above, so no WAIVER line for those is required or present — but a test-floor disposition/waiver IS
required by Clause 7's own trigger and is deliberately absent.

## Backlog row

Synthetic backlog row for this fixture (fed to `it0-impl-row-check.sh` via a materialized temp
backlog file) — `surface:cli` fires Clause 7's trigger condition; no "design delivered" marker, so
Clause 4/6 correctly N/A-pass:

| M93-fake-testfloor-violating | Fake product-touching milestone for test-floor fixture testing — CLI flag-parsing fix, no test-coverage disposition recorded | SELECTED | exploit | milestone-candidate, surface:cli |

## Acceptance Criteria

Synthetic AC for this fixture (clause-0 source) — each concrete and checkable:
- The CLI flag parses the corrected value.
- The fix is verified against the reported repro case.

## Definition of Done

References the standard DoD (`inherited-core.md`'s Definition of Done section, clauses 0-7) — this
fixture DELIBERATELY violates Clause 7's requirement (product-touching work must record a real
≥80%-coverage disposition or an explicit dated waiver) so `it0-dod-check.mjs` clause 7 has a real,
adversarially-constructed FAIL case.
