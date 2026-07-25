---
name: quay-webui-bootstrap-methodology
description: Use when inheriting or extending methodology into a frontend/visual/UX-shaped BAIME experiment, or when evaluating V_meta ceiling behavior across multiple experiments, the §0c independent holistic visual review mechanism, the G3+visual-review ENV gap, or the σ_QW floor-reset pattern. Extracted HALT-with-practical-convergence-accepted from experiments/quay-webui-bootstrap/ (experiment 3, a frontend/visual/UX transfer test) at iteration 5. This is a delta skill to both quay-native-methodology and quay-core-bootstrap-methodology — read those skills first; this one packages only what experiment 3 discovered that they did not already contain.
status: halted
V_instance: 1.0
V_meta: 0.123
σ: 0.778
---

# quay-webui-bootstrap-methodology

λ(scope, task) → GatedOutcome | inherit(quay-native-methodology) ∧ inherit(quay-core-bootstrap-methodology) ∧ apply_delta(scope, task)

## Status (see provenance.md)

Extracted from `experiments/quay-webui-bootstrap/` at iteration 5 — HALT with
practical convergence accepted, NOT formally converged. V_instance=1.0,
V_meta=0.123 (ceiling 0.26), σ_QW=7/9=0.778 (floor reset to 0 at iteration
0). Full convergence-criteria accounting and iteration narrative in
`provenance.md` §Skill extraction — methodology.

## Relationship to prior methodology skills (read those first)

This skill is a **delta**, not a replacement. Read
`.claude/skills/quay-native-methodology/SKILL.md` and
`.claude/skills/quay-core-bootstrap-methodology/SKILL.md` before using this
one. All gate mechanics, directive lifecycle, G3 audit discipline, manda
daemon address rules, manda reliability envelope, V_meta ceiling diagnostic,
and σ-vs-inherited-floor trap are already documented in those two skills.
This skill only packages what experiment 3 discovered that those skills
did not already contain.

## What this Skill packages (net-new findings only)

1. **The §0c independent holistic visual review mechanism** — no precedent
   in experiments 1 or 2. Required for every visual_design_quality movement
   claim. Dispatcher pattern, four-mode grid, holistic-verdict discipline,
   Lighthouse sequencing, browser conflict lesson, blocking semantics.
   See `reference/visual-review-mechanism.md`.

2. **The shared ENV gap for G3 and visual review dispatch** — both require
   orchestrator-dispatched fresh-context agents; both fall back to inline
   degraded-fallback when the ENV lacks an unconditional native Agent/Task
   tool. One root cause, two manifestations. See
   `reference/g3-visual-review-env-gap.md`.

3. **Two-experiment confirmation of the V_meta ceiling at 0.26** — experiment
   2 confirmed by absence-of-data (no scope-matched task in 10 iterations);
   experiment 3 confirmed by POSITIVE MEASUREMENT (four clean timing data
   points). The 0.26 value is now a positively-measured, cross-domain-stable
   quantity, not an absence-based default. See
   `reference/v-meta-ceiling-two-experiment.md`.

4. **Effectiveness re-trigger domain-specificity finding** — frontend/visual
   single-file tasks DID generate scope-matched effectiveness data for the
   first time across all three experiments, but all four measurements confirmed
   0.26. Moving effectiveness requires a domain with materially different
   per-task throughput vs. the QN-006 baseline, not merely a different domain
   with comparable scope shape. See `reference/effectiveness-timing-corpus.md`.

5. **σ_QW floor-reset as validated convergence enabler** — experiment 3
   explicitly reset the σ_QW floor to 0 at iteration 0. Validation grew from
   0.64 (inherited) to 0.778 (σ_QW=7/9) across four work iterations.
   Experiment 2's validation was frozen throughout 10 iterations by the
   inherited-floor trap. The reset design was effective. Recommended as the
   default for any future experiment with a genuinely different task
   population from its predecessor. See
   `reference/sigma-inherited-floor-trap.md` in quay-core-bootstrap-methodology
   for the trap analysis; this skill documents the validated design choice.

