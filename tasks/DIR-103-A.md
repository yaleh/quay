---
id: DIR-103-A
title: "CLI dry-run: quay gate --dry-run <task-id> executes the acceptance command without recording a GateEvent or mutating status"
status: todo
labels:
  - directive
  - human-steered
  - milestone-candidate
parent: DIR-103
children: []
extra:
  schema: v1
---

**type:** execution

## Proposal

Add `--dry-run` to `quay gate <task-id>` (NOT `quay run` — the original Proposal's
`quay run --dry-run DIR-NNN` contradicts the existing verb-less board-scan driver that
takes no positional id; the correct surface is the gate command, which already accepts a
`<task-id>` plus `--cwd`/`--timeout`).

`quay gate --dry-run <task-id>` executes `task.extra.acceptance` in the EXACT runner
environment a real gate run would use (same cwd, same timeout, same clean env), prints
stdout/stderr + exit code, but:
- does NOT append a GateEvent to the gate-event log;
- does NOT mutate task status (the safety invariant the original Proposal omitted —
  a dry-run must leave `status` untouched, not just skip the GateEvent).

This is the first child of the DIR-103 split (5-mechanism split-recommended finding).
First independently landable mechanism; no dependencies within the split.

## Chosen mechanism

Extend the `gate` command's flag parsing to accept `--dry-run` (short `-n`). When set,
the gate runner executes the acceptance command via the same `runAcceptance()` path used
by a real run (preserving env/cwd/timeout semantics), captures the result, prints
stdout/stderr + exit code to the terminal, and returns WITHOUT calling the gate-event
store or the lifecycle status writer. The dry-run result is not recorded anywhere
durable; its only observable effect is the printed output and the process exit code.

`quay gate --help` documents `--dry-run`.

## Plan

N/A — resolved via a human-steered milestone. The resolving milestone authors a checked
`docs/plans/*.md` plan (DIR-117-B prepared-gate artifact) before implementation.

## Finding

`packages/quay/bin/quay.ts:1256-1299` — the `run` branch documents "NO positional id:
run scans the board itself" and parses only flags; a positional `DIR-NNN` is dropped by
`parseFlags`. The natural surface is `quay gate --dry-run <id>` (`gate` already takes
`<task-id>` plus `--cwd`/`--timeout` at quay.ts:313/385-397). No `--dry-run` exists on
any gate surface today. `packages/quay/src/gate/lifecycle.ts:119-136` — `runComplete`
runs the acceptance gate then writes `status: done`; a dry-run that reuses that path
without an explicit no-write guard would mutate the task. The safety invariant must be
asserted, not assumed.

## Requested action

1. Add `--dry-run`/`-n` to the `quay gate <task-id>` flag set.
2. When set: execute the acceptance command via the same `runAcceptance()` path as a real
   run, print stdout/stderr + exit code, do NOT append a GateEvent, do NOT write any
   lifecycle status field.
3. Document `--dry-run` in `quay gate --help`.
4. RED/GREEN tests: dry-run executes the command, prints result, appends zero GateEvents
   (`gate-log` empty), leaves `status` unchanged; a real `gate <id>` afterwards still
   behaves byte-identically.

## Acceptance Criteria

- [ ] `quay gate --dry-run <task-id>` runs `task.extra.acceptance` with the same
  cwd/timeout/env as a real gate run and prints stdout/stderr + exit code.
- [ ] `quay gate --dry-run <task-id>` appends ZERO GateEvents (gate-event log unchanged —
  real before/after, not asserted).
- [ ] `quay gate --dry-run <task-id>` leaves the task's `status` field unchanged (a
  status-writing fixture task stays `todo`, never `done`).
- [ ] `quay gate --help` lists `--dry-run`.
- [ ] `quay gate <task-id>` (no dry-run) is byte-identical in behavior to pre-change
  (golden-replay).
- [ ] Tests: `packages/quay/test/acceptance.test.mjs` gains RED/GREEN dry-run blocks
  (>=80% coverage on new paths).

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] Landed on `master` under human-steered discipline.
- [ ] A real `quay gate --dry-run` dispatch shows the command executed, exit code
  surfaced, zero GateEvents appended, status untouched.
- [ ] A fresh independent audit finds no refutation.

## Human verification

1. Does `quay gate --dry-run <id>` leave both the GateEvent log and task status untouched?
2. Is `--dry-run` on the `gate` surface (not the verb-less `run` board-scan driver)?

## Touches

- `packages/quay/bin/quay.ts`
- `packages/quay/src/gate/acceptance-runner.ts`
- `packages/quay/test/acceptance.test.mjs`
- `docs/plans/M223-dir-103-a.md`
