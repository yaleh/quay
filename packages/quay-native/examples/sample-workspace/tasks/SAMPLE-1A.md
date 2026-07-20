---
id: SAMPLE-1A
title: "Implement greet(name) returning 'Hello, <name>!'"
status: done
labels:
  - backend
parent: SAMPLE-1
children: []
extra:
  acceptance: "true"
---
## Proposal

Illustrative **primitive** task (no children => `role: primitive`, derived
the same way as any compound task's derivation — see SAMPLE-1's Proposal).
Demonstrates a task with a `parent` link back to its compound epic
(SAMPLE-1) and a `extra.acceptance` shell command wired for
`quay gate SAMPLE-1A` (the gate engine's default `acceptance` gate runs this
command; here it's a trivial `true` stand-in since there's no real code to
build for a documentation example).

## Plan

N/A — single-step illustrative primitive, no further breakdown needed.

## Acceptance Criteria

- [x] `greet("World")` returns the string `"Hello, World!"`.

## Definition of Done

References the standard five DoD clauses (illustrative task).

## Resolution

Marked `done` as shipped sample data — this task is a fixture, not a real
in-flight unit of work, so its `## Resolution` section is pre-filled rather
than produced by a live audit.
