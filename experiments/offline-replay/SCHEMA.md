# Offline-Replay Sample Corpus — Schema

Purpose: convert the 4 completed BAIME experiments (quay-native / quay-core /
quay-webui / quay-continuous) into a **supervised sample corpus** for offline
"training" of the exp5 rule-set, defeating n=4 overfitting by sampling
**decision-points**, not experiments.

## One sample = one judgment point (JSONL, one object per line)

```jsonc
{
  "sample_id": "term-exp1-it12",         // <type>-<exp>-<iterOrTag>, unique
  "experiment": "exp1|exp2|exp3|exp4",
  "iteration": 12,                        // integer, or null for cross-iter events
  "decision_type": "termination|scoring|gap_severity|directive_lifecycle|transfer_phi|dilution|context_load",
  "features_available_then": {            // STRICT: only what was observable AT that point
     // e.g. dV_instance, dV_meta, sigma, consec_flat_count, iters_elapsed,
     //      ceiling_reached, new_gap_max_severity, done_when_met_count, ...
  },
  "on_the_spot_judgment": "what was actually decided/scored then (verbatim-ish)",
  "hindsight_label": "the retrospectively-correct judgment (the teacher)",
  "divergence": true,                     // true iff on_the_spot != hindsight  ← HIGH VALUE
  "label_source": "fact|audit|opinion"    // fact=downstream event; audit=G3/persona record; opinion=analyst
}
```

## Hard rules (make dozens-of-samples buy real independence)

1. **Labels from hindsight, features strictly then-available.** `features_available_then`
   must contain nothing that encodes the future. Train/serve hygiene: the exp5 rule
   must be computable live from these features alone.
2. **Prefer `label_source: fact` > `audit` > `opinion`.** Anchor labels in downstream
   facts (drag count, reopen, recurrence count, cross-domain reuse) or existing
   `audits/` G3/persona records. Minimize bare analyst opinion.
3. **Mine DIVERGENCES first.** on-the-spot vs hindsight disagreements carry the signal;
   agreements are low-information. Set `divergence` honestly.
4. **Effective-n is stratified.** Same-experiment samples are correlated. Leave-one-out
   is per-EXPERIMENT, not per-sample. Rare-event types (transfer_phi) stay ~n=3-6 — humble.

## decision_type: "value_discovery" (the generative layer — HIGHEST priority)

Not "was a control judgment right" but "how was a high-value improvement DIRECTION
discovered." Traces the provenance of good ideas. Feeds the exp5 OUTER discovery engine.

Extra/overridden fields for this type:
- `what_discovered`: the improvement/direction (e.g. "V_meta formula is structurally wrong").
- `value_magnitude`: "structural" (redesigned the framework) | "mechanism" (new reusable
   mechanism, e.g. §0c) | "polish" (a UQ-grade fix).
- `features_available_then.discovery_channel`: one of
   human_live_insight | simulated_user | g3_audit | transcript_observation |
   tool_trial | cross_experiment_comparison | metric_anomaly | dogfooding.
- `features_available_then.trigger`: what prompted the discovery.
- `features_available_then.latency_iters`: iterations elapsed before it surfaced (or null).
- `hindsight_label`: could a SYSTEMATIC mechanism have surfaced it earlier/cheaper, and
   which channel is it attributable to?
- `divergence`: true if found late / by luck / by a channel exp5 cannot yet reproduce.
- `label_source`: fact (directive created_by / provenance origin) > audit > opinion.

Analytic goal: cross-tabulate value_magnitude × discovery_channel. If high value
correlates with human/observation channels, exp5's outer layer must institutionalize them.

## Files
- `samples/termination.jsonl`   — continue/stop decisions (richest)
- `samples/scoring.jsonl`       — V_instance/V_meta scoring + corrections
- `samples/gaps.jsonl`          — gap severity classification + recurrence/aging
- `samples/directives.jsonl`    — DIR create/defer/apply/reopen lifecycle
- `samples/transfer_context.jsonl` — φ transfer edges (pos/neg) + dilution + context load-bearing
- `samples/discovery.jsonl` — value_discovery provenance (how high-value directions were found)
