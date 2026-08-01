---
id: DIR-124-F4c
title: "Seed-doc category annotations (repo-ground-truth.md headings + 1:1 test)"
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
`split-multi-mechanism`) — the **seed-doc category annotations**. This child owns adding a
`category: <slug>` annotation to each of the 8 seed-doc headings in
`docs/references/repo-ground-truth.md`, plus a test asserting a 1:1 mapping between the annotated
headings and the registry's `CATEGORIES` const (from F4-M1). This makes the seed doc the readable
index of the canonical fact-class enumeration and mechanically pins it against the registry
whitelist so the two never drift.

### Chosen mechanism

1. **`category: <slug>` annotations** — each of the 8 headings in `repo-ground-truth.md` gains an
   explicit `category: <slug>` annotation matching one of the 8 categories (`cli-paths`,
   `coverage-format`, `touches-matching`, `provider-defaults`, `module-signatures`,
   `evidence-surface`, `subprocess`, `gate-resolution`).
2. **1:1 test** — a test asserts that the set of annotated categories in the seed doc equals
   exactly the `CATEGORIES` const exported by `ground-truth-registry.ts` (both mirrors).
3. **No data/TS changes** — the registry JSON (F4-M2) and the TS module (F4-M1) are read-only
   inputs; only the seed doc + tests are modified.

**WIRING-CLAIM (F4c-SEED-ANNOTATIONS):** all 8 `repo-ground-truth.md` headings carry a
`category: <slug>` annotation, and a test asserts the annotated set is exactly `CATEGORIES` (1:1),
so the seed doc headings and the registry category whitelist never drift. → AC1: seed-doc headings
annotated 1:1 against `CATEGORIES`.

## Acceptance Criteria

- [ ] All 8 `repo-ground-truth.md` headings carry a `category: <slug>` annotation.
- [ ] A test (both mirrors) asserts the annotated category set equals exactly the `CATEGORIES`
  const from `ground-truth-registry.ts` (1:1, no missing/extra).
- [ ] No registry JSON or TS-module behavior changes; tests GREEN per `scripts/test.sh`.

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] Landed on `master` under human-steered discipline.
- [ ] The 1:1 test passes against the live seed doc + live `CATEGORIES` const (real test/CLI
  evidence).
- [ ] A fresh independent audit finds no refutation.

## Touches

- `docs/references/repo-ground-truth.md`
- `experiments/quay-perpetual-stream/scripts/ground-truth-registry.ts` (read-only input — CATEGORIES is verified against, not modified; owned by F4a/M270)
- `plugin/scripts/ground-truth-registry.ts` (read-only input — mirror)
- `experiments/quay-perpetual-stream/test/*ground-truth*.test.mjs`
- `plugin/test/*ground-truth*.test.mjs`
- `docs/plans/M272-dir-124-f4c.md`
