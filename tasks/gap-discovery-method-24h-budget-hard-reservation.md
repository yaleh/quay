---
id: gap-discovery-method-24h-budget-hard-reservation
title: "discovery-method 24h model-call ceiling is soft: overshoot, failure
  under-count, no cross-process atomicity — make it a hard pre-spawn
  reservation"
status: ready
labels:
  - gap
  - discovery-method
  - budget-safety
parent: null
children: []
extra: {}
---
## Proposal
The 24h model-call ceiling of the discovery-method routine (`max_model_calls_per_24h`, added by `gap-discovery-method-routine-interval-60m-temporary`) is a soft check. It is not a hard budget. A 2026-10-12 operator audit of `plugin/scripts/discovery-method-routine.ts` found three defects:

1. **Overshoot.** The ceiling is consulted ONCE, before the round (`used >= cap`, ~:743). The round then spends up to the full per-round `max_model_calls` (6), not `cap − used`. With `used = 23` and cap 24, a round may spend 6 ⇒ 29.
2. **Silent under-count on failure.** Usage is reconstructed only from `scan-round` lines (`modelCallsInWindow`, ~:377). Two failure paths spend model calls and then return WITHOUT appending a line, so the spent calls are invisible to every later 24h check:
   - a wall-clock breach after reflection or during generalization (~:839, ~:935, "nothing appended");
   - a reflection refusal after calls.
   The same holds for a process crash or kill mid-round.
3. **No cross-process atomicity.** There is no lock or reservation (`lock|flock|O_EXCL` matches 0 in the file). The resident driver and a manual `--once` (which counts against the same budget by design) can both read the same `used` and both proceed.

Also unclear today: what a "model call" counts.
- The counter is `calls.length` per `modelCall` invocation, i.e. one launcher subprocess.
- The reflection seam is `liveModelFactory({tools:"", maxTurns:null})` (~:1080).
- The generalization verifier is described as `--tools Read,Grep` with a turn budget (discovery-reflection.mjs ~:911).
- So one counted call may be several underlying API turns, and the config key does not say which it bounds.

## Plan
1. **A shared, durable, atomic reservation ledger** for this routine's model calls (a carrier under the shared checkout's `.quay/`, declared in `docs/carrier-registry.json` if that registry covers it):
   - Before EVERY `modelCall` (reflection and verification alike), reserve one unit under a cross-process exclusive lock. Use a lock primitive with stale-holder recovery: a crashed holder must not wedge the budget forever, and recovery must be bounded and logged.
   - The reservation is granted only if the trailing-24h sum of reservations is below the cap.
   - The reservation is written BEFORE the subprocess spawns, and is never deleted. Its outcome (completed / failed / timeout / crashed-unknown) is appended afterwards.
   - A reservation with no outcome counts as SPENT.
   ⇒ Failure, timeout and crash cannot under-count.
2. **Per-round cap = min(`max_model_calls`, cap − used_at_reservation)**, enforced by the reservation itself rather than by a pre-round snapshot. When a reservation is refused mid-round:
   - stop further calls;
   - report `skipped_budget` with reason `BUDGET_24H`;
   - persist what was done.
   The round's own carrier/last-run semantics are unchanged (see 5).
3. **Counting semantics, explicit.** The config key bounds launcher **subprocess invocations**. Each reservation records the realized underlying turns/requests when the stream reports them (`num_turns` or equivalent), or `null` with a reason.
   - Bound every subprocess's internal turns: reflection with `--tools ""` ⇒ document it as 1 turn; the verifier gets an explicit `maxTurns` from config with a stated default.
   - So the worst-case API turns per 24h = cap × maxTurns is a computable, documented number.
   - Do not claim to bound API requests unless it is actually bounded.
4. **Manual and driver share the same ledger.** `--no-model` reserves nothing. `--force` still never bypasses the ceiling.
5. **Unchanged behaviour:**
   - the kill switch (`enabled:false`) ⇒ zero reservations and zero spawns;
   - `halted` ⇒ zero;
   - a budget refusal is a `not-evaluated:budget-24h` Fact, never shaped like idle;
   - manual rounds still never advance `.quay/routine-last-run.json`;
   - `interval_until` expiry behaviour is unchanged.
