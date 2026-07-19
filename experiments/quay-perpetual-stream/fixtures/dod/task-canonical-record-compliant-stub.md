# Fixture: task-canonical-record-compliant-stub.md — synthetic milestone with a well-formed
# `## Proposal` + `## Plan` (Clause 8 GREEN case)

This is a synthetic charter+ABSORB-entry stub for a FAKE milestone `M40B-fake-canonical-compliant`,
built for `scripts/it0-dod-check.{sh,mjs}` regression testing (DIR-014 item 6 /
M40-dir014-task-canonical-lifecycle-record). It is NOT a real milestone and must never be SELECTed
or dispatched.

**What this fixture isolates:** it carries a `milestone:M40-fake-canonical-compliant` label (>= the
M40 cutover threshold, so Clause 8 actually FIRES — not grandfathered/N/A), a real, non-placeholder
`## Proposal` section, and a `## Plan` section stating `N/A — <reason>` with real reasoning. Every
other clause is also compliant, so this fixture's ONLY job is a clean, isolated positive case for
Clause 8 (task canonical-lifecycle-record gate).

Because `it0-dod-check.mjs`'s Clause 0/Clause 8 task-lookup only checks `tasks/<milestone-id>.md`
on disk (which does not exist for this fake milestone id) it falls back to reading THIS fixture
file's own full text — so the `## Proposal` / `## Plan` / `milestone:M40...` label all live in this
file directly (not a separate real task file), mirroring how `missing-ac-stub.md` etc. already rely
on that same fallback for Clause 0.

**Task labels (synthetic, drives Clause 8's cutover check):** `milestone-candidate`,
`milestone:M40-fake-canonical-compliant`

## Charter excerpt

**Milestone id:** M40B-fake-canonical-compliant

### Deliverable
This milestone ships a small, well-scoped mechanical change (not design-only). No self-exemption
language for any DoD clause.

### Explicitly OUT of scope
- Ordinary scope note that names/exempts no DoD clause (should NOT trigger clause 5).

## ABSORB-entry excerpt

ABSORB log entry for M40B-fake-canonical-compliant (synthetic, for fixture-testing only) — explicit
dispositions for clauses 1-4:
- Adversarial-audit gate: documented no-op — neither cadence condition applied; stated explicitly.
- V_meta consolidation-lag gate: clear — no rows past the K=2 threshold.
- Line-budget gate: PASS — small scope, no phase/stage plan required.
- Impl-row gate: N/A — not design-only, ships operational work.
No self-exemption language for any of the DoD clauses appears, so no WAIVER line is required.

## Backlog row

| M40B-fake-canonical-compliant | Fake compliant milestone for Clause 8 (task canonical-lifecycle-record) fixture testing | DONE | explore | milestone-candidate, surface:method-infra |

## Acceptance Criteria

Synthetic AC for this fixture (clause-0 source) — each concrete and checkable:
- The `## Proposal` section carries real, non-placeholder approach text.
- The `## Plan` section states `N/A` with explicit reasoning.

## Definition of Done

References the standard DoD (`inherited-core.md`'s Definition of Done section, clauses 0-8) — this
fixture demonstrates the COMPLIANT path for Clause 8: a well-formed embedded `## Proposal` plus a
`## Plan` that states `N/A — <reason>`.

## Proposal

This fake milestone's single chosen approach (for fixture-testing purposes only): reuse the exact
same task-canonical-lifecycle-record shape this fixture's own parent milestone
(M40-dir014-task-canonical-lifecycle-record) introduces — a `## Proposal` section carrying the
chosen approach inline, and a `## Plan` section either referencing a real `docs/plans/*.md` path or
stating `N/A` with reasoning. This paragraph exists purely to give Clause 8's placeholder-detection
logic enough real, non-boilerplate content (well over the minimum length threshold) to recognize
as a genuine proposal body, mirroring the shape (not the literal content) of a real milestone's
`## Proposal` section.

## Plan

N/A — this is a small, single-pass mechanical fixture-only change (a synthetic markdown stub added
to an existing fixtures directory and existing selfcheck script). It does not warrant a staged
`docs/plans/*.md` implementation plan.
