---
id: exp5-M-CRYST-B5-PARSER-UNIFY
title: "B5 [subtractive] Unify the parser fork: regenerate-backlog-view.mjs
  imports the canonical extractSection (review C2)"
status: done
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
- [x] `grep -rn "function extractSection" experiments/quay-perpetual-stream/scripts/` returns exactly ONE definition (in task-schema.mjs); regenerate-backlog-view.mjs imports it.
- [x] The regenerated backlog view is byte-identical before/after the unification (or, if it legitimately changes, the change is reviewed + a fixture pins the new correct output) — no silent drift.
## Definition of Done
References the standard inherited-core DoD clauses. Real landing:
- [x] One `extractSection` definition in the scripts dir; the backlog-view generator consumes it.
- [x] Regenerated view diff is empty or reviewed+fixture-pinned (transition is detectable, not silent).

## Resolution (2026-07-21, M68-cryst-b5)

Unification executed in worktree `milestones/M68/worktrees/iteration-0` (branch `milestones/M68-cryst-b5`).

**What changed:** `regenerate-backlog-view.mjs` previously defined a local `function extractSection`
(non-depth-aware, regex `##\s*<heading>\s*\n([\s\S]*?)(?=\n##\s|$)`, trimmed, returned `undefined`
on miss). Replaced with import of `extractSection` from `./task-schema.mjs` (depth-aware, returns
`null` on miss, untrimmed text on hit). Call sites in `fmtRow` updated to use `?? ""` and `.trim()`
to preserve identical output.

**Behavioral comparison:** Ran against all 79 milestone-candidate tasks (from live task store JSON).
With the adapter trim applied, outputs are byte-identical before/after on the full corpus. The
depth-aware vs non-depth-aware difference did not affect any current tasks (no nested headings that
would cause truncation differences in the `## Value type / cadence`, `## Source`, `## Outcome`, or
`## Status mirror` sections of existing tasks).

**C2 note:** No C2 (task-schema validator) implications arose. The canonical `extractSection` in
`task-schema.mjs` is unchanged; this task only consumed it, not altered it.
## Not selected (M69)
Done (M68). Not applicable.
