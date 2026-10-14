---
id: gap-adopted-live-orphan-exits-without-fan-in-so-adopted-work-never-lands
title: 被接管(adopt)的在飞 worker 退出后不跑机械 fan-in，只读 task 状态 ⇒ 永远 exited-not-landed（153
  次；anchor 自刷新/接管必然触发）
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Proposal
**Sibling of `gap-reconcile-books-exited-orphan-with-commits-as-failed-instead-of-adopting-its-fan-in` (done 2026-10-14). That fix covered the DEAD-orphan branch and explicitly left `adoptOrphanWorker` byte-unchanged (its AC evidence: "`adoptOrphanWorker` (live pid) is byte-unchanged"). This is the LIVE-orphan branch, which has the same defect (hard rule 5b).**

**Measured 2026-10-14 on quay's own host.** That fix landed and changed `worker-driver.ts`, so the dev-tree anchor self-refreshed (`06:57:37Z anchor: takeover 270269 exited — taking over`, new host pid 2429149). The in-flight worker for `gap-quality-restart-waits-out-whole-round-so-osd-in-flight-exceeds-stop-window` was still alive, so reconcile adopted it. The worker then finished with **all 4 ACs ticked** and a commit on its branch (`e18ec4b04 quality: honour a kind stop inside a round, not only between rounds`). Recorded outcome:
```
2026-10-14T07:05:26.139Z  final_state:"exited-not-landed"
failure_reason:"adopted orphan worker exited (exit code unobservable) — task status=ready (not done) and leftover worktree task/<id> still present"
```
**No mechanical fan-in ran.** No `fan-in-*` log exists for this task after the adoption.

**Cause (code).** `adoptOrphanWorker` (`worker-driver.ts`) waits for the adopted pid to die and then only calls `computeLandingState(rootDir, taskId, null)` → `computeAdoptedOutcome`. It never spawns the mechanical fan-in that a normally-owned worker gets after exit (`finishAsync` → `spawnMechanicalFanIn`). An adopted worker therefore can never land. Its "landing" is just a read of task status, which nobody advances. The task stays `ready`, and the next dispatch pays a whole worker session to redo a fan-in it could have had for free.

**Frequency (12b, from history).** Outcomes whose `failure_reason` starts with "adopted orphan worker exited": **146 on quay, 7 on ClaudeCodeUI (153 total)**. Recent ones: quay 2026-10-12T19:47, 10-13T16:12, 10-13T16:40, 10-14T07:05; ClaudeCodeUI 10-13 (×3) and 10-14T06:36. The last one is the in-flight task `gap-voice-relay-mode-a-prompt-drop-continue-arm-and-session-status` from the human-authorized r5 takeover, which a coordinator report had wrongly described as "adopted and fanned in". Every anchor takeover or driver self-refresh that brackets a long worker produces this. That makes the requirement "driver restart at any time" unmet even with both restart fixes landed.

## Plan
1. In `adoptOrphanWorker`, once the adopted pid has exited (not timed out), run the same post-exit pipeline a normally-owned worker gets: AC short-circuit gate → `spawnMechanicalFanIn` → `computeLandingState`. Reuse `resumeExitedOrphanFanIn` from the sibling fix rather than writing a third copy. Keep `exit_code:null` + `adopted:true` so the unobserved exit stays visible (3b).
2. The timed-out branch stays as is.
3. Ensure a single fan-in per task: an adopted worker's fan-in must not race a dispatch of the same task (dispatch record stays held until the fan-in outcome is written).

## Acceptance Criteria
- [ ] AC1: fixture: a live orphan adopted by reconcile, which then exits with an AC-complete commit ahead of develop. Post-fix it fans in and lands. Negative control: the pre-fix driver on the same fixture records `exited-not-landed` "adopted orphan worker exited" with no fan-in. Both pasted.
- [ ] AC2: same with an AC-incomplete worktree: fan-in refuses on its own grounds, commits kept, task back to `ready`.
- [ ] AC3: no double fan-in or double dispatch for the task during the adopted worker's lifetime and fan-in (dispatch record + outcome pasted).
- [ ] AC4: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC4 checked with pasted evidence. The dead-orphan path from the sibling task is unchanged.

## Touches
- tasks/gap-adopted-live-orphan-exits-without-fan-in-so-adopted-work-never-lands.md
- plugin/scripts/worker-driver.ts
- plugin/test/worker-driver.test.mjs
