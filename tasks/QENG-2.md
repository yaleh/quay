---
id: QENG-2
title: "AC-as-runnable-meter: task.acceptance executed by quay gate (epicd ADR-019)"
status: done
labels:
  - initiative:epicd-engine-port
parent: QENG-0
children: []
extra: {}
---
## Proposal
Add an **acceptance** field to the task model: a runnable command (or list). `quay gate <task>` (default `acceptance` gate) executes it in a sandboxed cwd with a timeout and transparently propagates the exit code. This is epicd ADR-019's "runnable meter" — it directly fixes exp5's poor verifiability (audits run a command instead of judging prose).

## Acceptance Criteria
- [x] `quay task edit X --acceptance 'exit 0'` then `quay gate X` exits 0.
- [x] `quay task edit X --acceptance 'exit 1'` then `quay gate X` exits 1.
- [x] Acceptance runs at repo root with an enforced timeout; a hanging command is killed and reported as fail (exit 1).
- [x] tests >=80% on the acceptance-runner, actually run (paste output).

## Definition of Done
References the standard + tests >=80%. Every AC is a command.

## Acceptance audit (2026-07-19, human-run — the LITERAL CLI commands, against a correct workspace)
Verified independently against `master` (commit `d33a834`), running the AC commands as written (not the implementer's test harness):
- AC1: `quay task edit OK --acceptance 'exit 0'` → task's `extra.acceptance` = `"exit 0"` persisted (view --json); `quay gate OK` → EXIT=0.
- AC2: `--acceptance 'exit 1'` → `quay gate NO` → EXIT=1.
- AC3: `--acceptance 'sleep 30'` + `QUAY_ACCEPTANCE_TIMEOUT_MS=200 quay gate TMO` → EXIT=1 in ~0.9s (killed early, NOT 30s).
- AC4: `node --test --experimental-test-coverage packages/quay/test/acceptance.test.mjs` → 21/21, `acceptance-runner.js` 100% line, `registry.js` 100% line. QENG-1 regression `gate.test.mjs` → 21/21.
Implementation: `packages/quay/src/gate/acceptance-runner.js` + `registry.js` (acceptance gate) + `bin/quay.js` (`--acceptance` flag, default gate = acceptance, `QUAY_ACCEPTANCE_CWD`). 445 insertions. Plan: `docs/plans/9-quay-acceptance-meter.md`. Proposal: `docs/proposals/proposal-quay-acceptance-meter.md`.
Note: a first verification pass FALSELY appeared to fail — the fixture `.quay/config.yml` was hand-written in list form without `mcp_entry`, so `withProvider` crashed. The real workspace config is a provider MAP with `mcp_entry`/`path`/`env` (see `.quay/config.yml` and the test `makeWorkspace()`); with a correct config all four ACs pass. Lesson recorded for future ad hoc verification.