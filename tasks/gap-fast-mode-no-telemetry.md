---
id: gap-fast-mode-no-telemetry
title: "Fast-mode (direct) execution emits zero telemetry — the 1-task/hour
  target has no meter"
status: ready
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

- [x] AC1: `fast-mode-telemetry.ts` exists in both mirrors, byte-identical — `experiments/.../fast-mode-telemetry.ts` is a symlink → `../../../plugin/scripts/fast-mode-telemetry.ts`; `cmp -s` clean (tested)
- [x] AC2: `--task-start` writes a schema-valid event (passes A1a's own `validateEvent`) and prints a `runId` — test `AC2 — --task-start writes a schema-valid start event and prints a runId`
- [x] AC3: `--task-end` writes a schema-valid end event carrying the outcome — test `AC3 — --task-end writes a schema-valid end event carrying the outcome`; invalid outcome fails closed
- [x] AC4: A start/end pair yields a computable wall-clock for that task — test `AC4 — a start/end pair yields a computable wall-clock (deterministic unit)` (60s → 1.0 min)
- [x] AC5: `--report --json` emits `{tasks: [{taskId, minutes, outcome}], meanMinutes, medianMinutes, tasksPerHour}` — tests `AC5 — --report --json emits ...` + multi-task roll-up
- [x] AC6: `--report` writes the committed aggregate under `milestones/fast-mode-telemetry/` — test `AC6 — --report writes the committed aggregate...`; real run wrote `milestones/fast-mode-telemetry/2026-08-02.json` (committed)
- [x] AC7: Raw `.workflow-events/` output stays gitignored — test `AC7 — .workflow-events/ is gitignored`; `git check-ignore -v` confirms
- [x] AC8: Zero new event schema — the module imports A1a's constants/validator rather than redefining them (grep-confirmable) — test `AC8 — the module imports A1a's schema; defines no second format`
- [x] AC9: The stage-vocabulary decision (extend `VALID_STAGES` additively vs map to existing) is recorded in the module header, and `SCHEMA_VERSION` is unchanged if the change was purely additive — decision: EXTEND additively (single `"Fast"` stage + `"abandoned"` outcome); `SCHEMA_VERSION` stays `"1"` (M207 additive-growth precedent). Tested
- [x] AC10: An end event with no matching start is reported as `orphaned`, never silently dropped — tests `AC10 — ... orphaned, never dropped` + `in-progress`
- [x] AC11: The fast-mode execution prompt (`docs/analysis/fast-mode-execution-prompt.md`) documents the two calls as a required per-task step — added mandatory `遥测` section + loop steps 0/10

## Definition of Done

- [x] Both mirrors byte-identical; tests in `plugin/test/` (CI glob) cover AC2–AC5 and AC10 — `plugin/test/fast-mode-telemetry.test.mjs` (21 tests, all pass: AC2–AC5, AC10, AC6–AC9, byte-identity, + 5 adversarial-review regression tests). Mirrors `cmp -s` clean
- [x] Run against a real task execution end-to-end; the resulting `--report` output pasted into the task — real run on this task itself, 2026-08-02, see「实现记录」below; committed aggregate at `milestones/fast-mode-telemetry/2026-08-02.json`
- [ ] `scripts/test.sh` still green — **NOT proven in this worktree.** Full suite not run per implementer discipline (local tests only). The round-2 reviewer DID run the full suite: 597 pass / 129 fail, ALL environmental (`ERR_MODULE_NOT_FOUND: yaml` — no `node_modules` in the worktree; no built `plugin/vendor/quay/dist/quay.js`), none touching this task's files. This task's own tests (Node-built-ins only), `workflow-event-schema.test.mjs` (50), golden-replay (2), and schema-adjacent workflow tests (37) are all green. Needs CI/orchestrator `scripts/test.sh` verification after merge

## 实现记录

Real end-to-end run of the tool on THIS task (gap-fast-mode-no-telemetry), 2026-08-02:

```
$ fast-mode-telemetry.ts --task-start --taskId gap-fast-mode-no-telemetry
fm-gap-fast-mode-no-telemetry-1785660267437-55b5ws

$ fast-mode-telemetry.ts --task-end --taskId gap-fast-mode-no-telemetry \
    --runId fm-gap-fast-mode-no-telemetry-1785660267437-55b5ws --outcome done
fast-mode-telemetry: end event written for gap-fast-mode-no-telemetry (runId ..., outcome done)

$ fast-mode-telemetry.ts --report --json
{
  "generatedAt": "2026-08-02T08:59:56.204Z",
  "since": null,
  "tasks": [
    { "taskId": "gap-fast-mode-no-telemetry", "minutes": 15.47, "outcome": "done" }
  ],
  "orphaned": [],
  "inProgress": [],
  "meanMinutes": 15.47,
  "medianMinutes": 15.47,
  "tasksPerHour": 3.88
}
```

(15.47 minutes measured wall-clock — well under the 1-hour/task target. Raw event stays in the
gitignored `.workflow-events/`; the committed snapshot is `milestones/fast-mode-telemetry/2026-08-02.json`.)

Adversarial review: 2 rounds (hard cap). Round 1 REFUTED — 4 real defects fixed (runId path
traversal; `--since` mislabelling straddling pairs as orphaned; negative wall-clock not guarded;
eventKind-less Fast events misclassified). Round 2 NOT REFUTED — all 4 fixes confirmed, no new
defects. 5 regression tests added for the 4 fixes (21 tests total).

**Why `ready` not `done`:** all 11 ACs proven by tests; DoD items 1–2 proven. DoD item 3
(`scripts/test.sh` still green) is not verifiable in this worktree (no `node_modules`/vendor build
— the reviewer's full-suite run shows the 129 failures are environmental and pre-existing). Flip to
`done` after a CI/orchestrator `scripts/test.sh` run confirms green.

## Touches

- experiments/quay-perpetual-stream/scripts/fast-mode-telemetry.ts
- plugin/scripts/fast-mode-telemetry.ts
- plugin/test/fast-mode-telemetry.test.mjs
- docs/analysis/fast-mode-execution-prompt.md
- plugin/scripts/workflow-event-schema.mjs (+ byte-identical experiments mirror) — AC9-authorized
  ADDITIVE extension only: `"Fast"` added to `VALID_STAGES`, `"abandoned"` to `VALID_OUTCOMES`;
  `SCHEMA_VERSION` unchanged; no existing value touched
