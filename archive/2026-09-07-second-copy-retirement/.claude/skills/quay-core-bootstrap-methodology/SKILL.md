---
name: quay-core-bootstrap-methodology
description: Use when inheriting or extending quay-native methodology into a THIRD scope, or when deciding whether to trust manda nested-subagent dispatch, the G3 audit dispatch channel, or a multiplicative V_meta configuration. Extracted HALT-with-practical-convergence-accepted from experiments/quay-core-bootstrap/ at iteration 10. Delta skill to quay-native-methodology.
status: halted
V_instance: 1.0
V_meta: 0.1012
σ: 0.40
---

# quay-core-bootstrap-methodology

λ(scope, task) → GatedOutcome | inherit(quay-native-methodology) ∧ apply_delta(scope, task)

## Status

Source: `experiments/quay-core-bootstrap/`, halted at iteration 10, NOT formally converged.
```
V_instance = 1.0 × 1.0 × 1.0 × 1.0 = 1.0   (stable since iteration 3)
V_meta     = 0.77 × 0.26 × 0.79 × 0.64 = 0.1012  (ceiling 0.26)
σ_QC       = 4/10 = 0.40  (dominated by inherited floor σ_strict=0.8493)
```

## Relationship to quay-native-methodology

This is a **delta**, not a replacement. All experiment-1 methodology (quay:author, quay:execute, task check gate, directive lifecycle, G3 audit discipline) is documented in `.claude/skills/quay-native-methodology/`. Reference files here cover only what experiment 2 discovered that experiment 1 did not.

## Spec

```
-- Net-new findings (experiment 2)

:: mandaDaemonAddress : Runtime → Path
| correct address read from .manda/hub.addr at runtime, not hardcoded port
| → reference: reference/manda-daemon-address-bug.md

:: mandaReliabilityEnvelope : TaskShape × Timeout → {success, timeout}
| trivial@90s = success ∧ medium@150s = success ∧ complex@90s = timeout ∧ complex@150s = success
| → reference: reference/manda-reliability-envelope.md — exact tuple, never compress

:: g3AuditDispatchAntiPattern : G3Audit → DispatchRule
| G3 audits dispatched by orchestrator via native Agent tool, NOT via manda self-dispatch
| → reference: reference/g3-audit-dispatch-drift-case-study.md (DIR-003)

:: vMetaCeilingDiagnostic : V_metaConfig → {reachable, unreachable}
| ceiling = Π structural_max(factor) ; ceiling < threshold ⇒ ¬reachable without unfreeze
| → reference: reference/v-meta-ceiling-diagnostic.md

:: sigmaFloorTrap : NewExperiment → DesignDecision
| inherit(σ_strict_floor) ⇒ decide(reset(0) ∨ throughput(sufficient))
| → reference: reference/sigma-inherited-floor-trap.md — never default silently

-- Formal constraints

:: delta_not_duplicate : Knowledge → CanonicalSource
| ∀ k ∈ skill.knowledge . source(k) = quay-native-methodology ∨ new_experiment_2(k)
| ⊨ cite quay-native-methodology for shared findings; this skill documents only Δ

:: honest_inheritance : Claim → EvidencePath
| ∀ claim ∈ skill.knowledge . claim.evidence ∈ {iteration-10.md, iterations/}
| ⊨ iteration-10.md (authoritative closing report) + specific iteration file

:: ¬imply_convergence : Status → AssertionConstraint
| status = halted ∧ V_meta = 0.1012 ∧ (V_meta < V_meta_ceiling = 0.26)
| ⊨ "HALT with practical convergence accepted" — distinct, weaker status

:: ceiling_diagnostic_before_iterating : V_metaGoal → FeasibilityCheck
| before(iterate(V_meta)) . require(ceiling_computation(factors))
| ⊨ ceiling < threshold ⇒ ¬reachable(criterion_1) without unfreeze(factor)

:: floor_reset_or_throughput_decision : NewExperiment → DesignDecision
| inherit(σ_strict_floor) ⇒ decide(reset(0) ∨ throughput(sufficient_to_exceed_floor))
| ⊨ reference/sigma-inherited-floor-trap.md — never default silently
```

## Validation

- V_instance = 1.0 (achieved; do not claim higher without new evidence)
- V_meta = 0.1012, ceiling 0.26 — not re-baselined upward
- Every reference file traceable to specific iteration in `experiments/quay-core-bootstrap/iterations/`

## Implementation

1. Read `.claude/skills/quay-native-methodology/SKILL.md` and its `reference/` files first.
2. Read `reference/transfer-test-outcome.md` for "what transferred, what's genuinely new."
3. Before relying on manda dispatch: read `reference/manda-daemon-address-bug.md` and `reference/manda-reliability-envelope.md`.
4. Before writing a G3 audit dispatch step: read `reference/g3-audit-dispatch-drift-case-study.md` — copy the corrected (DIR-003) design.
5. Before setting a V_meta formula/threshold: run `reference/v-meta-ceiling-diagnostic.md` computation.
6. Before inheriting σ_strict floor: read `reference/sigma-inherited-floor-trap.md` and make explicit recorded choice.
