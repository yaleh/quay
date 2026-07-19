# Fixture: self-exempt-implrow-stub.md — synthetic milestone that self-exempts the IMPL-ROW clause

This is a synthetic charter+ABSORB-entry stub for a FAKE milestone `M95-fake-implrow-self-exempt`,
built for `scripts/it0-dod-check.{sh,mjs}` regression testing (DIR-019). It is NOT a real milestone
and must never be SELECTed or dispatched.

**What this fixture isolates:** it is compliant on every DoD clause EXCEPT that its "Explicitly OUT
of scope" section declares the milestone **exempt from the impl-row gate**, with NO corresponding
`WAIVER:` line anywhere in the ABSORB-entry section. The backlog row is deliberately NOT design-only,
so the impl-row gate's own trigger legitimately does not fire (it N/A-passes) — which is precisely
what makes this a pure clause-5 test: the milestone tries to *narrate away* a gate that would not
have fired anyway, and clause 5 must still catch the undeclared-exemption *language* per
`inherited-core.md`'s clause-5 definition, exiting non-zero.

**The bug this fixture pins (DIR-019 Finding):** because clause 4 (impl-row) runs unconditionally and
always adds itself to `dispositionedClauses`, clause 5 skips it, so an impl-row self-exemption is
never caught — this fixture currently produces a FALSE PASS (exit 0) when it MUST FAIL (exit 1). See
`scripts/dod-fixture-selfcheck.sh` for the asserted expected behavior.

## Charter excerpt

**Milestone id:** M95-fake-implrow-self-exempt

### Deliverable
This milestone ships a small operational change (not design-only): it fixes one CLI flag parse bug
and adds a regression test. Well under the small-milestone norm.

### Done-when clauses
1. The flag parses correctly.
2. A regression test covers the fixed path.

### Explicitly OUT of scope
- This milestone is **exempt from the impl-row gate** — the author asserts no `-IMPL` follow-up row
  is applicable and the design-only-milestone rule does not apply, so the check may be skipped. This
  is a DELIBERATE self-exemption attempt for regression-testing purposes: it names the impl-row
  clause and uses exemption language ("exempt", "does not apply", "skipped"), and NO waiver line for
  this clause+milestone appears anywhere in this fixture's ABSORB-entry section, so clause 5 MUST
  catch it — regardless of the fact that the gate's own trigger legitimately would not fire.
- Documentation polish is out of scope (ordinary, non-exemption scope note — not naming any of the 4
  DoD clauses, should NOT trigger clause 5).

## ABSORB-entry excerpt

ABSORB log entry for M95-fake-implrow-self-exempt (synthetic, for fixture-testing only):

- Adversarial-audit gate: documented no-op — method-infra, no VT points, neither cadence condition
  fired; disposition recorded, gate not triggered.
- V_meta consolidation-lag gate: clear — no v-meta-ledger.md rows past the K=2 threshold.
- (Deliberately: NO `WAIVER:` line naming M95-fake-implrow-self-exempt and the impl-row clause
  appears anywhere in this file. The exemption claim lives ONLY in the charter's "Explicitly OUT of
  scope" section above — exactly the undeclared-self-exemption case clause 5 must catch.)

## Backlog row

Synthetic backlog row (fed to `it0-impl-row-check.sh` via a materialized temp backlog file) — this
row contains NO "design delivered"/"design-doc only" marker, so the impl-row gate's own trigger does
NOT fire (it N/A-passes); the ONLY intended failure is the impl-row self-exemption caught by clause 5:

| M95-fake-implrow-self-exempt | Fake milestone self-exempting the impl-row gate — ships operational work, not design-only | SELECTED | explore | milestone-candidate, surface:method-infra |
