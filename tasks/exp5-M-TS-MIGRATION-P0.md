---
id: exp5-M-TS-MIGRATION-P0
title: "TS migration P0 (tooling only, ADR-012): tsconfig + `tsc --noEmit` type
  gate + Node 25 native type-stripping run path + `node --test` on a .ts file —
  NO product-code rewrite (P1–P4 stay human-steered in the parent).
  Loop-executable, human-authorized slice of exp5-M-TS-MIGRATION."
status: done
labels:
  - milestone-candidate
  - crystallization
  - milestone:M63
parent: exp5-M-TS-MIGRATION
children: []
extra:
  schema: v1
  authorized: "2026-07-20 (human): P0 ONLY approved for autonomous SELECT
    (split-or-commit per the parent's phased plan). Tooling only — NO broad
    product-code migration. Remaining phases P1–P4 stay human-steered in the
    parent [[exp5-M-TS-MIGRATION]], each authorized separately after P0 lands.
    Behavior-preserving + golden-diff discipline (ADR-012); the tsc gate MUST be
    GREEN (set initial strictness lenient, ramp later)."
---
## Proposal
The tooling slice of [[exp5-M-TS-MIGRATION]] / ADR-012 — the loop-executable FIRST phase, human-authorized 2026-07-20 (P0 only; P1–P4 remain `human-steered` in the parent). Establish the TypeScript run+check path WITHOUT migrating product code broadly:
- a `tsconfig.json` (`allowJs` + `checkJs`, strictness set lenient-then-rampable so the gate is GREEN at P0),
- a `tsc --noEmit` type gate wired as a quay gate / DoD check (data-driven per ADR-013 — command sourced from workspace config, not hardcoded),
- confirm Node 25 native type-stripping runs a `.ts` module with NO separate build step,
- confirm `node --test` runs a `.ts` test file.
This unblocks P1+ (leaf-module migration) but changes NO product behavior. Interim `L_G/L_D` stays on the JS-native proxies (ADR-012); P0 does not touch them.

## Plan
N/A — a single tooling milestone; behavior-preservation verified by the existing suite staying green. ADR-012 is the decision of record; the parent [[exp5-M-TS-MIGRATION]] tracks the phased program (P0–P4).

## Finding
[[exp5-M-TS-MIGRATION]] (ADR-012, accepted) is authorized phase-by-phase (DIR-026 split-or-commit). Repo is 100% JS (0 `.ts` / 24 `.js`, no `tsconfig`). P0 is the lowest-risk slice — tooling only, no broad rewrite — so it is the right first loop-executable phase; P1–P4 (which touch product code broadly) stay human-steered.

## Acceptance Criteria
- [x] `tsconfig.json` exists (`allowJs` + `checkJs`, strictness set so the gate is GREEN on the current repo); `node --test` runs at least one `.ts` test file (exit 0).
- [x] A `tsc --noEmit` type gate is wired as a quay gate / DoD check (data-driven per ADR-013 — command from workspace config, not hardcoded) and PASSES on the repo.
- [x] A `.ts` module runs under Node 25 native type-stripping with NO separate build step (demonstrated: a `.ts` file executes/imports and runs), captured in the milestone record.
- [x] Behavior-preserving: the full existing test + selfcheck + gate suite stays green before/after; NO product-code behavior changed (any `.ts` introduced is a trivial/leaf demonstrator, not a broad migration).

## Definition of Done
References the standard inherited-core DoD clauses; the bar is REAL LANDING, not artifacts:
- [x] The `tsc --noEmit` gate actually runs GREEN on the real repo AND a real `.ts` file runs + is tested under Node native type-stripping with no build — captured (DIR-026 real object), not a fixture.
- [x] Existing suite green throughout (behavior-preserving); NO broad product-code migration performed (that is P1+, still human-steered in the parent).
- [x] The parent [[exp5-M-TS-MIGRATION]] P0 AC is ticked; P1–P4 remain `human-steered` pending separate authorization.

## Execution record

**Milestone:** M63 | **Iteration:** 0 (LOOP-EXECUTABLE, no dual-iteration, no charter file)  
**Realized Δv:** ~+1.5 (TS tooling foundation; P1+ unblocked under ADR-012 ramp discipline)  
**BUILD commit:** `61f02e7` | **Merge commit:** `572c71d` (master)  
**Adversarial audit verdict:** NO REFUTATION FOUND (agent `a09cfe57ff1a62fe3`, artifact: `milestones/M63/audits/iteration-0-acceptance-audit.md`)  
**Outcome:** DONE — all 4 AC + 3 DoD items confirmed and ticked; `tsc --noEmit` gate GREEN; Node 25 native .ts run path proven; behavior-preserving (0 product-code logic changes); 16 JS files annotated with `// @ts-nocheck` ramp per ADR-012.

## Human verification when exp5 marks this done
1. Does `tsconfig.json` exist and does the `tsc --noEmit` gate run GREEN on the repo?
2. Does a real `.ts` file run under Node native type-stripping (no build step) and get tested by `node --test`?
3. Is the existing suite still green (behavior-preserving), and did P0 avoid broad product-code migration?
4. Are P1–P4 still `human-steered` in the parent (not silently pulled in)?
5. If a build step was introduced, or the gate is red, or broad product code was migrated, it is NOT landed — send back.