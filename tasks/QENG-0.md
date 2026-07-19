---
id: QENG-0
title: Port epicd engine layer into quay — executable workflow engine
  (lighter-weight epicd)
status: todo
labels:
  - epic
  - initiative:epicd-engine-port
parent: null
children:
  - QENG-1
  - QENG-2
  - QENG-3
  - QENG-4
extra:
  initiative: epicd-engine-port
---
## Proposal
quay has a clean **data layer** (providers native/github, task CRUD, `task check`/`--enforce-gate`, `action`, `serve`, `mcp`) but lacks epicd's **engine layer** (driver, phase pipeline, gate system, GateEvent log, complete/adjudicate lifecycle). Port epicd's engine pillars (`/home/yale/work/epicd/src/engine/*`, `src/core/gate-event-store.ts`) into quay, TRIMMED to quay's provider architecture — so exp5's prose DoD/AC checks become executable engine commands. Reference discipline: epicd AGENTS.md ADR-019 "the meter is runnable, not asserted." This is the §3 compression that ends exp5's molten (1:9 code:doc) state.

## Acceptance Criteria
- [ ] `quay gate <task>` runs a task's runnable acceptance and exits 0 (pass) / 1 (fail) — proven on a compliant and a violating fixture task.
- [ ] At least one exp5 DoD check is invoked via `quay gate`, not prose (green).
- [ ] Self-hosting fixpoint: `quay gate QENG-1` runs quay's own gate on quay's own porting task and goes green.
- [ ] Initiative code:doc churn is code-dominant (inverts exp5's 1:9), measured by the same script used in the GIT analysis.

## Definition of Done
References the standard quay engine gates (once QENG-1 lands) + each child's own DoD. HARD rule for this whole initiative: **no AC or DoD may be a prose claim — every AC is a runnable command with an exit code.** Children QENG-1..4 each DONE (their runnable ACs green, tests >=80% actually run).