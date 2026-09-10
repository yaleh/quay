# V_meta Ceiling — Two-Experiment Confirmation

Source: `experiments/quay-webui-bootstrap/` experiment 3 (the second
confirmation) + `experiments/quay-core-bootstrap/` experiment 2 (the first
confirmation). Extends
`quay-core-bootstrap-methodology/reference/v-meta-ceiling-diagnostic.md`,
which documents the diagnostic technique and experiment 2's first
confirmation. This file documents the upgrade in epistemic status produced
by experiment 3's positive-measurement evidence.

---

## The ceiling value

V_meta_ceiling = 0.26

This is the maximum achievable V_meta given effectiveness frozen at 0.26:

```
V_meta_ceiling = completeness_max × effectiveness × reusability_max × validation_max
               = 1.0 × 0.26 × 1.0 × 1.0 = 0.26
```

The convergence threshold is V_meta ≥ 0.80. With ceiling = 0.26, criterion
1 (dual threshold) is arithmetically unreachable for as long as
effectiveness stays at 0.26. This is not contingent — it is arithmetic.

---

## Experiment 2 confirmation: absence-of-data evidence

Experiment 2 (`quay-core-bootstrap`, backend/documentation domain) ran 10
iterations. The ceiling was confirmed because:
- No scope-matched task (single-file, minimal source change, no network I/O,
  matching QN-006's scope shape) ever arose organically in 10 consecutive
  QC-* iterations
- Exhaustive comprehensive search at iteration 10 found no scope-matched
  candidate beyond a pre-existing QN-* GitHub issue, not a QC-* task
- Effectiveness remained at 0.26 throughout, confirmed by absence of
  contradicting data

Evidence type: absence-of-data. The ceiling held because no event could
have changed it.

---

## Experiment 3 confirmation: positive-measurement evidence

Experiment 3 (`quay-webui-bootstrap`, frontend/visual/UX domain) ran 5
iterations. The ceiling was confirmed because:
- Four clean scope-matched data points arose organically (QW-003, QW-004,
  QW-005, QW-008 — all single-file serve.js logic changes, no network I/O)
- All four confirmed the 0.26 baseline rather than demonstrating a higher
  value
- The re-trigger mechanism (condition 1 from the re-trigger watchlist) DID
  fire for the first time across all three experiments — but the data
  confirmed 0.26, not a different value

Evidence type: positive measurement. The ceiling held because measured data
confirmed the baseline.

---

## The upgrade in epistemic status

| Property | After experiment 2 | After experiment 3 |
|----------|-------------------|--------------------|
| Evidence type | Absence-of-data | Positive measurement |
| Domain tested | Backend/documentation | Frontend/visual/UX |
| Data points | 0 (no scope-matched tasks) | 4 clean timing data points |
| Re-trigger mechanism | Never fired | Fired; confirmed 0.26 |
| Interpretation | "0.26 is the inherited value; no data to change it" | "0.26 is a measured stable value across domains" |

The 0.26 value is now a **positively-measured, cross-domain-stable quantity**,
not an inherited default that happens to have no contradicting evidence.

For a future experiment to claim effectiveness above 0.26, it needs:
- Positive timing data showing scope-matched tasks complete materially faster
  or slower than the 200-261s cluster
- Not merely a different domain — the frontend/visual domain WAS different,
  and it confirmed 0.26

---

## What "materially faster" means for future experiments

The QN-006 baseline: author ~51s, execute ~179s, total ~230s.
The experiment 3 cluster: 200s, 252s, 200s, 261s (four clean points).

For effectiveness to move upward from 0.26, a future experiment would need
to produce scope-matched tasks that complete consistently below this range
AND have a rubric score that reflects the time compression. For example:
- Tasks that execute in < 100s total (roughly half the baseline) would
  warrant re-examining the rubric score
- Tasks that execute in > 400s total consistently would warrant downward
  adjustment

Note that QW-007 (392s) was excluded from the clean data set because its
elevated execute time was due to test-fixture engineering overhead (seeding
25-task fixture), not serve.js logic complexity. QW-009 (78s) was excluded
because it was a simpler scope (column addition, not a full logic-change
task). The clean set filters for tasks with comparable scope to QN-006.

The filter criterion: single-file change, logic change (not CSS-only or
test-engineering-only), no network I/O, comparable implementation complexity
to a typical QN-006-shaped task.

---

## Implications for experiment 4 design

1. **Do not expect a domain change alone to break the ceiling.** Two
   consecutive experiments in different domains (backend → frontend) both
   confirmed 0.26. The value reflects something about the methodology's
   operational throughput that is domain-independent at comparable scope
   shapes.

2. **To break the ceiling, identify a domain where the scope shape is
   materially different.** Candidates: larger architectural refactors
   (multi-file, multi-module changes) could produce slower timing and warrant
   a different rubric segment; very constrained configuration-only changes
   could produce faster timing.

3. **The re-trigger mechanism is now known to work.** It fired in experiment
   3 (first time across three experiments). If experiment 4 produces
   scope-matched tasks, they will be measured and compared. The machinery
   is not broken — it confirmed a stable value.

4. **The ceiling diagnostic must be run at iteration 0 of any future
   experiment.** With effectiveness inherited at 0.26, the ceiling is 0.26
   unless a domain shift is expected to produce materially different timing.
   State this at iteration 0, not when the HALT decision is pending.

---

## Cross-references

- `quay-core-bootstrap-methodology/reference/v-meta-ceiling-diagnostic.md`
  — the diagnostic technique itself; consume that file for the general
  method; this file documents the two-experiment confirmation result
- `reference/effectiveness-timing-corpus.md` (this skill) — all clean
  timing data across experiments 1-3; the full data set the 0.26 value
  reflects
- `experiments/quay-webui-bootstrap/HALT-RECOMMENDATION.md` §"Criterion 1"
  — the formal arithmetic derivation of the ceiling for experiment 3
- `experiments/quay-core-bootstrap/iterations/iteration-10.md` §8, §11
  — experiment 2's ceiling confirmation
