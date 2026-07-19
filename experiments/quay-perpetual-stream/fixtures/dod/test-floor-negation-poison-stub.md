# Fixture: test-floor-negation-poison-stub.md — synthetic product-touching milestone whose
# ABSORB-entry text mentions "80%"/"test coverage" ONLY inside a sentence that admits coverage is
# INADEQUATE

This is a synthetic charter+ABSORB-entry stub for a FAKE milestone `M91-fake-testfloor-negation`,
built for `scripts/it0-dod-check.{sh,mjs}` regression testing (M32-dod-escrow-testfloor / DIR-017
Step 2 acceptance audit finding — the pre-fix Clause 7 regex was negation-blind and false-PASSed
prose that plainly admits inadequate coverage while incidentally mentioning "80%"/"test coverage"
nearby, e.g. "no 80% test coverage floor was met" or "considered 80% coverage but decided it wasn't
necessary"). It is NOT a real milestone and must never be SELECTed or dispatched.

**What this fixture isolates:** compliant on every DoD clause 0-6, backlog row carries
`surface:web-ui` (product-touching), but the ABSORB-entry text's ONLY coverage-shaped language is
negated ("no 80% test coverage floor was met; tests exist only for the happy path.") — no genuine
compliant disposition and no WAIVER line. Pre-fix, this false-PASSed (the coverage-disposition regex
matched the raw "80%"/"test coverage" tokens without checking for same-sentence negation). Post-fix
(sentence-scoped negation window, mirrors Clause 6's own negation-window technique), this must FAIL.

## Charter excerpt

**Milestone id:** M91-fake-testfloor-negation

### Deliverable
This milestone ships a real web-UI form-validation fix directly to a product surface (not
design-only, not method-infra) — genuinely product-touching, `surface:web-ui`.

### Explicitly OUT of scope
- Ordinary scope note that names/exempts no DoD clause (should NOT trigger clause 5).

## ABSORB-entry excerpt

ABSORB log entry for M91-fake-testfloor-negation (synthetic, for fixture-testing only):

- Adversarial-audit gate: NO REFUTATION FOUND — audit re-ran the DoD checks, no criterion refuted.
- V_meta consolidation-lag gate: clear — no v-meta-ledger.md rows past the K=2 threshold at this
  ABSORB.
- Impl-row gate: not design-only, ships operational work — N/A, gate does not apply.
- Test coverage disposition: no 80% test coverage floor was met; tests exist only for the happy
  path.

No self-exemption language for any of the 6 pre-existing DoD clauses appears in the charter excerpt
above, so no WAIVER line for those is required or present — but a GENUINE test-floor
disposition/waiver IS required by Clause 7's own trigger and the negated sentence above must not
count as one.

## Backlog row

Synthetic backlog row for this fixture (fed to `it0-impl-row-check.sh` via a materialized temp
backlog file) — `surface:web-ui` fires Clause 7's trigger condition; no "design delivered" marker,
so Clause 4/6 correctly N/A-pass:

| M91-fake-testfloor-negation | Fake product-touching milestone for the Clause-7 negation-poisoning fixture — web-UI form-validation fix, only a NEGATED coverage sentence present | SELECTED | exploit | milestone-candidate, surface:web-ui |

## Acceptance Criteria

Synthetic AC for this fixture (clause-0 source) — each concrete and checkable:
- The form-validation fix rejects the reported malformed input.
- The fix is verified against the reported repro case.

## Definition of Done

References the standard DoD (`inherited-core.md`'s Definition of Done section, clauses 0-7) — this
fixture DELIBERATELY violates Clause 7's requirement (product-touching work must record a real
≥80%-coverage disposition or an explicit dated waiver, not a negated mention of the same tokens) so
`it0-dod-check.mjs` clause 7 has a real, adversarially-constructed FAIL case pinning the negation-
window fix found during the M32 acceptance audit.
