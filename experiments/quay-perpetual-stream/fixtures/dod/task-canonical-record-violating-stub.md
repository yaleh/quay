# Fixture: task-canonical-record-violating-stub.md — synthetic milestone with a PLACEHOLDER
# `## Proposal` and a `## Plan` referencing a non-existent `docs/plans/*.md` path (Clause 8 RED case)

This is a synthetic charter+ABSORB-entry stub for a FAKE milestone `M40C-fake-canonical-violating`,
built for `scripts/it0-dod-check.{sh,mjs}` regression testing (DIR-014 item 6 /
M40-dir014-task-canonical-lifecycle-record). It is NOT a real milestone and must never be SELECTed
or dispatched.

**What this fixture isolates:** it carries a `milestone:M41-fake-canonical-violating` label (>= the
M40 cutover threshold, so Clause 8 actually FIRES — not grandfathered/N/A). Its `## Proposal`
section is a bare placeholder (`TBD`), AND its `## Plan` section references a `docs/plans/*.md`
path that does not exist on disk. Either defect alone would fail Clause 8; both are present here so
the failure output demonstrably names BOTH violations, not just one. Every other clause is
compliant, so this fixture's ONLY intended failure is Clause 8 (task canonical-lifecycle-record
gate).

## Charter excerpt

**Milestone id:** M40C-fake-canonical-violating

### Deliverable
This milestone ships a small, well-scoped mechanical change (not design-only). No self-exemption
language for any DoD clause.

### Explicitly OUT of scope
- Ordinary scope note that names/exempts no DoD clause (should NOT trigger clause 5).

## ABSORB-entry excerpt

ABSORB log entry for M40C-fake-canonical-violating (synthetic, for fixture-testing only) — explicit
dispositions for clauses 1-4:
- Adversarial-audit gate: documented no-op — neither cadence condition applied; stated explicitly.
- V_meta consolidation-lag gate: clear — no rows past the K=2 threshold.
- Line-budget gate: PASS — small scope, no phase/stage plan required.
- Impl-row gate: N/A — not design-only, ships operational work.
No self-exemption language for any of the DoD clauses appears, so no WAIVER line is required.

## Backlog row

| M40C-fake-canonical-violating | Fake violating milestone for Clause 8 (task canonical-lifecycle-record) fixture testing | SELECTED | explore | milestone-candidate, surface:method-infra |

## Acceptance Criteria

Synthetic AC for this fixture (clause-0 source) — each concrete and checkable:
- The `## Proposal` section carries real, non-placeholder approach text.
- The `## Plan` section resolves or states N/A.

## Definition of Done

References the standard DoD (`inherited-core.md`'s Definition of Done section, clauses 0-8) — this
fixture demonstrates the VIOLATING path for Clause 8: a placeholder `## Proposal` plus a `## Plan`
referencing a `docs/plans/*.md` path that does not resolve on disk.

**Task labels (synthetic, drives Clause 8's cutover check):** `milestone-candidate`,
`milestone:M41-fake-canonical-violating`

## Proposal

TBD

## Plan

See `docs/plans/M40C-fake-canonical-violating-does-not-exist.md` for the staged implementation
plan.
