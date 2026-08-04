---
name: quay-cold-start
description: "Cold-start the two-layer loop in a project quay-init has already prepared: mount the two loop monitors (inner-state.sh + session-liveness.sh) via the Monitor tool, re-create the 20-minute outer cron, EXPLICITLY drive the inner session to start fast mode and dispatch the first task, then PROVE the loop is live by reading a real --task-start telemetry record in .workflow-events/. One slash command; the inner start is DRIVEN here, never assumed as a side effect. Events must be DELIVERED to this session (Monitor tool), never via nohup."
allowed-tools: Bash, Read, Monitor, CronCreate, CronList
---

# quay-cold-start

**One slash command that turns a quay-init-prepared project into a running two-layer loop.**
The user's whole cold start is this command; after it returns, the loop must be provably live.

## Why agent-executed, and why nohup does NOT pass

A `nohup bash …inner-state.sh > log &` process and a Monitor-tool process look **identical in `ps`**
(same argv). The difference is where stdout goes: the nohup process writes to a file and **nobody is
notified**; a Monitor-tool process has every stdout line turned into a **session notification**.
The criterion for "the loop is up" is therefore **"an event was delivered to this session"**, not
"a process is running". A cold start whose monitors are nohup'd looks installed but is silently
dead — worse than not installed, because it looks installed.

**⇒ This skill mounts both monitors via the Monitor tool. Never use nohup. If you find yourself
writing `nohup` or `&` to background a monitor, STOP — that is the anti-pattern this skill exists
to prevent.**

## Preconditions (fail-closed)

All must hold before starting; if any fails, STOP and report which precondition failed (never
"fix forward" past a missing precondition):

| Precondition | Path (root = the current working directory) |
|---|---|
| loop mechanism laid down | `<root>/plugin/scripts/inner-state.sh`, `session-liveness.sh`, `fast-mode-telemetry.ts` exist |
| tick docs laid down | `<root>/orchestration/orchestrator-loop-tick.md` and `<root>/docs/analysis/fast-mode-loop-tick.md` exist |
| inner session reachable | tmux session from `<root>/orchestration/session-liveness.env` (`SESSION_TMUX_SESSION=`), else `<project>-0:0.0`, exists (`tmux list-panes -t <session}`) |

## Observable consequences (AC8c) — the falsifiable checklist every cold-start MUST produce

"The same skill command produces the same observable consequences on any model" is only meaningful
if the consequences are a concrete, checkable list. After this skill completes, **all six** must be
true. Report each as `<KEY>: true|false` plus the one-line evidence; `false` on any key = the cold
start did NOT complete.

