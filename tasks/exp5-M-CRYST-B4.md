---
id: exp5-M-CRYST-B4
title: B4 Migrate existing tasks to the canonical schema (or forward-only +
  validator flags legacy)
status: todo
labels:
  - milestone-candidate
  - crystallization
parent: exp5-M-CRYST
children: []
extra:
  schema: v1
---
## Proposal
Bring existing tasks to the B1 schema (stamp `extra.schema:"v1"`, add `## Proposal`/`## Plan` where milestone tasks lack them, DoD→checklist, strip any status-mirror Resolution), OR adopt forward-only with the validator N/A-flagging legacy EXPLICITLY. Note: the SELECTed-milestone path already self-heals (B3 wiring stamps + authors at SELECT; the pre-dispatch `task-schema-check` blocks dispatch of a non-conformant task) — so B4 is the BACKFILL for the long tail of un-selected candidates, so the board reads uniformly and the sweep has 0 silent skips.
## Plan
N/A — a mechanical sweep + per-task stamp/author (or a documented forward-only grandfather); no code, no staged docs/plans doc warranted.
## Acceptance Criteria
- [ ] `task-schema-check tasks/*.md` reports every task PASS or EXPLICIT N/A-legacy (no silent skip); the live board is schema-consistent OR its heterogeneity is validator-tracked.
- [ ] No task carries a status-mirror Resolution or projection scaffolding (the precise `checkNoScaffolding`, not a naive grep).
## Definition of Done
References the standard inherited-core DoD clauses. Real landing:
- [ ] The live board is schema-consistent (or grandfathered-and-tracked, never silently) — verified by the sweep on `tasks/*.md`.
- [ ] Subtractive where it strips scaffolding; no new drift introduced.

## Not selected (M46)
Considered alongside the crystallization epic's usual candidate set, compared against
`exp5-M-DIR033-WORKTREE-HYGIENE` (fresh pending directive, live measured present-drift evidence).
No new urgency signal on B4 this pass (unchanged since last considered); deferred again — remains
open.

## Not selected (M64)
No new urgency signal; mechanical sweep with no external dogfood component. [[DIR-045]] selected instead — aged 2 passes, LOOP-EXECUTABLE with real archguard iteration proof, higher capability-growth value.

## Not selected (M70)
D4 [hard-fix] selected instead — closes the ADR-004 prose-parsing residual in vmeta-lag-check (structured-field vs interim leading-token parser), higher urgency (hard-fix label) than an administrative backfill sweep.

## Not selected (M71)
DIR-048 selected instead — fresh LOOP-EXECUTABLE directive with real dogfood motivation; capability-growth pick after 5 consecutive crystallization milestones (M66-M70).
