# Fixture: self-exempt-linebudget-stub.md — synthetic milestone that self-exempts the LINE-BUDGET clause

This is a synthetic charter+ABSORB-entry stub for a FAKE milestone `M96-fake-linebudget-self-exempt`,
built for `scripts/it0-dod-check.{sh,mjs}` regression testing (DIR-019). It is NOT a real milestone
and must never be SELECTed or dispatched.

**What this fixture isolates:** it is compliant on every DoD clause EXCEPT that its "Explicitly OUT
of scope" section declares the milestone **exempt from the line-budget gate**, with NO corresponding
`WAIVER:` line anywhere in the ABSORB-entry section. Per `inherited-core.md`'s clause-5
("No-self-exemption meta-clause") and its own stated design ("for clauses 3 (line-budget) and 4
(impl-row), the charter/ABSORB text is directly inspectable — scans for exemption-adjacent language
paired with an absent waiver line"), `it0-dod-check` MUST catch this as an undeclared
self-exemption and exit non-zero.

**The bug this fixture pins (DIR-019 Finding):** clauses 3 and 4 are run UNCONDITIONALLY and always
add themselves to `dispositionedClauses`, and clause 5 skips any clause already in that set. So a
line-budget (or impl-row) self-exemption is never caught — this fixture currently produces a FALSE
PASS (exit 0) when it MUST FAIL (exit 1). See `scripts/dod-fixture-selfcheck.sh` for the asserted
expected behavior.

## Charter excerpt

**Milestone id:** M96-fake-linebudget-self-exempt

### Deliverable
This milestone ships a small operational change (not design-only): it edits one helper function and
adds a unit test. Well under the small-milestone norm.

### Done-when clauses
1. The helper returns the corrected value.
2. A unit test covers the corrected path.

### Explicitly OUT of scope
- This milestone is **exempt from the line-budget gate** — the author asserts the change is trivially
  small so the ceiling check does not apply and may be skipped. This is a DELIBERATE self-exemption
  attempt for regression-testing purposes: it names the line-budget clause and uses exemption
  language ("exempt", "does not apply", "skipped"), and NO waiver line for this clause+milestone
  appears anywhere in this fixture's ABSORB-entry section, so clause 5 MUST catch it.
- General refactoring of unrelated modules is out of scope (ordinary, non-exemption scope note — not
  naming any of the 4 DoD clauses, should NOT trigger clause 5).

## ABSORB-entry excerpt

ABSORB log entry for M96-fake-linebudget-self-exempt (synthetic, for fixture-testing only):

- Adversarial-audit gate: documented no-op — this milestone is method-infra with no VT points and
  neither cadence-rule condition (a) nor (b) fired; disposition recorded here, gate not triggered.
- V_meta consolidation-lag gate: clear — no v-meta-ledger.md rows past the K=2 threshold at this
  ABSORB.
- (Deliberately: NO `WAIVER:` line naming M96-fake-linebudget-self-exempt and the line-budget clause
  appears anywhere in this file. The exemption claim lives ONLY in the charter's "Explicitly OUT of
  scope" section above — exactly the undeclared-self-exemption case clause 5 must catch.)

## Backlog row

Synthetic backlog row (fed to `it0-impl-row-check.sh` via a materialized temp backlog file) — this
row contains NO "design delivered"/"design-doc only" marker, so the impl-row clause correctly
N/A-passes; the ONLY intended failure is the line-budget self-exemption caught by clause 5:

| M96-fake-linebudget-self-exempt | Fake milestone self-exempting the line-budget gate — ships operational work, not design-only | SELECTED | explore | milestone-candidate, surface:method-infra |

## Acceptance Criteria

Present + well-formed so clause 0 PASSes and the ONLY failure is clause 5 (line-budget self-exemption):
- The helper returns the corrected value on the fixed input.
- A unit test covers the corrected path.

## Definition of Done

References the standard DoD (the five clauses in `inherited-core.md` — adversarial-audit, V_meta-lag,
line-budget, impl-row, no-self-exemption) plus:
- Standard DoD clauses 1-5 satisfied (except the deliberately-injected line-budget self-exemption
  this fixture exists to make clause 5 catch).
