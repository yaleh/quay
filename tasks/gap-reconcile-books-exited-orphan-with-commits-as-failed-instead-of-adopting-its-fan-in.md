---
id: gap-reconcile-books-exited-orphan-with-commits-as-failed-instead-of-adopting-its-fan-in
title: "driver 重启/anchor 接管间隙内退出的 worker（worktree 有提交）被 reconcile 记成 failed:
  orphaned，而不是接着跑它的机械 fan-in（81 次，66 次带提交）"
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Proposal
**Measured 2026-10-14 during a human-authorized r5 anchor takeover on ClaudeCodeUI (old 721987 → new 4160721, SIGTERM handoff).** In-flight task `gap-voice-close-trace-row-removed-from-transcript` had a worker (pid 3072420) whose session finished inside the handoff gap. The worktree received a commit at 06:32:32Z. The old anchor had passed its 120000ms grace at 06:31:45Z ("exiting anyway"), and the new anchor started at 06:32:46Z. Nobody ran that worker's mechanical fan-in. At 06:33:06Z the new anchor's reconcile wrote:
```
final_state:"failed", failure_reason:"orphaned worker finalized by reconcile: driver restarted mid-flight and worker pid 3072420 already exited (or was recycled) before a new instance could adopt it", orphan_pid_liveness:"exited", worktree_cleanup_has_commits:true, worktree_cleanup_preserved_commits:true
```
The work is not lost, because commits are preserved and the task stays `ready`. But a worker that finished is booked as a **failure** and its result is not adopted. The task pays a whole new worker session to redo the landing, and the `failed` outcome sits in the same consecutive-non-landing history the retry cap reads.

**Frequency (hard rule 12b, read from history, not predicted).** `failure_reason` containing "orphaned worker finalized by reconcile" occurs **81 times** across the two hosts' `.quay/worker-outcome.jsonl`: 78 on quay, 3 on ClaudeCodeUI. In **66** of them `worktree_cleanup_has_commits:true`. Recent: quay 2026-10-12 (×5) and 2026-10-13; ClaudeCodeUI 2026-10-05, 2026-10-13T23:43:39Z, and 2026-10-14T06:33:06Z. The last two were caused by this session's own anchor swaps. Any driver restart or anchor takeover that brackets a worker's exit produces this.

**Code path.** `worker-driver.ts` `reconcileOrphanDispatches`: `classifyOrphanDispatch` → `"finalize"` (pid dead or recycled) → `finalizeOrphanDispatch` → `computeOrphanFinalizedOutcome` → `final_state:"failed"`. Only a **live** pid goes to `adoptOrphanWorker`. That branch was fixed by `gap-reconcile-finalizes-live-worker-as-exited-and-double-dispatches-same-task` (done), which covered the alive case only. The exited-with-commits case has no adopt path.

## Plan
1. In reconcile, when an orphan's pid is dead **and** its task worktree carries commits ahead of the merge target, run the **same mechanical fan-in** a normally-exiting worker gets. Fan-in already decides landing from the worktree's own state: AC precheck, anti-drift, suite, ff. It does not need the dead process's exit code. Record the outcome with a distinct marker (e.g. `adopted_after_exit:true`, `exit_code:null`) so "the worker's own exit status was never observed" stays visible (hard rule 3b) rather than being shaped like a normal exit 0.
2. A dead orphan with **no** commits keeps today's behavior (`failed`, orphaned).
3. Decide, and state the reason, whether a dead-orphan `failed` should count toward the consecutive-non-landing retry cap. It is an infrastructure event, not a task-quality signal.
4. Do not change live-orphan adoption or the whole-anchor SIGTERM path.

## Acceptance Criteria
- [ ] AC1: fixture: an orphan dispatch record whose pid is dead and whose worktree has an AC-complete commit ahead of develop. Post-fix reconcile runs fan-in and the task lands. Negative control: the pre-fix driver on the same fixture writes `final_state:"failed"` with the orphaned reason. Both pasted.
- [ ] AC2: same fixture with an AC-incomplete worktree. Fan-in refuses on its normal grounds (e.g. `exited-not-landed`, AC precheck), not `failed: orphaned`. The task returns to `ready` with its commits intact.
- [ ] AC3: same fixture with no commits: unchanged `failed: orphaned` outcome (pasted).
- [ ] AC4: retry-cap treatment of dead-orphan outcomes decided and demonstrated with a fixture (pasted).
- [ ] AC5: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC5 checked with pasted evidence.
- No change to live-orphan adoption or to anchor takeover/SIGTERM semantics.

## Touches
- tasks/gap-reconcile-books-exited-orphan-with-commits-as-failed-instead-of-adopting-its-fan-in.md
- plugin/scripts/worker-driver.ts
- plugin/test/worker-driver.test.mjs
