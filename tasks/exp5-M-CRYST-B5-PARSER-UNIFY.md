---
id: exp5-M-CRYST-B5-PARSER-UNIFY
title: "B5 [subtractive] Unify the parser fork: regenerate-backlog-view.mjs
  imports the canonical extractSection (review C2)"
status: todo
labels:
  - milestone-candidate
  - crystallization
parent: exp5-M-CRYST
children: []
extra:
  schema: v1
---
## Proposal
Adversarial review of the first wave (2026-07-19) found a latent parser fork: `scripts/regenerate-backlog-view.mjs:58` defines its OWN `extractSection` (non-depth-aware, different regex) separate from the now-canonical `scripts/task-schema.mjs :: extractSection`. It is a view generator, not the schema, so it does NOT violate the single-source claim for the schema itself — but it is exactly the fork-class the crystallization is meant to eliminate (two definitions of "parse a markdown section" that can drift). Unify by importing the canonical `extractSection` (verify behavior-preserving against the backlog view's current output first, since the canonical one is depth-aware and the local one may not be — if the outputs differ, decide which is correct and pin a fixture).

## Plan
N/A — a single-module refactor (import the canonical function, drop the local copy) gated by a before/after diff of the generated backlog view; no staged docs/plans doc warranted.

## Acceptance Criteria
- [ ] `grep -rn "function extractSection" experiments/quay-perpetual-stream/scripts/` returns exactly ONE definition (in task-schema.mjs); regenerate-backlog-view.mjs imports it.
- [ ] The regenerated backlog view is byte-identical before/after the unification (or, if it legitimately changes, the change is reviewed + a fixture pins the new correct output) — no silent drift.
## Definition of Done
References the standard inherited-core DoD clauses. Real landing:
- [ ] One `extractSection` definition in the scripts dir; the backlog-view generator consumes it.
- [ ] Regenerated view diff is empty or reviewed+fixture-pinned (transition is detectable, not silent).