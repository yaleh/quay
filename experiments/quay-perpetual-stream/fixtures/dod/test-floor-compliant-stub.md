# Fixture: test-floor-compliant-stub.md — synthetic product-touching milestone WITH a recorded
# test-coverage disposition

This is a synthetic charter+ABSORB-entry stub for a FAKE milestone `M93B-fake-testfloor-compliant`,
built for `scripts/it0-dod-check.{sh,mjs}` regression testing (M32-dod-escrow-testfloor, DIR-017
Step 2). It is NOT a real milestone and must never be SELECTed or dispatched.

**What this fixture isolates:** same trigger shape as `test-floor-violating-stub.md` (backlog row
carries `surface:web-ui`, product-touching) but here the ABSORB-entry text records an explicit
≥80% test-coverage disposition, so Clause 7 must PASS. Every other clause is also compliant, so this
fixture's ONLY job is a clean, isolated positive case for Clause 7's coverage-disposition path (the
waiver-line path is separately covered by the "component-wise compound-label" note below, and both
paths are exercised across this pair — see the compound-label variant note at the end).

## Charter excerpt

**Milestone id:** M93B-fake-testfloor-compliant

### Deliverable
This milestone ships a real Web UI pagination fix directly to `packages/quay/src/serve.js` (not
design-only, not method-infra) — genuinely product-touching, `surface:web-ui`.

### Explicitly OUT of scope
- Ordinary scope note that names/exempts no DoD clause (should NOT trigger clause 5).

## ABSORB-entry excerpt

ABSORB log entry for M93B-fake-testfloor-compliant (synthetic, for fixture-testing only):

- Adversarial-audit gate: NO REFUTATION FOUND — audit re-ran the DoD checks, no criterion refuted.
- V_meta consolidation-lag gate: clear — no v-meta-ledger.md rows past the K=2 threshold at this
  ABSORB.
- Impl-row gate: not design-only, ships operational work — N/A, gate does not apply.
- **Test-coverage disposition (Clause 7):** real tests exist, 92% test coverage on the touched
  pagination-handling lines in `serve.js`, actually run via `node --test
  packages/quay/test/web-ui-browser.test.mjs` (all pagination assertions PASS). Coverage floor
  (≥80%) is met.

No self-exemption language for any of the 6 pre-existing DoD clauses appears in the charter excerpt
above, so no WAIVER line for those is required or present.

## Backlog row

Synthetic backlog row for this fixture (fed to `it0-impl-row-check.sh` via a materialized temp
backlog file) — `surface:web-ui` fires Clause 7's trigger condition; no "design delivered" marker,
so Clause 4/6 correctly N/A-pass:

| M93B-fake-testfloor-compliant | Fake product-touching milestone for test-floor fixture testing — Web UI pagination fix, 92% coverage recorded | SELECTED | exploit | milestone-candidate, surface:web-ui |

## Acceptance Criteria

Synthetic AC for this fixture (clause-0 source) — each concrete and checkable:
- Pagination renders the correct page-navigation links.
- A regression test covers both the first-page and last-page boundary cases.

## Definition of Done

References the standard DoD (`inherited-core.md`'s Definition of Done section, clauses 0-7) — this
fixture demonstrates the COMPLIANT path for Clause 7: product-touching work with a real, actually-run
≥80% test-coverage disposition recorded at ABSORB.
