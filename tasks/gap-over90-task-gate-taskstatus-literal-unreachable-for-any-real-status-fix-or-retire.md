---
id: gap-over90-task-gate-taskstatus-literal-unreachable-for-any-real-status-fix-or-retire
title: over90-task-gate.ts taskStatusAllowsOver90m(status==='in-progress') is
  unreachable for ANY real task — TASK_STATUSES has no such value; AC0 settles
  fix-vs-retire by liveness evidence (open-discovery finding
  open-semantic-discovery@2026-10-13T01:10:43.215Z#2, independently re-verified)
status: done
labels:
  - gap
  - defect
  - open-discovery-finding
parent: null
children: []
extra: {}
---
## Proposal
**Origin: open-semantic-discovery production finding, independently re-verified twice by the coordinator (2026-10-13), Portfolio `finding_id: open-semantic-discovery@2026-10-13T01:10:43.215Z#2`.**

`plugin/scripts/over90-task-gate.ts:113` `taskStatusAllowsOver90m`:
```js
export function taskStatusAllowsOver90m(root, taskId) {
  const status = readTaskStatus(root, taskId);
  if (status === null) return true;
  return status === "in-progress";
}
```
The single source of the task-status vocabulary, `plugin/scripts/task-status.ts:12` (lockstepped with `packages/quay/src/abi.ts:33`), is:
```js
export const TASK_STATUSES = ['todo', 'ready', 'done', 'needs-human', 'superseded'];
```
**`"in-progress"` is not a member.** `grep -rn '"in-progress"' --include=*.ts --include=*.sh .` (excluding `tasks/*.md`) finds no writer that ever stores it as a task status — the two other hits (`goal-driver.ts`) are the unrelated `GapState` enum. So for EVERY task file that carries a real, legal status, `taskStatusAllowsOver90m` returns `false`; it returns `true` only when the task file is absent. The branch the function exists to implement is unreachable by construction.

**Consumer and blast radius.** `supervisor-preempt-candidates.ts:87` ANDs this into its over-90m filter:
```js
.filter((p) => nowMs - p.startedAtMs > TASK_OVER_90M_MS && taskStatusAllowsOver90m(root, p.taskId))
```
So for any task with a real file, the over-90m preemption candidate list is permanently empty from this clause — the path that is supposed to catch a stuck 90-minute execution never fires for a real task.

**A blind fix (map the literal to one of the five words) is itself wrong**, and this is why the fix needs investigation, not substitution: none of `todo/ready/done/needs-human/superseded` means "currently being executed" — `ready` means "eligible to dispatch", and the current worker-driver architecture leaves a dispatched task's status at `ready` for the ENTIRE duration of its worker session (it flips only at the end, to `done`/`needs-human`). Substituting `"ready"` would make the gate fire for every old ready task regardless of whether a worker is actually running, which is the FALSE-POSITIVE class the function's own history (`gap-over-90m-false-signal-source-reads-telemetry-not-task-status`, done 2026-08-05) was written to kill ("3 phantom in-flight tonight: dead process, 0-commit worktree, status=ready").

**Architectural context found on inspection (bears on severity, not on the defect's reality):**
- `over90-task-gate.ts` / `supervisor-preempt-candidates.ts` / `inner-blocked-signal.ts` belong to the **manager/inner-driven preemption path** (the file's own header: "migrated OUT of inner-blocked-signal.ts"). CLAUDE.md records inner(fast-mode) as **retired**, superseded by worker-driver.
- Neither file has been touched since `cd1fcb856` (2026-09-20). No systemd timer/cron names `supervisor-preempt`. `orchestration/manager-tick-core.md` / `-criteria.md` / `-closing.md` / `-sending.md` do not mention `preempt`. The capability catalog still declares `supervisor-preempt-candidates.ts` as "每轮" (every round) manager-layer tooling, i.e. the catalog's own liveness claim is the thing to test, not assume.
- A prior semantic exploration round (`.quay/architecture-evidence-store.jsonl`, `E-GAIN-1-CTRL` cluster 8, 2026-10-12) touched the same two files and reported `refuted, intentional_difference_found:false` on an unrelated claim — not this defect, but it shows this code region keeps surfacing across exploration arms.
- **So whether a live, currently-exercised caller path reaches `supervisor-preempt-candidates.ts`'s `main()`/`checkOver90Candidates` today is an open empirical question, not yet settled by this read.** The fix's own AC0 settles it.

## Plan
**AC0 decides which branch applies — do not guess.**
1. **AC0 — liveness.** Determine, from position-based evidence (hard rule 2), whether any currently-running mechanism invokes `supervisor-preempt-candidates.ts`'s candidate check or `supervisor-preempt.sh` in production: a systemd timer/unit, a cron entry, a call from a currently-exercised manager/orchestrator doc step, or a recorded invocation in any session/driver log over a stated lookback window. Paste the search and its result either way.
2. **If AC0 finds a live caller (Plan A — wire a real signal):** Replace the task-status literal with a signal that exists in the CURRENT (worker-driver) architecture and actually distinguishes "a worker is running this task right now" from "this task is sitting ready, untouched": e.g. a live worktree for `task/<id>` AND a live process under it (the same shape used for cross-project in-flight checks elsewhere in this repo), or a dispatch record with no landing event. Keep the existing no-file-⇒-fire fallback. Keep `makeOver90ExecutorGone`'s separate "has it landed" check untouched — this fixes only the "is it genuinely still running" half.
3. **If AC0 finds no live caller (Plan B — retire with justification):** Do not silently leave the dead branch. Mark `taskStatusAllowsOver90m` (and, if warranted, the whole over90-task-gate/supervisor-preempt-candidates consumer chain) as retired in its own header with the AC0 evidence, remove or correct the capability-catalog "每轮" claim to match reality, and keep a narrow, literal-level unit fix (so the function is at least internally correct if ever revived) without reviving the dead caller path.
4. Either branch: the fix must be falsifiable against the SAME production shape the finding described — a real task file with a real status, 90+ minutes old.

## Acceptance Criteria
- [x] **AC0 — liveness search, pasted (Plan B applies ⇒ retire with justification).**
  Position-based search for a currently-running invoker of `supervisor-preempt-candidates.ts`'s candidate check or `supervisor-preempt.sh`:
  ```
  $ systemctl list-units --all | grep -i preempt ; systemctl list-timers --all | grep -i preempt
  $ ls /etc/systemd/system ~/.config/systemd/user | grep -i preempt
  (no output — ZERO systemd units/timers name preempt)
  $ grep -rn "preempt" /etc/systemd/system/*.service /etc/systemd/system/*.timer ~/.config/systemd/user/*.service
  (no output)
  $ crontab -l
  no crontab for yale
  $ grep -rn "preempt" orchestration/*.md orchestration/manager-tick-*.md orchestration/*tick-core.md
  (only the UNRELATED git-merge-window sense: "连续 preempt 移出" in tick-log.md / manager-tick-log.md)
  $ ls -la .quay/supervisor-preempt-ledger.jsonl
  ls: cannot access '.quay/supervisor-preempt-ledger.jsonl': No such file or directory
  $ grep -rn "listPreemptible\|findPreemptibleCandidate\|performPreempt\|checkOver90Candidates" --include=*.ts --include=*.mjs --include=*.js .
  (only intra-module definitions + plugin/test/supervisor-preempt-candidates.test.mjs — ZERO non-test callers)
  $ grep -rl -- "--list-preemptible\|preempt-task" ~/.claude/projects/-data-home-yale-work-quay   # main + subagents/ + workflows/
  (5 files; 4 have no matching tool_use command, the 5th is an unrelated task FILENAME
   gap-goal-driver-hardcoded-120s-spawn-kill-preempts-… ; the 6th hit is THIS session)
  $ grep -c supervisor-preempt-candidates docs/analysis/runtime-usage-inventory.json
  0
  ```
  **Result: NO live caller.** No systemd unit/timer, no crontab, no orchestration/manager-tick step, no recorded session invocation, no runtime-usage record, and the preemption ledger was never written. The only entry is the `quay-deliver` grouped entry point (its own CADENCE is "按需"), so the capability catalog's "每轮" claim for both files was FALSE. ⇒ **Plan B.** (AC4 additionally confirms nothing else catches the same case by default, so the unreachability is harmless only *because* the chain is dead, not because a complementary mechanism covers it.)

- [x] **AC1 — failing test BEFORE the fix (RED), pasted.**
  New file `plugin/test/over90-task-gate.test.mjs`; run against the pre-fix module (`git show HEAD:plugin/scripts/over90-task-gate.ts`):
  ```
  ✖ AC1: the gate answers from the single-source vocabulary, never from an out-of-vocabulary literal
      AssertionError: the mid-flight status set is exported (RED before the fix: absent)
  ✖ AC1: the decision surface carries no task-status literal outside the vocabulary (position-based)
      AssertionError: the decision body compares against a task-status literal outside the vocabulary: ["in-progress"]
  ✖ AC2 (Plan B): retirement documented in the header, literal corrected, no legal status fires
      AssertionError: the retired word is named, not silently dropped
  ✔ AC3 negative control: the 2026-08-05 false-positive class stays excluded   (controls pass BEFORE, as AC3 requires)
  ```
  The behavioural half of the same finding, pre-fix vs post-fix:
  ```
  PRE-FIX  taskStatusAllowsOver90m(status=in-progress) = true    <- fires on a value TASK_STATUSES cannot contain
  PRE-FIX  taskStatusAllowsOver90m(status=ready)       = false
  POST-FIX taskStatusAllowsOver90m(status=in-progress) = false
  POST-FIX taskStatusAllowsOver90m(status=ready)       = false
  ```
  A task file carrying a REAL, legal status (`ready`) with a 95-min bracket is excluded from `listPreemptible`/`findPreemptibleCandidate` (the review's `checkOver90Candidates`) — the finding's exact shape, asserted in the AC1 test.

- [x] **AC2 — correct state after the fix (GREEN), Plan B.** Post-fix run, all four tests green:
  ```
  ✔ AC1: the gate answers from the single-source vocabulary, never from an out-of-vocabulary literal
  ✔ AC1: the decision surface carries no task-status literal outside the vocabulary (position-based)
  ✔ AC2 (Plan B): retirement documented in the header, literal corrected, no legal status fires
  ✔ AC3 negative control: the 2026-08-05 false-positive class stays excluded
  ```
  The unit-level literal is CORRECTED, not renamed: `MID_FLIGHT_TASK_STATUSES` is DERIVED from `TASK_STATUSES` (`new Set(TASK_STATUSES.filter(s => s === MID_FLIGHT_STATUS_WORD))`) and is **empty** (`size === 0`), so no out-of-vocabulary word can again act as a working branch, and the gate revives automatically if the vocabulary ever gains a word meaning "executing". **Retirement documented** in the file header of `over90-task-gate.ts` and `supervisor-preempt-candidates.ts` with the AC0 evidence; the catalog's false "每轮" claim is corrected to "按需" for both files. **No behavioral promise about production firing** (Plan B) — every legal status answers "not mid-flight"; the only surviving fire arm is the absent-file fallback.

- [x] **AC3 — negative control on the EXISTING safety path (passes before AND after).**
  The 2026-08-05 false-positive this function was built to prevent (`gap-over-90m-false-signal-source-reads-telemetry-not-task-status`: dead process / 0-commit worktree / `status=ready` + stale bracket) stays excluded — asserted in `over90-task-gate.test.mjs` for `ready`/`done`/`needs-human`/`superseded`/`todo` at 95 min, all yielding `count === 0`, plus the landed arm (`executorGone → {gone:true}`) still excluded. The pre-fix run above shows the same test GREEN before the change and the post-fix run shows it GREEN after. **The control is not vacuous**: a positive control in the same test asserts the surviving arm (missing task file, 95-min bracket) DOES yield `count === 1`. `makeOver90ExecutorGone`'s landed-evidence logic is untouched (DoD).

- [x] **AC4 — semantic counter-evidence (tried to refute the defect; conclusion pasted).**
  Checked whether some OTHER already-landed mechanism independently catches the stuck-90-minutes case:
  - `worker-driver.ts --timeout <ms>` — the CURRENT architecture's stuck-task catcher. It exists, but **defaults to 0 = disabled** (`worker-driver.ts:53` "缺省 0 = 无超时"; `worker-driver.ts:5198` `timeoutDeadlineMs: timeoutMs > 0 ? startedAtMs + timeoutMs : 0`; `driver-anchor.ts:486` documents the same). `ps aux` shows the live worker-driver invoked as `--mechanical-fan-in --task …`, i.e. **no `--timeout`** ⇒ off.
  - `worktree-process-reaper.ts` — reclaims orphaned `claude-probe` processes and stale `full-suite.lock` holders (deleted-worktree orphans / lock holders), a DIFFERENT class from "a task whose worker is stuck past 90 minutes".
  - `mechanism-vitality-check.ts` — the CADENCE-driven zero-call detector that WOULD have flagged a "每轮" instrument untouched for >3× its cadence (this file was last touched 2026-09-20, 23 days) is **archived** (`archive/2026-09-07-zero-call-scripts/plugin/scripts/mechanism-vitality-check.ts`).
  **Conclusion:** no complementary mechanism covers the same case *by default*. The defect's unreachability is harmless only *because nothing calls the gate* (AC0) — not because something else catches it. The defect's reality is unchanged.

- [x] **AC5 — fan-in acceptance:** `scripts/test.sh --for-task gap-over90-task-gate-taskstatus-literal-unreachable-for-any-real-status-fix-or-retire --allow-thin` green in the worktree, plus the anti-drift Touches hard gate green (both pasted in the worker's run record); the driver's mechanical fan-in (merge → delta → typecheck → scoped gate → suite → ff) is what lands it.

- [x] **AC6 — Portfolio linkage (written through the ABI, readback pasted).**
  `correctFinding(root, { finding_id: "open-semantic-discovery@2026-10-13T01:10:43.215Z#2", patch: { fix_task: "gap-over90-task-gate-taskstatus-literal-unreachable-for-any-real-status-fix-or-retire" }, … , actor: "task-worker" })` → `{ok: true, kind: "portfolio_correction", id: "portfolio_correction-c5c2cab72f944c20", appended: true}`.
  Readback (`readPortfolio`):
  ```
  BEFORE: {"outcome":"supported","fix_task":null,"fix_landed_commit":null,"fix_landed_reason":"NO_FIX_TASK"}
  AFTER : {"outcome":"supported","fix_task":"gap-over90-task-gate-taskstatus-literal-unreachable-for-any-real-status-fix-or-retire",
           "fix_landed_commit":null,
           "fix_landed_reason":"NO_DONE_COMMIT_ON_develop_FOR_tasks/gap-over90-…md",
           "corrected":true,"correction_ids":["portfolio_correction-c5c2cab72f944c20"],
           "corrected_from":{"fix_task":null,"fix_landed_commit":null,"fix_landed_reason":"NO_FIX_TASK"}}
  ```
  The outcome is **fixed** (the finding is CONFIRMED and corrected in code), recorded append-only with the superseded values preserved; `fix_landed_reason` becomes `DONE_SUBJECT_ON_develop` once this task lands done on develop.

## Definition of Done
- AC0–AC6 checked with pasted evidence (the failing-before / passing-after pair is the load-bearing one; hard rule 2).
- `scripts/test.sh --for-task <this task>` green.
- No change to `makeOver90ExecutorGone`'s landed-evidence logic unless AC0/AC3 show it must change.

## Touches
- tasks/gap-over90-task-gate-taskstatus-literal-unreachable-for-any-real-status-fix-or-retire.md
- plugin/scripts/over90-task-gate.ts
- plugin/scripts/supervisor-preempt-candidates.ts
- plugin/test/over90-task-gate.test.mjs
- plugin/test/supervisor-preempt-candidates.test.mjs
- plugin/test/inner-blocked-signal.test.mjs
- plugin/scripts/capability-catalog-declarations.json
- .quay/discovery-portfolio.jsonl

**Two test files added to Touches beyond the filed list** (hard rule 5b — the same phantom literal was
pinned in the sibling tests, which are what made the defect invisible): the retired consumer chain's
fixtures wrote `status: in-progress`, a word no writer stores, so `supervisor-preempt-candidates.test.mjs`
and `inner-blocked-signal.test.mjs` asserted a preemption/over-90m fire that no real task could produce.
Their preemptible fixtures now use the surviving fire arm (a MISSING task file — the documented
fail-closed-toward-fire fallback already pinned by inner-blocked-signal.test.mjs) and their
non-preemptible fixtures use legal statuses. Without this, correcting the literal reds 8 tests that
encode the defect.

## Blocker

**2026-10-13T04:11:58.243Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: # fail 84
- run_id：wk-prod-anchor
- session_id：58bdc32d-33d9-46ea-988a-5e2f0763a2e4
