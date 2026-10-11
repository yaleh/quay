---
name: cold-start
description: "Cold-start the two-layer loop in a project `/quay:init` has already prepared: re-create the 20-minute outer cron, EXPLICITLY drive the inner session to start fast mode and dispatch the first task, then PROVE the loop is live by reading a real --task-start telemetry record in .workflow-events/. One slash command; the inner start is DRIVEN here, never assumed as a side effect."
allowed-tools: Bash, Read, Monitor, CronCreate, CronList
---

# cold-start

**One slash command that turns a `/quay:init`-prepared project into a running two-layer loop.**
The user's whole cold start is this command; after it returns, the loop must be provably live.

> **⛔ RETIRED (2026-09-04, `SPEC-tmux-retirement-2026-09-03.md` §1.4/Layer 3b).**
> The two-session "start an outer loop, drive an inner session" model this skill describes is
> **retired**: the outer session role was absorbed into the manager's direct subagent dispatch
> (`gap-retire-outer-tmux-window-logic`), and the inner session was replaced by the worker-driver.
> The current enablement flow is **① install ② start a Claude Code session (your choice)
> ③ `/quay:init` ④ `/quay:drivers` ⑤ `/quay:manager`** — there is no "start outer" step. The
> content below is retained for historical reference pending a full rewrite (tracked separately,
> SPEC §4 非目标); do not follow it as the current procedure.

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
| loop mechanism laid down | `${CLAUDE_PLUGIN_ROOT}/scripts/dist/fast-mode-telemetry.js` exists |
| tick docs laid down | `<root>/orchestration/orchestrator-loop-tick.md` and `<root>/docs/analysis/fast-mode-loop-tick.md` exist |
| launch config laid down | `<root>/.claude/launch.settings.json` exists (quay-init `--loop` lays the default template; the consumer edits model/env per project) |
| **sessions launched via the laid-down launcher** | sessions were started by **`bash <root>/plugin/scripts/quay-launch.sh <role>`**, which carries `--settings` + the role-convention name (`quay-outer`/`quay-inner`) — **never** a hand-typed bare `claude` one-liner, **never** a non-role window name like `inner` |
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
inner via `bash <root>/plugin/scripts/quay-launch.sh inner` (window name `quay-inner`). If a window exists
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
if the consequences are a concrete, checkable list. After this skill completes, **all five** must be
true. Report each as `<KEY>: true|false` plus the one-line evidence; `false` on any key = the cold
start did NOT complete.

| # | Key | Checkable definition | Evidence |
|---|---|---|---|
| 1 | `CRON-CREATED` | `CronCreate` `*/20 * * * *` succeeded, `CronList` lists it, AND `bash <root>/plugin/scripts/loop-driver-check.sh <root>` reports `LIVE` (exactly ONE driver — not STALLED, not DOUBLE-TRIGGER) | the check output (`loop-driver: LIVE (1) …`) |
<!-- gap-laydown-derivation-is-sensitive-to-reference-spelling-dependency-closure (AC2/AC3): this
     bare-name reference to transcript-delivery-check.ts (no plugin/scripts/ prefix) is INTENTIONAL
     and mechanically caught — the dependency-closure pass reads send-keys-reliable.sh:41
     `${SCRIPT_DIR}/transcript-delivery-check.ts` (content-level, spelling-independent), and the
     verify check resolves tick-doc bare names. Do NOT "fix" it to a prefixed form. -->
