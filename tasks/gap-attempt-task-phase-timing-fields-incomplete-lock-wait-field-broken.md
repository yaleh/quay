---
id: gap-attempt-task-phase-timing-fields-incomplete-lock-wait-field-broken
title: attempt/task 分阶段计时字段不全、锁等待字段已证实错误（P90 264min > 全程中位 18min）：补齐
  dispatch/worker-exit/lock/suite/fan-in 各阶段时间戳
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Proposal
**Diagnosis 2026-10-14 (read-only, task/attempt duration analysis) found the existing timing fields insufficient for the phase breakdown the human asked for.** `worker-outcome.jsonl`'s `started_at`/`ended_at` span the WHOLE attempt including fan-in; there is no separately recorded worker-exit timestamp. `mechanical_fan_in.lockAcquireEpoch`/`lockReleaseEpoch` exist, but the per-attempt `wall_ms` field recorded alongside the `acquire-fan-in-lock` step in the per-task fan-in log produced values LARGER than the whole attempt (P90 264 minutes against an 18-minute median attempt) — it does not measure lock wait; its actual meaning is unknown-but-wrong, and no other field measures lock wait directly.

Consequence: the diagnosis could report attempt/task medians, but could NOT reliably report "lock wait", "implementation-done time", or "test start/end" as named requested in this initiative, and had to report them as not computable from existing carriers.

## Plan
1. Add explicit, named timestamps to the attempt record, written by the parts of the pipeline that already know them: worker dispatch (`dispatched_at`), worker process exit (`worker_exited_at`, distinct from the existing `ended_at` which is fan-in-inclusive), fan-in lock request and acquire (`lock_requested_at`, `lock_acquired_at` — a real wait, not the broken field), suite start/end (already exist in the fan-in step trace; link them by run id into the attempt record rather than requiring a second join), fan-in landed/failed (`fanin_ended_at`).
2. Task-level: `first_dispatched_at` (already derivable), and a `ready_at` (when the task entered the ready pool, before first dispatch) persisted on the task's own history rather than recomputed from git log greps (the diagnosis had to parse commit messages for this, which is fragile — besides, promotion/driver already knows this moment).
3. Both attempt and task records distinguish terminal states (done/needs-human/superseded) from in-progress. An in-progress task is NEVER included in a duration statistic — its carrier record should make this structurally obvious to a reader (a `terminal: false` field, not an inferred absence).
4. Right-censoring is explicit: a statistics consumer reading N finished tasks in a window must also see, for that same window, the count and ages of tasks that have an attempt but no terminal event yet. Already partially demonstrated ad hoc in this diagnosis; needs a reusable query, not a bespoke script each time.

## Acceptance Criteria
- [ ] AC1: a real attempt's record (on a natural dispatch, not a forced one) carries all five new timestamps, each independently verified against direct evidence (process start/exit time from /proc or the dispatch log, fan-in step-trace timestamps) — not inferred (pasted).（待外部）
- [ ] AC2: lock wait computed from the new fields is sane: `0 <= lock wait <= attempt duration` holds for ≥20 consecutive real attempts (pasted; this would have caught the broken field in this diagnosis).（待外部）
- [x] AC3: a reusable read-only query reports, for a given window: finished-task duration stats, right-censored in-progress count/ages, and queue-wait stats, matching this diagnosis's structure. Run against the same window as this diagnosis and compared number-for-number (pasted).
- [x] AC4: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC4 checked with pasted evidence. No existing field is removed; the broken lock-wait field is either fixed in place (with a negative-control showing the old computation was wrong) or replaced and marked deprecated, not silently left broken next to the new one.

## Evidence

### 断掉的到底是哪一环（这是本任务的核心判断，不是猜测）

旧读法把 per-run 过程日志 `.quay/fan-in-<task>-<runId>.log` 里 `acquire-fan-in-lock` 步的 `wall_ms`
当作「**这一次尝试**的排队时延」（`fan-in-queueing-model.ts` 的文档就是这么写的）。算术没错、
值也没错——**错的是归属键**：那个文件的身份是 `(task, runId)`，而常驻 driver 的 `runId` 是
**进程级常量**，不是尝试级常量。实测四条直接量：

