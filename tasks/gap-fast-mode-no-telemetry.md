---
id: gap-fast-mode-no-telemetry
title: "Fast-mode (direct) execution emits zero telemetry — the 1-task/hour
  target has no meter"
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

The short-term operating target is **≤1 hour per task, ≥1 task per hour**. That target is
quantitative and currently **unmeasurable**: fast-mode (direct, non-workflow) execution writes no
telemetry at all.

`milestones/prepare-telemetry/` covers only `prepare-milestone.js` dispatches. DIR-124-A1b just
landed `_emitStageEvent` at 17 call sites in `execute-milestone.js` and 4 in `prepare-milestone.js`
— but **fast mode runs neither workflow**, so none of those fire.

### Evidence that this is already biting

The only per-task timings available for the 2026-08-02 fast-mode batch were reconstructed from
commit timestamps after the fact:

| Task | Inferred | Source |
|---|---|---|
| 0.1 gap-green-test-baseline | 38 min | `8d9c995c`→`c30e0b5e` gap |
| 1.1 extract-mechanism-calibration | 15 min | `92c0c352`→`f0b1415e` gap |
| 1.2 DIR-124-F-plancheck | 11 min | `f0b1415e`→`7ad8a555` gap |
| 1.3 DIR-124-A1b | 7 min | `1474dede`→`66f8a578` gap |

That is archaeology, not metering. It cannot separate prepare from implement from review from test,
cannot see a task that was abandoned without a commit, and cannot attribute wall-clock to a
concurrent subagent. None of the questions the target actually needs answered are answerable.

## Chosen mechanism

**Wire the EXISTING A1a schema — do not invent a second event format.**
`experiments/quay-perpetual-stream/scripts/workflow-event-schema.mjs` already provides
`SCHEMA_VERSION`, `VALID_STAGES`, `validateEvent`, `emitEvent`, and an `--emit-event '<json>'` CLI
that appends to `.workflow-events/<runId>.jsonl`. This task adds a thin fast-mode wrapper CLI, not
a new schema.

`experiments/quay-perpetual-stream/scripts/fast-mode-telemetry.ts` (byte-identical `plugin/scripts/`
mirror) with three modes:

- `--task-start --taskId <id>` — writes a start event, prints the `runId` for the caller to hold
- `--task-end --taskId <id> --runId <r> --outcome <done|needs-human|abandoned>` — writes the end event
- `--report [--since <iso>] [--json]` — aggregates `.workflow-events/*.jsonl` into per-task
  wall-clock plus the roll-up the target needs: task count, mean/median minutes per task,
  tasks-per-hour

**Stage vocabulary.** Fast mode's phases are not the workflow's. If `VALID_STAGES` does not already
admit a suitable value, extend it additively (the M207 additive-growth precedent — do NOT bump
`SCHEMA_VERSION` for a pure addition), or map onto existing stages and document the mapping. Decide
explicitly and record which.

**Storage.** `.workflow-events/` is gitignored (transient). The per-task roll-up that the target is
judged against must survive, so `--report` writes a committed summary to
`milestones/fast-mode-telemetry/<date>.json`. Raw events stay gitignored; the aggregate is committed.

**Deliberately NOT built:** an enforcement gate on the 1-hour budget. This task measures. Whether a
task that exceeds budget should be killed is a policy decision that belongs in the execution prompt
first (ADR-021 Principle 1 — do not mechanize a policy before data shows the prompt rule failing).

## Acceptance Criteria

- [ ] AC1: `fast-mode-telemetry.ts` exists in both mirrors, byte-identical
- [ ] AC2: `--task-start` writes a schema-valid event (passes A1a's own `validateEvent`) and prints a `runId`
- [ ] AC3: `--task-end` writes a schema-valid end event carrying the outcome
- [ ] AC4: A start/end pair yields a computable wall-clock for that task
- [ ] AC5: `--report --json` emits `{tasks: [{taskId, minutes, outcome}], meanMinutes, medianMinutes, tasksPerHour}`
- [ ] AC6: `--report` writes the committed aggregate under `milestones/fast-mode-telemetry/`
- [ ] AC7: Raw `.workflow-events/` output stays gitignored (grep `.gitignore`, confirm no new tracked raw events)
- [ ] AC8: Zero new event schema — the module imports A1a's constants/validator rather than redefining them (grep-confirmable)
- [ ] AC9: The stage-vocabulary decision (extend `VALID_STAGES` additively vs map to existing) is recorded in the module header, and `SCHEMA_VERSION` is unchanged if the change was purely additive
- [ ] AC10: An end event with no matching start is reported as `orphaned`, never silently dropped
- [ ] AC11: The fast-mode execution prompt (`docs/analysis/fast-mode-execution-prompt.md`) documents the two calls as a required per-task step

## Definition of Done

- [ ] Both mirrors byte-identical; tests in `plugin/test/` (CI glob) cover AC2–AC5 and AC10
- [ ] Run against a real task execution end-to-end; the resulting `--report` output pasted into the task
- [ ] `scripts/test.sh` still green

## Touches

- experiments/quay-perpetual-stream/scripts/fast-mode-telemetry.ts
- plugin/scripts/fast-mode-telemetry.ts
- plugin/test/fast-mode-telemetry.test.mjs
- docs/analysis/fast-mode-execution-prompt.md
