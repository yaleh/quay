---
name: quay-native-methodology
description: Reference material for quay's task-authoring/execution methodology — the `task check` gate contract (todo→ready, ready→done, compound-recursive), the directive out-of-band-steering lifecycle, the G3 independent-audit discipline ("the gate is both contestant and judge"), and the Layer-1/Layer-2 Skill pattern. Use when inheriting or extending this methodology's operational rules into a new scope. Extracted from a converged reference set — case studies, inventory data, and V-meta history stay in the source workspace's own skill, not duplicated here.
allowed-tools: Read
---

# quay-native-methodology

Portable reference material for quay's task-authoring/execution methodology: the `task check`
gate contract, the directive out-of-band-steering lifecycle, the G3 independent-audit discipline,
and the Layer-1/Layer-2 Skill structure precedent. This is the reusable operational subset only —
the originating workspace's specific case studies, inventory data, and V-meta stall analysis are
not duplicated here; consult the source workspace's own methodology skill for that history.

## Spec

```
:: taskCheckGate :: Task → {PASS, FAIL}
| Gate for todo→ready (artifact-completeness + AC checked-state) and ready→done
| (AC checked-state + recursive compound children-done). Never the sole arbiter
| of its own correctness — pair with g3AuditDiscipline below.
| → reference: reference/gate-mechanics.md

:: directiveLifecycle :: Directive → {pending, applied, deferred, rejected}
| Out-of-band steering channel: additive-only, one-time-consumed,
| pending/ → archive/ convention, never edits a live iteration's own files.
| → reference: reference/directive-lifecycle.md

:: g3AuditDiscipline :: ProvenanceClaim → AuditRequirement
| Every status transition / convergence / σ-lift claim requires an
| independently-dispatched audit that re-derives evidence — never self-performed
| by the session that did the work.
| → reference: reference/g3-audit-discipline.md

:: patterns :: Methodology → OperationalMechanics
| σ/V-function mechanics, the Layer-1/Layer-2 Skill split (as actually built:
| only Layer-2 materialized as files, Layer-1 as inline Method steps with an
| explicit dispatch-capable-target vs. degraded-fallback split), and how the
| three mechanisms above compose.
| → reference: reference/patterns.md

-- Formal constraints

:: gate_before_status_advance : Task × StatusTransition → GateResult
| transition ∈ {todo→ready, ready→done} ⇒ gate_check(task) = pass
| ⊨ run the gate before any status write; never force-edit past a false gate

:: g3_before_credit : ProvenanceClaim → AuditRequirement
| ∀ credit ∈ {status_advance, convergence_claim, σ_lift} . require(dispatch(audit, ¬self))
| ⊨ separately-dispatched review, never self-performed
```

## Implementation

1. Read `reference/gate-mechanics.md` before designing or extending any status-model gate —
   reuse the artifact-completeness + checked-state (not merely presence) + recursive
   (not one-level-deep) children-done shape; these are two regressions the source experiment
   already found and fixed, do not reintroduce them.
2. Read `reference/directive-lifecycle.md` before building any out-of-band steering channel —
   reuse the additive-only, one-time-consumed, `pending/` → `archive/` convention verbatim,
   regardless of the consuming scope's directory layout.
3. Read `reference/g3-audit-discipline.md` before crediting any status transition, convergence
   claim, or σ-lift — require a genuinely separate dispatch (background subagent or independent
   human/adjudicate pass) that re-derives evidence, not a self-reported "PASS."
4. Read `reference/patterns.md` for the general σ/V-function mechanics and the Layer-1/Layer-2
   Skill structure precedent before assuming a cleaner split is "the real design, just not yet
   built" — treat the inline degraded-fallback structure as the actual proven artifact, and
   re-verify any subagent-dispatch assumption live before building on top of it.
