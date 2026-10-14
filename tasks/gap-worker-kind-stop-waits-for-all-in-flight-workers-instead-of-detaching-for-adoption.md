---
id: gap-worker-kind-stop-waits-for-all-in-flight-workers-instead-of-detaching-for-adoption
title: worker kind 的 restart 在有在飞 worker 时必然 stop-failed（循环只在 running==0
  时退出）；应脱钩在飞、交给下一循环 adopt+fan-in
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Proposal
**Measured 2026-10-14 08:06Z on ClaudeCodeUI, r6 dist kernel (develop `1ce4cab18`, anchor 778542), under explicit human authorization to restart at any time.** In the same session, against the same anchor:
- `restart --kind quality` ×3: all confirmed in 1.4–1.6s, the first one interrupting a round 26.8s in (the landed `gap-quality-restart-waits-out-whole-round-so-osd-in-flight-exceeds-stop-window` works).
- `restart --kind worker` with **2 workers in flight** (pids 1149784, 3903296): **`stop-failed` after 60289ms → `restart-aborted`**.

The failure path itself is now safe: desired state restored, no stale stop record, one worker loop. But a worker-kind restart is impossible whenever any worker is in flight, which on a busy host is nearly always. Earlier first-hand measurements on the same host (2026-10-13, recorded in `gap-driver-stop-kind-worker-message-does-not-name-drain-or-takeover-handoff`) show the same refusal.

**Cause (code, `worker-driver.ts`).** On a kind stop, the dispatch loop stops starting new workers (`:6155` `!workerStopRequested()`), but the loop exits only through the `running.length === 0` branch (`:6213-6214`). The comment at `:5942` makes this explicit: the stop "只让睡眠提前结束，⛔ 不杀在飞（收尾仍由 running.length === 0 那一支决定）". So the stop waits for every in-flight worker session to end, which takes minutes to hours, against a 60000ms stop window.

**Why detaching is now correct rather than lossy.** Worker sessions are independent OS processes (SPEC §6.9 inv.3). Their dispatch records persist on disk. As of today, a fresh worker loop adopts a still-live orphan **and runs its mechanical fan-in when it exits** (`gap-adopted-live-orphan-exits-without-fan-in-so-adopted-work-never-lands`, done), and fans in a dead orphan with commits (`gap-reconcile-books-exited-orphan-with-commits-as-failed-instead-of-adopting-its-fan-in`, done). The whole-anchor SIGTERM takeover already relies on exactly this. The per-kind worker stop is the only path that still insists on draining.

## Plan
1. On a kind stop, the worker loop leaves its in-flight workers **detached**. Their dispatch records stay on disk, still owned, so the next loop's reconcile adopts them. The loop then returns promptly. It must not kill workers and must not finalize them.
2. Make sure no window allows a double dispatch. While detached, a task with a live worker and a dispatch record must stay excluded from the new loop's selector (the cold-inflight exclusion must cover it from the first round).
3. Keep `drain` semantics unchanged: drain is the explicit "finish what's in flight, start nothing new" verb.

## Acceptance Criteria
- [x] AC1: reproduce first on a dist scratch host. With a fixture worker in flight (a long-sleeping process registered as a dispatch), `restart --kind worker` yields `stop-failed` / `restart-aborted` (pasted).
- [x] AC2: after the fix, the same harness confirms the restart within seconds. The fixture worker is still alive, is adopted by the new loop (outcome/adoption event pasted), and when it exits, its mechanical fan-in runs exactly once (pasted).
- [x] AC3: no double dispatch of the in-flight task across the restart (dispatch record + worker-outcome pasted).
- [x] AC4: `drain` still waits for in-flight workers (pasted, unchanged behavior).
- [x] AC5: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC5 checked with pasted evidence; no budget change; no change to anchor SIGTERM takeover.

## Evidence

