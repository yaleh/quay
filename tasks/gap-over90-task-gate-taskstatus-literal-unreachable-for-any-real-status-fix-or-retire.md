---
id: gap-over90-task-gate-taskstatus-literal-unreachable-for-any-real-status-fix-or-retire
title: over90-task-gate.ts taskStatusAllowsOver90m(status==='in-progress') is
  unreachable for ANY real task — TASK_STATUSES has no such value; AC0 settles
  fix-vs-retire by liveness evidence (open-discovery finding
  open-semantic-discovery@2026-10-13T01:10:43.215Z#2, independently re-verified)
status: ready
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
- [ ] AC0: the liveness search and its result, pasted (grep/systemctl/crontab/doc-reference commands and output). States which Plan branch applies and why.
- [ ] AC1 (failing test BEFORE the fix): a unit test reproduces the finding exactly — a task file with a REAL, legal status (`ready`) and age > `TASK_OVER_90M_MS` is excluded from `checkOver90Candidates`'s result even though its telemetry bracket is long over budget. Run this test against the CURRENT code and paste it RED, before any fix lands.
- [ ] AC2 (correct state after the fix): under Plan A, a task genuinely mid-flight (the new live signal present) and over budget IS a candidate; a task merely `ready`-but-idle is NOT. Under Plan B, the retirement is documented and the unit-level literal is corrected but makes no behavioral promise about production firing. Paste the post-fix test, GREEN.
- [ ] AC3 (negative control on the EXISTING safety path, not just the new code): the 2026-08-05 false-positive this function was built to prevent must still be prevented — a task whose worktree is gone / process is dead / status is `done` must NOT become a candidate under the fixed code. Paste this control passing both before and after the change (it was already true; the fix must not break it).
- [ ] AC4 (semantic counter-evidence): before confirming either plan, actively try to refute "this is a real defect" — e.g. check whether some OTHER already-landed mechanism independently catches the same stuck-90-minutes case (making this gate's unreachability harmless in practice). Paste what was checked and the conclusion. The defect's reality does not change; what this AC tests is whether a complementary mechanism already covers the gap.
- [ ] AC5: fan-in acceptance — the task's own fan-in (merge, anti-drift, scoped gate, full suite) is green, pasted.
- [ ] AC6: Portfolio linkage — write the fix's outcome (fixed / fixed-as-retirement / no-change-needed-because-already-covered) back to the Portfolio record for `finding_id: open-semantic-discovery@2026-10-13T01:10:43.215Z#2` via its ABI write path, and paste the readback.

## Definition of Done
- AC0–AC6 checked with pasted evidence (the failing-before / passing-after pair is the load-bearing one; hard rule 2).
- `scripts/test.sh --for-task <this task>` green.
- No change to `makeOver90ExecutorGone`'s landed-evidence logic unless AC0/AC3 show it must change.

## Touches
- tasks/gap-over90-task-gate-taskstatus-literal-unreachable-for-any-real-status-fix-or-retire.md
- plugin/scripts/over90-task-gate.ts
- plugin/scripts/supervisor-preempt-candidates.ts
- plugin/test/over90-task-gate.test.mjs
- plugin/scripts/capability-catalog-declarations.json
- .quay/discovery-portfolio.jsonl
