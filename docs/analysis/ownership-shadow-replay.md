# ownership/architecture shadow proposer — offline replay (v1)

Implements `tasks/gap-ownership-shadow-proposer-contract-and-replay.md`. Tests whether
"specialized proposer + deterministic policy + sandbox carrier" reproduces the way a human drove
GOAL-030..033 — **offline only**. No live shadow is registered, no proposer is activated, nothing
outside the sandbox carrier is written.

Regenerate: `node docs/analysis/ownership-shadow-replay.mjs --out docs/analysis/ownership-shadow-replay.results.json`
(no external model call — the runner always runs).

## What was built

- `docs/analysis/ownership-shadow-proposer.mjs` — the contract (`emptyEnvelope`, owned-domain
  keywords, forbidden-action vocabulary) + `deterministicGate()`, a **pure** function that
  polices schema, evidence resolution, domain scope, forbidden actions, per-round cap and dedup.
- `docs/analysis/ownership-shadow-replay.mjs` — the replay runner: feeds each corpus case the
  **same default prompt** (`input.json` only), derives an envelope with a deterministic baseline
  proposer, gates it, and scores it with the **existing** corpus evaluator
  (`scoreResponse`) — deliberately not a second evaluator, which would drift immediately.

## Result (deterministic baseline proposer, NO LLM)

| case | gate | action | ref action | inv-vs-goal | recall | slice | scope viol | harness | neg-ctl | leak |
|---|---|---|---|---|---|---|---|---|---|---|
| GOAL-030 | accept | propose-goal | goal | ✅ | 0 | no_match | false | incomplete | present | false |
| GOAL-031 | accept | investigate | goal | ❌ | 0 | no_match | false | harness_ready | present | false |
| GOAL-032 | accept | investigate | goal | ❌ | 0 | no_match | false | harness_ready | present | false |
| GOAL-033 | accept | propose-goal | goal | ✅ | 1 | no_match | false | incomplete | present | false |

- **investigate-vs-goal agreement: 2/4.** scope violations 0/4, negative-control presence 4/4,
  hindsight leakage 0/4, gate accept 4/4.

## Honest reading — and two caveats that matter more than the numbers

1. **The `granularity` metric is VACUOUS in this run and must not be quoted as a result.** The
   baseline self-reports `sufficient` for every case, and every reference is also `sufficient`,
   so it scores 4/4 "agreement" without discriminating anything. A metric that cannot come out
   false is not a measurement — it needs negative examples (a deliberately too-broad and a
   deliberately too-fragmented proposal) before it means anything.
2. **`concern recall` is 1/4 mostly because the baseline's concern text is generic boilerplate**,
   not because the idea is absent. The evaluator's overlap metric is token-based; a human reading
   GOAL-033's envelope would likely call it directionally right while the metric calls it 0. This
   is a known, stated weakness of the rule-assisted evaluator, not a finding about the proposer.

**What the run DOES establish:** the pipeline (prompt → envelope → deterministic gate → evaluator
→ sandbox carrier) runs end to end, needs no external model, is byte-reproducible, and the gate's
six rejection causes are pairwise distinguishable. That is the thing this task set out to prove.

**What it does NOT establish:** that this proposer is good. A deterministic baseline is an honest
floor, not a positive result. 2/4 investigate-vs-goal on 4 cases from one domain is nowhere near
evidence of generalisation.

## Design gap found while building it (worth carrying forward)

The first version carried the dedup set **across** the four cases and rejected 2 of 4 — wrong,
because each corpus case is an independent decision point at a different historical time. Dedup
must be **per-round**; a replay that dedups across cases silently measures nothing about the later
cases. The same mistake in a live shadow would suppress a genuinely-new proposal that merely
resembled an old one.

## Recommendation on promoting to limited-proposal stage

**Not yet — and the blocker is evidence, not the mechanism.** The mechanism (gate + sandbox +
attribution-ready envelope) is demonstrated. What is missing is a *semantic* proposer to compare
against this floor, and a live window of real current-state proposals to measure repetition and
attribution. Both are the next task's job. Promoting a mechanism whose only measured input is a
deterministic stub would be promoting the harness, not the intelligence.

Two preconditions for a fair live comparison are also **still open** and should gate it:
- the monolithic meta-driver's semantic half is currently dead (see
  `gap-launchargv-prompt-in-argv-exceeds-max-arg-strlen`), so a side-by-side "who found what"
  comparison would compare against a corpse; and
- the `granularity` dimension needs negative examples first (caveat 1 above).
