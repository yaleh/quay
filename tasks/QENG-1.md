---
id: QENG-1
title: Gate engine + GateEvent log (port gate-event-store/adjudicate-gate/gate-log)
status: done
labels:
  - initiative:epicd-engine-port
parent: QENG-0
children: []
extra: {}
---
## Proposal
Generalize quay's `task check` / `--enforce-gate` into a **gate engine**: `quay gate <task> [--gate <name>]` evaluates named gates and records a **GateEvent** (queryable via `quay gate-log <task>`). Port epicd `src/core/gate-event-store.ts` (GateEvents as data) + `src/engine/adjudicate-gate.ts` + `gate-log.ts`, adapted to quay's provider store.

## Acceptance Criteria
- [x] `quay gate --list` lists registered gates (exit 0).
- [x] `quay gate <compliant-fixture> --gate dod` exits 0; `quay gate <violating-fixture> --gate dod` exits 1.
- [x] Each gate run appends a GateEvent; `quay gate-log <task> --json` lists them.
- [x] `bun test` (or node test) on the new gate module passes with >=80% coverage on new lines (paste output).

## Definition of Done
References the standard (this initiative's runnable-AC rule) + tests >=80% actually run. Every AC above is a command, not prose.

## Acceptance audit (2026-07-19, human-run — boxes ticked by the verifier, not the author)
Verified independently against `master` (commit `7a9474e`), not trusting the implementer's self-report:
- AC1: `node bin/quay.js gate --list` → `dod`, EXIT=0.
- AC2/AC3: encoded as fixture tests in `packages/quay/test/gate.test.mjs` (compliant→pass/exit0, violating→fail/exit1, gate-log most-recent verdict). Re-run here: 21 tests, 21 pass, 0 fail, EXIT=0.
- AC4: `node --test --experimental-test-coverage` → `src/gate/{engine,gate-event-store,registry}.js` 100% line, `gate-log.js` 100% line / 75% branch — all ≥80%.
Implementation: `packages/quay/src/gate/{gate-event-store,registry,engine,gate-log}.js` + CLI wiring in `bin/quay.js` (595 insertions, code-first). Plan: `docs/plans/8-quay-gate-engine.md`. Proposal: `docs/proposals/proposal-quay-gate-engine.md`.