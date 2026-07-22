---
id: exp5-DEFECT-QC-T1-FIXTURE-PROBE-LOSS
title: "defect: QC-T1 healthcheck fixture task lost between cycles — silent recovery masks broken healthcheck"
status: todo
labels:
  - milestone-candidate
  - defect
---
## Proposal

The OUTER-LOOP.md healthcheck step uses `mcp__quay__task_get` to probe for a `QC-T1` fixture task
as a liveness signal for the native task store. The fixture was absent in 3 consecutive healthcheck
calls within session `e0fb1192-a14a-45a8-bd2c-fa929a1e363e` (2026-07-20, ~08:09–09:00 UTC),
producing `no such task: QC-T1 (provider: native)`. Despite this, the loop continued running —
meaning the error was swallowed rather than treated as a hard gate failure.

**Evidence:** `analyze_errors` output (project scope, 2026-07-15 to 2026-07-21):
```
tool_name: mcp__quay__task_get, count: 3
examples: ["no such task: QC-T1 (provider: native)", "no such task: QC-T1 (provider: native)"]
```
**Session reference:** `e0fb1192-a14a-45a8-bd2c-fa929a1e363e`, turns starting 2026-07-20T08:09:07Z.
`query_session_content` with `contains="no such task: QC-T1"` returned these turns from this session.

**Gaps identified:**
1. The QC-T1 fixture is not idempotent — if deleted or never created, the healthcheck silently
   fails with a recoverable error rather than a hard gate
2. The loop's healthcheck error handling swallows `no such task` errors (no re-creation, no halt)
3. A broken healthcheck is indistinguishable from a passing one if the loop continues anyway

## Plan

N/A — a targeted fix to make QC-T1 probe idempotent: if `task_get` returns "no such task",
the healthcheck step should re-create the fixture task (or explicitly halt with `needs-human`).
A separate gate should verify fixture presence before each healthcheck cycle, not assume it.

## Acceptance Criteria

- [ ] Healthcheck step explicitly handles `no such task: QC-T1` with one of: (a) re-create the fixture and retry once, or (b) `needs-human` halt (not silent swallow)
- [ ] The fixture probe is documented as idempotent — the healthcheck does not depend on state from a prior session
- [ ] No instance of `no such task: QC-T1` appears as a swallowed error in subsequent sessions

## Definition of Done

References the standard inherited-core DoD clauses.

- [ ] `OUTER-LOOP.md` healthcheck step updated with `no such task` error handling
- [ ] Adversarial audit disposition recorded


## Not selected (M90)

Not selected M90 — exp5-DEFECT-ABSORB-DISPATCH-RECORD-GAP ranked higher (governance-integrity defect with recurring impact, bounded scope). QC-T1 fixture loss deferred to M91+.
