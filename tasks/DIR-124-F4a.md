---
id: DIR-124-F4a
title: "Ground-truth registry TS module (ground-truth-registry.ts)"
status: todo
labels:
  - directive
  - milestone-candidate
parent: DIR-124-F4
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

Split from DIR-124-F4 (M260, ProposalReview disposition `split-recommended` /
`split-multi-mechanism`) — the **registry TS module**. This child owns
`experiments/quay-perpetual-stream/scripts/ground-truth-registry.ts` (byte-identical mirror at
`plugin/scripts/ground-truth-registry.ts`): the `CATEGORIES` const (the canonical 8 fact-class
enumeration), the pure functions `validateRegistry` / `promoteFact` / `computeContentHash`, and an
`isDirectEntry`-guarded CLI (`--validate`, `--promote`, `--inject`, `--version`, `--hash`,
`--selftest`). This module is the single production owner of the registry shape + category
whitelist; the seeded data file (F4-M2) and the seed-doc annotations (F4-M3) depend on it.

### Chosen mechanism

1. **`ground-truth-registry.ts` (both mirrors)** exports:
   - `CATEGORIES` — the 8 seed-doc sections (`cli-paths`, `coverage-format`, `touches-matching`,
     `provider-defaults`, `module-signatures`, `evidence-surface`, `subprocess`, `gate-resolution`)
     as the single canonical fact-class enumeration.
   - `validateRegistry(registry)` — schema + category-whitelist validation (unknown category →
     fail-closed).
   - `promoteFact(registry, fact)` — append, version bump, hash recompute.
   - `computeContentHash(registry)` — sha256 over canonicalized sorted facts.
2. **`isDirectEntry`-guarded CLI** — the CLI is reachable only as a direct entry point, exposing
   `--validate [--receipt <preparation.json>]`, `--promote <fact-json>`, `--inject
   [--categories <cat,...>]`, `--version`, `--hash`, `--selftest`, following the repo's
   `gate-script-base.ts` precedent.
3. **Mirror parity** — both copies byte-identical (`diff` exit 0) at Land.

**WIRING-CLAIM (F4a-REGISTRY-MODULE):** `ground-truth-registry.ts` is the single owner of the
registry shape, the `CATEGORIES` whitelist, and validate/promote/hash; a fact with an unknown
category fails `--validate`/`--promote` closed pre-dispatch. → AC1: module exists, exports
`CATEGORIES`, pure functions, guarded CLI; `--selftest` exits 0.

## Acceptance Criteria

- [ ] `ground-truth-registry.ts` (both mirrors) exports `CATEGORIES` enumerating exactly the 8
  seed-doc sections.
- [ ] `validateRegistry` / `promoteFact` / `computeContentHash` are pure, unit-testable functions;
  a fact with an unknown category fails closed.
- [ ] The CLI is `isDirectEntry`-guarded; `--selftest` exits 0 and exercises
  validate/promote/hash round-trip.
- [ ] Both mirrors byte-identical (`diff` exit 0); tests RED/GREEN per `scripts/test.sh`.

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] Landed on `master` under human-steered discipline.
- [ ] A real `node --experimental-strip-types ground-truth-registry.ts --selftest` (and a
  `--validate` on the module's own fixtures) passes on both mirrors (real CLI evidence).
- [ ] A fresh independent audit finds no refutation.

## Touches

- `experiments/quay-perpetual-stream/scripts/ground-truth-registry.ts`
- `plugin/scripts/ground-truth-registry.ts`
- `experiments/quay-perpetual-stream/test/*ground-truth*.test.mjs`
- `plugin/test/*ground-truth*.test.mjs`
- `docs/plans/M270-dir-124-f4a.md`