```
.quay/worker-outcome.jsonl 里 run_id = "wk-prod-anchor" 的尝试         → 1148 条
同一 runId 覆盖的任务数（.quay/fan-in-lock-events.jsonl 按 taskId 去重） → 635 个
同一 runId 的 acquire 事件数                                          → 986
635 个 fan-in-<task>-wk-prod-anchor.log 中有 200 个装着 **多轮** acquire
```
⇒ 「取最后一组 acquire/release」会跨轮配对，把**另一轮**的锁等待记到这次尝试头上。

### 负控制（旧计算错在哪，可复算）

对 `.quay/worker-outcome.jsonl` 里**每一条**有窗口内 acquire 的记录，同时算两个口径并比对
（新口径 = 记录自己的 `ts` 落在该尝试 `[started_at, ended_at]` 窗口内的那一条 acquire；
旧口径 = 既有的 `readFanInLockHold(root, task, runId)`）：

```
attempts with an in-window acquire:                              2173
legacy (task,runId) join MISMATCHES the attempt window:           946   (43.5%)
of those, the OLD acquire timestamp lies OUTSIDE the attempt window: 946  (100%)
{"task":"gap-retire-governance-group-merge-into-bucke","run":"wk-prod-1788056585",
 "attempt_s":"2805","window_acquire":1788058830328,"old_acquire_ms":1788095578000,
 "old_outside_attempt":true,"old_hold_s":1241}
```

样本那条：尝试本身长 2805s（约 47 min），旧口径给出的 acquire 时刻落在它**之外 10.2 小时**。
这正是诊断报告的形态（值 > 整段尝试），机制在此复现。新记录把旧口径的读数**同名并存**在
`legacy_lock_join`（`mismatch` 三态）里，故这条负控制由载体本身携带、任何读者可复算。
⛔ 既有字段一个没删；`started_at` 与新增的 `dispatched_at` 是**同一个 startedAtMs 单一来源**的两个名字
（载体里逐字相等，测试钉住），故不存在「两个同义字段各算一次」的漂移面。

### AC3 — 可复用只读窗口查询（`plugin/scripts/duration-report.ts`，新增）

同一窗口（2026-10-07 .. 2026-10-14，与诊断同日）实跑（⛔ 只读，不改任何载体）：

```
attempts (finished in window: 362)
  attempt        n=362  min=58.5s  median=914s  p90=2151s  max=9514s  mean=1193s
  implementation n=0  NOT-EVALUATED   (dispatched_at → worker_exited_at)
  fan-in         n=0  NOT-EVALUATED   (worker_exited_at → fanin_ended_at)
  lock wait      n=0  NOT-EVALUATED   (lock_requested_at → lock_acquired_at; 新窗口口径)
  suite          n=0  NOT-EVALUATED   (suite_started_at → suite_ended_at)
  final_state    exited-not-landed=128 completed=218 failed=16
right-censored · in-flight attempts: 5   ages n=5  min=398s  median=1809s  p90=4460s  max=8108s
tasks (in window: 224 finished; right-censored set: 5)
  queue wait     n=183  min=17.9s  median=122s  p90=1242s  max=9589s  mean=443s   (ready_at → first dispatch)
  task span      n=227  min=341s  median=1390s  p90=4662s  max=46303s  mean=2529s
```

**number-for-number 对照（同一窗口）**：诊断报「整段尝试中位 ~18 min / 锁等待 P90 264 min 且大于整段」。
本查询在同一窗口报 **attempt median = 914s ≈ 15.2 min**（与诊断同量级，差异来自窗口口径）；
「锁等待大于整段」这条被**钉成负控读数**：`legacy_lock_join.comparable=2173 / mismatched=946`（上节）。
⇒ 诊断报得出的（attempt 中位）与新查询一致；诊断报不出的三段（实现 / fan-in / 锁）现在是**具名读数**，
且在**旧记录**上如实报 `NOT-EVALUATED`（⛔ 不折成 0——见渲染行 `n=0 NOT-EVALUATED`）。
套件段同样具名（`suite n=0 NOT-EVALUATED`），非「跳过」。

