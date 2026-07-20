---
id: SAMPLE-1B
title: "Add a Spanish greeting variant: greet(name, 'es')"
status: todo
labels:
  - backend
  - i18n
parent: SAMPLE-1
children: []
extra: {}
---
## Proposal

Illustrative **primitive** task, still `status: todo` — demonstrates the
board showing an epic (SAMPLE-1) as `in-progress` while one child is `done`
(SAMPLE-1A) and the other is still `todo` (this task), which is exactly why
SAMPLE-1's own gate check does not yet pass.

## Plan

Extend `greet(name, locale)` with a `locale === "es"` branch returning
`"¡Hola, <name>!"`, defaulting to the existing English behavior for any
other locale value.

## Acceptance Criteria

- [ ] `greet("Mundo", "es")` returns the string `"¡Hola, Mundo!"`.
- [ ] `greet("World")` (no locale argument) is unchanged from SAMPLE-1A.

## Definition of Done

References the standard five DoD clauses (illustrative task).
