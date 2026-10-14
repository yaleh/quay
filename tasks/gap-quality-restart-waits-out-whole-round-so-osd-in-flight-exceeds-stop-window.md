---
id: gap-quality-restart-waits-out-whole-round-so-osd-in-flight-exceeds-stop-window
title: quality 的 per-kind restart 只在轮间检查停机，OSD 轮(92s–20min)在飞时必超 60s 停机窗 →
  stop-failed（安全但不可靠）
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Proposal
**Measured 2026-10-14 on ClaudeCodeUI after deploying the per-kind stop fix (`gap-per-kind-stop-is-in-memory-and-never-crosses-dist-bundles`, done; r5 dist kernel from develop `a9bfc5f0c`, anchor 4160721).** Per-kind restart of `quality` now works: two production restarts confirmed (`confirmed_ms=502`), with no anchor churn, no other kind restarted, and strictly sequential loops. But the first restart took **44249ms**, because it waited for an in-flight round. On the r5 scratch host, where rounds are short, restarts took 1.3–3.4s.

**Cause, from code.** `runResidentQualityGateLoop` (`quality-gate-driver.ts:1577`) checks `stopCtl.isStopRequested()` only at the top of each round. The per-routine `for` loop has no stop check between routines, and `runRoutineWithWatchdog` (`:1528`) races only a wall-clock watchdog, with no stop signal. A stop therefore waits for the entire remaining round, while `stopKindViaAnchor` waits at most `ANCHOR_LOOP_STOP_TIMEOUT_MS` = 60000ms.

**How often a round exceeds 60s (measured from carriers):**
- ClaudeCodeUI OSD scan-round `wall_ms`: 256674, 92252, 243136, 164024, 306521, 229365, i.e. **6/6 > 60s**.
- quay OSD: **22/23 > 60s**, max 1172s.
- quay discovery-method: 3/41 > 60s.

So a quality restart issued while an OSD (or long discovery-method) round is in flight deterministically ends in `stop-failed` / `restart-aborted`. Since the landed fix, desired state is restored, so this is *safe* but not *reliable*, which falls short of the requirement that driver restarts not need an idle window.

## Plan
1. Check the stop flag **between routines** within a round. That is cheap and bounds latency to the longest single routine.
2. For the long, model-calling routines (OSD, discovery-method, cross-project-dogfood, architecture-review judge), propagate the stop as a cancellation. The routine stops at its next model-call boundary and records a legible `not-evaluated: stopped-mid-round` with whatever it persisted. Never record a partial round as a completed one (硬规则 3b). It must also not leave a budget reservation unaccounted for: a reservation already spent stays spent.
3. Alternatively or additionally, make `stopKindViaAnchor`'s wait aware of a declared in-flight long routine (e.g. extend the wait while the loop reports one, up to that routine's own `max_wall_ms`). Pick one approach and give the reason. Do not just raise the 60s literal (硬规则 4 推论二).

## Acceptance Criteria
- [x] AC1: reproduce before the fix: a scratch dist host whose quality round includes a routine that runs >60s (a fixture routine is fine). `restart --kind quality` issued mid-round yields `stop-failed` / `restart-aborted` (pasted). — **Reproduced 2026-10-14 against the PRE-fix kernel (main checkout, pre-merge), one scratch host, the SAME fixture driver on both arms — only the tree the kernel is imported from differs.** Host = `mkdtemp` under `$TMPDIR` + `plugin/scripts/{six drivers}`; the five non-quality fixtures are heartbeat writers, the `quality` fixture drives the REAL `runResidentQualityGateLoop` with one forced-due routine of 25 "model calls" × 3s (75s > 60s) that appends a budget reservation BEFORE each call (the production order). All six kinds on one anchor; `restart --kind quality` issued while the routine was mid-round (≥3 reservations already taken). Readings:
  ```
  [prefix-maincheckout] restart --kind quality  exit=1  elapsed_ms=60375
  [prefix-maincheckout] stderr: stop-failed: kind=quality — 该 kind 的循环在 60000ms 内未收尾（anchor pid=2753045）。⛔ 本条不报成 not-running：循环仍在 ⇒ 接着 start 会得到两份 loop（双派发）。期望态：已把 quality 放回（restart 中止 ⇒ 「该 kind 应该在跑」仍成立）。
  [prefix-maincheckout] loop-started counts before -> after: {"promotion":"1 -> 1","worker":"1 -> 1","outer":"1 -> 1","quality":"1 -> 1","meta":"1 -> 1","goal":"1 -> 1"}
  [prefix-maincheckout] fixture ledger reservations: 24
  [prefix-maincheckout] quality round records: 0
  ```
  i.e. wait out the full 60s window → `stop-failed` (⇒ `restart-aborted`, with the landed desired-state restore visible in the same line) → no round record at all, while the routine kept spending reservations (24). This is the measured production shape from the Proposal, at fixture level.
