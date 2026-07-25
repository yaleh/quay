---
name: quay-native-methodology
description: Use when inheriting or extending quay's task-authoring/execution methodology (Layer-2 quay:author/quay:execute Skills, task check gate, directive lifecycle, G3 out-of-band audit discipline) into a new scope. Extracted HALTED-NOT-CONVERGED from experiments/quay-native-bootstrap/ at iteration 88.
status: halted
V_instance: 0.6016
V_meta: 0.0973
σ: 0.8493
---

# quay-native-methodology

λ(scope, task) → GatedOutcome | inherit({skills, gate, directives, audit}) ∧ apply(scope, task)

## Status

Source: `experiments/quay-native-bootstrap/`, halted at iteration 88, NOT converged. Final metrics:
```
V_instance = 0.85 × 0.97 × 0.76 × 0.96 = 0.6016
V_meta     = 0.74 × 0.26 × 0.79 × 0.64 = 0.0973  (flat 22+ iterations)
σ_strict   = 62/73 = 0.8493
```

## Spec

```
-- Inherited artifacts (stage 0, per v2 proposal §2.2)

:: quayAuthor :: TaskId × ProviderId → {ready, needsHuman}
| Layer-2 orchestration Skill for todo→ready. Degraded-fallback: same-session sequential.
| → reference: examples/quay-author-SKILL.md

:: quayExecute :: TaskId × ProviderId → {done, needsHuman}
| Layer-2 orchestration Skill for ready→done, including compound (epic) recursive children-done.
| → reference: examples/quay-execute-SKILL.md

:: taskCheckGate :: Task → {PASS, FAIL}
| store.js check()/childrenStatus(): todo→ready and ready→done assertions, compound recursive.
| → reference: reference/gate-mechanics.md

:: directiveLifecycle :: Directive → {pending, applied, deferred, rejected}
| One-time-consumed lifecycle via experiments/quay-native-bootstrap/directives/.
| → reference: reference/directive-lifecycle.md, templates/directive-template.md

:: g3AuditDiscipline :: ProvenanceClaim → AuditRequirement
| Every σ lift co-signed by independently-dispatched adjudicate, never self-performed.
| → reference: reference/g3-audit-discipline.md

-- Formal constraints

:: honest_inheritance : Claim → EvidencePath
| ∀ claim ∈ skill.knowledge . claim.evidence ∈ {provenance.md, iterations/}
| ⊨ cite iteration file never assert from skill prose alone

:: ¬imply_convergence : Status → AssertionConstraint
| status = halted ∧ V_meta = 0.0973 ≪ 0.80
| ⊨ never emit "converged"

:: σ_boundary : NewScope → LedgerInit
| prefix(newScope) ∩ prefix(source) = ∅
| ⊨ new scope resets provenance ledger and task-ID prefix per v2 proposal §6

:: stalled_factors_are_starting_hypotheses : MetaFactor → ActionRequirement
| ∀ f ∈ stalled_factors . require(movement(f) ∨ new_stall_reason(f))
| → reference: reference/v-meta-stall-analysis.md

:: gate_before_status_advance : Task × StatusTransition → GateResult
| transition ∈ {todo→ready, ready→done} ⇒ gate_check(task) = pass
| ⊨ quay task check <id> before status write, never force-edit past false gate

:: g3_before_credit : ProvenanceClaim → AuditRequirement
| ∀ credit ∈ {σ_lift, convergence_claim, stall_reopen} . require(dispatch(G3_audit, ¬self))
| ⊨ separately-dispatched adjudicate, never self-performed
```

## Validation

- V_instance ≥ 0.60 (source experiment achieved floor)
- V_meta honestly carried forward as 0.0973, not re-baselined
- reference/patterns.md ≤ 400 lines
- examples/ traceable to specific iteration/task in provenance.md

## Implementation

1. Read `reference/patterns.md` for σ/V-function mechanics before writing any new task.
2. Read `reference/v-meta-stall-analysis.md` before setting a new meta objective.
3. Copy/adapt `examples/quay-author-SKILL.md` and `examples/quay-execute-SKILL.md` only if the consuming scope's task store/status model matches quay-native. If subagent-dispatch is available, re-verify live (iteration 14 sync-Agent timeout, iterations 78-87 async-manda success).
4. Reuse `reference/directive-lifecycle.md`'s pending/archive convention for out-of-band steering.
5. Reuse `reference/g3-audit-discipline.md`'s co-sign requirement for all load-bearing evidence claims.
6. Before claiming any V_meta factor has moved, check `reference/v-meta-stall-analysis.md`'s re-trigger conditions.
