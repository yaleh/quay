---
name: quay-loop-driver
description: Drive quay's ready-task queue for THIS workspace end to end — SELECT a ready task, execute it (quay:execute), gate it (quay gate), then mark it done on PASS or needs-human on FAIL, and repeat. Runner-agnostic and workspace-portable (works with any provider/gate configured in .quay/config.yml / task extra.acceptance). Invoke with an optional provider id (default native) and an optional max-iterations bound.
allowed-tools: Bash, Read
---

# quay-loop-driver

    select  :: Workspace × ProviderId → Task?                         -- the oldest/first task at status "ready" (task_list --status ready)
    execute :: Task → ExecutionAttempt                                -- delegate to the quay:execute skill (implements the plan, self-audits AC/DoD)
    gate    :: Task → Pass | Fail(reason)                              -- `quay gate <task-id>` (or --gate <name> if the workspace names one); exit 0 = PASS
    settle  :: Task × (Pass|Fail) → done | needs-human                 -- PASS -> status=done; FAIL -> status=needs-human (default policy; see Retry policy)
    repeat  :: () → ()                                                 -- loop back to select until no ready task remains or the iteration bound is hit

**Slim and runner-agnostic.** This skill names no test runner, no language, and no specific
provider. Every runnable check is whatever THIS workspace's own `quay gate <task-id>` resolves —
by default the `acceptance` gate, which runs `task.extra.acceptance` as a shell command
(workspace data, not something this skill hardcodes). A workspace may instead name a different
gate (`--gate <name>`, e.g. a `dod`/`test-pass`/`coverage-floor` gate it has configured) — this
skill's own cycle does not care which; it only cares about the gate's PASS/FAIL outcome.

**Workspace-portable.** Like `quay-directive`, this skill auto-detects the current workspace's
own `.quay/config.yml` (searched upward from the current directory) and operates on whichever
provider that config enables — it does not assume a fixed task-store layout, a fixed provider id,
or any research/experiment directory. `provider` defaults to `native`; pass a different id if the
workspace's config names one.

## Spec

```
LoopOutcome = Idle | Cycled(count: Int)

driveLoop :: (ProviderId, MaxIterations?) → LoopOutcome
driveLoop(provider, maxIterations) = {
  loop until no ready task or maxIterations reached:
    task := select(provider)                     -- quay task list --status ready --json; take the first
    if task is None: return Idle                 -- nothing left to drive; stop, do not invent work
    attempt := execute(task, provider)            -- invoke the quay:execute skill against task.id
    outcome := gate(task.id, provider)             -- quay gate <task.id> [--gate <name>]; exit code is the verdict
    case outcome of
      Pass      -> quay task edit <task.id> --status done --provider <provider>
      Fail(why) -> quay task edit <task.id> --status needs-human --provider <provider>   -- see Retry policy
  return Cycled(count)
}
```

## Method

1. **`select-ready`** — `quay task list --status ready --provider <provider> --json` (or the MCP
   `task_list` tool with `status: "ready"` if the workspace's client offers it). Pick the first
   returned task. If the list is empty, STOP — this is `Idle`, a normal terminating condition, not
   a failure. Never fabricate a task to keep the loop busy.
2. **`execute-task`** — invoke the existing `execute` skill (`quay:execute` — this plugin's own
   `skills/execute/SKILL.md`, or the equivalent skill already installed in this workspace) against
   the selected task id and provider. That skill implements the task's plan, self-audits its own
   AC/DoD, and leaves the task at `ready` (unchanged) if it could not make progress, or attempts its
   own `ready -> done` transition. This driver does not duplicate that logic — it delegates.
3. **`gate-check`** — run `quay gate <task-id> [--gate <name>] --provider <provider>`. This is the
   single source of truth for PASS/FAIL: **exit code 0 = PASS**, any nonzero exit = FAIL (the
   command's stdout/stderr names the reason, e.g. an acceptance command's own failure output, or a
   configured `dod`/coverage-floor gate's reason string). Do not re-implement or second-guess the
   gate's verdict in this skill — whatever command the workspace names IS the check.
4. **`settle`** — on PASS, `quay task edit <task-id> --status done --provider <provider>`. On FAIL,
   apply the **retry policy** below (default: mark `needs-human` immediately — no silent infinite
   retry). Record the gate's captured output before changing status, so the reason is not lost.
5. **`repeat`** — go back to step 1. Stop when `select-ready` returns nothing, or when an optional
   caller-supplied iteration bound is reached (useful for a bounded demo/CI run rather than an
   unbounded loop).

### Retry policy (documented, not implicit)

Default policy: **first FAIL routes straight to `needs-human`.** This keeps the cycle simple and
fail-closed — a broken acceptance command or a genuinely stuck task does not spin the loop
indefinitely, and a human decides the next step (fix the task, fix the acceptance command, or
manually resolve it). A workspace that wants bounded retries instead may extend step 4 to retry
the `execute` + `gate` pair up to N times before falling back to `needs-human` — that extension is
workspace policy, not something this skill hardcodes.

## Gaps (honestly declared)

- This skill delegates the actual implementation work to the `execute` skill and does not itself
  implement a task's plan — if no `execute`-equivalent skill is installed in the target workspace,
  step 2 has nothing to delegate to and the cycle cannot make progress (a workspace-composition
  precondition, not a bug in this skill).
- No subagent-dispatch/parallelism is assumed — like `author`/`execute`, this runs sequentially in
  the current session unless the host environment offers a fresh-context dispatch primitive.
- The default retry policy is intentionally simple (immediate `needs-human` on FAIL); it does not
  attempt automatic remediation of a failing acceptance command or task — that is a human's job.