- [x] AC2: after the fix, the same harness confirms the restart within the fix's stated bound, with no double loop (anchor.log `stopped` precedes the next `started`) and no other kind restarted (pasted). — **Same harness, same fixture, kernel imported from the fixed worktree.** Stated bound: stop latency ≤ one stop-probe poll (`DISK_STOP_POLL_MS_DEFAULT` = 500ms) + the in-flight routine's own cancellation granularity (here one 3s model-call block) + teardown; and, for a routine that ignores the signal entirely, ≤ poll + `STOP_GRACE_MS_DEFAULT` (5s) — i.e. **≤ ~6s regardless of routine behaviour**, against the 60s window. Measured:
  ```
  [postfix-worktree] restart --kind quality  exit=0  elapsed_ms=3720
  [postfix-worktree] stdout: stopped
  [postfix-worktree] stdout: started: anchor pid=2733142 kind=quality driver pid=2733142 confirmed_ms=502
  [postfix-worktree] anchor.log (stop/start lines):
      06:58:35Z anchor: kind=quality loop stopped
      06:58:36Z anchor: kind=quality loop started (pid=2733142)
  [postfix-worktree] loop-started counts before -> after: {"promotion":"1 -> 1","worker":"1 -> 1","outer":"1 -> 1","quality":"1 -> 2","meta":"1 -> 1","goal":"1 -> 1"}
  [postfix-worktree] anchor pid stable across the restart: 2733142
  [postfix-worktree] quality round records: 1
  [postfix-worktree]   round=1 stopped_mid_round=true skipped=[] facts=[{"name":"fixture-model-round","state":"not-evaluated","observed":true,"reason":"stopped-mid-round: the fixture routine observed the signal at its next model-call boundary"}]
  [postfix-worktree] fixture ledger reservations: 5
  ```
  3720ms ≪ the 60s window; `kind=quality loop stopped` precedes the next `kind=quality loop started` with no second quality loop in between (and the anchor pid is unchanged, so it was the same anchor throughout); only `quality`'s loop-started count moved (1→2) — the other five kinds are all 1→1, so no other kind was restarted. The fixture's budget ledger holds 5 reservations: the ones taken before the stop, none after.
