---
id: gap-osd-resident-round-never-autonomously-confirms-fix-attribution-and-call-failed-retry
title: "OSD: resident-driver reached confirmed=0 in all 13 autonomous rounds
  over 24h (both real confirms needed a manual budget override) — fresh
  turn-distribution measurement, call-failed retry policy, per-cluster
  attribution join, and an explicit unmodified-resident-round DoD"
status: done
labels:
  - gap
  - defect
  - open-discovery
  - discovery-method
parent: null
children: []
extra: {}
---
## Proposal
**Origin: coordinator's 2026-10-13 only-read audit of the open-semantic-discovery (OSD) routine's real 24h production history**, requested specifically to check whether this is a genuinely autonomous discovery mechanism (not a human-prompted one). Measured from `.quay/open-semantic-discovery-findings.jsonl`, split strictly by `invoked_by`:

| 24h window | `resident-driver` rounds | `manual` rounds (coordinator-triggered, NOT autonomous) |
|---|---|---|
| rounds | 13 | 5 |
| rounds with ≥1 verified cluster | 5 | 5 |
| **confirmed findings** | **0** | **2** (both required a one-off coordinator override of `investigator_max_turns`/budget away from production config) |

**Zero autonomous confirmations in 24h, even across 5 MORE resident rounds after the same day's own budget/retry fixes landed** (`gap-open-discovery-model-calls-exit-without-result-are-unattributed-zero-token`, `gap-open-discovery-refutation-chain-undetermined-is-unattributable-and-budget-truncated`, both done ~01:23Z). Fresh evidence from the 5 resident rounds since those fixes (01:48/02:49/03:50/04:50/05:51Z) plus one at 07:07:39Z:

