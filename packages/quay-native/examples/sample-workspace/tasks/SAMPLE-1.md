---
id: SAMPLE-1
title: "Ship a bilingual greeting endpoint"
status: ready
labels:
  - epic
parent: null
children:
  - SAMPLE-1A
  - SAMPLE-1B
extra: {}
---
## Proposal

Illustrative **compound** ("epic") task: `role` is derived automatically from
`children` being non-empty (never a stored field — see
`packages/quay-native/src/store.js`), so this task is `role: compound`
without any frontmatter saying so. It groups two primitive child tasks that
must both reach `done` before this one's own `ready -> done` gate check can
pass (`quay-native task check SAMPLE-1`) — today it correctly reports
`ok: false` because SAMPLE-1B is still `todo`.

## Plan

Split the work into two independently-completable primitives: the greeting
function itself (SAMPLE-1A) and its i18n follow-up (SAMPLE-1B).

## Acceptance Criteria

- [x] Both child tasks (SAMPLE-1A, SAMPLE-1B) are `status: done`.
- [ ] `quay-native task check SAMPLE-1` (or `quay task check SAMPLE-1` via
      Core) reports the compound task's own gate as satisfied only once
      every child is done.

## Definition of Done

References the standard five DoD clauses (illustrative task — no real
external methodology is attached here; this file exists purely to
demonstrate the view-model shape a fresh `quay`/`quay-native` install ships
with).
