---
id: exp5-M-AC-DOD-CHECKLIST-AUDIT-WRITEBACK
title: "DIR-020: AC/DoD in task bodies become GitHub-flavored Markdown checklists
  (- [ ]/- [x]), authored unchecked at SELECT, ticked ONLY by the per-milestone
  acceptance-audit subagent's write-back as it confirms each item — Clause 0
  updated to accept the checklist shape, an unchecked box at ABSORB HARD-blocks
  exactly as an unmet criterion does today"
status: in-progress
labels:
  - milestone-candidate
  - surface:method-infra
  - milestone:M34-ac-dod-checklist-writeback
extra: {}
---
## Provenance
Materialized at m34 DRAIN/SELECT boundary (2026-07-19), sourced directly to DIR-020 (pending),
authored by the human directly in this live conversation. Selected over `exp5-M-NATIVE-RELATION-SYNC`
and the DIR-017-Step-3-sourced candidate (leakage metrics onto `dashboard.md`) per the standing
DRAIN convention that a fresh, live human directive takes priority over standing backlog candidates
(mirrors how DIR-017 itself was prioritized once cleared).

## Source
`experiments/quay-perpetual-stream/directives/pending/DIR-020-ac-dod-markdown-checklist-updated-by-audit-subagents.md`
(full text; see `tasks/DIR-020.md` for the directive-tracking task).

## Value type / cadence
governance-integrity (primary) — per-criterion AC/DoD satisfaction becomes visible and write-tracked
in the canonical task itself, not only in the audit report/ABSORB log prose. method-infra (secondary).
Δv̂ ≈ 0 (methodology refinement, no VT chart cell — mirrors M25/M30/M31/M32's own no-VT-cell
precedent for this DoD-program lineage).

## Acceptance Criteria
- [ ] `inherited-core.md`'s "AC/DoD live in the TASK" rule and Definition of Done Clause 0's text are
  updated to require the `## Acceptance Criteria` / `## Definition of Done` sections be authored as
  GitHub-flavored Markdown checklists (`- [ ]` per item), not prose bullet/numbered lists.
- [ ] `scripts/it0-dod-check.mjs` Clause 0's shape check is updated to recognize `- [ ]`/`- [x]` lines
  as the valid checkable-clause form (still requiring ≥1 real, non-placeholder item; DoD must still
  reference the standard clauses per the reference-plus-extras rule) — prose-form (pre-existing tasks,
  e.g. M32's) remains accepted too, no retroactive rewrite required (backward-compatible).
- [ ] `OUTER-LOOP.md` step 1's AC/DoD authoring sub-step text is updated: AC/DoD are authored as
  UNCHECKED (`- [ ]`) checklists at SELECT time — a milestone starts with nothing ticked.
- [ ] `OUTER-LOOP.md` step 6's per-milestone acceptance-audit sub-step text is updated: the audit
  subagent, as it confirms each AC/DoD item, WRITES BACK to the task file (ticking `- [x]` for each
  confirmed item, leaving `- [ ]` for any it cannot confirm) — the audit is the ONLY writer that ticks
  boxes; the loop must not self-tick at authoring time. A live demonstration of this write-back
  actually happening (not just documented) is required for THIS milestone's own acceptance audit.
- [ ] A synthetic/fixture milestone whose AC still has an unchecked `- [ ]` box at ABSORB is
  HARD-blocked by `it0-dod-check.mjs`, exactly as an unmet criterion does today (new fixture pinning
  this, added to `fixtures/dod/` + wired into `dod-fixture-selfcheck.sh`).

## Definition of Done
- [ ] References the standard `inherited-core.md` Definition of Done clauses (0 AC/DoD-present — this
  milestone directly extends Clause 0's shape rule, 1 per-milestone acceptance audit — this
  milestone's own audit must demonstrate the write-back live, 2 V_meta-lag, 3 line-budget, 4 impl-row
  — N/A, ships real code, 5 no-self-exemption, 6 escrow-Δv — N/A, not design-only, 7 test-floor —
  `surface:method-infra`, non-product-touching, N/A per Clause 7's own trigger condition). No
  task-specific exemption from any clause.
- [ ] `dod-fixture-selfcheck.sh` full suite still exits 0 with the new checklist-shape fixture(s)
  added and all pre-existing fixtures unaffected/unchanged.

## Status mirror
SELECTed @m34 DRAIN/SELECT boundary, 2026-07-19. This task itself is authored with checklist-form
AC/DoD (the very form DIR-020 requests) as the first live dogfood of the new mechanism, ahead of
Clause 0's mechanical update landing later in this same milestone — an intentional bootstrap
ordering, not an inconsistency.
