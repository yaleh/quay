---
name: quay-cold-start
description: "Cold-start the two-layer loop in a project quay-init has already prepared: mount the loop monitor (session-liveness.sh) via the Monitor tool, re-create the 20-minute outer cron, EXPLICITLY drive the inner session to start fast mode and dispatch the first task, then PROVE the loop is live by reading a real --task-start telemetry record in .workflow-events/. One slash command; the inner start is DRIVEN here, never assumed as a side effect. Events must be DELIVERED to this session (Monitor tool), never via nohup."
allowed-tools: Bash, Read, Monitor, CronCreate, CronList
---

# quay-cold-start

**One slash command that turns a quay-init-prepared project into a running two-layer loop.**
The user's whole cold start is this command; after it returns, the loop must be provably live.

**本文件是执行路径,不是行为正本。** 行为正本与背景(如 nohup 禁用的说明、铺什么验什么的判据、
non-goals)在 `orchestration/orchestrator-loop-tick.md`(冷启动段 + 冷启动背景档案)与
`orchestration/CRYSTALLIZED-reliable-send-2026-08-04.md`。本文件只给动作(Steps)与可判定清单。
**tick 与冷启动引用同一批行为文件**:外层 `orchestration/orchestrator-loop-tick.md`、内层
`docs/analysis/fast-mode-loop-tick.md`(随 `quay-init --loop` 铺下的产品模板)、管理者
`orchestration/manager-loop-tick.md`。

## Preconditions (fail-closed)

All must hold before starting; if any fails, STOP and report which precondition failed (never
"fix forward" past a missing precondition):

| Precondition | Path (root = the current working directory) |
|---|---|
| loop mechanism laid down | `<root>/plugin/scripts/session-liveness.sh`, `fast-mode-telemetry.ts` exist |
| tick docs laid down | `<root>/orchestration/orchestrator-loop-tick.md` and `<root>/docs/analysis/fast-mode-loop-tick.md` exist |
| launch config laid down | `<root>/.claude/launch.settings.json` exists (quay-init `--loop` lays the default template; the consumer edits model/env per project) |
| **sessions launched via the laid-down launcher** | outer and inner windows were started by **`bash <root>/plugin/scripts/quay-launch.sh <role>`** (or `bash <root>/plugin/scripts/session-bootstrap.sh <root> inner/outer`), which carries `--settings` + the role-convention name (`quay-outer`/`quay-inner`) — **never** a hand-typed bare `claude` one-liner, **never** a non-role window name like `inner` |
| inner session reachable | tmux session from `<root>/orchestration/session-liveness.env` (`SESSION_TMUX_SESSION=`), else `<project>-0:0.0`, exists (`tmux list-panes -t <session}`) |
| derived laydown set green | the plugin's DERIVED laydown set is green — `bash <quay-source>/plugin/scripts/laydown-set-check.sh` reports `laydown_set_green: green`. **Gate = the derived set (lay what you verify), NOT the whole suite** — an unrelated suite failure must NOT block the cold start (`gap-cold-start-gate-should-be-derived-laydown-set-green-not-whole-suite`; cross: `gap-red-window-dispatch-stop-should-be-shared-gate-conditional`, same scope axis, different mechanism) |

**Launch config is checked-in, not remembered** (background: `orchestration/orchestrator-loop-tick.md`
冷启动背景档案). The per-role launch command lives in `<root>/.claude/launch.settings.json`
(settings-schema keys + `_launchSpec` for flag-only params), materialized by the skill-internal
launcher `quay-launch.sh` — the user/agent never names the launcher and never hand-types a shell
one-liner. Verify without starting anything via the launcher's `--dry-run`.

**F4 — the launcher is the ONLY way sessions are started (measured 2026-08-11 ad-arm1 archguard
Level3 首跑):** the two sessions were hand-started (outer process with NO `--settings`, inner window
named `inner` instead of the role-convention `quay-inner`), so the laid-down `quay-launch.sh` was
never used. A session is cold-start-eligible ONLY when it was started by the launcher: outer via
`bash <root>/plugin/scripts/quay-launch.sh outer` (window name `quay-outer`, carries `--settings`),
inner via `bash <root>/plugin/scripts/quay-launch.sh inner` (window name `quay-inner`), from bare
metal via `bash <root>/plugin/scripts/session-bootstrap.sh <root> inner/outer`. If a window exists
but was NOT started by the launcher (no `--settings` / wrong name), restart it through the launcher
before proceeding — a cold start in hand-started windows repeats the F4 defect. `quay-launch.sh
--dry-run` prints the exact command each role would get.