| # | Key | Checkable definition | Evidence |
|---|---|---|---|
| 1 | `MONITORS-MOUNTED` | Two Monitor-tool invocations exist, one for `<root>/plugin/scripts/inner-state.sh`, one for `<root>/plugin/scripts/session-liveness.sh`; `bash <root>/plugin/scripts/monitor-mount-check.sh --json` reports `mounted=true`, `targetOk=true`, `ownedByThisSession=true` | the `--json` output (three criteria) |
| 2 | `MONITORS-DELIVERING` | **At least one event line from a mounted monitor was delivered to THIS session** (an `INIT` baseline, a `SESSION-STATUS` line, a `BLOCKED`, etc.). A running process is NOT evidence; a nohup log file is NOT evidence | the delivered event line(s), verbatim |
| 3 | `CRON-CREATED` | `CronCreate` `*/20 * * * *` succeeded, `CronList` lists it, AND `bash <root>/plugin/scripts/loop-driver-check.sh <root>` reports `LIVE` (exactly ONE driver — not STALLED, not DOUBLE-TRIGGER) | the check output (`loop-driver: LIVE (1) …`) |
| 4 | `INNER-DRIVEN` | `bash <root>/plugin/scripts/send-keys-verified.sh <session> "<fast-mode tick instruction>"` exited 0 (pane hash changed = delivered). Inner was EXPLICITLY started — not assumed as a side effect of outer guidance | send-keys-verified output (hash before → after) |
| 5 | `TELEMETRY-RECORD` | `<root>/.workflow-events/` contains at least one `.jsonl` file carrying a `--task-start`-written record (the runId from the first `fast-mode-telemetry.ts --task-start --taskId <id> --root <root>`) | `ls <root>/.workflow-events/` + grep for the task-start record |
| 6 | `FIRST-TASK` | At least one task is `ready`/`done` on the board and it has been dispatched — `fast-mode-telemetry.ts --report --json --root <root>` shows it in `inProgress` (or the task-start record in #5 references it) | the `--report --json` `inProgress` |

## Steps

### 1. Locate root, project, session

- `root = $(pwd)` (this skill runs inside the target project's outer session).
- `project = basename "$root"`.
- `session =` value of `SESSION_TMUX_SESSION=` in `<root>/orchestration/session-liveness.env`, else `${project}-0:0.0`.

### 2. Mount the two monitors via the Monitor tool (AC5 — events to THIS session)

```
Monitor({command: "<root>/plugin/scripts/inner-state.sh",
         description: "inner state transitions (INIT/START/OVER90/ORPHAN/RISKY/BLOCKED)",
         persistent: true, timeout_ms: 3600000})
Monitor({command: "<root>/plugin/scripts/session-liveness.sh",
         description: "session alive/active (SESSION-GONE/BACK/IDLE/RESUMED/REPO-STALL/OVERDUE)",
         persistent: true, timeout_ms: 3600000})
```

Both `persistent: true` — they must outlive the current turn. The commands are the ABSOLUTE
laid-down paths in the target project (they self-locate, so they work from the laid-down copy).

### 3. Verify mount AND delivery — do not assume "looks mounted"

```bash
bash <root>/plugin/scripts/monitor-mount-check.sh --json
```

Require `mounted=true` AND `targetOk=true` AND `ownedByThisSession=true` — the three criteria are
three different ways to be wrong (not mounted / mounted on the wrong project / mounted by a previous
session that will never notify this one). Then **wait for at least one delivered event line**
(first `inner-state.sh` snap is up to ~55–60s; `session-liveness.sh --once` in the skill's own run is
faster). If no event arrives within ~90s, the monitors are not delivering — **STOP and report**
`MONITORS-DELIVERING: false`; do not proceed to pretend the loop is up.

### 4. Re-create the 20-minute cron — THE single loop driver (session-scoped, dies with the session)

**`CronCreate` is the ONE loop-driving mechanism.** Do NOT also start a `/loop` (a fixed-interval
`/loop` is the same cron mechanism — a second one is a double-trigger) and do NOT use the self-paced
wakeup (`/loop` with no interval: it has no listing tool and must be re-chained every tick — the most
likely to silently stall unattended). The single-driver invariant is enforced mechanically by
`plugin/scripts/loop-driver-check.sh`.

**Before creating the cron, run the driver check** — creating a second driver when one already exists is
exactly the double-trigger this skill exists to prevent:

```bash
bash <root>/plugin/scripts/loop-driver-check.sh <root>
# exit 0 (LIVE) → a driver is already registered — STOP; creating another would double-trigger.
# exit 4 (DOUBLE-TRIGGER) → already 2+ drivers — STOP and report.
# exit 3 (STALLED) → no driver — proceed to create the cron below.
```

Then create the cron, confirm it is listed, and **record it in the driver registry** (the registry is
what the check counts — a cron that is never recorded is invisible to the check):

```
CronCreate(cron="*/20 * * * *",
           prompt="执行 <root>/orchestration/orchestrator-loop-tick.md 中的 tick 指令",
           recurring=true)
CronList   # confirm it is listed — an unlisted cron is not an alarm, it is a silent no-op
mkdir -p <root>/.quay
printf '%s\n' '{"mechanism":"cron","interval":"*/20 * * * *","source":"cold-start"}' >> <root>/.quay/loop-driver.jsonl
bash <root>/plugin/scripts/loop-driver-check.sh <root>   # MUST now report LIVE (exit 0)
```

A check that does NOT report `LIVE` means the cold start did NOT reach exactly-one-driver — do not
proceed as if it did. If this is a fresh cold-start after a previous session and the pre-check reported
LIVE from a stale registration (the previous session's cron is dead), clear the stale registry with
`rm -f <root>/.quay/loop-driver.jsonl` and re-run the pre-check before creating the cron.

### 5. Drive inner to start fast mode — EXPLICIT, never a side effect (AC1 correction)

```bash
bash <root>/plugin/scripts/send-keys-verified.sh <session> "执行 <root>/docs/analysis/fast-mode-loop-tick.md 中的 tick 指令"
```

`send-keys-verified.sh` exits 0 only if the pane hash changed (delivery confirmed). If it exits
non-zero, inner is unreachable / not consuming input — **STOP**; do not claim the inner start.

### 6. Dispatch the first task

If no task is `ready`, promote the top `label:milestone-candidate` task to `ready` (MCP
`task_write`), or create the first task. The inner fast-mode tick picks it up and dispatches it
(which writes the `--task-start` telemetry record). To make the cold start provably wired even
before inner's first tick lands, ensure a `--task-start` record exists:

```bash
node --experimental-strip-types <root>/plugin/scripts/fast-mode-telemetry.ts --task-start --taskId <firstTaskId> --root <root>
```

(the runId printed here is what step 7 greps for). Only do this yourself if inner has not already
written one — never report success on a missing record.

### 7. Assert the telemetry record — the "loop is up" proof (telemetry AC)

```bash
ls <root>/.workflow-events/*.jsonl
grep -l -- '--task-start\|"task-start"' <root>/.workflow-events/*.jsonl
```

If no `.jsonl` carries a `--task-start` record, the loop has NOT connected — there may be commits
and tick-log writes, but the loop never recorded its own start. **Report `TELEMETRY-RECORD: false`
and STOP.** The record must be in the TARGET project (`.workflow-events/`), not somewhere else.

### 8. Report the observable-consequences checklist

Print all six keys (`MONITORS-MOUNTED`, `MONITORS-DELIVERING`, `CRON-CREATED`, `INNER-DRIVEN`,
`TELEMETRY-RECORD`, `FIRST-TASK`) with `true|false` and the one-line evidence each. This is the
deliverable — the user's whole cold start is this command, and this list is how they (and a future
model) know it actually took.

## Non-goals

- **Not a one-keypress button.** The command count is install (1–2) + init (1) + this skill (1);
  the inner start is INSIDE this skill, not a separate human step.
- **Not a shell script.** The monitors are mounted through the Monitor tool so their events reach a
  session; a script that backgrounds processes delivers to nobody.
