# Effectiveness Timing Corpus — All Experiments

Source: `experiments/quay-native-bootstrap/` (experiment 1),
`experiments/quay-core-bootstrap/` (experiment 2),
`experiments/quay-webui-bootstrap/` (experiment 3). This file collects all
clean, scope-matched timing data used to compute the effectiveness factor
in V_meta across all three experiments, plus the re-trigger-domain-specificity
finding from experiment 3.

---

## The QN-006 baseline

Source: `experiments/quay-native-bootstrap/timing/iteration-0.log`

```
Task: QN-006 (stage-0 — the effectiveness rubric's reference task)
Scope: single-file, minimal source change, no network I/O
author phase: ~51s
execute phase: ~179s  (execute 2m59s)
total: ~230s
```

This is the denominator task for the effectiveness rubric. The rubric
score (0.26) reflects how the methodology's operational throughput compares
to this baseline across a sample of scope-matched tasks.

---

## Experiment 1 (quay-native-bootstrap): baseline data only

Experiment 1 established QN-006 as the baseline. No aggregate of multiple
scope-matched tasks was compiled because the experiment was discovering the
methodology, not measuring its stability. The 0.26 score was derived from
the QN-006 single-point baseline and the methodology's inherent overhead
structure.

No experiment-1 scope-matched data is listed here beyond QN-006 itself —
see `experiments/quay-native-bootstrap/` for the full iteration history.

---

## Experiment 2 (quay-core-bootstrap): zero data points

Experiment 2 ran 10 iterations in a backend/documentation domain
(Core ABI, web_ui_verification, action delivery, backlog health). No
scope-matched task (single-file, minimal source change, no network I/O,
QN-006-shaped) arose organically in any of the 10 iterations.

An exhaustive comprehensive search at iteration 10 found the nearest
candidate was a pre-existing QN-* GitHub issue — not a QC-* task, and
not scope-matched. Effectiveness stayed at 0.26 by absence-of-data
confirmation.

---

## Experiment 3 (quay-webui-bootstrap): four clean data points

Source: `experiments/quay-webui-bootstrap/provenance.md` and
`experiments/quay-webui-bootstrap/iterations/iteration-{2,3,4}.md`.

All four are single-file serve.js changes, logic change, no network I/O —
matching QN-006's scope shape.

| Task | Iteration | Author | Execute | Total | Notes |
|------|-----------|--------|---------|-------|-------|
| QW-003 | 2 | 32s | 170s | 202s | Filter-by-status GET / route; first clean per-task comparison |
| QW-004 | 3 | 72s | 180s | 252s | Sort-by-id/status logic; higher author time (more planning) |
| QW-005 | 3 | 27s | 173s | 200s | Filter-by-label logic |
| QW-008 | 4 | 20s | 241s | 261s | Parent/children frontmatter rendering on detail page |

**Range of clean data**: 200s–261s.
**Mean**: ~229s (coincidentally close to QN-006 baseline of ~230s).

### Excluded from clean set

| Task | Total | Exclusion reason |
|------|-------|-----------------|
| QW-001 | part of 411s combined | Not individually timed; combined with QW-002 |
| QW-002 | part of 411s combined | Not individually timed; combined with QW-001 |
| QW-006 | 102s | CSS-only change (`.meta a { text-decoration: underline }` + one HTML line); shorter because it is simpler scope, not comparable to QN-006 logic changes |
| QW-007 | 392s | Elevated execute time due to test-fixture engineering overhead (seeding 25-task fixture for pagination tests); the serve.js logic change itself was comparable, but the test time inflated the total |
| QW-009 | 78s | Simple scope (labels column addition in list table); not comparable to QN-006 logic-change shape |

The filter criterion for the clean set: single-file change, logic change
(not CSS-only, not test-engineering-only), no network I/O, comparable
implementation complexity to QN-006.

---

## Re-trigger-domain-specificity finding (experiment 3)

Experiment 3 is the first experiment across three where the effectiveness
re-trigger mechanism actually fired. Re-trigger condition 1 (from the
watchlist in `experiments/quay-webui-bootstrap/ITERATION-PROMPTS.md`):
"did any QW-* task arise that is organically scope-matched to stage-0
QN-006's shape?"

Answer: YES. Four such tasks arose organically (QW-003, QW-004, QW-005,
QW-008) across iterations 2-4.

The data confirmed 0.26, not a higher value.

**Key implication**: the failure of experiment 2 to produce scope-matched
tasks was domain-specific (backend/documentation work does not naturally
produce single-file logic-change tasks at QN-006's scope shape). The
frontend/visual/UX domain DOES produce such tasks. The re-trigger mechanism
is not broken — it produced data. The data confirmed the baseline.

**Second implication**: switching domains alone (backend → frontend) does
not change the effectiveness score if the scope shape remains comparable.
The 200-261s cluster for frontend serve.js logic changes is the same
range as the ~230s QN-006 baseline. The rubric does not distinguish by
domain; it measures time relative to the baseline scope shape.

---

## What would move effectiveness above 0.26

For effectiveness to score above 0.26, an experiment would need either:

1. **Materially faster scope-matched tasks** — consistently completing
   in, say, <100s total. This would require a domain where:
   - The scope is constrained to very small isolated changes (single-line
     config edits, single-constant changes)
   - The test suite runs faster than quay's current test suite
   - The author phase is faster (possibly because the change is more
     formulaic)

2. **A rubric revision** — if the rubric measurement basis changes (e.g.,
   measuring throughput over a full sprint rather than per-task), the
   0.26 value would need to be re-derived from scratch.

3. **Evidence that the methodology's overhead has structurally decreased**
   — if a future iteration of the methodology eliminates a step that
   currently accounts for much of the execute time (~179s for QN-006),
   all scope-matched tasks would complete faster and the rubric score
   would rise.

What would NOT move effectiveness:
- More scope-matched tasks that confirm 0.26 (experiment 3 demonstrated this)
- A different domain with comparable scope shapes (experiment 3 demonstrated this)
- Faster *different* tasks that are not scope-matched to QN-006's shape
  (QW-009 at 78s is faster, but it is excluded because it is simpler scope)

---

## Cross-references

- `reference/v-meta-ceiling-two-experiment.md` (this skill) — how the
  corpus connects to the two-experiment ceiling confirmation
- `experiments/quay-webui-bootstrap/iterations/iteration-2.md` §5 — QW-003
  timing derivation (first clean per-task comparison)
- `experiments/quay-webui-bootstrap/iterations/iteration-3.md` §5 — QW-004,
  QW-005, QW-006 timing derivation
- `experiments/quay-webui-bootstrap/iterations/iteration-4.md` §5 — QW-007,
  QW-008, QW-009 timing derivation
- `quay-core-bootstrap-methodology/reference/v-meta-ceiling-diagnostic.md`
  — the general ceiling diagnostic technique that prompted the timing corpus
  collection requirement