**REQUIRED launch params (both routes, every role, fail-closed)** — the ghost-suggestion
(reliable-send fault 6) is eliminated AT SOURCE by two params, both REQUIRED, present in EVERY
launched session (manager/outer/inner):

1. `--prompt-suggestions false` — flag-only form, materialized by `quay-launch.sh` from
   `_launchSpec.promptSuggestions === false` (verify: the launcher's `--dry-run` output contains
   `--prompt-suggestions false`).
2. `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false` — env-var form, carried by the checked-in settings
   file top-level `env` and loaded via `--settings`.

A `--dry-run` that omits `--prompt-suggestions false` for any role means the checked-in launch spec
has drifted from the REQUIRED cold-start contract — STOP and fix the settings file before starting
(`plugin/test/launch-settings.test.mjs` asserts this mechanically).

**Gate criterion — 铺什么验什么**（判据正文在 `orchestration/orchestrator-loop-tick.md` 冷启动背景档案；
门是 DERIVED laydown set 绿，不是全量套件绿——步骤 1b 跑门，本文件不再复述判据）。

## Observable consequences (AC8c) — the falsifiable checklist every cold-start MUST produce

"The same skill command produces the same observable consequences on any model" is only meaningful
if the consequences are a concrete, checkable list. After this skill completes, **all seven** must be
true. Report each as `<KEY>: true|false` plus the one-line evidence; `false` on any key = the cold
start did NOT complete.

| # | Key | Checkable definition | Evidence |
|---|---|---|---|
| 1 | `MONITORS-MOUNTED` | ONE Monitor-tool invocation exists for `<root>/plugin/scripts/session-liveness-mount.sh` (the observer — session observation has exactly ONE tool, SPEC-one-observer-two-surfaces.md; the retired per-parameter observer was removed by gap-retire-inner-state-one-observer-targets-by-parameter); `bash <root>/plugin/scripts/monitor-mount-check.sh --json` reports `mounted=true`, `targetOk=true` (2026-08-06: `delivered` retired with the shared events file — the mount check is mounted + targetOk) | the `--json` output (two criteria) |
| 2 | `MONITORS-DELIVERING` | **The observer provably produces an event line** — EITHER a transition event from the mounted monitor delivered to THIS session (a `SESSION-GONE`, a `SESSION-BACK`, a `SESSION-IDLE`, a `SESSION-OVERDUE`, etc. — each observer owns its own stdout stream, 2026-08-06), OR (deterministic, preferred) the `bash <root>/plugin/scripts/session-liveness.sh --once` `SESSION-STATUS` line(s). **The resident mount emits ONLY on state TRANSITIONS — a stable session legitimately emits NOTHING, so do NOT wait ~90s for a transition event that may never come (F6, measured 2026-08-11: ad-arm1 outer burned 15min/120.6k token diagnosing this non-problem)**; the `--once` seam is the fast delivery proof. A running process is NOT evidence; a nohup log file is NOT evidence | the `--once` `SESSION-STATUS` line(s) verbatim, or the delivered transition event line(s) |
| 3 | `CRON-CREATED` | `CronCreate` `*/20 * * * *` succeeded, `CronList` lists it, AND `bash <root>/plugin/scripts/loop-driver-check.sh <root>` reports `LIVE` (exactly ONE driver — not STALLED, not DOUBLE-TRIGGER) | the check output (`loop-driver: LIVE (1) …`) |
<!-- gap-laydown-derivation-is-sensitive-to-reference-spelling-dependency-closure (AC2/AC3): this
     bare-name reference to transcript-delivery-check.ts (no plugin/scripts/ prefix) is INTENTIONAL
     and mechanically caught — the dependency-closure pass reads send-keys-reliable.sh:41
     `${SCRIPT_DIR}/transcript-delivery-check.ts` (content-level, spelling-independent), and the
     verify check resolves tick-doc bare names. Do NOT "fix" it to a prefixed form. -->
