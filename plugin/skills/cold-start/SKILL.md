---
name: quay-cold-start
description: "Cold-start the two-layer loop in a project quay-init has already prepared: mount the loop monitor (session-liveness.sh) via the Monitor tool, re-create the 20-minute outer cron, EXPLICITLY drive the inner session to start fast mode and dispatch the first task, then PROVE the loop is live by reading a real --task-start telemetry record in .workflow-events/. One slash command; the inner start is DRIVEN here, never assumed as a side effect. Events must be DELIVERED to this session (Monitor tool), never via nohup."
allowed-tools: Bash, Read, Monitor, CronCreate, CronList
---

# quay-cold-start

**One slash command that turns a quay-init-prepared project into a running two-layer loop.**
The user's whole cold start is this command; after it returns, the loop must be provably live.

## Why agent-executed, and why nohup does NOT pass

A `nohup bash …session-liveness.sh > log &` process and a Monitor-tool process look **identical in
`ps`** (same argv). The difference is where stdout goes: the nohup process writes to a file and
**nobody is notified**; a Monitor-tool process has every stdout line turned into a **session
notification**.
The criterion for "the loop is up" is therefore **"an event was delivered to this session"**, not
"a process is running". A cold start whose monitor is nohup'd looks installed but is silently
dead — worse than not installed, because it looks installed.

**⇒ This skill mounts the monitor via the Monitor tool. Never use nohup. If you find yourself
writing `nohup` or `&` to background a monitor, STOP — that is the anti-pattern this skill exists
to prevent.**

## Preconditions (fail-closed)

All must hold before starting; if any fails, STOP and report which precondition failed (never
"fix forward" past a missing precondition):

| Precondition | Path (root = the current working directory) |
|---|---|
| loop mechanism laid down | `<root>/plugin/scripts/session-liveness.sh`, `fast-mode-telemetry.ts` exist |
| tick docs laid down | `<root>/orchestration/orchestrator-loop-tick.md` and `<root>/docs/analysis/fast-mode-loop-tick.md` exist |
| inner session reachable | tmux session from `<root>/orchestration/session-liveness.env` (`SESSION_TMUX_SESSION=`), else `<project>-0:0.0`, exists (`tmux list-panes -t <session}`) |

**Launch config is checked-in, not remembered.** The correct per-role launch command lives in
`<root>/.claude/launch.settings.json` (settings-schema keys + `_launchSpec` for flag-only params) and is
materialized by `<root>/plugin/scripts/quay-launch.sh`. If a session must be (re)started during this
skill, run `bash <root>/plugin/scripts/quay-launch.sh <role>` (roles `manager|outer|inner`) — never
hand-type a shell one-liner from memory (`gap-crystallize-launch-config-into-checked-in-settings-file`).
Verify the command without starting anything: `bash <root>/plugin/scripts/quay-launch.sh <role> --dry-run`.
For a one-shot verification session use `bash <root>/plugin/scripts/quay-launch.sh <role> --bare`
(minimal mode, not long-lived).

## Observable consequences (AC8c) — the falsifiable checklist every cold-start MUST produce

"The same skill command produces the same observable consequences on any model" is only meaningful
if the consequences are a concrete, checkable list. After this skill completes, **all seven** must be
true. Report each as `<KEY>: true|false` plus the one-line evidence; `false` on any key = the cold
start did NOT complete.

