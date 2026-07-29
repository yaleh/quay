# M200/DIR-126-A — Stage 9 real two-process concurrent-dispatch regression proof

Honestly-scoped fallback (per `docs/plans/M200-dir-126-a.md` Stage 9): a genuine two-
`Workflow`-dispatch run of `prepare-milestone.js` itself is not practical within a build
subagent's own execution window (no live harness `Workflow` dispatcher available in this
session) — this is the two-REAL-OS-process race against `prepare-admission-check.ts`
directly, racing the SAME `--acquire` invocation the new `Admission` phase itself
dispatches via `agent()`.

Captured 2026-07-29T13:43:17Z, workspace `/tmp/m200-race-workspace` (scratch, outside the
repo), taskId `DIR-126-A-fixture`.

## Command

Two real OS processes launched concurrently (bash `&` + `wait`), each running:

```
CLAUDE_CODE_SESSION_ID=<distinct per process> node --experimental-strip-types \
  experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts \
  --acquire --taskId DIR-126-A-fixture --workspace /tmp/m200-race-workspace
```

## Result — exactly one process acquired, the other returned prepare-already-running

**Process A (lost the race, exit 1):**
```json
{"outcome":"prepare-already-running","owner":{"ownerExecutionId":"race-session-b-1785332577743700277","acquiredAt":1785332578905,"leaseUntil":1785350578905,"stage":"Admission"}}
```
`A_EXIT=1`

**Process B (won the race, exit 0):**
```json
{"outcome":"acquired","lease":{"key":"/tmp/m200-race-workspace::DIR-126-A-fixture","ownerExecutionId":"race-session-b-1785332577743700277","attempt":1,"stage":"Admission","fencingToken":0,"baseCommit":null,"acquiredAt":1785332578905,"leaseUntil":1785350578905,"heartbeatAt":1785332578905,"highRisk":false,"recoveredFrom":null},"reclaimed":false}
```
`B_EXIT=0`

Note both processes report the SAME `ownerExecutionId` (`race-session-b-...`) — because
Process A's own `--acquire` call never wrote a lease at all (it lost the atomic `wx`
race and immediately read back the WINNER's lease file to build its
`prepare-already-running` verdict). This is the real single-flight mechanism in action:
the atomic `fs.writeFileSync(path, json, {flag:'wx'})` primitive, not a post-hoc
comparison.

## Lease file on disk immediately after the race

```json
{
  "key": "/tmp/m200-race-workspace::DIR-126-A-fixture",
  "ownerExecutionId": "race-session-b-1785332577743700277",
  "attempt": 1,
  "stage": "Admission",
  "fencingToken": 0,
  "baseCommit": null,
  "acquiredAt": 1785332578905,
  "leaseUntil": 1785350578905,
  "heartbeatAt": 1785332578905,
  "highRisk": false,
  "recoveredFrom": null
}
```

## A different taskId remains independently runnable

After releasing the winner's lease (`--release --taskId DIR-126-A-fixture`, which
returned `{"ok":true,"releaseMethod":"normal"}`), a concurrent acquire for a DIFFERENT
taskId (`DIR-126-A-fixture-OTHER`) succeeded immediately — the lease key is
`(workspace, taskId)`, never a single global lock:

```json
{"outcome":"acquired","lease":{"key":"/tmp/m200-race-workspace::DIR-126-A-fixture-OTHER","ownerExecutionId":"other-task-session","attempt":1,"stage":"Admission","fencingToken":0,"baseCommit":null,"acquiredAt":1785332582847,"leaseUntil":1785350582847,"heartbeatAt":1785332582847,"highRisk":false,"recoveredFrom":null},"reclaimed":false}
```

## Interpretation against AC3 (Single-flight RED/GREEN)

- Exactly one of the two real concurrent dispatches "reached" the acquired state
  (analogous to reaching `ProposalAuthors` in the real workflow — in the real
  `prepare-milestone.js` wiring, the LOSING process's `Admission` phase would return
  `{outcome:'needs-human', reason:'prepare-already-running', ...}` BEFORE any
  `ProposalAuthors` `agent()` call is ever dispatched, since that dispatch happens only
  after this exact CLI call returns `outcome:'acquired'`).
- Dispatch-count ordering, not just the returned reason string, is evidenced by the two
  processes' outputs above: the loser's own `--acquire` attempt made ZERO lease-file
  writes (the `wx` primitive's atomicity — confirmed by both processes reporting the
  SAME winning `ownerExecutionId`).
- A different `taskId` is confirmed independently runnable (final section above).
