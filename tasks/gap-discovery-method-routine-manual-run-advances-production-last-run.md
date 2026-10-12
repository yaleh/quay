---
id: gap-discovery-method-routine-manual-run-advances-production-last-run
title: "discovery-method routine: a manual/acceptance --once run advances the
  PRODUCTION last-run and suppressed the resident 360m cycle"
status: ready
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra: {}
---
## Proposal
Production acceptance check, 2026-10-12. The resident quality-gate driver (pid 342010, started 09:42:53Z) never ran the `discovery-method` routine. Its only fact in `.quay/quality-round.jsonl`, at 09:46:57Z, is `not-evaluated: "not due: ran 36m ago within the 360m interval — nothing spawned"`.

The cause is a manual test run, not the schedule:
- `.quay/routine-last-run.json` holds `discovery-method = 1791796240114` (09:10:40Z). That is the timestamp of a `--once` acceptance run made by the worker of the done task `gap-discovery-method-routine-report-only` against `--root /data/home/yale/work/quay`.
- `plugin/scripts/discovery-method-routine.ts` derives `lastRunPath` from the caller's root (`path.join(root, ROUTINE_LAST_RUN_REL)`, around line 429) and calls `writeLastRun` at around line 691 for EVERY run. A manual or acceptance run therefore advances the production schedule.
- The two `scan-round` lines in `.quay/discovery-method-findings.jsonl` (09:10:40Z, 09:33:09Z) both come from those test runs. Nothing on that line says who ran them.

## Plan
1. Every round records `invoked_by`: `"resident-driver"` when called through the quality-gate driver's routine table, `"manual"` for the `--once` CLI and tests. The `scan-round` line and the routine Fact carry it.
2. Only `invoked_by:"resident-driver"` rounds read and advance the production entry in `.quay/routine-last-run.json`. A manual round:
   - ignores the due gate only when `--force` is given;
   - never writes `.quay/routine-last-run.json`;
   - writes its `scan-round` line with `invoked_by:"manual"`.
3. Manual rounds may still ingest and reflect into the persistent carriers, since report-only output is real data. But they must not change WHEN production runs next.
4. Do not edit, clear or backdate the existing `discovery-method` entry in `.quay/routine-last-run.json`, and do not touch any other routine's entry. The real production round is expected once the 360m interval from 09:10:40Z elapses (about 15:10Z); this task records what actually happens, it does not force it.

## Acceptance Criteria
- [ ] `node --test plugin/test/discovery-method-routine.test.mjs` exits 0, with new cases:
  - (a) a manual round leaves a fixture `routine-last-run.json` byte-identical;
  - (b) a resident-driver round advances only the `discovery-method` key, and the other keys stay byte-identical;
  - (c) a manual round followed by a resident-driver round in the same interval: the resident round is still DUE, because it reads the last PRODUCTION time, not the manual one;
  - (d) a manual round's `scan-round` line carries `invoked_by:"manual"`, a resident one `"resident-driver"`.
- [ ] Real check, read-only on production: paste `jq` of `.quay/routine-last-run.json` before and after one manual `--once` run of the landed code against `/data/home/yale/work/quay`. The `discovery-method` value and every other key must be unchanged. Paste the new `scan-round` line showing `invoked_by:"manual"`.
- [ ] Mutation control: make manual rounds write last-run again and show case (a) goes red. Paste, then revert.
- [ ] Production reading: at least one `scan-round` line with `invoked_by:"resident-driver"` and ts after this task lands, plus the matching quality-round fact (state and reason). If none yet, write 未读到 with the next expected due time computed from `.quay/routine-last-run.json`. （待外部）

## Definition of Done
- AC1–AC3 ticked with output pasted; AC4 read from production or recorded as not yet read.
- `scripts/test.sh --for-task gap-discovery-method-routine-manual-run-advances-production-last-run` green.
- `.quay/routine-last-run.json` was never hand-edited by this task.

## Touches
- tasks/gap-discovery-method-routine-manual-run-advances-production-last-run.md
- plugin/scripts/discovery-method-routine.ts
- plugin/test/discovery-method-routine.test.mjs