**Harness (2026-10-14).** Dist-kernel scratch host: fresh `git init`, `.quay/plugin` → a `.git`-free kernel tree, no quay source checkout. Two kernels built by esbuild from the SAME base commit, differing **only** in `plugin/scripts/worker-driver.ts` (pre-fix = the main checkout's dev source; post-fix = this task's worktree): real `driver-runtime.js` + real `driver-anchor.js` + the real `worker-driver.js` bundle, hosted on ONE anchor. Fixtures are the documented test seams only — `--worker-cmd-exact` ⇒ `node -e setTimeout(()=>{},600000) quay-task-worker gap-kindstop-inflight` (a long-sleeping process whose cmdline carries the worker name + task id, so reconcile's `classifyOrphanDispatch` sees a genuine in-flight worker), plus `--ready-pool-cmd` / `--selector-cmd`; the non-worker kinds are heartbeat fixtures. No live worker model call (the only `claude` invocation is `start --kind worker`'s own environment smoke check, unchanged by this task). Driver scripts live out of the repo at `/data/home/yale/work/quay-scratch/kindstop-dist/{harness.mjs,run.mjs}`.

**AC1 — pre-fix kernel, fixture worker in flight, dispatch record registered and alive.**
`$ node scripts/dist/driver-runtime.js restart --kind worker --confirm-timeout 10 --root <host>`
```
exit=1 wall_ms=60256
stdout: (empty)
stderr:
stop-failed: kind=worker — 该 kind 的循环在 60000ms 内未收尾（anchor pid=1771329）。⛔ 本条**不报成 not-running**：循环仍在 ⇒ 接着 start 会得到两份 loop（双派发）。期望态：已把 worker 放回（restart 中止 ⇒「该 kind 应该在跑」仍成立）。
restart-aborted: kind=worker — stop 未确认旧进程树已退出（exit=1）；⛔ 不起新循环（否则与旧 loop 双派发）。
[inflight] dispatch record: {"taskId":"gap-kindstop-inflight","runId":"wk-prod-anchor","workerPid":1771569,"selectorReason":"selector picked gap-kindstop-inflight","startedAtMs":1791967157738,"timeoutDeadlineMs":0,"cmdlineFingerprint":"node -e setTimeout(()=>{},600000) quay-task-worker gap-kindstop-inflight"}
[post] worker pid 1771569 alive: true
[post] anchor.log: 'kind=worker loop started' present, 'kind=worker loop returned' ABSENT (the loop never yielded)
[post] outcomes: []
```

**AC2/AC3 — post-fix kernel, same harness.**
`$ node scripts/dist/driver-runtime.js restart --kind worker --confirm-timeout 30 --root <host>`
```
exit=0 wall_ms=3229
stdout:
stopped
started: anchor pid=1882354 kind=worker driver pid=1882354 confirmed_ms=505
(git status blob: "carrier_path":"/tmp/ksd-ac2-DMrGs8/.quay/worker-round.jsonl","carrier_records":2,...)
stderr: start-warning: kind=worker — environment smoke failed-non-environment: smoke call exited 1  (unchanged by this task)
[AC2] confirmed_ms=505 (restart wall_ms=3229); stop-failed present: false
[AC2] the in-flight worker pid 1882662 alive after the restart: true
[AC2] live fixture-worker processes after restart: [1882662]
[AC2] rounds after restart (round / in_flight / detached_workers / undetachable_workers):
  {"round":1,"in_flight":1,"detached_workers":[],"undetachable_workers":[]}         <- before the stop
  {"round":2,"in_flight":1,"detached_workers":["gap-kindstop-inflight"],"undetachable_workers":[]}  <- the detach round
  {"round":1,"in_flight":1,"detached_workers":[],"undetachable_workers":[]}         <- the NEW loop's first round
[AC2] rounds recording the detach: 1
[AC2] worker 'loop started' count before=1 after=2; anchor pid unchanged: true
```
Adoption + post-exit pipeline (the worker is SIGKILLed after the restart; the exit is then booked by the ADOPTING loop):
```
[AC2] outcomes for gap-kindstop-inflight: 1
[AC2] outcome: {"ts":"2026-10-14T08:40:38.024Z","task":"gap-kindstop-inflight","exit_code":null,"signal":null,
  "wall_clock_ms":7067,"final_state":"exited-not-landed","failure_reason":"resumed orphan worker (exit status
  unobservable) — task status=ready (not done)","worker_pid":1882662,"run_id":"wk-prod-anchor","timed_out":false,
  "adopted_after_exit":true}
```
`adopted_after_exit: true` + `exit_code: null` is the adopting loop's post-exit pipeline (the entry point the mechanical fan-in hangs off) — observed exactly ONCE (`outcomes … : 1`), and the dispatch record is cleared by it. Same arm repeated with an AC-complete `task/<id>` worktree (so the AC gate passes and the real fan-in process is spawned) — one outcome, `mechanical_fan_in` present, again exactly once:
```
[AC2] outcomes for gap-kindstop-inflight: 1
… "adopted_after_exit": true, "mechanical_fan_in": {"outcome":"red","verdict":{"step":"parse-mechanical-fan-in",
  "verdict":"failed","summary":"unparseable fresh mechanical fan-in output: exit 0"},"step":"parse-mechanical-fan-in"}
```
(the fan-in ran once and refused on its own grounds — the scratch host declares no suite; that verdict is the fan-in's business, not this task's).

