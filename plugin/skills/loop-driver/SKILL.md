---
name: quay-loop-driver
description: "Drive THIS workspace's quay ready-task queue persistently under /loop — SELECT the first ready task, execute it (quay:execute), gate it (quay gate), settle (done/needs-human), ScheduleWakeup on idle, repeat until .quay/.loop-stop exists. Runner-agnostic and workspace-portable."
allowed-tools: Bash, Read
---

# quay-loop-driver

    halt?   :: Workspace → bool                 -- test -f .quay/.loop-stop ; ⊨ checked before every select
    select  :: Workspace × Provider → Task?     -- task_list --status ready ; take first ; ⊨ never fabricate
    execute :: Task → Attempt                   -- delegate to quay:execute ; ⊨ no re-implementation here
    gate    :: Task → Pass | Fail               -- quay gate <id> [--gate <name>] ; ⊨ exit 0 = PASS ; fail-closed
    settle  :: Task × verdict → done | needs-human  -- PASS → done ; FAIL → needs-human (no silent retry)
    idle    :: () → ScheduleWakeup(300s)        -- queue empty → ScheduleWakeup then return ; ⊨ never Bash sleep

invariants: halt-checked-first · gate-fail-closed · no-fabrication · settle-immediate(no-retry)

**Invocation:** `/loop /quay:loop-driver` only. Each `/loop` call executes one `halt? → select → execute → gate → settle` cycle (or one `halt? → select → idle` if empty), then returns. The `/loop` framework re-invokes on wakeup.

**Sentinel:** `.quay/.loop-stop` (workspace-relative). Touch to stop cleanly at the next boundary.

**Runner-agnostic.** No test runner, language, or project name in this skill. Gate is whatever `quay gate` resolves from `.quay/gates.yml` — workspace data, not hardcoded here.

## Cycle

```
cycle :: Provider → ()
cycle(provider) =
  if test -f .quay/.loop-stop → log "halt"; return
  task := task_list(status=ready, provider)
  if task is None →
    read idle_sleep_s from .quay/loop.yml (default 300)
    ScheduleWakeup(delaySeconds, "queue empty — rechecking", "/quay:loop-driver")
    return
  execute(task, provider)                         -- quay:execute skill
  verdict := gate(task.id, provider)              -- quay gate <id>; exit 0 = PASS
  case verdict of
    Pass → task edit <id> --status done
    Fail → task edit <id> --status needs-human    -- capture gate output first
```

## Steps

0. `test -f .quay/.loop-stop` — if present, log and return. Never remove the file.
1. `task_list --status ready --provider <provider>` (MCP `task_list` or CLI). Take the first result.
   - Empty → read `grep -m1 'idle_sleep_s' .quay/loop.yml 2>/dev/null | grep -oE '[0-9]+'`, default 300; call `ScheduleWakeup(delaySeconds=N, reason="queue empty — rechecking ready tasks", prompt="/quay:loop-driver")`; return.
2. Invoke `quay:execute` against the task id. Delegate fully — do not re-implement the task's plan here.
3. `quay gate <task-id> [--gate <name>] --provider <provider>`. Exit 0 = PASS; nonzero = FAIL. Do not re-evaluate the verdict.
4. PASS → `quay task edit <id> --status done`. FAIL → capture gate output, then `quay task edit <id> --status needs-human`. First FAIL goes straight to `needs-human` — no retry loop.
