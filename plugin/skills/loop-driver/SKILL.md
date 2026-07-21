---
name: quay-loop-driver
description: "Drive quay's ready-task queue for THIS workspace persistently — SELECT a ready task, execute it (quay:execute), gate it (quay gate), settle (done/needs-human), repeat. Runs until a .quay/.loop-stop sentinel exists (default stop policy: until(.halt)). On idle (no ready task) waits and re-checks rather than exiting. Runner-agnostic and workspace-portable."
allowed-tools: Bash, Read
---

# quay-loop-driver

    select  :: Workspace × ProviderId → Task?                         -- first task at status "ready" (task_list --status ready)
    execute :: Task → ExecutionAttempt                                -- delegate to quay:execute skill
    gate    :: Task → Pass | Fail(reason)                              -- `quay gate <id>` [--gate <name>]; exit 0 = PASS
    settle  :: Task × (Pass|Fail) → done | needs-human
    halt?   :: Workspace → bool                                        -- check .quay/.loop-stop sentinel before each iteration
    idle    :: StopPolicy → Continue | Stop                            -- on empty queue: wait+recheck (until(.halt)) or stop (once/until(∅ ready))
    repeat  :: () → ()

**StopPolicy (default: `until(.halt)`):**
- `until(.halt)` — persistent; on idle, sleep 300 s then re-check; only stops when `.quay/.loop-stop` exists. This is the default and matches exp5's OUTER-LOOP behavior.
- `until(∅ ready)` — stop as soon as the ready queue is empty (one drain pass).
- `once` — stop after the first task cycle, whether or not more tasks remain.

**Sentinel:** `.quay/.loop-stop` (workspace-relative). Touch this file to stop the loop cleanly at the next boundary — equivalent to exp5's `.halt` file. The loop checks it **before** each `select`, not mid-task.

**Slim and runner-agnostic.** No test runner, language, or provider name in this skill. Every gate check is whatever THIS workspace's `.quay/gates.yml` + `quay gate` resolves. Provider defaults to `native`; pass a different id when the workspace's config names a different enabled provider.

## Spec

```
StopPolicy = until(.halt) | until(∅ ready) | once

driveLoop :: (ProviderId, StopPolicy, MaxIterations?) → LoopOutcome
driveLoop(provider, stop=until(.halt), maxIterations=∞) = {
  loop:
    if .quay/.loop-stop exists: log "halt sentinel found"; return HaltSignal
    task := select(provider)              -- quay task list --status ready; take first
    if task is None:
      case stop of
        once | until(∅ ready) -> return Idle   -- bounded run: normal exit
        until(.halt)          -> sleep 300s; continue  -- persistent: wait and re-check
    attempt := execute(task, provider)
    outcome := gate(task.id, provider)
    case outcome of
      Pass      -> quay task edit <task.id> --status done --provider <provider>
      Fail(why) -> quay task edit <task.id> --status needs-human --provider <provider>
    count += 1
    if count >= maxIterations: return Cycled(count)
}
```

## Method

0. **`halt-check`** — before every iteration, run `test -f .quay/.loop-stop`. If it exists, log a clean stop message and exit. Never remove the file — let the human decide when to clear it.

1. **`select-ready`** — `quay task list --status ready --provider <provider>` (or MCP `task_list` with `status: "ready"`). Take the first returned task. If empty and `stop=until(.halt)` (default): apply the idle wakeup mechanism (see below — ScheduleWakeup in `/loop` context, until-loop poll in direct mode). If empty and stop is `once` or `until(∅ ready)`: exit cleanly (`Idle`). Never fabricate a task.

2. **`execute-task`** — invoke `quay:execute` against the selected task id and provider. That skill implements the task's plan, self-audits AC/DoD, and leaves the task unchanged if it could not make progress. This driver delegates — it does not re-implement.

3. **`gate-check`** — `quay gate <task-id> [--gate <name>] --provider <provider>`. Exit 0 = PASS, nonzero = FAIL. Do not second-guess the gate's verdict.

4. **`settle`** — PASS → `quay task edit <task-id> --status done`. FAIL → `quay task edit <task-id> --status needs-human` (see Retry policy). Capture gate output before writing status.

5. **`repeat`** — go back to step 0.

### Retry policy

Default: first FAIL → `needs-human` immediately. No silent infinite retry. A workspace may extend step 4 to retry up to N times before falling back — that is workspace policy, not hardcoded here.

### Idle sleep duration and wakeup mechanism

**CRITICAL — idle wakeup mechanism depends on invocation mode. Do NOT merely emit text.**

Detect mode and act accordingly:

- **`/loop /quay:loop-driver` (preferred):** ScheduleWakeup IS available. On idle, call `ScheduleWakeup(delaySeconds=N, reason="queue empty — rechecking ready tasks", prompt="/quay:loop-driver")` then RETURN immediately. The `/loop` framework re-invokes on wakeup. Do NOT call `Bash("sleep N")` — it will be blocked.
- **Direct `/quay:loop-driver`:** ScheduleWakeup is NOT available. On idle, use `Bash("until quay task list --status ready --provider <provider> | grep -q .; do sleep 60; done")` — a Monitor-style until-loop that polls every 60s. This blocks the session inline until a task appears.

Default N = 300 s (5 min). Read override: `grep -m1 'idle_sleep_s' .quay/loop.yml 2>/dev/null | grep -oE '[0-9]+'` — use that value if present, else 300.

**Invocation modes:**
- **`/loop /quay:loop-driver`** — preferred for persistent loops. Each call handles one select→execute→gate→settle cycle; idle → ScheduleWakeup → return. The `/loop` framework handles re-invocation.
- **`/quay:loop-driver`** direct — uses the until-loop Bash poll for idle. The session must stay alive; if it exits, the loop stops.

## Gaps (honestly declared)

- The `execute` step requires `quay:execute` to be installed; if absent, step 2 cannot make progress (workspace-composition precondition).
- Sequential only — no subagent parallelism assumed.
- Retry policy is intentionally simple; automatic remediation of a failing gate is a human's job.
- In direct-invocation mode, if the session is closed or times out during a `sleep`, the loop stops. Use `/loop /quay:loop-driver` for a more resilient persistent loop.
