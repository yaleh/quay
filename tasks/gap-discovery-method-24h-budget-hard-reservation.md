---
id: gap-discovery-method-24h-budget-hard-reservation
title: "discovery-method 24h model-call ceiling is soft: overshoot, failure
  under-count, no cross-process atomicity — make it a hard pre-spawn
  reservation"
status: todo
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
6. **Migration.** The trailing-24h usage at cut-over is seeded from the existing `scan-round` lines (the 2026-10-12 14:59:56Z round's 6 calls), so the window is not reset to zero by the change.

## Acceptance Criteria
- [ ] `node --test` on the routine's test file exits 0, covering:
  - (a) used=23, cap=24, a round requesting 6 ⇒ exactly 1 call made, 5 skipped with `BUDGET_24H`, ledger total = 24;
  - (b) two concurrent processes (a real second process, not two promises in one process) each requesting 6 with 20 used ⇒ combined calls made = 4, never more;
  - (c) a crash after reservation and before outcome (kill the child process) ⇒ after restart that reservation still counts as spent;
  - (d) a model call that throws or times out ⇒ counted;
  - (e) a wall-breach round that appends no `scan-round` line ⇒ its calls still counted by the next round;
  - (f) window boundary: a reservation at exactly now−24h is excluded and one at now−24h+1ms is included (state the chosen inclusivity and test both sides);
  - (g) `enabled:false`, `halted` and `--no-model` ⇒ zero reservations;
  - (h) manual `--force` at cap ⇒ refused;
  - (i) last-run not advanced by manual rounds or by budget refusals (existing cases still green);
  - (j) stale-lock recovery: a lock held by a dead pid is recovered within a stated bound, and the recovery is logged.
- [ ] **Negative controls**, each in a scratch copy, pasting the red output for each and then restoring:
  - drop the pre-spawn reservation (reserve-after) ⇒ (c)/(e) go red;
  - drop the lock ⇒ (b) goes red, or state honestly if the race is not reproducible and how (b) was forced deterministically;
  - restore the pre-round-only check ⇒ (a) goes red.
- [ ] **Counting semantics:** paste the config key's documented meaning, the reflection and verifier `maxTurns` actually passed (read from the launcher argv on a real invocation), and the computed worst-case API turns per 24h.
- [ ] **Real execution log on the production path:** after landing and the driver self-reload (paste the driver's assembly line showing the hard-budget settings), paste:
  - the reservation-ledger lines and the `scan-round` line of the first resident-driver round that makes ≥1 model call;
  - ledger total vs the sum of `scan-round` `model_calls` in the window.
  If no such round has run yet, write 未读到（待外部） with the next due time; do not run a manual production round to manufacture one.
- [ ] Migration reading: ledger trailing-24h total at cut-over equals the carrier's trailing-24h `model_calls` sum. Paste both.

## Definition of Done
- All AC ticked with output pasted.
- `scripts/test.sh --for-task gap-discovery-method-24h-budget-hard-reservation` green.
- No change to other routines' budgets, to `interval_until`, or to `.quay/config.yml` values beyond any NEW key the plan requires (declare it in the task evidence).

## Touches
- tasks/gap-discovery-method-24h-budget-hard-reservation.md
- plugin/scripts/discovery-method-routine.ts
- plugin/test/discovery-method-routine.test.mjs
- docs/analysis/discovery-reflection.mjs
- plugin/test/discovery-reflection.test.mjs
- docs/carrier-registry.json
- .quay/config.yml