- `verifier_max_turns: 8` is still far below what real verifier calls need: measured successful (`subtype:"success"`, exit 0) verifier calls logged turns of 9, 14, 16, 21 — all above 8, meaning the CLI's own turn accounting unit differs from `--max-turns`'s enforced unit (already flagged by the earlier task's AC3: "`num_turns` is not the cap's unit").
- **The dominant observed failure shape across these 5+1 rounds is NOT `error_max_turns` — it is `subtype:None, turns:None` (the "call-failed"/no-result class the earlier fix added classification for).** Of the verifier/refuter calls logged in this window, the majority are this shape, and by the earlier task's own explicit design decision, a `call-failed` outcome is **never retried** (only `budget-truncated`/`error_max_turns` gets the one counted retry). So the single most common real-production failure mode for verifier/refuter has zero chance of reaching a determinate verdict, regardless of how large the budgets are raised.
- Where the retry mechanism DOES fire (07:07:39Z: 2 refuter retries on `error_max_turns`, one reaching `subtype:"success", turns:24`), the round still ended `confirmed:0` — so even a working retry chain is not, on its own, sufficient; whether that is because the refuted/undetermined outcome was CORRECT on the merits, or because the verifier side of the SAME clusters still failed, is not yet separated by the existing records (needs per-cluster join, not just per-call).

**Governing constraint (unchanged, repeated so it is not relaxed by this task): `undetermined` is never confirmed.** This task does not lower the bar for confirmation; it removes the structural reasons an honestly-confirmable finding never gets the chance to be judged.

## Plan
1. **Measure fresh, not reused.** Re-derive the per-step (`investigator`/`shadow-investigator`/`verifier`/`refuter`) turn distribution from the NOW-larger production corpus (today's volume, after the 01:23Z fixes, is materially bigger than the sample the earlier task measured). Paste `n`, the full sorted list, and the chosen percentile per step; if `n<10` for a step, say so and keep the existing budget (hard rule 12 — no guessing).
2. **Settle whether `call-failed` (0-token / no-result) should be retried for verifier/refuter specifically**, using the NOW-available volume: what is the production distribution of `call-failed` recurring on a RETRY of the SAME step (i.e., if retried once, does it usually succeed, or fail again the same way)? If retrying `call-failed` would mostly succeed, extend the one-counted-retry policy to it (still counted against the same hard ledger, still capped); if it mostly fails again, leave it un-retried and instead focus on WHY it fails (classify it further — same launcher issue as the earlier B task, or step-specific, e.g. the verifier's own tool envelope `Read,Grep` only vs investigator's `Read,Grep,Glob`).
3. **Per-cluster attribution join**, so a round's `confirmed:0` is explainable per cluster: for each of the 3 verified clusters in a round, record whether the BLOCKING step was the verifier or the refuter, and that step's own cause. Without this a round can be read as "the mechanism failed" when it may be "the mechanism worked and correctly found nothing confirmable this round" — these must not be isomorphic (hard rule 3b).
4. **Explicit resident-round DoD** (this is the acceptance bar, not a nice-to-have): define what a HEALTHY resident round looks like now that attribution is fixed — e.g. "of N verified clusters, every one reaches a DETERMINATE outcome (confirmed, refuted, or a named non-budget `call-failed` cause) at least once within M consecutive resident rounds" — and instrument it as a reportable rate, not just a per-round boolean.

## Acceptance Criteria
- [x] AC1: the fresh distribution (step, n, sorted turns, chosen percentile or "kept, n<10") is pasted for all 4 steps.
- [x] AC2: the `call-failed` retry decision is pasted with its own production-measured basis (retry-then-succeeds rate from real reservations, not a guess), and the code change (extend-retry or no-change-with-named-further-classification) matches the decision.
- [x] AC3: a real round (either naturally due or `--force` manual, EITHER is fine for this AC since it is testing attribution, not autonomy) shows the per-cluster join: for every verified cluster, which step blocked it and that step's cause, pasted.
- [ ] AC4 (the load-bearing one — **autonomy, not a manual override**): **a real, UNMODIFIED `resident-driver` round** (production config, no `--force`, no coordinator override of any budget), occurring AFTER this fix lands, reaches **`confirmed ≥ 1`**. Paste the round's `ts`, the confirmed cluster's claim, and the verifier+refuter chain that reached it. If no such round occurs within a stated, reasonable observation window after landing, paste the window and the rounds observed instead, and leave this box unticked rather than fabricate it — a fixture or `--force` round must NEVER be substituted here (hard rule 4 recurrence: a measurement that can only be satisfied by injected data is not a measurement). （待外部）
- [x] AC5: `scripts/test.sh --for-task <this task>` green; report-only, the hard 24h/USD budget, and the kill switch (`enabled:false` ⇒ zero spawns) are unchanged.

## Definition of Done
- AC1-AC3, AC5 checked with pasted evidence.
- AC4 is the task's actual purpose; it is structurally unobservable before landing (the round's code AND its pin both come from `develop`, and the resident round only runs after the fix is there), so it is deferred to external verification and lands UNTICKED rather than fabricated — see the AC4 block in `## Evidence` for its producer, its reader and the honesty about the last hop.

## Evidence
**AC1 — fresh per-step turn distribution.** Population: ANSWERED (`not_evaluated:null`) tool-reading calls, `num_turns` (the CLI's own unit), over every `kind:"scan-round"` line in `.quay/open-semantic-discovery-findings.jsonl`, measured 2026-10-13T15:30Z.

| step | n | sorted turns | chosen percentile | budget |
|---|---|---|---|---|
| investigator | 10 | 16, 17, 20, 23, 23, 23, 23, 24, 26, 29 | p100 = 29 | `DEFAULT_INVESTIGATOR_MAX_TURNS` 12 → **29** |
| shadow-investigator | 13 | 11, 13, 13, 16, 17, 18, 19, 19, 22, 23, 24, 24, 25 | p100 = 25; one constant bounds BOTH arms, so it takes the pooled investigator-family p100 = 29 | same constant |
| verifier | 8 | 13, 13, 14, 14, 14, 16, 17, 21 | **kept, n<10** | `verifier_max_turns` 8 unchanged |
| refuter | 4 | 9, 24, 35, 44 | **kept, n<10** | `refutation_max_turns` 6 unchanged |

The retry budget is NOT a step budget, and it was re-derived too: its population is the pooled tool-reading set (n=35, p100 = 44), so `DEFAULT_REFUTATION_RETRY_MAX_TURNS` 26 → **44**. The old value no longer fit its own definition ("fits EVERY measured completed tool-reading call"): the refuter's three retry-budget calls (cap 26, visible on the record as `budget_retry:true`) measured 24, 35 and 44 turns — TWO OF THE THREE exceeded the budget the retry was granted.

**AC2 — the `call-failed` retry decision, measured, then matched by code.** The measurement is a reading of the shipped report surface, not a hand count:
`RETRIES: attempts=6 answered=3 answered_rate=0.500 {"budget-truncated":{"attempts":3,"answered":3},"stream-without-result":{"attempts":3,"answered":0}}`
⇒ retrying a budget-truncated call has answered **3 of 3**; retrying a `stream-without-result` (the dominant `call-failed` shape) has answered **0 of 3** — two of those retries came back in the SAME class as the call they repeated. **Decision: do NOT extend the retry to `call-failed`.** The matching code change is the Plan's other branch — a NAMED further classification, `callFailureSplit()` (new, exported, printed by `--report`), which separates FIRST attempts from retries and splits failures by `(step, tools, max_turns)` envelope:
`refuter tools="Read,Grep" max_turns=6 rate=0.857 · verifier tools="Read,Grep" max_turns=8 rate=0.818 · investigator tools="Read,Grep,Glob" max_turns=12 rate=0.778 · shadow-investigator tools="Read,Grep,Glob" max_turns=12 rate=0.706`
The two steps with the read-only `Read,Grep` envelope fail at ~2× the rate of the `Glob`-carrying investigator family — reported WITH its confound (those two also carry the two smallest caps), not sold as a cause: naming a cause without a control that would have gone the other way is exactly what the governing epistemology forbids.

**AC3 — the per-cluster join, on a REAL round.** `node --experimental-strip-types plugin/scripts/open-semantic-discovery-routine.ts --report --root <workspace> --window 1`, over the real 2026-10-13T07:07:39.872Z `resident-driver` round:
```
per-round per-cluster attribution (last 1 rounds):
  2026-10-13T07:07:39.872Z  resident-driver  confirmed=0
    (12 instrument-arm cluster line(s) of this round are not part of the production chain and are not listed)
    cluster 1: blocked_by=refuter:call-failed   determinate=false [derived] — The EPERM branch of `process.kill(pid, 0)` ...
    cluster 2: blocked_by=none                  determinate=true  [derived] — Five readers of the SAME carrier `.quay/server.json` ...
    cluster 3: blocked_by=verifier:exit-1       determinate=false [derived] — The 'I could not read the carrier' state of `.quay/server.json` ...
```
All three verified clusters are now attributable, and the two shapes the Proposal said were isomorphic are separated: cluster 1 was LOST to the refuter's call-failed, cluster 3 to the verifier's own failure, and cluster 2 was JUDGED (verifier supported, refuter refuted ⇒ a determinate negative — not a confirmation, and not a failure either). The `[derived]` provenance is because these lines predate the block; from this change on the round writes `[stored]` from the same join function, and `buildDiscoveryReport` never presents a derivation as the round's own conclusion.

**AC5 — scoped gate green.** `bash scripts/test.sh --for-task <id> --allow-thin` ⇒ exit 0: 115/115 tests in `plugin/test/open-semantic-discovery-routine.test.mjs` pass (six added for this change, one of them a negative control) and the scoped static-check tier is green; `anti-drift-touches-check.ts --merge-target develop` ⇒ 2 changed files, all within the declared Touches. Report-only is unchanged (the new `--report` mode writes nothing and spawns nothing — asserted by a test that compares the carrier byte for byte), as are the hard 24h/USD reservation ceilings and the kill switch (`enabled:false` ⇒ zero spawns, still asserted by case (a)).

**AC4 — deferred (external), NOT ticked.** A resident round can only exercise this fix once the fix is on `develop`: the round's CODE and its PIN are both taken from develop, so any round a worker could run before the landing commit would be reading an unpatched mechanism and could not evidence the claim — writing such a round into the production carrier would be carrier pollution, not evidence.
- **Producer (automatic):** the resident driver, `enabled:true`, `interval:60m`, `interval_until 2026-10-20T12:00:00Z`; every round from now on writes its own `attribution` block onto `.quay/open-semantic-discovery-findings.jsonl`.
- **Reader (the check):** `node --experimental-strip-types plugin/scripts/open-semantic-discovery-routine.ts --report --root <workspace> --window 24` — a `confirmed ≥ 1` round shows up as that round's `confirmed=1` plus a `cluster N: blocked_by=none` line.
- **Observation window:** 24 resident rounds (~24h at the declared cadence) after landing. If it is still 0 by then, the honest follow-up is NOT to raise a budget again but to read the `attribution.causes` histogram: the split by blocking step is now the reading that says whether the next move is the verifier's envelope, the refuter's, or neither.
- **承接者 and the honest last hop:** the reader is the coordinator's OSD audit (the same only-read audit that filed this task). The last hop is **MANUAL** — no routine currently files a follow-up finding when the OSD carrier stays empty of confirmations, so nothing will tick this box on its own. It is left unticked and marked 待外部 rather than fabricated, per the DoD.

## Touches
- tasks/gap-osd-resident-round-never-autonomously-confirms-fix-attribution-and-call-failed-retry.md
- plugin/scripts/open-semantic-discovery-routine.ts
- plugin/test/open-semantic-discovery-routine.test.mjs
- .quay/config.yml
