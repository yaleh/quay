# Fixture: self-exempt-escrow-stub.md — synthetic milestone that self-exempts the ESCROW-Δv clause
# (Clause 6) while its own trigger condition legitimately does not fire

This is a synthetic charter+ABSORB-entry stub for a FAKE milestone `M92-fake-escrow-self-exempt`,
built during the M32-dod-escrow-testfloor reconciliation ABSORB to regression-test the exact
DIR-019-shaped question the two independent M32 iterations disagreed about: should Clause 6
(escrow-Δv) and Clause 7 (test-floor) be added to `it0-dod-check.mjs`'s
`MECHANICALLY_UNCONDITIONAL_CLAUSES` set?

**What this fixture isolates:** the milestone is NOT design-only (so Clause 6's own trigger
condition legitimately does not fire — Clause 6 itself would correctly N/A-pass on content
grounds), but its "Explicitly OUT of scope" section nonetheless contains undeclared self-exemption
language naming the escrow-Δv gate, with NO corresponding `WAIVER:` line anywhere in the
ABSORB-entry section. This is a genuinely different case from `escrow-deltav-violating-stub.md`
(which tests Clause 6's OWN content check when its trigger DOES fire) — this fixture instead tests
whether Clause 5 (no-self-exemption) catches an undeclared exemption CLAIM when Clause 6's
trigger legitimately doesn't fire, i.e. whether "already dispositioned" (N/A) is wrongly treated as
evidence the exemption is legitimate.

**Why this matters (the reconciliation finding):** Clause 6/7's implementation code calls
`dispositionedClauses.add(...)` on EVERY branch (N/A, PASS, and FAIL alike) — structurally
identical to Clauses 3/4's shape (which is exactly the property DIR-019 diagnosed as making
"already dispositioned" a vacuous, always-true signal, not evidence of legitimate non-firing).
Unlike Clauses 1/2 (which only call `.add()` on their PASS/disposition-found branch and leave the
"no disposition found" branch un-added, making "already dispositioned" a REAL signal there), a
milestone can have Clause 6's trigger legitimately not fire (not design-only) while STILL carrying
free-form undeclared self-exemption prose naming the escrow-Δv gate — the trigger's own
content-conditioning does not prevent this, because the exemption language lives in a separate,
independent section of the charter. Per DIR-019's own reasoning, Clause 6/7 MUST therefore be in
`MECHANICALLY_UNCONDITIONAL_CLAUSES` (same as Clauses 3/4), or this exact fixture produces a FALSE
PASS. Confirmed live during reconciliation: against a version of `it0-dod-check.mjs` WITHOUT Clause
6/7 in `MECHANICALLY_UNCONDITIONAL_CLAUSES`, this fixture (constructed as
`M88-fake-escrow-self-exempt-v3` during reconciliation testing) produced exit 0 (FALSE PASS); with
Clause 6/7 added to the set, it correctly produces exit 1.

## Charter excerpt

**Milestone id:** M92-fake-escrow-self-exempt

### Deliverable
This milestone ships operational work (not design-only): no "design delivered"/"design-doc only"
wording, no future-implementer checklist appears anywhere in this charter.

### Explicitly OUT of scope
- This milestone is **exempt from the escrow-Δv gate** — the author asserts the gate does not apply
  and may be skipped for this milestone, regardless of design-only status. This is a DELIBERATE
  self-exemption attempt for regression-testing purposes: it names the escrow-Δv clause and uses
  exemption language ("exempt", "does not apply", "skipped"), and NO waiver line for this
  clause+milestone appears anywhere in this fixture's ABSORB-entry section, so clause 5 MUST catch
  it.
- General refactoring of unrelated modules is out of scope (ordinary, non-exemption scope note —
  should NOT trigger clause 5).

## ABSORB-entry excerpt

ABSORB log entry for M92-fake-escrow-self-exempt (synthetic, for fixture-testing only):

- Adversarial-audit gate: documented no-op — neither cadence-rule condition fired.
- V_meta consolidation-lag gate: clear — no v-meta-ledger.md rows past the K=2 threshold at this
  ABSORB.
- Impl-row gate: N/A — not design-only.
- VT-curve append (m92/M92-fake-escrow-self-exempt, 100/100, Δv=+5.0) — final, confirmed as landed
  capability, no escrow language required per the author's exemption claim above.
- (Deliberately: NO `WAIVER:` line naming M92-fake-escrow-self-exempt and the escrow-delta-v/escrow-Δv
  clause appears anywhere in this file. The exemption claim lives ONLY in the charter's "Explicitly
  OUT of scope" section above — exactly the undeclared-self-exemption case clause 5 must catch.)

## Backlog row

Synthetic backlog row (fed to `it0-impl-row-check.sh` via a materialized temp backlog file) — this
row contains NO "design delivered"/"design-doc only" marker, so the impl-row clause and Clause 6's
own trigger both correctly N/A-pass; the ONLY intended failure is the escrow-Δv self-exemption
caught by clause 5:

| M92-fake-escrow-self-exempt | Fake milestone self-exempting the escrow-Δv gate — ships operational work, not design-only | SELECTED | explore | milestone-candidate, surface:method-infra |

## Acceptance Criteria

Present + well-formed so clause 0 PASSes and the ONLY failure is clause 5 (escrow-Δv self-exemption):
- The operational change works as described on the fixed input.
- A regression test covers the fixed path.

## Definition of Done

References the standard DoD (the eight clauses in `inherited-core.md` — AC/DoD presence,
adversarial-audit, V_meta-lag, line-budget, impl-row, no-self-exemption, escrow-Δv, test-floor) plus:
- Standard DoD clauses satisfied (except the deliberately-injected escrow-Δv self-exemption this
  fixture exists to make clause 5 catch).
