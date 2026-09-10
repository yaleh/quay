# The σ_QC-vs-inherited-floor structural trap

Source: `experiments/quay-core-bootstrap/iterations/iteration-10.md` §6,
§8 (validation), §11d.

## The trap, stated precisely

When a new experiment inherits a high `σ_strict` floor from a prior
experiment (here, experiment 1's final `σ_strict = 0.8493`, cited in
`quay-native-methodology/reference/patterns.md`), but starts its own
provenance ledger — `σ_QC` — at 0/0 for its own scope, the **validation**
factor of V_meta is dominated by the inherited floor until the new
experiment's own native-provenance task count grows very large.

## The arithmetic

If validation tracks `σ_QC` against an inherited floor and the floor
dominates whenever `σ_QC < σ_strict_floor`:

```
σ_QC = n / (10 + n)     (n = additional all-native tasks, starting from a denominator of 10)

n / (10 + n) ≥ 0.8493
n ≥ 0.8493 × (10 + n)
n(1 - 0.8493) ≥ 8.493
n ≥ 56.4
```

Experiment 2 reached `σ_QC = 4/10 = 0.40` by iteration 10 (four
consecutive native-triple-provenance tasks, QC-007 through QC-010) — a
genuinely reproducible pattern (see `manda-reliability-envelope.md`'s
provenance-triple section) — but this is nowhere near sufficient.
Approximately **57 more** consecutive native-gate tasks would be needed
just to *begin* exceeding the inherited floor, from a denominator that
was only 10 at closure. Even then, the lift in the validation score would
be marginal (from 0.64 toward ~0.85); a materially higher validation
score (0.70+) would require the numerator to be substantially above the
floor, implying well over 100 total native-gate tasks — structurally
outside the natural scope of a 10-iteration, documentation/browser-test-
heavy experiment.

## Why this is a design trap, not a performance failure

The four consecutive native-triple tasks (QC-007-010) demonstrate the
*mechanism* works reliably on demand — the bottleneck is not reliability,
it is the **denominator growth rate** relative to the floor's fixed
height. No amount of continuing the same kind of documentation-task work
at the same pace closes this gap within any realistic iteration budget.
This is a structural property of the scoring setup chosen at experiment
design time, not a finding about whether the methodology "works."

## Consuming-scope guidance (the explicit design-time decision this implies)

Any experiment inheriting a prior experiment's `σ_strict` floor should
make one of the following two choices **explicitly, at design time**,
rather than letting the floor silently dominate for the entire
experiment's life (as happened here):

1. **Reset the floor to 0** for the new experiment's own ledger — treat
   validation as measuring only the new experiment's own native-task
   discipline, with no cross-experiment carry-forward. This is honest if
   the new experiment's own provenance ledger is meant to stand alone.
2. **Design for high native-task throughput** — deliberately include
   objectives that generate many native-triple-provenance tasks per
   iteration (source-logic work naturally does this more than
   documentation work; see `quay-native-methodology`'s own finding that
   late-stage V_instance movement in experiment 1 came from
   `{seed,seed,seed}` ad hoc work, not Skill-driven native work — the
   opposite failure mode, worth avoiding in the other direction too).
   This requires committing, at design time, to enough iterations and
   task volume to plausibly reach `n ≥ ~57` (or whatever the specific
   inherited floor implies) — do this arithmetic (per
   `v-meta-ceiling-diagnostic.md`'s method) before committing to the
   experiment's iteration budget.

Do not let this decision default silently to "inherit the floor and hope"
— that is exactly what produced experiment 2's validation stall.