| # | Key | Checkable definition | Evidence |
|---|---|---|---|
| 1 | `MONITORS-MOUNTED` | ONE Monitor-tool invocation exists for `<root>/plugin/scripts/session-liveness-mount.sh` (the single observer — `inner-state.sh` is retired, gap-retire-inner-state-one-observer-targets-by-parameter); `bash <root>/plugin/scripts/monitor-mount-check.sh --json` reports `mounted=true`, `targetOk=true`, `delivered=true` | the `--json` output (three criteria) |
| 2 | `MONITORS-DELIVERING` | **At least one event line from the mounted monitor was delivered to THIS session** (a `SESSION-STATUS` line, a `SESSION-GONE`, a `SESSION-OVERDUE`, a `HEARTBEAT`, etc.). A running process is NOT evidence; a nohup log file is NOT evidence | the delivered event line(s), verbatim |
| 3 | `CRON-CREATED` | `CronCreate` `*/20 * * * *` succeeded, `CronList` lists it, AND `bash <root>/plugin/scripts/loop-driver-check.sh <root>` reports `LIVE` (exactly ONE driver — not STALLED, not DOUBLE-TRIGGER) | the check output (`loop-driver: LIVE (1) …`) |
| 4 | `INNER-DRIVEN` | `bash <root>/plugin/scripts/send-keys-reliable.sh <session> "<fast-mode tick instruction>" <target-transcript.jsonl>` exited 0 — the TARGET session's own transcript shows the drive text as a real user message (`transcript-delivery-check.ts`, Fault 5; only the target transcript is a trustworthy delivery signal — the pane-hash criterion is superseded, outer ruling F, 3 false positives). Inner was EXPLICITLY started — not assumed as a side effect of outer guidance | send-keys-reliable output (`delivered: true` + matched transcript line) |
| 5 | `TELEMETRY-RECORD` | `<root>/.workflow-events/` contains at least one `.jsonl` file carrying a `--task-start`-written record (the runId from the first `fast-mode-telemetry.ts --task-start --taskId <id> --root <root>`) | `ls <root>/.workflow-events/` + grep for the task-start record |
| 6 | `FIRST-TASK` | At least one task is `ready`/`done` on the board and it has been dispatched — `fast-mode-telemetry.ts --report --json --root <root>` shows it in `inProgress` (or the task-start record in #5 references it) | the `--report --json` `inProgress` |
| 7 | `TOPOLOGY-IN-PLACE` | The two-window session topology is in place per the factory definition — `bash <root>/plugin/scripts/topology-check.sh --session <session> --json` reports `ok: true` (each of `<session>:outer/:inner` exists AND has a claude process, not a bare bash window). manager is cross-project and NOT part of this topology. A single-bash-window session (the meta-cc-3/archguard-4 failure shape) MUST report `ok: false` | the `--json` output (`ok: true` + both windows `ok`) |

## Steps

### 1. Locate root, project, session

- `root = $(pwd)` (this skill runs inside the target project's outer session).
- `project = basename "$root"`.
- `session =` value of `SESSION_TMUX_SESSION=` in `<root>/orchestration/session-liveness.env`, else `${project}-0:0.0`.

### 2. Build and verify the two-window session topology (AC4 — the other half of 装得上)

The session the loop lives in is built **by definition**, never hand-assembled
(`gap-tmux-session-topology-no-factory-definition`; two-window correction
`gap-manager-baked-into-project-topology-factory` — manager is cross-project, not part of the
project topology). The definition ships in the `quay-session-topology` skill; this step applies
it. **Cross-annotation (`gap-outer-self-checks-and-creates-inner-session`):** this step is the
build-by-definition half; the OUTER's own cold-start path
(`orchestration/orchestrator-loop-tick.md` step 3) independently SELF-CHECKS inner in three
states — healthy (window+process+user message) ⇒ untouched, empty-shell (window+process, no user
message) ⇒ driven not rebuilt, missing (no window or process) ⇒ calls this same factory.

```bash
bash <root>/plugin/scripts/quay-topology.sh --session <session>        # build: outer/inner per definition (idempotent; manager is cross-project, not built here)
bash <root>/plugin/scripts/topology-check.sh --session <session> --json # verify: each window exists AND has a claude process
```

Require the check to report `ok: true`. A single-bash-window session (the meta-cc-3 / archguard-4
failure shape) reports `ok: false` — STOP; a cold start in a hand-built single-bash-window session
would start the loop in a session that is visibly not the shipped topology.

### 3. Mount the monitor via the Monitor tool (AC5 — events to THIS session)

Observation has exactly ONE tool (`session-liveness.sh`, SPEC-one-observer-two-surfaces.md).
`inner-state.sh` is retired — it never observed the session (tmux hits 0) and its signature signal
(`.quay/inner-blocked.json`) never fired in any project. Mount `session-liveness-mount.sh` (the
single-flight mount entry, which execs `session-liveness.sh`):

```
Monitor({command: "<root>/plugin/scripts/session-liveness-mount.sh",
         description: "session alive/active (SESSION-GONE/BACK/IDLE/RESUMED/REPO-STALL/OVERDUE/HEARTBEAT)",
         persistent: true, timeout_ms: 3600000})
```

`persistent: true` — it must outlive the current turn. The command is the ABSOLUTE laid-down path in
the target project (it self-locates, so it works from the laid-down copy).

### 4. Verify mount AND delivery — do not assume "looks mounted"

```bash
bash <root>/plugin/scripts/monitor-mount-check.sh --json
```

Require `mounted=true` AND `targetOk=true` AND `delivered=true` — the three criteria are three
different ways to be wrong (not mounted / mounted on the wrong project / no events actually reaching
the shared session-liveness events file). AC9 (gap-liveness-mounting-is-a-single-flight-role-with-no-
owner): the ownership criterion is ABOLISHED — the criterion is "事件是否真的送达", not "是不是本会话
挂的"; a mount from another session that is delivering normally must still PASS. Then **wait for at
least one delivered event line**
(`session-liveness.sh --once` in the skill's own run is faster; a resident mount emits a `HEARTBEAT`
each round). If no event arrives within ~90s, the monitor is not delivering — **STOP and report**
`MONITORS-DELIVERING: false`; do not proceed to pretend the loop is up.

### 5. Re-create the 20-minute cron — THE single loop driver (session-scoped, dies with the session)

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

### 6. Drive inner to start fast mode — EXPLICIT, never a side effect (AC1 correction)

Delivery criterion = the TARGET session's own transcript jsonl shows the drive text as a REAL user
message (`transcript-delivery-check.ts`, Fault 5 in
`orchestration/CRYSTALLIZED-reliable-send-2026-08-04.md`) — only the target transcript is a
trustworthy delivery signal. The previously-shipped whole-pane-hash exit-0 criterion was superseded
by outer ruling F (`orchestration/outer-rulings-2026-08-04-A-F.md`, 3 false positives) — do NOT use it.

```bash
bash <root>/plugin/scripts/send-keys-reliable.sh <session> "执行 <root>/docs/analysis/fast-mode-loop-tick.md 中的 tick 指令" <target-transcript.jsonl>
```

(`<target-transcript.jsonl>` = the inner session's OWN transcript jsonl, e.g.
`~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`.) `send-keys-reliable.sh` exits 0 only when
that transcript shows a real user message containing the drive text (delivery confirmed). If it
exits non-zero, inner is unreachable / the text was not delivered — **STOP**; do not claim the
inner start.

### 7. Dispatch the first task

If no task is `ready`, promote the top `label:milestone-candidate` task to `ready` (MCP
`task_write`), or create the first task. The inner fast-mode tick picks it up and dispatches it
(which writes the `--task-start` telemetry record). To make the cold start provably wired even
before inner's first tick lands, ensure a `--task-start` record exists:

```bash
node --experimental-strip-types <root>/plugin/scripts/fast-mode-telemetry.ts --task-start --taskId <firstTaskId> --root <root>
```

(the runId printed here is what step 8 greps for). Only do this yourself if inner has not already
written one — never report success on a missing record.

### 8. Assert the telemetry record — the "loop is up" proof (telemetry AC)

```bash
ls <root>/.workflow-events/*.jsonl
grep -l -- '--task-start\|"task-start"' <root>/.workflow-events/*.jsonl
```

If no `.jsonl` carries a `--task-start` record, the loop has NOT connected — there may be commits
and tick-log writes, but the loop never recorded its own start. **Report `TELEMETRY-RECORD: false`
and STOP.** The record must be in the TARGET project (`.workflow-events/`), not somewhere else.

### 9. Report the observable-consequences checklist

Print all seven keys (`MONITORS-MOUNTED`, `MONITORS-DELIVERING`, `CRON-CREATED`, `INNER-DRIVEN`,
`TELEMETRY-RECORD`, `FIRST-TASK`, `TOPOLOGY-IN-PLACE`) with `true|false` and the one-line evidence
each. This is the deliverable — the user's whole cold start is this command, and this list is how
they (and a future model) know it actually took.

## Non-goals

- **Not a one-keypress button.** The command count is install (1–2) + init (1) + this skill (1);
  the inner start is INSIDE this skill, not a separate human step.
- **Not a shell script.** The monitor is mounted through the Monitor tool so its events reach a
  session; a script that backgrounds processes delivers to nobody.
