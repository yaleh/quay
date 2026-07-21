---
id: exp5-M-TS-MIGRATION-P2
title: "TS migration P2 (ABI boundary, ADR-012): express the Provider ABI (task
  + ADR view-models) as TypeScript interfaces — the ABI contract becomes a type
  — behavior-preserving, autonomous under the golden-diff discipline."
status: ready
labels:
  - milestone-candidate
  - crystallization
parent: exp5-M-TS-MIGRATION
children: []
extra:
  schema: v1
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    exp5-M-TS-MIGRATION-P2
    experiments/quay-perpetual-stream/charters/M79-ts-migration-p2.md
    /tmp/m79-absorb-entry.md
---
## Proposal
Phase P2 of [[exp5-M-TS-MIGRATION]] (ADR-012). With the TS tooling landed (P0) and the pure-logic leaf
modules ported (P1), express the **Provider ABI** — the task view-model (`{id, title, status, role,
labels, parent/children, body}`) and the ADR view-model — as **TypeScript interfaces**. This is the
highest-value phase: the ABI contract, today enforced only by prose + conformance tests, becomes a
**type** that every provider (native, github) and Core typecheck against. `L_C` constraint-hardening at
the exact seam the whole product is organised around.

Behavior-preserving-by-construction (TS is a JS superset; Node 25 native type-stripping runs `.ts` with
no build step; `allowJs` coexistence). No runtime behavior changes — only the contract gains a
compile-time type. This phase runs AUTONOMOUSLY (the parent's `human-steered` gate was cleared by human
directive 2026-07-21); the safety that replaces it is the **executable behavior-preserving discipline**
in the Plan/DoD below, NOT a prose promise.

**Scope:** the ABI view-model type declarations + wiring native/github/Core to typecheck against them.
**Out of scope:** per-package internal migration (P3); exp5 method-infra scripts (P4); any runtime
behavior change.

## Plan
N/A — a single-seam TS milestone; split-or-commit at SELECT (DIR-026) if it cannot complete in one
milestone. Behavior-preservation is verified mechanically, not asserted:
- `tsc --noEmit` (the P0 type gate) passes on the repo with the new interfaces.
- The FULL existing suite + selfchecks + gates stay green before/after (native + Core + provider-ABI
  conformance) — a golden-diff on any load-bearing behavior; net zero behavior change.
- TDD/red-green per ADR-001; fresh-context adversarial audit per the DIR-044/048 discipline (did the
  type change any runtime path? is it a real contract type, not `any`-laundered?).

## Acceptance Criteria
- [ ] The Provider ABI task + ADR view-models exist as TypeScript interfaces (not `any`/loose records); native, github, and Core typecheck against them under `tsc --noEmit` (the P0 gate), which passes.
- [ ] Behavior-preserving: the full existing test + selfcheck + gate suite (incl. provider-ABI conformance) is green before AND after; a golden-diff shows no runtime behavior change.
- [ ] No dual source of the contract: the TS interface is THE ABI contract (prose/docs reference it, do not re-specify it) — ADR-004 single-source.

## Definition of Done
References the standard inherited-core DoD clauses; the bar is REAL LANDING, not artifacts:
- [ ] The ABI view-models are TS interfaces, `tsc --noEmit` passes, and both providers + Core typecheck against them — pasted evidence, on a real milestone.
- [ ] Full suite/selfchecks/gates green before/after (behavior-preserving); the it0 DoD meta-enforcer passes; TDD per ADR-001; a fresh-context adversarial audit confirms no runtime drift and no `any`-laundering of the contract.
- [ ] Per DIR-026 SPLIT-OR-COMMIT: lands done-or-`needs-human`; parent [[exp5-M-TS-MIGRATION]] is done only when ALL its children (P0–P4) are done.