**AC3 — no double dispatch across the restart.** The dispatch record is byte-identical before and after the restart (no re-dispatch was recorded), and exactly one fixture-worker process existed throughout the window:
```
before: {"runId":"wk-prod-anchor","workerPid":1882662,"startedAtMs":1791967230957,…}
after:  {"runId":"wk-prod-anchor","workerPid":1882662,"startedAtMs":1791967230957,…}   (unchanged)
[AC2] live fixture-worker processes after restart: [1882662]      (exactly one)
```
The task is only re-dispatched AFTER its post-exit pipeline closed the dispatch (normal `exited-not-landed` retry) — that is a new dispatch, not a double one, and it is visible as such: the record above is untouched for the whole in-flight window.

**AC4 — `drain` unchanged (post-fix kernel, worker in flight).**
```
$ node scripts/dist/driver-runtime.js drain --kind worker --root <host>
exit=0 wall_ms=84
drained: worker halted (no new dispatch; in-flight workers untouched) — control state at <host>/.quay/worker-control.json
[AC4] worker pid 1980241 still alive: true
[AC4] anchor log worker 'loop started' / 'loop returned': 1 / 0   (the loop is STILL running, it did not detach)
[AC4] rounds since the drain: [{"round":1,"in_flight":1,"detached_workers":[],"stop_reason":"filtered-empty …"}]
[AC4] outcomes while in flight: []
[AC4] the in-flight worker ends ⇒ the OWNING loop writes its outcome itself:
  {"task":"gap-kindstop-inflight","signal":"SIGKILL","final_state":"killed","failure_reason":"worker killed by SIGKILL",
   "worker_pid":1980241,"session_id":"40bc89e0-9047-49aa-8fa4-f6983701f962","quick_death_cause":"ordinary"}
[AC4] worker 'loop returned' lines: ["… anchor: kind=worker loop returned code=137 after 5994ms"]
```
`detached_workers: []` on the drain path is the negative control for the new gate: a stop that is NOT a kind-stop record (halt/drain) does not detach and still waits the in-flight worker out, booking its outcome itself. The anchor's SIGTERM/takeover path is likewise untouched — it never writes `.quay/anchor-kind-stops.json` (the only thing `workerStopRequested()` newly gates on), and `driver-anchor.ts` / the shutdown path are not modified by this task.

**AC5 — `bash scripts/test.sh --for-task gap-worker-kind-stop-waits-for-all-in-flight-workers-instead-of-detaching-for-adoption --allow-thin`**
```
ℹ tests 143
ℹ pass 143
ℹ fail 0
EXIT=0
```
(plus the three new fixture-level tests in `plugin/test/worker-driver.test.mjs`: kind-stop detach + prompt loop return; the next loop adopts and the post-exit pipeline runs exactly once; the drain negative control — all green.)

## Touches
- tasks/gap-worker-kind-stop-waits-for-all-in-flight-workers-instead-of-detaching-for-adoption.md
- plugin/scripts/worker-driver.ts
- plugin/test/worker-driver.test.mjs