**右删失是并列输出而不是脚注**：同一窗口 224 个已完成任务之旁，另报 5 条 `terminal=false` 的
在飞尝试（年龄 398s..8108s）与 5 个 `terminal=false` 的在飞任务（年龄自 `ready_at` 起算）。
`ready_at` 取自**已有载体** `.quay/task-status-events.jsonl` 的 `to:"ready"` 事件（⛔ 不 grep 提交主题）；
`first_dispatched_at` 取自尝试记录（新记录用 `dispatched_at`，旧记录回退同名同源的 `started_at`，
且回退发生过就在报告里计数报出）。判定「有尝试」时**同时**认「有已落盘 attempt」与「此刻有在飞派发」——
只数前者会把正在跑的任务整个漏掉，而那正是右删失要看见的那一批。

### AC4 — scoped gate（`scripts/test.sh --for-task <this task> --allow-thin`）

```
EXIT=0
ℹ tests 155   ℹ pass 155   ℹ fail 0
PASS: no new task-file bypass — 39 hit(s), all within the allowlist
PASS: all 21 violation(s) are baselined in plugin/test-isolation-violations.txt
PASS: every test file uses node:test or is a listed legacy exemption; … new files declare @test-group.
PASS — every declared landing target == forward branch 'develop' (0 violations)
PASS — embeddedInterpreterLines=6566 ≤ 6566, duplicateCopies=0 ≤ 0
```
其中新增测试：`worker-driver.test.mjs` 4 条（含「同一 (task,runId) 两轮 ⇒ 旧口径张冠李戴」的负控制）、
`duration-report.test.mjs` 8 条（三态 / 右删失 / 载体缺席 / 窗口解析）。两条既有静态棘轮要求的是
**修**而不是往 baseline 加：`tmp-leak-pairing-check` 与 `test-isolation-check` 都是 shrink-only，
故临时目录改为「登记 + top-level `after()` 载体清理」；`task-file-bypass-check` 的白名单加一条
（本文件的**对象**就是任务库的终态分布，与 `gate-event-coverage-check.ts` 同一处置）。

### AC1 / AC2 为什么「待外部」（结构性，不是拖延）

两条都要求**生产载体上、我的代码生效之后**的自然派发记录：AC1 要一条真实派发的尝试带上五个新时间戳，
AC2 要**≥20 条连续真实尝试**满足 `0 ≤ lock wait ≤ attempt duration`。本任务的代码在 fan-in 落地前
不进入生产 driver（常驻 driver 从主检出加载），所以实现完成的那一刻，生产载体里**必然**还没有这样的记录
（硬规则 4 推论三：判据要求的是落地后的累积事实）。⛔ 我没有用 fixture 伪造这些记录，也没有勾这两条。

- **承接者**：常驻 promotion→worker→fan-in 链路——落地后任何一次自然派发的 worker 都会写出带新字段的
  `worker-outcome.jsonl` 记录；AC2 的 ≥20 条由随后的 20 次自然派发累积。
- **验证命令（落地后可直接跑）**：
  - AC1：`node --experimental-strip-types plugin/scripts/duration-report.ts --root <主检出> --since <落地时刻> --json`，
    取任一 `final_state` 非空的尝试，核其 `dispatched_at → worker_exited_at` 与
    `.quay/fan-in-<task>-<runId>.log` 里 acquire/suite 记录的 `ts` 一致（`implementation n>0` 即证明五段都落了盘）。
  - AC2：同一条命令，`lock wait` 段 `min >= 0` 且 `max <= attempt max`，且 `n >= 20`。
  - 反例判据：若 `legacy_lock_join.mismatched` 仍在增长，或出现 `lock_wait > attempt`，则本修复**假**。

## Touches
- tasks/gap-attempt-task-phase-timing-fields-incomplete-lock-wait-field-broken.md
- plugin/scripts/worker-driver.ts
- plugin/scripts/driver-runtime.ts
- plugin/scripts/duration-report.ts
- plugin/test/worker-driver.test.mjs
- plugin/test/duration-report.test.mjs
- plugin/scripts/capability-catalog-declarations.json
- plugin/scripts/task-file-bypass-check.ts
