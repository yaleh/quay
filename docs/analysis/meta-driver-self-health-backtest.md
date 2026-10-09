# meta-driver self-health backtest

Offline, deterministic (zero-LLM) backtest against the real production carrier
`.quay/meta-driver-round.jsonl` (53,056 lines on this host as of 2026-10-09). Regenerate with
`node docs/analysis/meta-driver-self-health-backtest.mjs --in .quay/meta-driver-round.jsonl --out
docs/analysis/meta-driver-self-health-backtest.results.json`. Implements
`tasks/gap-meta-driver-self-health-backtest.md`.

## A correction made before trusting any result

The carrier's semantic-attempt fact was **renamed mid-history**: `meta-driver` (used
2026-09-06 → 2026-09-29; states `verified`/`failed`/`not-evaluated`) and `meta-review`
(introduced 2026-09-14, overlapping the old name through 2026-09-29 under the **same** anchor
`run_id` — a live source self-refresh renamed the fact in place, this was not a process
handoff). A first draft of the extractor only matched `name === "meta-review"` and concluded
**zero `verified` states ever existed** — which was wrong: it silently dropped the real
2026-09-12..09-14 outage (a *different* failure mode, "probe spawn error: spawn E2BIG") and
understated the true outage start by almost 2 days. Fixed by treating both fact names as the
same logical attempt timeline (verified: 0 of 2,319 such facts lack a `state` key, so the two
names are structurally identical). This is exactly the "give the predicate a known-true sample
before trusting a zero/nonzero count" check this repo's own methodology calls for — recorded
here because it changes the headline number, not as a footnote.

## Real history, corrected

- **Last successful (`verified`) semantic round: 2026-09-12T02:21:57.766Z.**
- **Outage start (first non-`verified` attempt in the sustained streak running to EOF):
  2026-09-12T02:37:09.240Z** — only ~15 minutes after the last success, not 2026-09-14 as an
  earlier reading (keyed only on the `meta-review` name) suggested.
- The outage has **two distinct, sequential root causes**, neither ever caught: first
  `"probe spawn error: spawn E2BIG"` (147 `not-evaluated` occurrences, 2026-09-12 → 2026-09-13),
  then `"routine threw: snapshotTrackedChanges is not defined"` (1,739 `failed` occurrences,
  2026-09-14 → 2026-10-09, continuous as of this backtest).
- Across the full history: 2,319 semantic attempts, 419 verified, 1,753 failed, 147
  not-evaluated (folded into the 1,753+147≈1,900 non-verified total used by the rules below).
- **27 days of continuous non-verified state, zero detection by any existing mechanism.**

## Detection delay and false-alarm cost, by rule

| rule | param | detection delay | false alarms (full 53k-round history) |
|---|---|---|---|
| count | N=1 | 0.00h | 6 |
| count | N=3 | 0.67h | **0** |
| count | N=5 | 1.34h | 0 |
| count | N=10 | 3.02h | 0 |
| count | N=20 | 6.37h | 0 |
| window | 15m | 0.00h | 5 |
| window | 30m | 0.34h | **0** |
| window | 1h | 1.01h | 0 |
| window | 3h | 3.02h | 0 |
| window | 6h | 6.03h | 0 |
| window | 24h | 23.84h | 0 |

## Headline finding

The smallest rules with **zero historical false alarms** are **count N=3** (fires after 3
consecutive non-verified attempts) and **window T=30m** (fires 30 minutes after the last
verified attempt) — both would have caught the real outage with a **detection delay under 1
hour**, against the ~27 days it actually took to go undetected. N=1 / T=15m detect instantly but
cost 5-6 transient false alarms over the full history (isolated non-verified blips that
self-recovered) — not free, but still cheap, and a reasonable alternative if a 20-40 minute
delay is considered too slow.

This clears the decision-gate threshold declared in the task's Plan step 9 (detection delay ≤24h
AND false-alarm count ≤2) by a wide margin at N≥3 / T≥30m. **Recommendation: a follow-up,
independent, minimal production-liveness-check task is warranted** — kept strictly separate
from this task and from any `meta-driver.ts` refactor, per the task's own non-goals.
