# The mathematical-ceiling diagnostic for multiplicative V_meta

Source: `experiments/quay-core-bootstrap/iterations/iteration-6.md`
(first stated), reconfirmed and made authoritative in
`iterations/iteration-10.md` §8, §10, §11a.

## The technique

When a score is defined as a product of independent factors —
`V_meta = completeness × effectiveness × reusability × validation` here —
and one factor is structurally frozen (cannot move without an external
event that has not occurred and, per exhaustive search, is not pending),
compute the **ceiling** of the whole product early: substitute 1.0 for
every *other* factor and keep the frozen factor at its actual value.

```
V_meta_ceiling = 1.0 × effectiveness_frozen × 1.0 × 1.0
```

In experiment 2: `effectiveness = 0.26` was frozen (see
`quay-native-methodology/reference/v-meta-stall-analysis.md` — inherited
from experiment 1, reconfirmed stalled across 10 further iterations of
comprehensive search in experiment 2). Even if completeness, reusability,
and validation had all simultaneously reached their own theoretical
maximum of 1.0 (each individually blocked from doing so for its own
reasons), the ceiling would still be:

```
V_meta_ceiling = 1.0 × 0.26 × 1.0 × 1.0 = 0.26
```

Since the convergence threshold (criterion 1) requires `V_meta ≥ 0.80`,
and `0.26 < 0.80`, criterion 1 is **arithmetically unreachable** —
not merely "hard," but impossible without the frozen factor itself
moving. This was stated explicitly starting at iteration 6 and carried
forward unchanged through the iteration-10 closing report.

## Why this matters: early recognition vs. late discovery

Computing this ceiling does not require running any further iterations —
it is a pure arithmetic fact derivable the moment a factor is confirmed
frozen. Experiment 2 computed and stated it at iteration 6 (4 iterations
before the practical-convergence halt at iteration 10), which meant
iterations 7-10 could be explicitly framed as "confirming the ceiling
holds and discharging the comprehensive-fallback-search obligation," not
as "still hoping for criterion 1." This is a more honest and more
efficient posture than discovering the impossibility only at the formal
halt decision point.

## Generalization for future experiments

Before running additional iterations toward *any* multiplicative-score
threshold:

1. Identify which factors are currently frozen (held flat with a
   documented, search-confirmed structural blocker — not just "hasn't
   moved yet").
2. Compute the ceiling by setting every non-frozen factor to its
   theoretical maximum (usually 1.0) and multiplying through with the
   frozen factor(s) at their actual value.
3. Compare the ceiling to the convergence threshold.
4. If the ceiling is already below threshold, say so explicitly and as
   early as possible — this reframes subsequent iterations honestly (as
   confirming/discharging obligations, not as still pursuing an
   achievable target) and gives the experiment's eventual halt decision
   an arithmetic, not just an accumulated-fatigue, justification.
5. This diagnostic does **not** by itself justify halting — the
   experiment must still complete its comprehensive fallback search (or
   equivalent due-diligence obligation) before accepting practical
   convergence, per `quay-native-methodology`'s guardrail discipline. The
   ceiling calculation tells you *what to expect* from that search, not a
   license to skip it.

## Consuming-scope guidance

- Run this diagnostic the first iteration any factor is confirmed frozen
  with a structural (not just "not yet found") blocker — do not wait
  until a formal halt-decision iteration to compute it for the first
  time.
- State the ceiling in every subsequent iteration's V_meta section as a
  standing fact (as iteration 10 did, citing it as "carried from
  iteration 6"), so it remains visible rather than requiring
  rederivation each time.
- If a new experiment's design allows choosing which factors compose
  V_meta, consider whether any candidate factor is likely to freeze early
  (e.g. because it depends on an external event with no organic trigger
  in the experiment's own scope) — this diagnostic is also a useful
  design-time question, not just a running-experiment diagnostic.
