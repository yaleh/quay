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
- [x] AC1: fixture: an orphan dispatch record whose pid is dead and whose worktree has an AC-complete commit ahead of develop. Post-fix reconcile runs fan-in and the task lands. Negative control: the pre-fix driver on the same fixture writes `final_state:"failed"` with the orphaned reason. Both pasted.
- [x] AC2: same fixture with an AC-incomplete worktree. Fan-in refuses on its normal grounds (e.g. `exited-not-landed`, AC precheck), not `failed: orphaned`. The task returns to `ready` with its commits intact.
- [x] AC3: same fixture with no commits: unchanged `failed: orphaned` outcome (pasted).
- [x] AC4: retry-cap treatment of dead-orphan outcomes decided and demonstrated with a fixture (pasted).
- [x] AC5: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- [x] AC1-AC5 checked with pasted evidence.
- [x] No change to live-orphan adoption or to anchor takeover/SIGTERM semantics.

## Touches
- tasks/gap-reconcile-books-exited-orphan-with-commits-as-failed-instead-of-adopting-its-fan-in.md
- plugin/scripts/worker-driver.ts
- plugin/test/worker-driver.test.mjs

## Evidence

### Implementation (worker-driver.ts, commit c073d6904)
- `shouldResumeExitedOrphan({root,taskId,record})` — pure predicate: `/proc`-measured pid **exited** ∧ worktree dir present ∧ `git log develop..task/<id>` has commits. ⛔ all three required.
- `computeResumedAfterExitOutcome(...)` — terminal outcome carrying `adopted_after_exit:true` and `exit_code:null` (verified ⇒ `completed`; else ⇒ `exited-not-landed`).
- `resumeExitedOrphanFanIn({rootDir,outcomeFile,record,fanInRunner?})` — same order as `finishAsync`: AC short-circuit gate → spawn fresh mechanical fan-in (`spawnMechanicalFanIn`) → `computeLandingState` → append outcome + clear dispatch record + project `## Blocker`.
- `reconcileOrphanDispatches`: `cls === "finalize"` ∧ `shouldResumeExitedOrphan` ⇒ push into `running` via `.then((r) => onWorkerFinished(rw, r))`; otherwise the original `finalizeOrphanDispatch` path is unchanged.

### AC1 — dead orphan + worktree with commits ⇒ mechanical fan-in is resumed and the task lands
`node --test --test-name-pattern="死孤儿" plugin/test/worker-driver.test.mjs` → 4/4 pass.

Negative control (same fixture, the pre-fix destination `finalizeOrphanDispatch`):
```
{"task":"gap-resume-exited-orphan","exit_code":null,"final_state":"failed",
 "failure_reason":"orphaned worker finalized by reconcile: driver restarted mid-flight and worker pid 999999999 already exited (or was recycled) before a new instance could adopt it",
 "orphan_pid_liveness":"exited","worktree_cleanup_has_commits":true,"worktree_cleanup_preserved_commits":true}
```
Post-fix (same fixture, `resumeExitedOrphanFanIn`; the stub fan-in performs the real landing actions: ff `develop` to the branch tip + remove the worktree):
```
{"task":"gap-resume-exited-orphan","exit_code":null,"final_state":"completed","failure_reason":null,
 "adopted_after_exit":true,
 "mechanical_fan_in":{"outcome":"landed","landedSha":"171655763c7b1b50c965e962bde3da22eda33910", ...}}
```
Assertions: `fanInCalls === 1` (fan-in actually ran), `final_state === "completed"`, `adopted_after_exit === true`, `exit_code === null`, no leftover worktree, dispatch record cleared.

### AC2 — AC-incomplete worktree ⇒ refused on its OWN normal grounds, ⛔ not failed:orphaned; task stays ready with commits intact
```
{"task":"gap-resume-exited-orphan","exit_code":null,"final_state":"exited-not-landed",
 "failure_reason":"AC 未全勾（checked 0/2，剩余未勾 2）——续做只需验证并勾选 AC",
 "adopted_after_exit":true,"short_circuit":"ac-not-checked"}
```
Assertions: `fanInCalls === 0` (AC-incomplete ⇒ short-circuit, no fan-in spawn), `final_state === "exited-not-landed"`, `short_circuit === "ac-not-checked"`, reason names “AC 未全勾” and ⛔ does not contain the orphaned wording; `readTaskStatus(root,taskId) === "ready"`, worktree still present, branch tip byte-identical (commits intact), dispatch record cleared.

