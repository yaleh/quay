# M192 — DIR-120 Phase 2/3: delete legacy config fallbacks + exp5 profile-fragment restriction

**Task:** DIR-120 · **Class:** development · **Value type:** capabilityGrowth
**Deliverable:** yes · **Charter tokens:** ~0.6 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ > 0 (capability-growth, deliverable). DIR-120's Phase 0/1 (M186) already landed the
`config-wiring-check` invariant and the 4 human-decided Phase-1 config values. This milestone
finishes the actual crystallization: delete the now-fully-superseded legacy `.quay/gates.yml` /
root `.quay/loop.yml` files AND their reader fallback code paths (deleting only the files while
keeping fallback code would leave two truths again), restrict exp5's own loop config to a
profile-fragment schema (no `providers:`/`gates:` allowed), and fix the `drivable-workspaces.yml`
layering inversion.

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
Phase 3:

1. **Phase 2**: delete root `.quay/gates.yml` and root `.quay/loop.yml`; delete the corresponding
   fallback branches in `packages/quay/src/gate/config/loader.ts` and `packages/quay/src/
   loop-params.ts`. Then prove a real `quay gate` call and a real loop dispatch both still work
   (the DoD's own explicit post-deletion proof requirement).
2. **Phase 3**: restrict exp5's own `.quay/loop.yml` to a profile-fragment schema (loop params
   only; `providers:`/`gates:` mechanically FAIL, not warn) — RED fixture (a fragment carrying
   `providers:`) and GREEN fixture (a valid loop-only fragment), both with real output. Fix the
   `drivable-workspaces.yml` layering inversion (keep it an independent file per DIR-120's own
   Requested-action item 6 reasoning — do not merge it into `config.yml`).

## Touches

- .quay/gates.yml
- .quay/loop.yml
- packages/quay/src/gate/config/loader.ts
- packages/quay/src/loop-params.ts
- experiments/quay-perpetual-stream/.quay/loop.yml
- experiments/quay-perpetual-stream/drivable-workspaces.yml
- plugin/scripts/config-wiring-check.ts
- experiments/quay-perpetual-stream/scripts/config-wiring-check.ts
- milestones/M192/**

## Done-when

Per `tasks/DIR-120.md`'s own remaining unticked AC/DoD items:
1. Root `.quay/gates.yml`/`.quay/loop.yml` deleted AND their loader fallback code deleted —
   grep-confirmed no remaining read path.
2. A real post-deletion `quay gate` call and a real loop dispatch both work — proving deleted
   weight was dead, not live.
3. exp5 profile-fragment RED/GREEN fixtures both shown with real output.
4. `drivable-workspaces.yml` layering fixed, file stays independent (not merged into `config.yml`).
5. Full/focused test suites green.
6. **This milestone's own real dispatch record (SELECT-quality candidate → `prepare-milestone.js`
   real run → `preparation.json` receipt → `execute-milestone.js` with `preparationReceiptFile` →
   Build only after zero-finding Proposal/Plan checks) is DIR-117-B's own evidence — captured
   separately in DIR-117-B's own task record, not duplicated here.**

## Inner termination

Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ e9905ca4931bfdc889c96d7ae83d657e786316c7