6. **Parallel-advancement stall guard operational record** — the §4.5 guard
   between ui_read_capability and visual_design_quality was checked every
   iteration and never violated. Operational lesson: the product formula
   itself structurally enforces advancement when a factor is at 0.0 (a
   collapsed factor creates immediate pressure). Explicit guard triggering
   is less likely when the formula is chosen correctly.

## Constraints

- delta_not_duplicate: cite quay-native-methodology and
  quay-core-bootstrap-methodology for all findings already documented in
  those skills. Do not re-document here.
- honest_inheritance: cite `experiments/quay-webui-bootstrap/iterations/`
  and `HALT-RECOMMENDATION.md` for any claim about what experiment 3 found.
- not_converged: this experiment is HALT with practical convergence accepted,
  NOT CONVERGED. V_meta=0.123, ceiling=0.26, criterion 1 arithmetically
  unreachable.
- visual_review_requires_both: the §0c holistic visual review and the
  Lighthouse mechanical check are both mandatory, neither substitutes for
  the other. A Lighthouse pass alone does not credit visual_design_quality
  movement.
- dispatcher_discipline: both G3 and §0c visual review must be dispatched
  by the orchestrator via the native Agent/Task tool. The ENV gap (inline
  fallback) is a known degradation, not the correct mechanism.
- ceiling_diagnostic_before_iterating: inherited from
  quay-core-bootstrap-methodology; see `reference/v-meta-ceiling-diagnostic.md`
  in that skill. The 0.26 ceiling is now two-experiment confirmed.
- floor_reset_explicit: the σ_QW floor-reset decision must be made
  explicitly at iteration 0 and recorded in provenance.md. It was the
  correct choice for experiment 3; it should be the default choice for any
  experiment with a task population distinct from its predecessor's.

## Validation

- V_instance_snapshot = 1.0 (all four Done-when clauses met at iteration 4)
- V_meta_snapshot = 0.123, ceiling 0.26, honestly carried forward
- σ_QW = 7/9 = 0.778 (own-experiment ledger; QW-003..QW-009 all-native)
- every reference file traceable to a specific iteration in
  `experiments/quay-webui-bootstrap/iterations/` or
  `experiments/quay-webui-bootstrap/provenance.md`

## Implementation

When a consuming scope (e.g. an experiment 4) invokes this skill:

1. Read `.claude/skills/quay-native-methodology/SKILL.md` and its
   `reference/` files first.
2. Read `.claude/skills/quay-core-bootstrap-methodology/SKILL.md` and its
   `reference/` files second — specifically the G3 dispatch drift case
   study and the V_meta ceiling diagnostic.
3. Read `reference/visual-review-mechanism.md` (this skill) before writing
   any iteration prompt that includes a visual_design_quality factor. The
   four-mode grid, holistic-first verdict, browser conflict rule, and
   Lighthouse sequencing are all required to use this mechanism correctly.
4. Read `reference/g3-visual-review-env-gap.md` (this skill) before writing
   dispatch logic for either G3 or §0c visual review. The shared root cause
   means both gaps must be handled at the orchestration level, not inside
   the executor.
5. Read `reference/v-meta-ceiling-two-experiment.md` (this skill) if
   effectiveness is still inherited frozen at 0.26 — the two-experiment
   confirmation changes the epistemic status of the 0.26 value. Any claim
   that a new domain will break the ceiling requires stronger evidence than
   "domain is different."
6. Read `reference/effectiveness-timing-corpus.md` (this skill) before
   evaluating any effectiveness re-trigger claim. The 200–261s cluster
   across both experiments is the concrete baseline the rubric score refers
   to.
7. Make the σ_QW floor-reset decision explicitly at iteration 0, recording
   the arithmetic in provenance.md. The reset is the recommended default;
   the inherited-floor throughput path requires explicit arithmetic to
   justify choosing it over the reset.
