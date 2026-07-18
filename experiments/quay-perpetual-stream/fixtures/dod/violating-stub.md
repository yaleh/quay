# Fixture: violating-stub.md — synthetic VIOLATING milestone for it0-dod-check testing

This is a synthetic charter+ABSORB-entry stub for a FAKE milestone `M99-fake-violating`, built for
`scripts/it0-dod-check.{sh,mjs}` end-to-end testing (charter M25-dod-meta-enforcer, Stage 2.3). It
is NOT a real milestone and must never be SELECTed or dispatched.

Deliberately constructed as a **DOUBLE violation** so the check has more than one independent way
to legitimately fire non-zero, making the fixture robust to either individual clause's exact
wording changing later:
1. **impl-row FAIL** — this milestone is design-only per the impl-row gate's own trigger text
   ("design delivered" appears below), and NO corresponding `M99-fake-violating-IMPL` row exists
   anywhere in this fixture's embedded backlog section.
2. **self-exemption FAIL** — the "Explicitly OUT of scope" section below declares this milestone
   "exempt from the adversarial-audit gate", and NO waiver line for that clause appears in the
   ABSORB-entry section below.

Both violations are real usage of the SAME mechanism `it0-dod-check.mjs` inspects (charter text +
ABSORB-entry text), not an unrelated usage error (e.g. a missing file, a malformed argument) — the
FAIL must come from the DoD clauses themselves firing correctly, which is the point of this
fixture per the charter's adversarial-construction instruction.

## Charter excerpt

**Milestone id:** M99-fake-violating

### Deliverable
This milestone's deliverable is a design document only. **Design delivered** — the actual
implementation is deferred to a future milestone. See the "Done-when clauses a future implementing
milestone would need" checklist below for what that follow-up must cover.

### Done-when clauses a future implementing milestone would need
1. Build the thing the design describes.
2. Wire it into the loop.

### Explicitly OUT of scope
- This milestone is **exempt from the adversarial-audit gate** — the author judges it too small to
  warrant an out-of-band audit dispatch. This is a DELIBERATE self-exemption attempt for
  fixture-testing purposes — no waiver line for this clause is present anywhere in this fixture's
  ABSORB-entry section, so `it0-dod-check.mjs`'s clause 5 must catch this as an undeclared
  self-exemption.
- Retroactive sweep of past milestones is out of scope (ordinary, non-exemption scope note — not
  naming any of the 4 DoD clauses, should NOT trigger clause 5).

## ABSORB-entry excerpt

ABSORB log entry for M99-fake-violating (synthetic, for fixture-testing only):

- V_meta consolidation-lag gate: clear — no v-meta-ledger.md rows past the K=2 threshold at this
  ABSORB.
- (Deliberately: this ABSORB-entry section states NOTHING about the adversarial-audit gate's own
  verdict or applicability — the exemption claim lives ONLY in the charter's "Explicitly OUT of
  scope" section above, which is exactly the undeclared-self-exemption case clause 5 must catch.
  This fixture intentionally omits any waiver-shaped line naming this milestone and this gate
  together, anywhere in this file.)

## Backlog row

Synthetic backlog rows for this fixture (fed to `it0-impl-row-check.sh` via a materialized temp
backlog file) — deliberately NO `M99-fake-violating-IMPL` row exists, so the impl-row clause FAILs:

| M99-fake-violating | Fake violating milestone for it0-dod-check fixture testing — design delivered, no -IMPL row exists | SELECTED | explore | milestone-candidate, surface:method-infra |
