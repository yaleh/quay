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
  - QENG-5
extra:
  initiative: epicd-engine-port
---
## Proposal
quay has a clean **data layer** (providers native/github, task CRUD, `task check`/`--enforce-gate`, `action`, `serve`, `mcp`) but lacks epicd's **engine layer** (driver, phase pipeline, gate system, GateEvent log, complete/adjudicate lifecycle). Port epicd's engine pillars (`/home/yale/work/epicd/src/engine/*`, `src/core/gate-event-store.ts`) into quay, TRIMMED to quay's provider architecture — so exp5's prose DoD/AC checks become executable engine commands. Reference discipline: epicd AGENTS.md ADR-019 "the meter is runnable, not asserted." This is the §3 compression that ends exp5's molten (1:9 code:doc) state.

## Acceptance Criteria
- [x] `quay gate <task>` runs a task's runnable acceptance and exits 0 (pass) / 1 (fail) — proven on a compliant and a violating fixture task. (QENG-1/2)
- [ ] At least one exp5 DoD check is invoked via `quay gate`, not prose (green). — REMAINING: this is the exp5-integration step, deliberately deferred while exp5 is paused; the engine to do it is now built.
- [x] Self-hosting fixpoint: `quay gate QENG-1` runs quay's own gate on quay's own porting task and goes green. (verified: `quay gate QENG-1` → PASS)
- [x] Initiative code:doc churn is code-dominant (inverts exp5's 1:9): the four impl commits are ~2560 code+test lines vs the six lean docs — an inversion of exp5's 1:9.

## Progress (2026-07-19)
Engine layer BUILT: **QENG-1 (gate engine), QENG-2 (acceptance meter), QENG-3 (lifecycle), QENG-4 (driver `quay run`) all DONE** on master (commits 7a9474e, d33a834, f0decb4, e2e6726). quay now has `packages/quay/src/gate/{engine,registry,gate-event-store,gate-log,acceptance-runner,lifecycle,driver}.js` and commands `gate/gate-log/complete/adjudicate/promote/retreat/run`. 3 of 4 epic ACs met; the remaining one (adopt at least one exp5 gate via `quay gate`) is the exp5-integration step — the natural next move once exp5 is resumed on the new engine. Epic stays open until that lands.

## Definition of Done
References the standard quay engine gates (once QENG-1 lands) + each child's own DoD. HARD rule for this whole initiative: **no AC or DoD may be a prose claim — every AC is a runnable command with an exit code.** Children QENG-1..4 each DONE (their runnable ACs green, tests >=80% actually run).