---
id: gap-osd-resident-round-never-autonomously-confirms-fix-attribution-and-call-failed-retry
title: "OSD: resident-driver reached confirmed=0 in all 13 autonomous rounds
  over 24h (both real confirms needed a manual budget override) — fresh
  turn-distribution measurement, call-failed retry policy, per-cluster
  attribution join, and an explicit unmodified-resident-round DoD"
status: ready
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
- [ ] AC1: the fresh distribution (step, n, sorted turns, chosen percentile or "kept, n<10") is pasted for all 4 steps.
- [ ] AC2: the `call-failed` retry decision is pasted with its own production-measured basis (retry-then-succeeds rate from real reservations, not a guess), and the code change (extend-retry or no-change-with-named-further-classification) matches the decision.
- [ ] AC3: a real round (either naturally due or `--force` manual, EITHER is fine for this AC since it is testing attribution, not autonomy) shows the per-cluster join: for every verified cluster, which step blocked it and that step's cause, pasted.
- [ ] AC4 (the load-bearing one — **autonomy, not a manual override**): **a real, UNMODIFIED `resident-driver` round** (production config, no `--force`, no coordinator override of any budget), occurring AFTER this fix lands, reaches **`confirmed ≥ 1`**. Paste the round's `ts`, the confirmed cluster's claim, and the verifier+refuter chain that reached it. If no such round occurs within a stated, reasonable observation window after landing, paste the window and the rounds observed instead, and leave this box unticked rather than fabricate it — a fixture or `--force` round must NEVER be substituted here (hard rule 4 recurrence: a measurement that can only be satisfied by injected data is not a measurement).
- [ ] AC5: `scripts/test.sh --for-task <this task>` green; report-only, the hard 24h/USD budget, and the kill switch (`enabled:false` ⇒ zero spawns) are unchanged.

## Definition of Done
- AC1-AC3, AC5 checked with pasted evidence.
- AC4 is the task's actual purpose; if it cannot be checked within the observation window, the task documents the gap it leaves and is NOT marked done by papering over AC4 — escalate to needs-human with the honest state rather than fabricate a pass.

## Touches
- tasks/gap-osd-resident-round-never-autonomously-confirms-fix-attribution-and-call-failed-retry.md
- plugin/scripts/open-semantic-discovery-routine.ts
- plugin/test/open-semantic-discovery-routine.test.mjs
- .quay/config.yml