| 2 | `INNER-DRIVEN` | `bash <root>/plugin/scripts/send-keys-reliable.sh <session> "<fast-mode tick instruction>" <target-transcript.jsonl>` exited 0 — the TARGET session's own transcript shows the drive text as a real user message (`transcript-delivery-check.ts` — a BARE-FILENAME reference, resolved by quay-init's laydown derivation under plugin/scripts/, gap-laydown-derivation-is-sensitive-to-reference-spelling; Fault 5; only the target transcript is a trustworthy delivery signal — the pane-hash criterion is superseded, outer ruling F, 3 false positives). Inner was EXPLICITLY started — not assumed as a side effect of outer guidance | send-keys-reliable output (`delivered: true` + matched transcript line) |
| 3 | `TELEMETRY-RECORD` | `<root>/.workflow-events/` contains at least one `.jsonl` file carrying a `--task-start`-written record (the runId from the first `fast-mode-telemetry.ts --task-start --taskId <id> --root <root>`) | `ls <root>/.workflow-events/` + grep for the task-start record |
| 4 | `FIRST-TASK` | At least one task is `ready`/`done` on the board and it has been dispatched — `fast-mode-telemetry.ts --report --json --root <root>` shows it in `inProgress` (or the task-start record in #5 references it) | the `--report --json` `inProgress` |
| 5 | `TOPOLOGY-IN-PLACE` | The two-window outer/inner session topology was retired with the outer tmux session (`gap-retire-outer-tmux-window-logic`) — this key is vacuous (no session topology remains to verify). manager is cross-project and NOT part of this topology | n/a — retired |

**Manager cold start is NOT this checklist** — a project cold start never starts the manager
(delivery ≠ startup, AC8). The manager layer has its OWN five-key falsifiable checklist
(`HOME-IN-PLACE` / `CRON-CREATED` / `REGISTRY-MATCHES` / `FIRST-TICK-LANDED` / `NOT-STARTED-BY-PROJECT`),
documented in `plugin/skills/manager/SKILL.md` §6.5, executed by `quay manager start` (+
`manager-arm-loop.sh --verify`). When a network needs its manager
started, the operator runs that checklist in the manager's own session — a project outer running
this skill must NOT create/drive/check the manager (C3; `no-manager-tick-doc-check.ts`).

## Steps

### 0. Running-state branch — installed-and-RUNNING vs installed-but-STOPPED (the 已停转 branch)

The five-key checklist measures **"was the instrument laid down" (L1)** — NONE of the keys answers
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
| `running` | none | `none` | loop is live — skip the full cold-start; verify the five keys are still true and report `ALREADY-RUNNING`. |
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

### 0a. Mid-flight state check — recovery branch vs fresh-start branch (the 恢复分支)

The running-state branch (step 0) decides RUNNING vs STOPPED. This branch decides HOW to start a
STOPPED, already-laid-down loop — fresh vs recover. The fresh-start path (steps 1-9) assumes
"nothing started, start clean"; it has NO step for a workspace whose last run crashed mid-flight
leaving real state behind. That state class is real, not speculative: tonight's two real OOM
recoveries both hit it, and both were done by hand because there was nowhere in this skill to point
at. When the mechanism is laid down AND the loop is
stopped, enumerate the three mid-flight state classes with **existing tools only** (no new detection
logic — reuse what's there):

```bash
# ① orphaned task branch — a `task/*` branch NOT reachable from the mainline ref
git -C <root> branch --list "task/*"          # every task branch
git -C <root> branch --merged <mainline-ref>  # the reachable ones — the rest are orphaned candidates
git -C <root> worktree list                   # in-flight worktrees (cross-checked against ②)
# ② ghost telemetry — a `--task-start` bracket whose taskId has NO in-flight worktree
node ${CLAUDE_PLUGIN_ROOT}/scripts/dist/fast-mode-telemetry.js --report --json --root <root>
#   → read inProgress[]: every {taskId} must appear in `git worktree list`; one that does NOT is a ghost
# ③ status drift — code landed but the status field never followed
node ${CLAUDE_PLUGIN_ROOT}/scripts/dist/task-status-drift-check.js --json
#   → read suspects[]: a todo/ready task whose AC symbols resolve in the tree on a MERGED task/* branch
```

`<mainline-ref>` is the repo's landing ref (`master`, or `integration`/`develop` per landingRef — the
same ref the drift check's stranded-branch classification uses; never hardcode a different one).

**Routing decision (both directions, checkable):** take the RECOVERY branch (step 0b) **if and only
if** the mechanism is laid down AND at least one of ① ② ③ reports a non-empty finding. All three
clean ⇒ take the FRESH-START branch (steps 1-9) unchanged. A genuinely clean workspace MUST route
to fresh-start — the negative control: never false-positive into recovery.

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
   worktree gone / process gone — never age). Verify against the task's REAL state
   (`tasks/<taskId>.md` status field); if the task is genuinely done or still-todo, DELETE the ghost record (remove its line from `.workflow-events/<runId>.jsonl`). **NEVER backfill a plausible-but-fabricated `--task-end`** — a fabricated end event claims an outcome the crashed executor never recorded.

Once the re-run of all three checks is clean — ONLY when all three come back clean — the recovery
branch CONVERGES into the SAME AC8c checklist and steps 1-9 the fresh-start branch uses — there is
no second acceptance framework (AC3).
The report is the same five-key AC8c output; a recovery that converges is reported `COMPLETE`, one
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
# would ship the regression)
```

**Do NOT wait for the whole suite (`scripts/test.sh` no-args / the full-suite run / 「全量」) to be
green** — that is the too-wide criterion this gate replaces. Only the derived set gates the cold
start. The check **never falls back to the whole suite**: if 0 test files resolve from the derived
set it fails closed (red) — a silent "nothing checked" green is not an acceptable gate.

### 1c. Install the pre-commit guard hook (provisioned = active)

**Why**: the pre-commit guard (`${CLAUDE_PLUGIN_ROOT}/scripts/dist/precommit-guard.js`, shipped by `quay-init --loop`)
is only ACTIVE when its hook is installed. The hook is **CLONE-LOCAL** (`.git/hooks/pre-commit`) —
a fresh clone, or a project laid down before the guard wiring shipped, has NO hook and the guard
never runs. "Built ≠ active" is exactly the gap the guard task exists to close: a guard that is never
invoked is as good as not merged. Cold-start auto-installs the hook so the guard is active from the
first commit after this recovery/start — and because the hook lives in `.git/hooks`, it PERSISTS
across session recovery (no re-install needed after a crash/restart in the same clone).

```bash
node --no-warnings ${CLAUDE_PLUGIN_ROOT}/scripts/dist/precommit-guard.js --install-hook --root <root>
# exit 0 → the hook is installed (idempotent). A pre-existing UNRELATED hook makes it exit 2
#           (never a silent clobber) — merge the guard shim into the existing hook, then re-run.
ls -l <root>/.git/hooks/pre-commit   # verify — present and executable
```

Require exit 0 AND the hook file present. Non-git workspaces (no `.git/hooks`) skip — there is no
commit surface to guard.

### 2. Session topology — retired (AC4 — the other half of 装得上)

The two-window session topology (outer/inner) was retired with the outer tmux session
(`gap-retire-outer-tmux-window-logic`) — the outer session role was absorbed into the manager's
direct subagent dispatch, and the inner session was already replaced by the worker-driver. There is
no session topology factory/check to build or verify anymore; the `TOPOLOGY-IN-PLACE` key above is
vacuous. manager is cross-project and NOT part of this topology.

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
exits non-zero, inner is unreachable / the text was not delivered — **but before concluding STOP,
re-run the SAME delivery checker (`transcript-delivery-check.ts`) against the materialized target
transcript once it exists**. A fresh inner's transcript legitimately does not exist at poll time
(`ENOENT`), so `send-keys-reliable.sh` fail-louds `exit 1` even when the drive text WAS delivered —
measured 2026-08-12 on quay's own cold start (SH4): first drive exited 1 (ENOENT), re-check on the
materialized transcript returned `state: delivered, delivered: true` with the drive text as a real
user message (ts 03:12:08). Only a re-check that STILL cannot match the drive text means
non-delivery — then **STOP**; do not claim the inner start.

### 7. Dispatch the first task

If no task is `ready`, promote the top `label:milestone-candidate` task to `ready` (MCP
`task_write`), or create the first task. The inner fast-mode tick picks it up and dispatches it
(which writes the `--task-start` telemetry record). To make the cold start provably wired even
before inner's first tick lands, ensure a `--task-start` record exists:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/dist/fast-mode-telemetry.js --task-start --taskId <firstTaskId> --root <root>
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

Print all five keys (`CRON-CREATED`, `INNER-DRIVEN`,
`TELEMETRY-RECORD`, `FIRST-TASK`, `TOPOLOGY-IN-PLACE`) with `true|false` and the one-line evidence
each. This is the deliverable — the user's whole cold start is this command, and this list is how
they (and a future model) know it actually took.

**The five keys alone are NOT a "complete" verdict** — they measure installed (L1), not running (L2).
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
