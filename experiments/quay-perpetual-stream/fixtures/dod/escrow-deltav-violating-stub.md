# Fixture: escrow-deltav-violating-stub.md — synthetic milestone claiming a FINAL (unescrowed) Δv
# on a design-only milestone

This is a synthetic charter+ABSORB-entry stub for a FAKE milestone `M97-fake-escrow-violating`,
built for `scripts/it0-dod-check.{sh,mjs}` regression testing (M32-dod-escrow-testfloor, DIR-017
Step 2). It is NOT a real milestone and must never be SELECTed or dispatched.

**What this fixture isolates:** it is compliant on every DoD clause 0-5 and 7 EXCEPT that it is
design-only (backlog row states "design delivered") AND its ABSORB-entry text claims a nonzero VT
Δv, folded into the confirmed VT-curve total, with NO escrow/provisional language anywhere near the
claim. Per `inherited-core.md`'s new Clause 6 (escrow-Δv gate, M32/DIR-017 Step 2), `it0-dod-check`
MUST catch this and exit non-zero — a design-only milestone's Δv must not be treated as final before
its corresponding `-IMPL` row ships.

This fixture also carries a legitimate, non-DONE `-IMPL` row so that clause 4 (impl-row) PASSes
cleanly — the ONLY intended failure is clause 6 (escrow-Δv), isolating the new clause from the
pre-existing impl-row clause it depends on for its own trigger condition.

## Charter excerpt

**Milestone id:** M97-fake-escrow-violating

### Deliverable
This milestone's deliverable is a design document only. **Design delivered** — the actual
implementation is deferred to a future milestone. See the "Done-when clauses a future implementing
milestone would need" checklist below for what that follow-up must cover.

### Done-when clauses a future implementing milestone would need
1. Build the thing the design describes.
2. Wire it into the loop.

### Explicitly OUT of scope
- Ordinary scope note that names/exempts no DoD clause (should NOT trigger clause 5).

## ABSORB-entry excerpt

ABSORB log entry for M97-fake-escrow-violating (synthetic, for fixture-testing only):

- Adversarial-audit gate: NO REFUTATION FOUND — audit re-ran the DoD checks, no criterion refuted.
- V_meta consolidation-lag gate: clear — no v-meta-ledger.md rows past the K=2 threshold at this
  ABSORB.
- Impl-row gate: design-only, and a corresponding `M97-fake-escrow-violating-IMPL` row was created
  in `backlog.md` this ABSORB (see Backlog row section below) — PASS.
- **Realized Δv: 4.25**, appended to the confirmed VT-curve total this ABSORB. (Deliberately: no
  "escrow"/"provisional"/"pending -IMPL" qualifier anywhere near this claim — the Δv is presented as
  final, immediately, on a design-only milestone whose implementation has not shipped. This is
  EXACTLY the Goodhart-at-the-metric surface Clause 6 exists to close.)

No self-exemption language for any of the 6 DoD clauses appears in the charter excerpt above, so no
WAIVER line is required or present.

## Backlog row

Synthetic backlog rows for this fixture (fed to `it0-impl-row-check.sh` via a materialized temp
backlog file) — a legitimate `-IMPL` row EXISTS (so clause 4 PASSes), isolating clause 6 as the sole
intended failure:

| M97-fake-escrow-violating | Fake design-only milestone for escrow-Δv fixture testing — design delivered, claims unescrowed Δv | SELECTED | explore | milestone-candidate, surface:method-infra |
| M97-fake-escrow-violating-IMPL | Follow-up implementation candidate row for M97-fake-escrow-violating | SELECTED | explore | milestone-candidate, surface:method-infra |

## Acceptance Criteria

Synthetic AC for this fixture (clause-0 source) — each concrete and checkable:
- The design document names all the follow-up implementation's Done-when clauses.
- The `-IMPL` candidate row exists in `backlog.md`.

## Definition of Done

References the standard DoD (`inherited-core.md`'s Definition of Done section, clauses 0-7) plus
this task's own extra: since this is a design-only milestone, Clause 6 (escrow-Δv) applies — any Δv
claimed must be recorded as escrowed/provisional until the `-IMPL` row's own ABSORB clears. This
fixture DELIBERATELY violates that requirement so `it0-dod-check.mjs` clause 6 has a real, adversarially-
constructed FAIL case (not merely a fixture shaped to already pass).
