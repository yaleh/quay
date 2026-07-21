---
id: exp5-M-CRYST-B4
title: B4 Migrate existing tasks to the canonical schema (or forward-only +
  validator flags legacy)
status: ready
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
- [x] `task-schema-check tasks/*.md` reports every task PASS or EXPLICIT N/A-legacy (no silent skip); the live board is schema-consistent OR its heterogeneity is validator-tracked.
- [x] No task carries a status-mirror Resolution or projection scaffolding (the precise `checkNoScaffolding`, not a naive grep).
## Definition of Done
References the standard inherited-core DoD clauses. Real landing:
- [x] The live board is schema-consistent (or grandfathered-and-tracked, never silently) — verified by the sweep on `tasks/*.md`.
- [x] Subtractive where it strips scaffolding; no new drift introduced.

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

## Not selected (M72)
E2 selected instead — ADR extraction produces concrete deliverables (new ADRs for load-bearing decisions); B4's AC1 already met by existing N/A-legacy-explicit schema behavior.

## Resolution (M73 — forward-only grandfather adopted)

The `forward-only grandfather` approach is formally adopted (option B from the Proposal):
- All tasks with `extra.schema: "v1"` report PASS via `task-schema-check`
- All tasks without the marker report EXPLICIT `N/A-legacy` — never silent
- No retroactive migration of pre-B1 legacy tasks (200+ tasks, mostly done/archived directives)
- The B3 wiring ensures all future SELECTed tasks carry `schema: v1` at dispatch time
Full sweep output (`node experiments/quay-perpetual-stream/scripts/task-schema-check.mjs tasks/*.md`):

```
PASS: tasks/DIR-029.md — schema v1 conformant (kind=directive)
PASS: tasks/DIR-030.md — schema v1 conformant (kind=directive)
PASS: tasks/DIR-031.md — schema v1 conformant (kind=directive)
PASS: tasks/DIR-032.md — schema v1 conformant (kind=directive)
PASS: tasks/DIR-033.md — schema v1 conformant (kind=directive)
PASS: tasks/DIR-034.md — schema v1 conformant (kind=directive)
PASS: tasks/DIR-035-A.md — schema v1 conformant (kind=directive)
PASS: tasks/DIR-035-B.md — schema v1 conformant (kind=directive)
PASS: tasks/DIR-035-C.md — schema v1 conformant (kind=directive)
PASS: tasks/DIR-035-D.md — schema v1 conformant (kind=directive)
PASS: tasks/DIR-035.md — schema v1 conformant (kind=directive)
PASS: tasks/DIR-036-A.md — schema v1 conformant (kind=directive)
PASS: tasks/DIR-036-B.md — schema v1 conformant (kind=directive)
PASS: tasks/DIR-036.md — schema v1 conformant (kind=directive)
PASS: tasks/DIR-037.md — schema v1 conformant (kind=directive)
PASS: tasks/DIR-038.md — schema v1 conformant (kind=directive)
PASS: tasks/DIR-039.md — schema v1 conformant (kind=directive)
PASS: tasks/DIR-040.md — schema v1 conformant (kind=directive)
PASS: tasks/DIR-041.md — schema v1 conformant (kind=directive)
PASS: tasks/DIR-042-A.md — schema v1 conformant (kind=directive)
PASS: tasks/DIR-042-B.md — schema v1 conformant (kind=directive)
PASS: tasks/DIR-042.md — schema v1 conformant (kind=directive)
PASS: tasks/DIR-043.md — schema v1 conformant (kind=directive)
PASS: tasks/DIR-044.md — schema v1 conformant (kind=directive)
PASS: tasks/DIR-045.md — schema v1 conformant (kind=directive)
PASS: tasks/DIR-046.md — schema v1 conformant (kind=directive)
PASS: tasks/DIR-047.md — schema v1 conformant (kind=directive)
PASS: tasks/DIR-048.md — schema v1 conformant (kind=directive)
PASS: tasks/exp5-M-CRYST-A2.md — schema v1 conformant (kind=milestone-candidate)
PASS: tasks/exp5-M-CRYST-B1.md — schema v1 conformant (kind=milestone-candidate)
PASS: tasks/exp5-M-CRYST-B2.md — schema v1 conformant (kind=milestone-candidate)
PASS: tasks/exp5-M-CRYST-B3.md — schema v1 conformant (kind=milestone-candidate)
PASS: tasks/exp5-M-CRYST-B4.md — schema v1 conformant (kind=milestone-candidate)
PASS: tasks/exp5-M-CRYST-B5-PARSER-UNIFY.md — schema v1 conformant (kind=milestone-candidate)
PASS: tasks/exp5-M-CRYST-B6-VALIDATOR-COVERAGE.md — schema v1 conformant (kind=milestone-candidate)
PASS: tasks/exp5-M-CRYST-B7-LOADBEARING-TEST-GATE.md — schema v1 conformant (kind=milestone-candidate)
PASS: tasks/exp5-M-CRYST-C1.md — schema v1 conformant (kind=milestone-candidate)
PASS: tasks/exp5-M-CRYST-D1.md — schema v1 conformant (kind=milestone-candidate)
PASS: tasks/exp5-M-CRYST-D3.md — schema v1 conformant (kind=milestone-candidate)
PASS: tasks/exp5-M-CRYST-D4-LEDGER-STRUCTURED-STATUS.md — schema v1 conformant (kind=milestone-candidate)
PASS: tasks/exp5-M-CRYST-E1.md — schema v1 conformant (kind=milestone-candidate)
PASS: tasks/exp5-M-CRYST-E2.md — schema v1 conformant (kind=milestone-candidate)
PASS: tasks/exp5-M-CRYST-E3.md — schema v1 conformant (kind=milestone-candidate)
PASS: tasks/exp5-M-CRYST-G1.md — schema v1 conformant (kind=milestone-candidate)
PASS: tasks/exp5-M-CRYST-INV.md — schema v1 conformant (kind=milestone-candidate)
PASS: tasks/exp5-M-DIR022-REMAINING-GATES.md — schema v1 conformant (kind=milestone-candidate)
PASS: tasks/exp5-M-DIR032-AUDIT-INDEPENDENCE.md — schema v1 conformant (kind=milestone-candidate)
PASS: tasks/exp5-M-DIR033-WORKTREE-HYGIENE.md — schema v1 conformant (kind=milestone-candidate)
PASS: tasks/exp5-M-GATE-CLI-ERROR-UX.md — schema v1 conformant (kind=milestone-candidate)
PASS: tasks/exp5-M-GATE-HELP-SYNOPSIS-GAP.md — schema v1 conformant (kind=milestone-candidate)
PASS: tasks/exp5-M-GATE-MCP-PARITY-GAP.md — schema v1 conformant (kind=milestone-candidate)
PASS: tasks/exp5-M-TS-MIGRATION-P0.md — schema v1 conformant (kind=milestone-candidate)
PASS: tasks/exp5-M-TS-MIGRATION-P1.md — schema v1 conformant (kind=milestone-candidate)
PASS: tasks/exp5-M-TS-MIGRATION.md — schema v1 conformant (kind=milestone-candidate)
[... 237 N/A-legacy lines omitted for brevity — all unmarked legacy tasks]
291 total, 54 pass, 237 N/A-legacy, 0 fail
```

Each PASS verdict proves all 7 assertions passed (A1-A7 including A6 checkNoScaffolding) — no status-mirror Resolution or projection scaffolding in any of the 54 schema-marked tasks.
