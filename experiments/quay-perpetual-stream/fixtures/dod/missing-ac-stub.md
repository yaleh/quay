# Fixture: missing-ac-stub.md — synthetic milestone MISSING its Acceptance Criteria (clause 0)

This is a synthetic charter+ABSORB-entry stub for a FAKE milestone `M94-fake-missing-ac`, built for
`scripts/it0-dod-check.{sh,mjs}` regression testing (2026-07-19, AC/DoD-in-task rule). It is NOT a
real milestone and must never be SELECTed or dispatched.

**What this fixture isolates:** it is compliant on every DoD clause 1-5 (explicit dispositions below,
no self-exemption, not design-only) EXCEPT it has NO `## Acceptance Criteria` section. Per clause 0
(AC + DoD present and well-formed in the task), `it0-dod-check` MUST catch this and exit non-zero.
The ONLY intended failure is clause 0. A `## Definition of Done` section IS present (so the failure is
specifically the missing AC, not a missing DoD).

## Charter excerpt

**Milestone id:** M94-fake-missing-ac

### Deliverable
Ships a small operational change (not design-only). No self-exemption language for any DoD clause.

### Explicitly OUT of scope
- Ordinary scope note that names/exempts no DoD clause (should NOT trigger clause 5).

## ABSORB-entry excerpt

ABSORB log entry for M94-fake-missing-ac (synthetic) — explicit dispositions for clauses 1-4:
- Adversarial-audit gate: documented no-op — neither cadence condition applied; stated explicitly.
- V_meta consolidation-lag gate: clear — no rows past the K=2 threshold.
- Line-budget gate: PASS — small scope, no phase/stage plan required.
- Impl-row gate: N/A — not design-only, ships operational work.
No self-exemption language for any of the 4 DoD clauses appears, so no WAIVER line is required.

## Backlog row

| M94-fake-missing-ac | Fake milestone missing its Acceptance Criteria — ships operational work, not design-only | SELECTED | explore | milestone-candidate, surface:method-infra |

## Definition of Done

References the standard DoD (the five clauses in `inherited-core.md` — adversarial-audit, V_meta-lag,
line-budget, impl-row, no-self-exemption). DoD is present; the deliberately-omitted section is the
`## Acceptance Criteria` one, which is exactly what clause 0 must catch.