| 4 | `INNER-DRIVEN` | `bash <root>/plugin/scripts/send-keys-reliable.sh <session> "<fast-mode tick instruction>" <target-transcript.jsonl>` exited 0 — the TARGET session's own transcript shows the drive text as a real user message (`transcript-delivery-check.ts` — a BARE-FILENAME reference, resolved by quay-init's laydown derivation under plugin/scripts/, gap-laydown-derivation-is-sensitive-to-reference-spelling; Fault 5; only the target transcript is a trustworthy delivery signal — the pane-hash criterion is superseded, outer ruling F, 3 false positives). Inner was EXPLICITLY started — not assumed as a side effect of outer guidance | send-keys-reliable output (`delivered: true` + matched transcript line) |
| 5 | `TELEMETRY-RECORD` | `<root>/.workflow-events/` contains at least one `.jsonl` file carrying a `--task-start`-written record (the runId from the first `fast-mode-telemetry.ts --task-start --taskId <id> --root <root>`) | `ls <root>/.workflow-events/` + grep for the task-start record |
| 6 | `FIRST-TASK` | At least one task is `ready`/`done` on the board and it has been dispatched — `fast-mode-telemetry.ts --report --json --root <root>` shows it in `inProgress` (or the task-start record in #5 references it) | the `--report --json` `inProgress` |
| 7 | `TOPOLOGY-IN-PLACE` | The two-window session topology is in place per the factory definition — `bash <root>/plugin/scripts/topology-check.sh --session <session> --json` reports `ok: true` (each of `<session>:outer/:inner` exists AND has a claude process, not a bare bash window). manager is cross-project and NOT part of this topology. A single-bash-window session (the meta-cc-3/archguard-4 failure shape) MUST report `ok: false` | the `--json` output (`ok: true` + both windows `ok`) |

**Manager cold start is NOT this checklist** — a project cold start never starts the manager
(delivery ≠ startup, AC8). The manager layer has its OWN seven-key falsifiable checklist
(`HOME-IN-PLACE` / `IDLE-WATCH-MOUNTED` / `IDLE-WATCH-DELIVERING` / `CRON-CREATED` /
`REGISTRY-MATCHES` / `FIRST-TICK-LANDED` / `NOT-STARTED-BY-PROJECT`), documented in
`plugin/skills/manager/SKILL.md` §6.5, executed by `quay manager start` (+ its
`idle-watch-mount.txt` intent + `manager-arm-loop.sh --verify`). When a network needs its manager
started, the operator runs that checklist in the manager's own session — a project outer running
this skill must NOT create/drive/check the manager (C3; `no-manager-tick-doc-check.ts`).

## Steps

### 0. Running-state branch — installed-and-RUNNING vs installed-but-STOPPED (the 已停转 branch)

The seven-key checklist measures **"was the instrument laid down" (L1)** — NONE of the keys answers
**"is the loop actually RUNNING right now" (L2 continuous health)**. A cold-start that previously
succeeded can leave the loop installed-but-stopped, and a re-run then reports "complete" while the loop
sits idle (measured 2026-08-06: archguard 11:40 cold-start → 8.5h autonomous → #102 stopped at its
completion point, six keys five-true-one-false, then idle — genuinely human-needed/backlog-bottom, NOT
a defect, but the report said "complete"). The **L2 dead-loop criterion** (`dead-loop-check.sh`, cross:
`tasks/gap-l2-continuous-health-dead-loop-criterion-loop-running-not-installed`) tests **EXACTLY the
running state** (transcript no new user message + git no recent commit). **Call it FIRST, before
touching anything:**

```bash
bash <root>/plugin/scripts/dead-loop-check.sh --check-running --root <root>
```

This prints `cold_start_state=running|stopped` and, when stopped, `stopped_reason` + an **EXECUTABLE
`next_step`**. A stopped loop is reported "installed but stopped" with that next step — **never
"complete"**. Branch on it:

| `cold_start_state` | `stopped_reason` | `next_step` | action |
|---|---|---|---|
| `running` | none | `none` | loop is live — skip the full cold-start; verify the seven keys are still true and report `ALREADY-RUNNING`. |
| `stopped` | `never-started` | `restart` | installed but never started — proceed with the full cold-start below (a first start, not a resume). |
| `stopped` | `queue-empty` | `backlog-empty` | started before but the backlog is bottom — do NOT report "complete"; tell the human: add new direction/tasks, then restart. |
| `stopped` | `waiting-human` | `human-needed` | started before but blocked on human — do NOT report "complete"; tell the human: resolve the needs-human items / give direction, then restart. |
| `stopped` | `unknown` | `restart` | started before, work available, but the driver died — restart the loop (re-create the cron, re-drive inner). |

> **Known limitation — fresh cold-start false positive (measured 2026-08-12,
> `gap-quay-self-hosting-e2e-proof` SH4 proof)**: `dead-loop-check.sh` scans the target project's
> transcript dir for recent user messages. When the cold-start is run BY a session whose own
> transcript lives in that dir (the normal self-host case — the cold-start outer session IS a
> session of the target project), the check can report `running` on a project that has never been
> started. Before accepting `running` on what should be a fresh start, cross-check the two
> started-markers the stopped branch already reads: `.quay/loop-driver.jsonl` (empty → no driver
> registered) and `.workflow-events/` (no `--task-start` record → never dispatched). Both empty ⇒
> the loop was never started ⇒ take the fresh-start path, not `ALREADY-RUNNING`. Fix is routed as a
> step-0/L2-criterion follow-up (driver+telemetry disambiguation).

The stopped branch **reuses the L2 criterion** instead of inventing a new liveness signal — the dead-loop
check's `liveness_independent_of_backlog` invariant keeps queue-empty (healthy idle) separate from
nobody-driving (dead-loop), and this branch additionally reads the target project's own started-marker
(`.quay/loop-driver.jsonl` / `.workflow-events/` task-start record) + backlog status (`needs-human` /
`ready` / `todo`) to pick the executable next step. Cross-annotation (AC4): the L2 criterion task
`tasks/gap-l2-continuous-health-dead-loop-criterion-loop-running-not-installed.md` records this branch
as its first cold-start consumer.

### 0b. Recovery branch — mid-flight state exists, converge THEN cold-start

Fresh-start steps 1-9 assume a genuinely clean workspace. A workspace whose loop CRASHED mid-task
(today's two real OOM recoveries, both done by hand from a manually-written brief because the skill had
no recovery branch) has real mid-flight state that must be resolved BEFORE any tick can safely resume —
merged-but-unclosed tasks, orphaned worktrees/branches, ghost telemetry `--task-start` records with no
matching `--task-end`. A cold-start over such a workspace without converging first re-dispenses the
mid-flight task and double-books the board.

**Select recovery (NOT fresh-start) when the mechanism is already laid down (the step-1 preconditions
hold) AND at least one of the three state classes below is present.** Enumerate all three with the
EXISTING tools — zero new detection logic (invariant `zero_new_detection = 1`):

| # | State class | Existing tool(s) | Mid-flight signal |
|---|---|---|---|
| 1 | mid-flight worktree | `git worktree list` + `git branch --list "task/*"` + `git merge-base --is-ancestor <branch> <landing-ref>` | a `task/*` branch NOT reachable from the landing ref (integration → develop → master) whose telemetry has a `--task-start` and no matching `--task-end` |
| 2 | ghost telemetry | `fast-mode-telemetry.ts --report --json --root <root>` | an `inProgress[]` record whose `taskId` has NO in-flight worktree (`git worktree list` has no `task/<taskId>`) and no live process |
| 3 | task-status drift | `task-status-drift-check.ts` (+ `--stranded`) | a status-drift suspect on a `task/*` branch reachable from the landing ref (code landed, `status:` field never followed) |

**ALL THREE CLEAN → the fresh-start branch (steps 1-9).** ANY finding → the recovery steps below.

**Recovery steps — resolve each finding with the existing mechanism, then RE-RUN all three checks;
only an all-clean re-run converges forward:**

1. **merged-but-unclosed task (drift)** — the `status:` field lags code that already landed. Close it
   through the normal close path with REAL evidence (this session's own
   `gap-init-guesses-the-tmux-session...` fix is the worked example): verify the ACs' declared work
   actually landed (`task-status-drift-check.ts --check <id>` + the task's Touches exist on the
   landing ref), then set `status: done` via the same gate — never fabricate evidence, never paste a
   plausible AC onto an unverified task.
2. **orphaned worktree / branch** — verify against the landing ref: if the branch IS an ancestor
   (`git merge-base --is-ancestor <branch> <landing-ref>` — the work already landed), remove the
   worktree (`git worktree remove <path>`) and delete the branch (`git branch -d <branch>`); if it
   has commits NOT on the landing ref, the work is REAL — MERGE it, never delete (fail-closed: the
   same rule that forbids `--clean-stale` of a branch with commits).
3. **ghost telemetry** — a `--task-start` record whose executor is observably gone. Run
   `fast-mode-telemetry.ts --reconcile --root <root>`: it writes a real `--task-end` (outcome
   `abandoned`, `reconcileReason` set) ONLY when the executor is OBSERVABLY gone (branch merged /
   worktree gone / process gone — never age). A record whose task is genuinely done or still-todo has
   its ghost record DELETED (`rm <root>/.workflow-events/<runId>.jsonl`). NEVER backfill a
   plausible-but-fabricated `--task-end`.

Once the re-run of all three checks is clean, the recovery branch CONVERGES into the SAME AC8c
checklist and steps 1-9 the fresh-start branch uses — there is no second acceptance framework (AC3).
The report is the same seven-key AC8c output; a recovery that converges is reported `COMPLETE`, one
that cannot make all three checks clean is reported "installed but unrecovered" with the remaining
findings — never "complete".

### 1. Locate root, project, session

- `root = $(pwd)` (this skill runs inside the target project's outer session).
- `project = basename "$root"`.
- `session =` value of `SESSION_TMUX_SESSION=` in `<root>/orchestration/session-liveness.env`, else `${project}-0:0.0`.

### 1b. Gate the derived laydown set — lay what you verify, not the whole suite (fail-closed)

The cold start only relies on the **DERIVED laydown set** — the scripts quay-init laid down. That set
is mechanically derived (`grep plugin/skills/*/SKILL.md orchestration/*.md docs/analysis/*.md` → the
`plugin/scripts/*` they reference — the SAME derivation quay-init.sh uses; no hand-written list). The gate is therefore
**"that set is green", not "the whole suite is green"**: an unrelated suite failure must NOT block the
cold start (`gap-cold-start-gate-should-be-derived-laydown-set-green-not-whole-suite`; cross:
`gap-red-window-dispatch-stop-should-be-shared-gate-conditional` — same scope axis, different
mechanism: suite-RED 处置 vs 冷启动 gate).

Run the check in the **quay SOURCE repo** (where `plugin/test/` lives — the target project only has
the laid-down scripts, not the tests):

```bash
bash <quay-source>/plugin/scripts/laydown-set-check.sh
# laydown_set_green: green → proceed; red → STOP (a derived-set script's test is failing; laying it
# would ship the regression — e.g. session-liveness.sh's test IS in the set, so the M3 wait was correct)
```

**Do NOT wait for the whole suite (`scripts/test.sh` no-args / the full-suite run / 「全量」) to be
green** — that is the too-wide criterion this gate replaces. Only the derived set gates the cold
start. The check **never falls back to the whole suite**: if 0 test files resolve from the derived
set it fails closed (red) — a silent "nothing checked" green is not an acceptable gate.

### 2. Build and verify the two-window session topology (AC4 — the other half of 装得上)

The session the loop lives in is built **by definition**, never hand-assembled
(`gap-tmux-session-topology-no-factory-definition`; two-window correction
`gap-manager-baked-into-project-topology-factory` — manager is cross-project, not part of the
project topology). The definition ships in the `quay-session-topology` skill; this step applies
it. **Bare-metal entry (`gap-no-formalized-bare-metal-session-bootstrap`):** if the session does
NOT exist yet (nothing to build on), first run
`bash <root>/plugin/scripts/session-bootstrap.sh <root> inner/outer` — the formalized
from-bare-metal step that produces a session with live claude windows, after which this topology
factory/check applies idempotently. **Cross-annotation
(`gap-outer-self-checks-and-creates-inner-session`):** this step is the
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

Observation has exactly ONE tool (`session-liveness.sh`, SPEC-one-observer-two-surfaces.md), mounted
through a mount entry that execs it (who mounts owns its own stdout event stream — the "single-flight"
mutual-exclusion semantics were retired 2026-08-06; parallel mounts of the same target are naturally
conflict-free). **Never use nohup** — a `nohup bash …session-liveness.sh > log &` process is
`ps`-identical to a Monitor-tool process but writes to a file and **nobody is notified**; if you find
yourself writing `nohup` or `&` to background a monitor, **STOP — that is the anti-pattern this skill exists to prevent.** Mount `session-liveness-mount.sh` (the mount entry, which execs
`session-liveness.sh`):

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

Require `mounted=true` AND `targetOk=true` — the two criteria are two
different ways to be wrong (not mounted / mounted on the wrong project). 2026-08-06
(gap-session-liveness-remove-shared-events-and-lock): the old `delivered` criterion (shared events
file freshness) is GONE — the shared file was removed; observation is a tree, each observer owns its
own stdout stream, and delivery is verified by THIS session's own Monitor stream (criterion 2 below),
not by a cross-observer file.

**Delivery is proven by the deterministic `--once` seam, not by waiting for a resident event.**
The resident mount emits ONLY on state TRANSITIONS (SESSION-GONE/BACK/IDLE/RESUMED/OVERDUE/…) — a
stable session legitimately emits NOTHING, so "no event within ~90s" is NORMAL, not a monitor defect.
**(F6, measured 2026-08-11: ad-arm1 outer cold start burned 15min/120.6k token diagnosing exactly
this non-problem — the monitor was fine; it had no state change to report.)** Do NOT wait for a
transition event that may never come. Instead, get the deterministic delivery proof in seconds:

```bash
bash <root>/plugin/scripts/session-liveness.sh --once   # SESSION-STATUS <name> alive=... per target
```

Require `--once` to emit at least one `SESSION-STATUS` line — that line IS the delivered-event
evidence (criterion 2's `SESSION-STATUS` form). The mount check (mounted+targetOk) proves the
resident observer is attached; the `--once` line proves the observer can produce events; a later
real state change will arrive on the Monitor stream. Only a mount-check failure OR an empty `--once`
output is `MONITORS-DELIVERING: false` — **STOP and report**; do not proceed to pretend the loop is up.

### 5. Re-create the 20-minute cron — THE single loop driver (session-scoped: dies when the session PROCESS exits)

> **Precision (measured 2026-08-08 13:3xZ)**: "session-scoped" means the **process**, not the
> context. A `/clear` swaps the transcript session id and wipes the context but **does NOT kill the
> cron** — `CronList` after two consecutive `/clear`s still returned the live job. So this step is
> **list-then-decide**, never unconditional re-creation; creating one blindly after a `/clear` is
> exactly the double-trigger this section forbids. What does kill it is process exit (crash / OOM /
> window closed), and then `CronList` comes back empty. Same-measurement corollary: a `/clear`
> leaves the loop **running** while silently invalidating any monitor that pinned a transcript
> path — resolve the transcript by `customTitle`, never by a hardcoded session id.

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
message (`transcript-delivery-check.ts` — BARE-FILENAME reference, resolved by quay-init's laydown
derivation under plugin/scripts/, gap-laydown-derivation-is-sensitive-to-reference-spelling; Fault 5 in
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

**The seven keys alone are NOT a "complete" verdict** — they measure installed (L1), not running (L2).
Re-run the step-0 check and include it in the report:

```bash
bash <root>/plugin/scripts/dead-loop-check.sh --check-running --root <root>
```

Report `LOOP-STATE: <cold_start_state>` plus, when stopped, `STOPPED-REASON: <stopped_reason>` and
`NEXT-STEP: <next_step>` (restart / human-needed / backlog-empty). **A stopped loop is reported
"installed but stopped" with the executable next step — never "complete".** Only a loop whose
`cold_start_state=running` (or a stopped loop you actually restarted to running) may be reported
`COMPLETE`.

## Non-goals

Non-goals 与「这些不是目标」的正文已搬去 `orchestration/orchestrator-loop-tick.md`(冷启动背景档案)。
本文件只留动作。
