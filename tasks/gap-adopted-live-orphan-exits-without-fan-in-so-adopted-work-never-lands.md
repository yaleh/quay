---
id: gap-adopted-live-orphan-exits-without-fan-in-so-adopted-work-never-lands
title: 被接管(adopt)的在飞 worker 退出后不跑机械 fan-in，只读 task 状态 ⇒ 永远 exited-not-landed（153
  次；anchor 自刷新/接管必然触发）
status: done
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
- [x] AC1: fixture: a live orphan adopted by reconcile, which then exits with an AC-complete commit ahead of develop. Post-fix it fans in and lands. Negative control: the pre-fix driver on the same fixture records `exited-not-landed` "adopted orphan worker exited" with no fan-in. Both pasted.
- [x] AC2: same with an AC-incomplete worktree: fan-in refuses on its own grounds, commits kept, task back to `ready`.
- [x] AC3: no double fan-in or double dispatch for the task during the adopted worker's lifetime and fan-in (dispatch record + outcome pasted).
- [x] AC4: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC4 checked with pasted evidence. The dead-orphan path from the sibling task is unchanged.

## Touches
- tasks/gap-adopted-live-orphan-exits-without-fan-in-so-adopted-work-never-lands.md
- plugin/scripts/worker-driver.ts
- plugin/test/worker-driver.test.mjs

## Evidence

### Implementation（`plugin/scripts/worker-driver.ts`，提交 `8d1d07c8a`）
`adoptOrphanWorker` 的退出分支按 `timedOut` 分叉：自然退出 ⇒ `finishAdopted()` 委派 `resumeExitedOrphanFanIn`（兄弟修复已建的退出后流水线：AC 短路闸 → `spawnMechanicalFanIn` → `computeLandingState` → 落盘 → blocker 投影 → 清 dispatch 记录），不再只调 `computeLandingState` 读一次 task status；超时 ⇒ `finishTimedOut()`（`timed-out` + `worktree_preserved`，逐字不变）。新增 `fanInRunner` 测试缝（缺省 `spawnMechanicalFanIn`），透传给该流水线。终态带 `adopted_after_exit:true` + `exit_code:null`——worker 自己的退出码从未被观测，不伪装成一次正常的 exit 0（硬规则 3b）。

`computeAdoptedOutcome` 逐字未删：生产路径现只以 `timedOut:true` 调用它，`timedOut:false` 两条分支保留为「修前那条只读 task status 的终态」的可跑参照（负控制夹具直接调它复现）。

### AC1 — 被 adopt 的存活孤儿自然退出 ⇒ 跑机械 fan-in 并落地
`node --test --test-name-pattern="被 adopt 的存活孤儿|接管全程单次 fan-in|死孤儿路径逐字不变" plugin/test/worker-driver.test.mjs` → 4/4 pass。

正臂（真 spawn 一个【实测存活】的孤儿 worker（cmdline 含 worker 名 + task id ⇒ `classifyOrphanDispatch` 判 `adopt`），它随后自然退出；替身 fan-in 执行真 fan-in 的落地动作：ff develop 到分支 tip + 移除 worktree）：
```
{"task":"gap-adopted-live-orphan","exit_code":null,"final_state":"completed","failure_reason":null,
 "adopted_after_exit":true,
 "mechanical_fan_in":{"outcome":"landed","landedSha":"455939f9cad634755a973448938cdd9fd0fdbca3",
   "mergeTreeSha":"455939f9cad634755a973448938cdd9fd0fdbca3","developSha":"455939f9cad634755a973448938cdd9fd0fdbca3"}}
```
断言：`seam.calls() === 1`（fan-in 确实跑了，不是只记一个终态）、`final_state === "completed"`、`adopted_after_exit === true`、`exit_code === null`、`develop` 已 ff 到分支 tip、落地后无残留 worktree、载体里有一条 `completed`、`exitCode === 0`。

负控制——同一夹具的同一状态，调修前 `finish()` 落盘用的那个终态构造器 `computeAdoptedOutcome({timedOut:false, …})`：
```
{"task":"gap-adopted-live-orphan","exit_code":null,"final_state":"exited-not-landed",
 "failure_reason":"adopted orphan worker exited (exit code unobservable) — task status=ready (not done) and leftover worktree task/gap-adopted-live-orphan still present",
 "timed_out":false}
```
断言：`final_state === "exited-not-landed"`、原因逐字含 `adopted orphan worker exited (exit code unobservable)`、`mechanical_fan_in === undefined`（从未跑 fan-in）。两臂终态必须【不同形】（`notEqual`）——否则这个对照什么也没测。

