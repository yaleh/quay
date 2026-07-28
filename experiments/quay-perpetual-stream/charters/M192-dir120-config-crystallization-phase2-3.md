# M192 — DIR-120 Phase 2/3a: delete legacy config fallbacks + exp5 profile-fragment restriction

**Task:** DIR-120 · **Class:** development · **Value type:** capabilityGrowth
**Deliverable:** yes · **Charter tokens:** ~0.6 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ > 0 (capability-growth, deliverable). DIR-120's Phase 0/1 (M186) already landed the
`config-wiring-check` invariant and the 4 human-decided Phase-1 config values. This milestone
finishes the actual crystallization: delete the now-fully-superseded legacy `.quay/gates.yml` /
root `.quay/loop.yml` files AND their reader fallback code paths (deleting only the files while
keeping fallback code would leave two truths again), and restrict exp5's own loop config to a
profile-fragment schema (no `providers:`/`gates:` allowed).

**Scope change (2026-07-28, DIR-026 SPLIT-OR-COMMIT):** Phase 3b (the `drivable-workspaces.yml`
layering inversion — `drivable-workspace-check.ts`'s `DEFAULT_REGISTRY_PATH` removal, symlink
conversion, `selftest()` fix, and its two downstream consumer fixes) was split into **DIR-120-B**
after 5+ independent, real findings across `prepare-milestone.js`'s actual ProposalReview rounds
(this same charter's own real dispatch history) all traced to that one sub-area — a self-contained
unit of work, distinct in kind from this charter's remaining "delete legacy config files" scope.
This charter now covers Phase 2 + Phase 3a only.

## Why this task, as this charter

This is the real, otherwise-independent candidate task for **DIR-117-B**'s own required proof:
one real SELECT-quality candidate goes through `prepare-milestone.js` for real (Proposal
authors → adjudication → grounded review incl. mechanism-claim wiring coverage → Plan author →
Plan-check → receipt), then `execute-milestone.js` consumes that real receipt via
`preparationReceiptFile`. DIR-120's own scope is real, substantive, and file-disjoint from
`execute-milestone.js`/`prepare-milestone.js` themselves (confirmed via `touches-orthogonality-
check.ts`), so this real landing is not confounded by DIR-117-B's own simultaneous changes to the
driver files.

## Scope

Per `tasks/DIR-120.md`'s own Acceptance Criteria and Definition of Done — not summarized here to
avoid a second, driftable copy. In short, this milestone lands DIR-120's remaining Phase 2 and
Phase 3a:

1. **Phase 2**: delete root `.quay/gates.yml` and root `.quay/loop.yml`; delete the corresponding
   branch-A fallback in `packages/quay/src/gate/config/loader.ts` and `packages/quay/src/
   loop-params.ts` (branch B stays — exp5 depends on it). Then prove a real `quay gate` call and a
   real loop dispatch both still work.
2. **Phase 3a**: restrict exp5's own `.quay/loop.yml` to a profile-fragment schema (loop params
   only; `providers:`/`gates:` mechanically FAIL, not warn) — RED fixture (a fragment carrying
   `providers:`) and GREEN fixture (a valid loop-only fragment), both with real output.
3. **Cross-check** (round-7 `prepare-milestone.js` finding): prove `config-wiring-check.ts`'s
   verdict for the `gates`/`loop` fields agrees with `readGatesConfig`/`readLoopParams`'s real
   post-deletion behavior, side by side.

**Out of scope for this charter**: Phase 3b (`drivable-workspaces.yml`/`drivable-workspace-check.ts`
layering inversion) — see `DIR-120-B`'s own future charter.

## Touches

- .quay/gates.yml
- .quay/loop.yml
- packages/quay/src/gate/config/loader.ts
- packages/quay/src/loop-params.ts
- experiments/quay-perpetual-stream/.quay/loop.yml
- plugin/scripts/config-wiring-check.ts
- experiments/quay-perpetual-stream/scripts/config-wiring-check.ts
- packages/quay/test/loop-params.test.mjs
- packages/quay/test/gate-ergonomics.test.mjs
- milestones/M192/**

## Done-when

Per `tasks/DIR-120.md`'s own remaining unticked AC/DoD items:
1. Root `.quay/gates.yml`/`.quay/loop.yml` deleted AND their branch-A fallback code deleted —
   grep-confirmed no remaining read path (branch B unchanged).
2. A real post-deletion `quay gate` call and a real loop dispatch both work — proving deleted
   weight was dead, not live.
3. exp5 profile-fragment RED/GREEN fixtures both shown with real output.
4. `config-wiring-check.ts`'s verdict and the readers' real behavior shown to agree post-deletion.
5. Full/focused test suites green, including `gate-ergonomics.test.mjs`/`dod-gate-set.test.mjs`
   re-run unmodified.
6. **This milestone's own real dispatch record (SELECT-quality candidate → `prepare-milestone.js`
   real run → `preparation.json` receipt → `execute-milestone.js` with `preparationReceiptFile` →
   Build only after zero-finding Proposal/Plan checks) is DIR-117-B's own evidence — captured
   separately in DIR-117-B's own task record, not duplicated here.**

## Inner termination

Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ e9905ca4931bfdc889c96d7ae83d657e786316c7