### AC3 — no commits: unchanged `failed: orphaned` (and worktree cleaned)
```
{"task":"gap-resume-ac3-none","exit_code":null,"final_state":"failed",
 "failure_reason":"orphaned worker finalized by reconcile: driver restarted mid-flight and worker pid 999999999 already exited (or was recycled) before a new instance could adopt it",
 "worktree_cleaned":true,"worktree_cleanup_has_commits":false,"worktree_cleanup_preserved_commits":false}
```
Assertions: `taskBranchHasCommits === false`, `shouldResumeExitedOrphan === false`, `final_state === "failed"`, orphaned reason unchanged, worktree cleaned.

### AC4 — retry-cap treatment (decided)
**Ruling.** ① A dead orphan that **has output** resumes and really runs fan-in ⇒ its result takes the **same** destination as a normal worker (`onWorkerFinished`): landed ⇒ `completed` (not counted); fan-in refusal ⇒ `exited-not-landed` (counted as usual, with the existing exemptions ff-not-fast-forward / unrelated-flaky / AC short-circuit action split). Reason: it is now a **measured landing attempt** — a task-quality signal. ② A dead orphan with **no output** keeps today's behavior: `finalizeOrphanDispatch` writes `failed: orphaned` directly and its return value never enters `results` ⇒ it structurally cannot burn the retry budget. Reason: it is an **infrastructure event**, not a task-quality signal — counting it would park a task for infra reasons.
Fixture — resumed path refusal (`exited-not-landed`, carrying a `mechanical_fan_in` reading):
```
{"task":"gap-resume-exited-orphan","final_state":"exited-not-landed","adopted_after_exit":true,
 "mechanical_fan_in":{"outcome":"red","step":"suite","reason":"suite red", ...}}
```
Fixture — no-output dead orphan (`failed: orphaned`):
```
{"task":"gap-resume-ac4-nocommit","final_state":"failed",
 "failure_reason":"orphaned worker finalized by reconcile: ..."}
```
Assertions: `isFfNotFastForwardFailure(resumed) === false`; `advanceRetryCap` counts it once (it IS an input to the counting path); the no-output record's `final_state !== "exited-not-landed"` (not a value in the counting path's vocabulary); plus a source-text assertion that the resumed result is wired through `onWorkerFinished(rw, r)` (same destination as `adoptOrphanWorker`).

### AC5 — scoped gate green
```
bash scripts/test.sh --for-task gap-reconcile-books-exited-orphan-with-commits-as-failed-instead-of-adopting-its-fan-in --allow-thin
→ exit 0   (scoped static tier green; 89 test files selected; final suite worker-driver.test.mjs: tests 136 / pass 136 / fail 0)
```
(`--allow-thin` is the same scoped gate the driver's fan-in runs; the selector judged the selection thin, so the flagless form refuses with `test-selection-thin` rather than reporting a red.)

### Anti-drift
```
node --no-warnings --experimental-strip-types plugin/scripts/anti-drift-touches-check.ts --task <id> --worktree <wt> --merge-target develop
→ ANTI-DRIFT OK: task <id> — 2 actual file(s), all within declared Touches (3 glob(s))   [exit 0]
```

### DoD (live-orphan adoption / SIGTERM path untouched)
- `adoptOrphanWorker` (live pid) is byte-unchanged; `classifyOrphanDispatch` still routes a live pid to `adopt`.
- The new branch is gated on `/proc`-measured `exited`; `alive`/`unknown` (incl. a recycled pid) fall through to the unchanged `finalizeOrphanDispatch` (whose liveness gate still refuses a live worker).
- The whole-anchor SIGTERM path is untouched.