⚠️ 负控制取的是【修前终态构造器 + 同一夹具状态】，不是跑修前二进制：修前 `finish()` 的退出分支就是调它再落盘，故它给出的就是修前那条记录（与兄弟任务 AC1 负控制的取法一致）。

### AC2 — AC 未全勾的 worktree ⇒ 按它自己的正常理由拒绝；任务回 `ready`、提交完好
同一夹具、同一 adopt 入口，worktree 任务体 AC 未勾（`[ ]`）：
```
{"task":"gap-adopted-live-orphan","exit_code":null,"final_state":"exited-not-landed",
 "failure_reason":"AC 未全勾（checked 0/2，剩余未勾 2）——续做只需验证并勾选 AC",
 "adopted_after_exit":true,"short_circuit":"ac-not-checked"}
```
断言：`fanInCalls === 0`（AC 未全勾 ⇒ 短路，不 spawn fan-in）、`final_state === "exited-not-landed"`、`short_circuit === "ac-not-checked"`、原因点名「AC 未全勾」且不含 `orphaned` / `adopted orphan worker exited` 措辞（那正是本缺陷的指纹）、`readTaskStatus(root,taskId) === "ready"`、worktree 仍在、分支 tip 逐字未变（提交完好）、`develop` 未被推进、dispatch 记录已清、`exitCode === EXITED_NOT_LANDED_EXIT`。

### AC3 — 接管全程单次 fan-in、期间不双派
① 孤儿【存活期间】：dispatch 记录在盘上；该 task 已被内存 `running` 持有 ⇒ `orphanDispatchCandidates(store, [taskId]) === []`（reconcile 不重复 adopt/finalize）。
② fan-in【运行中】：替身 fan-in 的 `onCall` 钩子在运行中读盘，`readDispatchStore(...)[taskId]` 仍非空 ⇒ 记录持有到 outcome 写完为止（断言 `heldDuringFanIn.workerPid === orphan.pid`）。
③ 结束后：`seam.calls() === 1`（恰好一次 fan-in）、`final_state === "completed"`、dispatch 记录已清、该 task 在 `worker-outcome.jsonl` 里恰好一条终态。
④ 接线（源文本）：`resumeExitedOrphanFanIn` 函数体内 `appendOutcomeToFile(outcomeFile, outcome)` 的位置早于 `removeDispatchRecord(...)`；`adoptOrphanWorker` 体内匹配 `if (!timedOut) { void finishAdopted(); return; }`（自然退出走委派，超时才走旧路）。

### AC4 — scoped 门绿
```
bash scripts/test.sh --for-task gap-adopted-live-orphan-exits-without-fan-in-so-adopted-work-never-lands --allow-thin
→ EXIT=0
```
（scoped 静态层全部 PASS；选中套件 worker-driver.test.mjs：`tests 140 / pass 140 / fail 0`，`duration_ms 25002`。`--allow-thin` 是驱动 fan-in 跑的同一个 scoped 门；本任务 diff 面窄，选择器判选择偏薄，故带该旗。）

### DoD — 死孤儿路径逐字不变（兄弟任务的接线未动）
- 兄弟任务的 4 条夹具在同一份测试文件里仍全绿（`plugin/test/worker-driver.test.mjs` 整文件 140/140 pass，修前 136 + 本任务 4）。
- 源文本断言：`reconcileOrphanDispatches` 的 `finalize` 分支仍先判 `shouldResumeExitedOrphan(...)` → `resumeExitedOrphanFanIn(...)`，否则 `const res = finalizeOrphanDispatch({ root: rootDir, outcomeFile, record, workerName });`（逐字未变）。
- `adoptOrphanWorker` 超时分支的退出码行 `if (outcome.final_state === "timed-out") exitCode = 128 + signalExitCode("SIGTERM");` 逐字未变；现存的「pid 存活 + 原始截止已过期 ⇒ SIGTERM 且 timed-out」夹具仍绿。
