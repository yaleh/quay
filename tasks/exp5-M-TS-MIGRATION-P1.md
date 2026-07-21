---
id: exp5-M-TS-MIGRATION-P1
title: "TS migration P1 (leaf modules, ADR-012): port pure-logic leaf modules
  (task-schema, provider-client, gate registry — no wide product-code rewrite
  yet) to real .ts, behavior-preserving + golden-diff. Loop-executable,
  human-authorized slice of exp5-M-TS-MIGRATION, phase 2 of 5 (P0 done)."
status: todo
labels:
  - milestone-candidate
  - crystallization
  - milestone:M-77
parent: exp5-M-TS-MIGRATION
children: []
extra:
  schema: v1
  authorized: "2026-07-21 (human): P1 approved for autonomous SELECT, per the
    parent's phased split-or-commit plan (DIR-026) — 'approve execution of
    exp5-M-TS-MIGRATION' read as authorizing the next phase, matching the P0
    authorization pattern (each phase authorized separately after the prior
    lands). Scope is LEAF PURE-LOGIC MODULES ONLY — see Proposal for the exact
    file list. NOT authorized: any change to the Provider ABI surface, CLI
    argument parsing, MCP tool wiring, or web UI code — those stay human-steered
    pending separate authorization (P2+). Behavior-preserving + golden-diff
    discipline (ADR-012) applies; the tsc --noEmit gate (wired at P0) MUST stay
    GREEN throughout."
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    exp5-M-TS-MIGRATION-P1
    experiments/quay-perpetual-stream/charters/M77-ts-migration-p1.md
    /tmp/m77-absorb-entry.md
---
## Proposal
Phase 2 of [[exp5-M-TS-MIGRATION]] / ADR-012 — the second loop-executable slice, human-authorized 2026-07-21. P0 (`exp5-M-TS-MIGRATION-P0`, DONE at M63) established the tooling (tsconfig, `tsc --noEmit` gate, Node 25 native `.ts` run path, `.ts` under `node --test`) without touching product code. P1 spends that tooling on the **lowest-risk, most self-contained** files — pure-logic leaf modules with few/no internal importers, matching the parent's own P1 framing ("pure-logic first"):

Candidate scope for this milestone (pick ONE OR MORE of these leaf files per iteration — do not attempt all in one milestone unless trivially small; split-or-commit per DIR-026):
- `plugin/scripts/task-schema.mjs` / `experiments/quay-perpetual-stream/scripts/task-schema.mjs` (task frontmatter schema — pure parsing/validation logic, already duplicated across two copies per M68's unify-fork work; a TS port is a natural place to also confirm the two stay in sync or are already unified)
- `packages/quay/src/provider-client.js` (99 lines — thin ABI client wrapper)
- `packages/quay/src/gate/registry.js` (696 lines — gate registration/lookup; larger, may warrant its own milestone)

Each ported file: `.js`→`.ts` rename, add real types (not `any`-everywhere — the point is `L_C` hardening per ADR-012's Context), remove any `// @ts-nocheck` P0 ramp marker on that file if present, keep `allowJs`/`checkJs` coexistence for not-yet-ported neighbors, confirm `tsc --noEmit` gate stays GREEN, confirm the existing test suite for that module stays green with NO logic changes (golden-diff: behavior before == behavior after).

## Plan
N/A — split-or-commit (DIR-026): each milestone under this task ports 1 (or a small tightly-related set of) leaf file(s) end-to-end — rename, type, gate-check, test-green — rather than a partial multi-file sweep. If a candidate file turns out to have broad internal fan-in (many importers whose call sites would need touching), STOP and flag `needs-human` rather than widening scope past "leaf module" — that graduates it to P2/P3.

## Finding
[[exp5-M-TS-MIGRATION-P0]] landed clean (M63, DONE, adversarial audit: NO REFUTATION FOUND) — tooling path is proven GREEN. The parent's own phase list names P1 as "pure-logic first (task-schema-shaped modules, view-model types, provider-client, gate registry)"; this task operationalizes exactly that list as the next authorized, loop-executable slice.

## Requested action
Loop: SELECT this task per normal `ready`-status pickup once promoted; scope strictly to the candidate file list above (or a subset); if a candidate is found to have broad fan-in beyond "leaf", stop and land as `needs-human` with the finding recorded rather than widening scope.

## Acceptance Criteria
- [ ] At least one leaf module from the candidate list is renamed `.js`→`.ts` with real (non-`any`) types on its public surface.
- [ ] `tsc --noEmit` gate (wired at P0) stays GREEN including the newly-typed file(s).
- [ ] The existing test suite covering the ported module(s) stays green, unmodified in assertions (behavior-preserving — golden-diff, no logic change).
- [ ] Any P0 `// @ts-nocheck` ramp marker on the ported file(s) is removed (the file is now real-typed, not just tolerated).
- [ ] Scope stayed within "leaf pure-logic module" — no Provider ABI surface change, no CLI/MCP/web-UI code touched (if a candidate needed that, it was deferred/flagged instead of pulled in).

## Definition of Done
References the standard inherited-core DoD clauses; the bar is REAL LANDING, not artifacts:
- [ ] At least one real `.ts` leaf module lands on master, typed, gate-green, test-green — captured (DIR-026 real object), not a fixture.
- [ ] Existing suite green throughout (behavior-preserving); no product behavior changed.
- [ ] Scope discipline held: broad/ABI/CLI/MCP/web-UI changes were NOT pulled into this phase; any such need was flagged for P2+ instead.
- [ ] The parent [[exp5-M-TS-MIGRATION]] P1 progress is reflected (parent AC item 1 partially covers P0; this phase's own real evidence lives here, not duplicated into the parent body).

## Human verification when exp5 marks this done
1. Does at least one real `.ts` file exist in `packages/**` with meaningful (non-`any`) types, distinct from the P0 tooling ramp?
2. Does `tsc --noEmit` still pass GREEN on the whole repo including the new file(s)?
3. Is the existing test suite for the ported module(s) still green with no assertion changes (true golden-diff, not weakened tests)?
4. Did scope stay leaf-only — no ABI/CLI/MCP/web-UI files touched? If touched, was it correctly deferred/flagged instead?
5. If a build step was introduced, the gate is red, or scope crept beyond leaf modules, it is NOT landed — send back.
