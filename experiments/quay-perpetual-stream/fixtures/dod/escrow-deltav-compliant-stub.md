# Fixture: escrow-deltav-compliant-stub.md — synthetic design-only milestone with a PROPERLY
# escrowed Δv claim

This is a synthetic charter+ABSORB-entry stub for a FAKE milestone `M97B-fake-escrow-compliant`,
built for `scripts/it0-dod-check.{sh,mjs}` regression testing (M32-dod-escrow-testfloor, DIR-017
Step 2). It is NOT a real milestone and must never be SELECTed or dispatched.

**What this fixture isolates:** it is design-only (backlog row states "design delivered") AND its
ABSORB-entry text claims a nonzero VT Δv — same trigger shape as `escrow-deltav-violating-stub.md`
— but here the Δv claim IS explicitly marked escrowed/provisional, directly adjacent to the number,
so Clause 6 (escrow-Δv gate) must PASS. Every other clause is also compliant, so this fixture's ONLY
job is a clean, isolated positive case for Clause 6.

## Charter excerpt

**Milestone id:** M97B-fake-escrow-compliant

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

ABSORB log entry for M97B-fake-escrow-compliant (synthetic, for fixture-testing only):

- Adversarial-audit gate: NO REFUTATION FOUND — audit re-ran the DoD checks, no criterion refuted.
- V_meta consolidation-lag gate: clear — no v-meta-ledger.md rows past the K=2 threshold at this
  ABSORB.
- Impl-row gate: design-only, and a corresponding `M97B-fake-escrow-compliant-IMPL` row was created
  in `backlog.md` this ABSORB (see Backlog row section below) — PASS.
- **Realized Δv: escrowed/provisional 4.25** — NOT folded into the confirmed VT-curve total. Per
  Clause 6 (escrow-Δv gate), this figure remains provisional until `M97B-fake-escrow-compliant-IMPL`
  itself ships and is ABSORBed; only that future ABSORB may convert it to a confirmed VT-curve entry.

No self-exemption language for any of the 6 DoD clauses appears in the charter excerpt above, so no
WAIVER line is required or present.

## Backlog row

Synthetic backlog rows for this fixture (fed to `it0-impl-row-check.sh` via a materialized temp
backlog file):

| M97B-fake-escrow-compliant | Fake design-only milestone for escrow-Δv fixture testing — design delivered, claims properly-escrowed Δv | SELECTED | explore | milestone-candidate, surface:method-infra |
| M97B-fake-escrow-compliant-IMPL | Follow-up implementation candidate row for M97B-fake-escrow-compliant | SELECTED | explore | milestone-candidate, surface:method-infra |

## Acceptance Criteria

Synthetic AC for this fixture (clause-0 source) — each concrete and checkable:
- The design document names all the follow-up implementation's Done-when clauses.
- The `-IMPL` candidate row exists in `backlog.md`.

## Definition of Done

References the standard DoD (`inherited-core.md`'s Definition of Done section, clauses 0-7) — this
fixture demonstrates the COMPLIANT path for Clause 6: a design-only milestone's Δv is claimed but
correctly qualified as escrowed/provisional, not final.
