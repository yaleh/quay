---
id: exp5-M-CRYST
title: Crystallization program — molten prose → executable single-source
  (geometric-info-theory)
status: todo
labels:
  - milestone-candidate
  - crystallization
  - epic
parent: null
children:
  - exp5-M-CRYST-A2
  - exp5-M-CRYST-B1
  - exp5-M-CRYST-B2
  - exp5-M-CRYST-B3
  - exp5-M-CRYST-B4
  - exp5-M-CRYST-C1
  - exp5-M-CRYST-D1
  - exp5-M-CRYST-D2
  - exp5-M-CRYST-D3
  - exp5-M-CRYST-E1
  - exp5-M-CRYST-E2
  - exp5-M-CRYST-F1
  - exp5-M-CRYST-G1
  - exp5-M-CRYST-ANALYSIS
  - exp5-M-CRYST-INV
  - exp5-M-CRYST-B5-PARSER-UNIFY
  - exp5-M-CRYST-B6-VALIDATOR-COVERAGE
  - exp5-M-CRYST-B7-LOADBEARING-TEST-GATE
extra: {}
---
## Proposal
Umbrella for the crystallization work. Source: docs/proposals/exp5-crystallization-strategy.md.
Subtractive (remove representations) + executable (runnable invariants) + code-over-prompt (Axis 2′).
Children below; sequence: first wave = B1→B2→B3 (canonical schema + validator + authoring sources) + A2 (namespace), then D/E/analysis.
## Acceptance Criteria
- [ ] All child tasks are done or explicitly needs-human (external only, DIR-026).
## Definition of Done
References inherited-core DoD. Done when every child lands for real (real object operated), net line count negative overall.

## Progress
- 2026-07-19 — FIRST WAVE LANDED (B1→B2→B3 + A2), independently adversarially reviewed (all 8 claims REAL, no blocking defect). The `extra.schema:"v1"` canonical-task-schema gate is operative on real objects (DIR-029 + B1/B2/B3/A2 PASS; sweep 5 pass / rest explicit N/A-legacy / 0 fail); single-source validator (`task-schema.mjs`, imported by `it0-dod-check.mjs`); both authoring sources fixed at root; A2 retired the two corrupted-title duplicate DIR-004/005 (net-negative, no content lost). Review C1/C2 tracked as B6 (validator coverage) / B5 (parser fork).
- 2026-07-19 — D3 INCREMENT 1 (Axis-2′): OUTER-LOOP gate-narration compressed to code-pointers (525→445, net −80), independently reviewed LOSSLESS.
- 2026-07-19 — ADR-TDD authored + TDD debt paid: `task-schema.mjs` backfilled with `test/task-schema.test.mjs` (20 tests, 100% func / ~99% line) via a real RED→GREEN cycle — dogfooding ADR-TDD (load-bearing method-infra gates must be fixture-first + covered).
- 2026-07-19 — E1 LANDED — ADRs are a FIRST-CLASS kind SEPARATE from tasks (superseded the earlier lean `label:adr`-task attempt, which reproduced the status-mirror antipattern: `status:done` + `extra.adrStatus`). Per epicd's `EntityType.Decision`: new `packages/quay-native/src/adr-store.js` (decision lifecycle proposed/accepted/superseded/deprecated/rejected, never "done"; no parent; global `ADR-NNN`), Provider ABI `adr_list/get/write`, Core CLI `quay adr …`, Core MCP tools, web `/adr` views, github declares unsupported. The 3 ADRs migrated out of `tasks/` into `adr/` (repo-root sibling of `tasks/`) via the real `quay adr new` mechanism; the `kind=adr` bolt-on in `task-schema.mjs` retired. Enforcement (`applies-to` + runnable-check + named `adr-<id>` gate, ADR-TDD→B7) reserved for the next pass. Strict TDD across all packages.
- Next: D3 R5–R8 (new single-source checks), D1/D2, E1/E2 (+INV enforcement-with-design), C1, F1, G1 per the re-prioritized §6 sequencing.