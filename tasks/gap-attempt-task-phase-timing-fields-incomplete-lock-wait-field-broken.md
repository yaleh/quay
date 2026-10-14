---
id: gap-attempt-task-phase-timing-fields-incomplete-lock-wait-field-broken
title: attempt/task 分阶段计时字段不全、锁等待字段已证实错误（P90 264min > 全程中位 18min）：补齐
  dispatch/worker-exit/lock/suite/fan-in 各阶段时间戳
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Proposal
**Diagnosis 2026-10-14 (read-only, task/attempt duration analysis) found the existing timing fields insufficient for the phase breakdown the human asked for.** `worker-outcome.jsonl`'s `started_at`/`ended_at` span the WHOLE attempt including fan-in; there is no separately recorded worker-exit timestamp. `mechanical_fan_in.lockAcquireEpoch`/`lockReleaseEpoch` exist, but the per-attempt `wall_ms` field recorded alongside the `acquire-fan-in-lock` step in the per-task fan-in log produced values LARGER than the whole attempt (P90 264 minutes against an 18-minute median attempt) — it does not measure lock wait; its actual meaning is unknown-but-wrong, and no other field measures lock wait directly.

Consequence: the diagnosis could report attempt/task medians, but could NOT reliably report "lock wait", "implementation-done time", or "test start/end" as named requested in this initiative, and had to report them as not computable from existing carriers.

## Plan
1. Add explicit, named timestamps to the attempt record, written by the parts of the pipeline that already know them: worker dispatch (`dispatched_at`), worker process exit (`worker_exited_at`, distinct from the existing `ended_at` which is fan-in-inclusive), fan-in lock request and acquire (`lock_requested_at`, `lock_acquired_at` — a real wait, not the broken field), suite start/end (already exist in the fan-in step trace; link them by run id into the attempt record rather than requiring a second join), fan-in landed/failed (`fanin_ended_at`).
2. Task-level: `first_dispatched_at` (already derivable), and a `ready_at` (when the task entered the ready pool, before first dispatch) persisted on the task's own history rather than recomputed from git log greps (the diagnosis had to parse commit messages for this, which is fragile — besides, promotion/driver already knows this moment).
3. Both attempt and task records distinguish terminal states (done/needs-human/superseded) from in-progress. An in-progress task is NEVER included in a duration statistic — its carrier record should make this structurally obvious to a reader (a `terminal: false` field, not an inferred absence).
4. Right-censoring is explicit: a statistics consumer reading N finished tasks in a window must also see, for that same window, the count and ages of tasks that have an attempt but no terminal event yet. Already partially demonstrated ad hoc in this diagnosis; needs a reusable query, not a bespoke script each time.

## Acceptance Criteria
- [ ] AC1: a real attempt's record (on a natural dispatch, not a forced one) carries all five new timestamps, each independently verified against direct evidence (process start/exit time from /proc or the dispatch log, fan-in step-trace timestamps) — not inferred (pasted).
- [ ] AC2: lock wait computed from the new fields is sane: `0 <= lock wait <= attempt duration` holds for ≥20 consecutive real attempts (pasted; this would have caught the broken field in this diagnosis).
- [ ] AC3: a reusable read-only query reports, for a given window: finished-task duration stats, right-censored in-progress count/ages, and queue-wait stats, matching this diagnosis's structure. Run against the same window as this diagnosis and compared number-for-number (pasted).
- [ ] AC4: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC4 checked with pasted evidence. No existing field is removed; the broken lock-wait field is either fixed in place (with a negative-control showing the old computation was wrong) or replaced and marked deprecated, not silently left broken next to the new one.

## Touches
- tasks/gap-attempt-task-phase-timing-fields-incomplete-lock-wait-field-broken.md
- plugin/scripts/worker-driver.ts
- plugin/scripts/driver-runtime.ts
- plugin/scripts/duration-report.ts
- plugin/test/worker-driver.test.mjs
