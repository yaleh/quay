---
id: exp5-M-CRYST-E1
title: E1 quay ADR-MANAGEMENT capability + concise .epicd-style ADR form + index
status: done
labels:
  - milestone-candidate
  - crystallization
  - milestone:first-wave
parent: exp5-M-CRYST
children: []
extra:
  schema: "v1"
---
## Proposal
CORRECTED (the original "label:adr / kind:adr riding the B1 task schema" framing was wrong — it conflated ADRs with tasks and reproduced the status-mirror antipattern). Model ADRs as a FIRST-CLASS quay object kind SEPARATE from tasks, per epicd's `EntityType.Decision`: a task is one-shot (todo→done); an ADR is a standing decision continuously applied. Own store (`adr/`, sibling of `tasks/`), decision lifecycle (proposed/accepted/superseded/deprecated/rejected — never "done"), no parent, global `ADR-NNN`, supersedes/superseded-by links. Reached through the Provider ABI (`adr_list/get/write`); Core CLI `quay adr …`, Core MCP tools, web `/adr` views; native implements, github declares unsupported. Concise form: frontmatter + Context + Decision + Consequences.

## Plan
N/A — implemented directly across packages (7 TDD stages: native adr-store → ABI → Core CLI → Core MCP → web → github-unsupported → migration); see docs/proposals/exp5-crystallization-strategy.md §10.

## Acceptance Criteria
- [x] An ADR is created + listed + web-rendered via quay (`quay adr new/list`, `/adr`); the store validates the decision lifecycle (status:done rejected).
- [x] ADRs are a separate kind: they never appear in `quay task list` / the `/` board (asserted in CLI + web tests).
- [x] The 3 existing ADRs migrated out of `tasks/` into `adr/` via the real mechanism; the `kind=adr` task-schema bolt-on retired.
## Definition of Done
References the standard inherited-core DoD clauses. Real landing:
- [x] A real ADR is managed through quay end-to-end (ADR-001/002/003 in `adr/`, accepted, via `quay adr`).
- [x] Strict TDD across all packages (native adr-store 10 + abi 5 + Core cli 3/mcp 3/web 4 + github 3); Core regression 29/29, native 26/26.
- [x] No status-mirror, no parent, no board pollution; net removes the conflated task-shaped ADRs.
- [ ] (next pass) continuous enforcement: applies-to + runnable-check + named `adr-<id>` gate (ADR-TDD→B7) — tracked, NOT part of E1.