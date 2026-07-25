---
name: quay-webui-bootstrap-methodology
description: Use when inheriting methodology into a frontend/visual/UX-shaped BAIME experiment, or when evaluating V_meta ceiling behavior across multiple experiments, the §0c independent holistic visual review mechanism, the G3+visual-review ENV gap, or the σ_QW floor-reset pattern. Extracted HALT-with-practical-convergence-accepted from experiments/quay-webui-bootstrap/ at iteration 5. Delta skill to quay-native-methodology and quay-core-bootstrap-methodology.
status: halted
V_instance: 1.0
V_meta: 0.123
σ: 0.778
---

# quay-webui-bootstrap-methodology

λ(scope, task) → GatedOutcome | inherit({quay-native-methodology, quay-core-bootstrap-methodology}) ∧ apply_delta(scope, task)

## Status

Source: `experiments/quay-webui-bootstrap/`, halted at iteration 5, NOT formally converged.
```
V_instance = ui_read_capability × visual_design_quality = 1.0 × 1.0 = 1.0
V_meta     = 0.77 × 0.26 × 0.79 × 0.64 = 0.123  (ceiling 0.26)
σ_QW       = 7/9 = 0.778  (floor-reset from inherited 0.64)
```
Convergence: criteria 2+4+5 met; 1 (V_meta ceiling 0.26) and 3 (only 1 factor moved) not met.

## Spec

```
-- Net-new findings (experiment 3)

:: visualReviewMechanism : VisualQualityClaim → DualEvidence
| §0c independent holistic visual review — dispatcher pattern, four-mode grid, Lighthouse sequencing
| → reference: reference/visual-review-mechanism.md

:: visualReviewEnvGap : AuditDispatch → OrchestratorConstraint
| G3 and §0c visual review share the same ENV gap: both require orchestrator-dispatched fresh-context
| agents; both fall back to inline degraded-fallback when no unconditional native Agent/Task tool.
| → reference: reference/g3-visual-review-env-gap.md

:: vMetaCeilingTwoExperiment : V_metaFactor → CrossDomainMeasurement
| effectiveness ceiling 0.26 confirmed by two experiments: exp2 × absence-of-data; exp3 × 4 positive
| measurement data points. Now a positively-measured, cross-domain-stable quantity.
| → reference: reference/v-meta-ceiling-two-experiment.md

:: effectivenessRetriggerDomainSpecificity : DomainShape → EffectivenessConstraint
| Four frontend single-file tasks generated scope-matched data but all confirmed 0.26. Moving
| effectiveness requires materially different per-task throughput vs. QN-006 baseline.
| → reference: reference/effectiveness-timing-corpus.md

:: sigmaFloorResetValidated : NewExperiment → DesignDecision
| σ_QW floor reset to 0 at iteration 0; grew from 0.64 (inherited) to 0.778 (7/9).
| Recommended default for any future experiment with genuinely different task population.
| → reference: reference/sigma-inherited-floor-trap.md (in quay-core-bootstrap-methodology)

:: parallelAdvancementStallGuard : ProductFormula → OperationalRecord
| §4.5 guard between ui_read_capability and visual_design_quality never violated. Product formula
| structurally enforces advancement when a factor is at 0.0.

-- Formal constraints

:: delta_not_duplicate : Knowledge → CanonicalSource
| ∀ k ∈ skill.knowledge . source(k) ∈ {quay-native-methodology, quay-core-bootstrap-methodology} ∨ new(k)
| ⊨ cite prior methodology skills for shared findings; this skill documents only Δ

:: honest_inheritance : Claim → EvidencePath
| ∀ claim ∈ skill.knowledge . claim.evidence ∈ {iterations/, HALT-RECOMMENDATION.md}
| ⊨ cite iteration file or HALT-RECOMMENDATION.md

:: not_converged : Status → AssertionConstraint
| status = halted ∧ V_meta = 0.123 ∧ (V_meta < V_meta_ceiling = 0.26)
| ⊨ "HALT with practical convergence accepted"

:: visual_review_requires_both : VisualQualityClaim → DualEvidence
| credit(visual_design_quality_movement) ⇒ holistic_review(§0c) ∧ lighthouse_pass
| ⊨ neither substitutes for the other

:: dispatcher_discipline : AuditDispatch → OrchestratorConstraint
| dispatch(G3) ∨ dispatch(§0c_visual) ⇒ orchestrator_dispatched(¬inline, ¬self)
| ⊨ shared root cause for both gaps

:: floor_reset_explicit : NewExperiment → DesignDecision
| iteration_0 . require(record(σ_floor_reset_decision, provenance.md))
| ⊨ default(σ_floor_reset = 0) for task population distinct from predecessor
```

## Validation

- V_instance = 1.0 (achieved on 2 Done-when clauses)
- V_meta = 0.123, ceiling 0.26 — not re-baselined upward
- Every reference file traceable to specific iteration or HALT-RECOMMENDATION.md

## Implementation

1. Read `.claude/skills/quay-native-methodology/SKILL.md` and `.claude/skills/quay-core-bootstrap-methodology/SKILL.md` first.
2. For visual quality claims: apply §0c visual review mechanism per `reference/visual-review-mechanism.md`.
3. For G3 or §0c audit dispatch: check ENV gap per `reference/g3-visual-review-env-gap.md`.
4. Before setting V_meta threshold: two-experiment ceiling confirmation at 0.26.
5. For new experiment design: reset σ floor to 0 per `reference/sigma-inherited-floor-trap.md`.