7. **Deployment.** The anchor's self-refresh watches only the kind's driver file plus the shared kernel files, NOT routine modules (`driver-runtime.ts` `watchedSourceFiles`). A delta confined to `discovery-method-routine.ts` / `discovery-reflection.mjs` would land inert, with production running the old soft check indefinitely.
   ⇒ The delta must also touch `plugin/scripts/quality-gate-driver.ts`. A real change is preferred, e.g. its discovery-method assembly line printing the hard-budget settings, which is the line the real-execution AC reads.
   Never restart via `pkill -f`.
6. **Migration.** The trailing-24h usage at cut-over is seeded from the existing `scan-round` lines (the 2026-10-12 14:59:56Z round's 6 calls), so the window is not reset to zero by the change.

## Acceptance Criteria
- [x] `node --test` on the routine's test file exits 0, covering (a)–(j).
  `node --test plugin/test/discovery-method-routine.test.mjs` → `ℹ tests 48 · pass 48 · fail 0`（原 34 条全绿 + 新增 14 条）:
```
✔ AC1(a) — used=23, cap=24, a round requesting 6 ⇒ exactly 1 call, 5 skipped BUDGET_24H, ledger total 24
✔ AC1(b) — TWO REAL PROCESSES, 20 used, each requesting 6 ⇒ combined 4 calls, never more
✔ AC1(c) — a crash AFTER the reservation and BEFORE the outcome stays SPENT
✔ AC1(d) — a model call that THROWS or TIMES OUT is counted, with its own outcome class
✔ AC1(e) — a wall-breach round appends NO scan-round line, and its calls are STILL counted
✔ AC1(f) — the window is HALF-OPEN (now−24h, now]: excluded AT the boundary, included 1ms inside
✔ AC1(g) — enabled:false, halted and --no-model ⇒ ZERO reservations
✔ AC1(h) — a manual `--force` round at the cap is REFUSED; `--force` bypasses the GATE, not the BUDGET
✔ AC1(i) — a MID-ROUND budget refusal persists what was done but does NOT advance the production last-run
✔ AC1(j) — a lock held by a DEAD pid is recovered at once; a merely OLD one after the bound; both LOGGED
✔ MIGRATION — the ledger's trailing-24h total at cut-over EQUALS the carrier's trailing-24h model_calls sum
✔ COUNTING SEMANTICS — one counted call = one subprocess; the turns inside it are bounded per step
✔ COUNTING SEMANTICS — a reservation records the launcher params AND the realized turns, or null WITH a reason
✔ NEGATIVE-CONTROL SUPPORT — the seams the three controls mutate are reachable, and the (b) race is forced deterministically
ℹ tests 48   ℹ pass 48   ℹ fail 0
```
  ⛔ 不是 fixture 回声：这些用例驱动的是**真引擎**（`runReflectionRound` → `reflect`，来自 `docs/analysis/discovery-reflection.mjs`）与**真 ingester**（走真 evidence store），只把 **model seam** 换成桩。AC1(b) 是**两个真进程**（`spawn` 两个子进程，barrier 对齐），不是同进程两个 promise。
  - (a) 断言 `model.calls.length === 1`、`reservations.granted === 1`、`refused === 5`、`refusal_reason === "BUDGET_24H"`、ledger 中 `reserve` 恰 24 条（23 seeded + 1）。
  - (f) 判据半开 `(now−24h, now]`（`inTrailing24hWindow`，唯一谓词，carrier 项与 ledger 项共用）：边界那条 **排除**、`+1ms` **包含**、未来 **排除**，两侧都测。
  - (j) 死 pid 立即回收（实测 <2s，而 stated bound `BUDGET_LOCK_STALE_MS` = 120s）；只老不死的锁过了界才回收；活的且新鲜的锁**永不**被抢（`BUDGET_LOCK_TIMEOUT`，独立取值）。三条都落 `lock-recovered` 行。
- [x] **Negative controls**（每一条都是就地变异 → 跑指定用例 → 贴红 → 从备份还原；还原后 `assert 还原文本 == 变异前文本` 通过，`git diff` 只剩本任务自身的改动）。
```
############ NEGATIVE CONTROL: reserve-after ############（把预占挪到轮末，即旧设计「按轮末结果记账」）
✖ AC1(c) — a crash AFTER the reservation and BEFORE the outcome stays SPENT
✖ AC1(e) — a wall-breach round appends NO scan-round line, and its calls are STILL counted
ℹ tests 2   ℹ pass 0   ℹ fail 2
  AssertionError: the reservation EXISTS — it was written before the spawn
  AssertionError: the round spent one call per unit before it breached

############ NEGATIVE CONTROL: drop-lock ############（`acquireBudgetLock` 直接返回 no-op handle）
✖ AC1(b) — TWO REAL PROCESSES, 20 used, each requesting 6 ⇒ combined 4 calls, never more
ℹ tests 1   ℹ pass 0   ℹ fail 1
  AssertionError: 20 used, cap 24 ⇒ the ceiling grants exactly 4 more, whatever the interleaving (got A=4 B=1)

############ NEGATIVE CONTROL: preround-only ############（恢复「只查轮前快照」：不缩减 per-round cap、不预占）
✖ AC1(a) — used=23, cap=24, a round requesting 6 ⇒ exactly 1 call, 5 skipped BUDGET_24H, ledger total 24
ℹ tests 1   ℹ pass 0   ℹ fail 1
  AssertionError: ⛔ EXACTLY ONE call: the round spends cap − used, not the full per-round max_model_calls
```
  ⛔ (b) 的竞态是**确定性强制**的，没有靠调度器碰运气：子进程把「读 usage → 睡 delay → 写 reserve」写成一个临界区，两个子进程 delay **不同**（30ms / 600ms）并用 barrier 对齐同时起跑。锁在 ⇒ 二者串行，读到的一定是新鲜值，合计恰 4；锁掉 ⇒ 慢的那个读到的 20 一直「有效」到快的那个把预算花光，然后**在已经到顶的 cap 上再追加一条**（A=4 B=1 ⇒ 5 > 4）。
- [x] **Counting semantics**（`## Evidence` §1 有完整 argv 与算式）：
  - config key 的文档含义：`max_model_calls_per_24h` 界定的是 **launcher 子进程调用次数**（一次 `model(...)` seam 调用 = 一个 claude 子进程），**不是** API 请求数。
  - 真 argv（PATH shim 拦在 driver 自己的 launcher 上）：reflection `--tools ""` `--max-turns 1`；verification `--tools Read,Grep` `--max-turns 12`。
  - 24h 最坏 API turns = cap × max(reflection 1, verifier 12) = 24 × 12 = **288**（装配行实打实打出这个数）。
  - ⛔ **不声称**界定 API 请求数：一个 turn 可以发多个请求，本改动没有测量它。
- [x] **Real execution log on the production path**：装配行见 `## Evidence` §2（真二进制起一次，`例程已装配（enabled, interval=60m, …, max_model_calls_per_24h=24 (HARD: pre-spawn reservation …), verifier_max_turns=12, worst_case_api_turns_per_24h=288 …）`）。**自刷新后的生产轮：未读到（待外部）** —— 生产 carrier 上最后一条 `invoked_by:"resident-driver"` 的 `scan-round` 是 `2026-10-12T14:59:56.733Z`，60m 节奏的**下一次到期 = 2026-10-12T15:59:56.733Z**（本卡收尾时刻 2026-10-12T15:54Z，尚未到期）。⛔ 未手工跑一次生产轮去制造读数。
- [x] **Migration reading**：cut-over 时 ledger 的 trailing-24h 合计 **=** carrier 的 trailing-24h `model_calls` 合计。两边都是 **6**（见 `## Evidence` §3），与提案点名的 2026-10-12 14:59:56Z 那一轮的 6 次调用一致。

## Evidence

### 1. Counting semantics — 真 argv 与最坏情形
`liveDiscoveryModel(root, cfg)` 走**真 launcher 路径**（`launchArgv` + `hardenedArgv`），把 driver 自己的 launcher 名 `claude` 换成一个 PATH shim，记录它实际收到的 argv。两次调用的区别就是两条 seam：
```
=== INVOCATION cwd=<worktree>
ARG -n / ARG quay-meta-driver
ARG --tools / ARG                 <- reflection：空 tools
ARG --disable-slash-commands --no-session-persistence --strict-mcp-config
ARG --max-turns / ARG 1           <- reflection：1 turn
ARG --output-format / ARG stream-json / ARG --verbose / ARG -p
STDIN REFLECTION-PROBE
=== INVOCATION cwd=<worktree>
ARG -n / ARG quay-meta-driver
ARG --tools / ARG Read,Grep       <- verifier：Read,Grep
ARG --disable-slash-commands --no-session-persistence --strict-mcp-config
ARG --max-turns / ARG 12          <- verifier：来自 verifier_max_turns（缺省 12）
ARG --output-format / ARG stream-json / ARG --verbose / ARG -p
STDIN VERIFIER-PROBE
```
`seamParamsFor(cfg)` = `{"reflection":{"tools":"","maxTurns":1,"timeoutMs":300000},"verification":{"tools":"Read,Grep","maxTurns":12,"timeoutMs":300000}}`。
worst case = `24 × max(1, 12)` = **288** turns / 24h。
每条 reservation 记录它界定的参数（`tools` / `max_turns`）与**实际** turns：`num_turns` 读得到就记数，读不到记 `null` + 原因（`UNINSTRUMENTED_STREAM` / `STREAM_REPORTED_NO_NUM_TURNS`），**绝不记 0**（0 读起来像「这次调用不要钱」）。

**新增 config key（声明）**：`verifier_max_turns`（整数 ≥1，缺省 `DEFAULT_VERIFIER_MAX_TURNS = 12`）。DoD 的「只允许新增 key」：**`.quay/config.yml` 未改动** —— 该 key 是可选的，生产 config 不声明它即取缺省 12，行为与显式写 12 完全一致（`.quay/config.yml` 本身 gitignored，不在交付 delta 里），故无需也不应改它。其它例程的预算、`interval_until`、既有 config 值一字未动。

### 2. 装配行（真二进制起一次，scratch root）
```
quality-gate-driver: discovery-method 例程已装配（enabled, interval=60m, interval_until=2026-10-19T14:00:00.000Z, max_model_calls_per_24h=24 (HARD: pre-spawn reservation per call, trailing-24h; a reservation with no outcome still counts as spent), verifier_max_turns=12, worst_case_api_turns_per_24h=288 (cap × max(reflection 1 turn, verifier turns))）
```
这一行同时是 **Plan 7 的部署面**：`quality-gate-driver.ts` 新增 `formatDiscoveryMethodAssembly(...)` 并真的用它打印装配行 —— delta 因此触到 anchor 的 `watchedSourceFiles` 里的 driver 文件，自刷新才会发生（只改 routine 模块会静默 inert）。**自刷新后的生产轮读数：未读到（待外部），下一次到期 2026-10-12T15:59:56.733Z。**

### 3. Migration reading（cut-over 不清零）
```
$ node .quay/ac-dm-budget/migration-read.mjs /data/home/yale/work/quay
{
 "root": "/data/home/yale/work/quay",
 "now": "2026-10-12T15:50:20.098Z",
 "ledger_missing": true,                 <- ledger 尚不存在（还没跑过新代码）
 "carrier_scan_rounds": 6,
 "ledger_trailing_24h_total": 6,         <- ledger 侧的 trailing-24h 读法
 "ledger_reservations": 0,
 "carrier_legacy_model_calls": 6         <- carrier 侧的 trailing-24h model_calls 合计
}
```
两侧都 **6** ⇒ 窗口不被这次改动重置。机制：`scan-round` 行**没有** `reservations` 字段的是 legacy 行，`modelCallsInWindow` 照旧计；本 build 写的行带 `reservations`，由 ledger 的 reservation 逐条计，carrier 项**跳过**它 —— 两个读法永不重复计同一次调用（重复计是另一个方向的错，同样不可接受）。

### 4. 交付面
```
M docs/analysis/discovery-reflection.mjs   (re-export parseVerifierStream —— routine 读 num_turns 的唯一来源)
M docs/carrier-registry.json               (登记 discovery-method-model-budget.jsonl)
M plugin/scripts/discovery-method-routine.ts
M plugin/scripts/quality-gate-driver.ts    (装配行 = 部署面)
M plugin/test/discovery-method-routine.test.mjs
```

## Definition of Done
- All AC ticked with output pasted.
- `scripts/test.sh --for-task gap-discovery-method-24h-budget-hard-reservation` green.
- No change to other routines' budgets, to `interval_until`, or to `.quay/config.yml` values beyond any NEW key the plan requires (declare it in the task evidence).

## Touches
- tasks/gap-discovery-method-24h-budget-hard-reservation.md
- plugin/scripts/discovery-method-routine.ts
- plugin/scripts/quality-gate-driver.ts
- plugin/test/discovery-method-routine.test.mjs
- docs/analysis/discovery-reflection.mjs
- plugin/test/discovery-reflection.test.mjs
- docs/carrier-registry.json
- .quay/config.yml