- [x] AC3: a model-calling routine interrupted mid-round records a distinct `stopped-mid-round` (or equivalent) state, not `verified`. Its budget ledger stays consistent: reservations before the stop are counted, and none are taken after it (pasted). — Covered at three levels, all committed in `plugin/test/quality-gate-driver.test.mjs` (that file 58/58 green), and every one of them goes RED if the `signal?.aborted` check is moved after `budget.reserve`:
  **(a) the choke point** — `reservingModel` (the seam every discovery-method model subprocess goes through) driven with a REAL `openModelBudget` ledger: one call before the stop (1 `reserve` + 1 `outcome`), then `abort()` ⇒ throws `StoppedMidRoundError{step:"reflection", afterStop:true}`; afterwards `reserve` count is **still 1** and 0 further model subprocesses were started. Abort arriving while the call is IN FLIGHT ⇒ `afterStop:false` with **2** reserves / **2** outcomes — the in-flight reservation stays SPENT, none is refunded, and `afterStop:true` vs `false` are different values (硬规则 3b).
  **(b) the round level** — a real `runDiscoveryMethod` whose reflection seam makes a real reservation and then throws the same error: `state="not-evaluated"`, reason starts `stopped-mid-round: `, one carrier line with `partial:true` / `partial_reason:"stopped-mid-round:reflection"` / `stopped_mid_round.after_stop=false`, and `latestResidentRoundTs(lines) === null` — so "did NOT advance the production last-run" is structurally true, not merely asserted. Negative control on the same code path: an ordinary engine error still records `failed` / `reflection threw`, and writes nothing.
  **(c) the routine the title names** — a real `runOpenSemanticDiscovery` round: the stop arrives with the investigator call in flight. Result: `state="not-evaluated"`, reason `stopped-mid-round: the resident loop's stop signal arrived during the investigator step (while that call was in flight; the call was killed and its reservation stays SPENT) — 1 call(s) already made stay RESERVED … the production last-run was NOT advanced`; the OSD budget ledger holds exactly **1 reserve + 1 outcome**; exactly **1** model subprocess was spawned; the carrier line is `partial:true` with `partial_reason:"stopped-mid-round:investigator"`. Independently, `spawnModelCall` is asserted to SIGKILL an in-flight child on abort (settled in 159ms, versus the 60000ms timeout it would otherwise have waited out) and to spawn nothing at all when the signal is already aborted, both surfacing `error.message` beginning `stopped-mid-round: `.
- [x] AC4: `scripts/test.sh --for-task <this task>` green. — `bash scripts/test.sh --for-task gap-quality-restart-waits-out-whole-round-so-osd-in-flight-exceeds-stop-window --allow-thin` → **exit 0**, `ℹ tests 236 / ℹ pass 236 / ℹ fail 0`, with every scoped static check PASS. The three selected files are the ones the Touches reach: `open-semantic-discovery-routine.test.mjs` (121), `discovery-method-routine.test.mjs` (57), `quality-gate-driver.test.mjs` (58, including the new `stop AC*` / `AC3 — reservingModel|spawnModelCall|（轮级）|（OSD 轮级）` cases).

## Definition of Done
- AC1-AC4 checked with pasted evidence; no budget ceiling changed. — No ceiling touched: `max_model_calls_per_24h`, `max_usd_per_24h`, `PER_CALL_USD_CEILING` and `verify_reserve` are byte-identical. The stop path only stops TAKING reservations; it never refunds or re-caps one (AC3(a)).
- **Plan step 3 was deliberately NOT taken**, and the reason is the Plan's own question. Extending `stopKindViaAnchor`'s wait is the wrong instrument: the 60000ms is a *waiting window*, not a *stop latency*, so raising it postpones `stop-failed` into a longer block and bounds nothing — the routine watchdog defaults to 30min, so a routine that ignores every signal could hold a restart for that long. What the requirement ("driver restarts must not need an idle window") actually needs is for the loop to *stop*, which is what Plan items 1+2 plus the caller-side `stopGraceMs` deliver: the bound in AC2 is a property of the loop, not of the wait. Raising the literal is also precisely what 硬规则 4 推论二 forbids.
- Scope note (硬规则 5b, honestly stated): the two remaining model-calling routines named in Plan item 2 — cross-project-dogfood and the architecture-review judge — are **not** in this task's Touches and were not given per-routine cancellation. They are covered by the *generic* half: the caller-side `stopGraceMs` bounds a round containing them regardless of whether they cooperate, and their round then records `observed:false` rather than `observed:true`. Their own graceful path (killing an in-flight child at a call boundary) remains open work if their rounds are ever measured to exceed the grace.

## Touches
- tasks/gap-quality-restart-waits-out-whole-round-so-osd-in-flight-exceeds-stop-window.md
- plugin/scripts/quality-gate-driver.ts
- plugin/scripts/driver-runtime.ts
- plugin/scripts/open-semantic-discovery-routine.ts
- plugin/scripts/discovery-method-routine.ts
- plugin/test/quality-gate-driver.test.mjs
