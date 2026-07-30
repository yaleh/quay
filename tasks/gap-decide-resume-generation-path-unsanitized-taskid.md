---
id: gap-decide-resume-generation-path-unsanitized-taskid
title: prepare-milestone.js's Stage-4 --decide-resume pre-check computes the
  generation-record path via raw, unsanitized taskId interpolation while
  proposal-convergence.ts's own CLI sanitizes it -- a slash-containing
  taskId would silently diverge; fail-safe (degrades to cold), zero
  real-production blast radius today, filed as a follow-up
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
  acceptance: node --experimental-strip-types --test plugin/test/prepare-milestone-convergence.test.mjs
---
## Proposal

Make `.claude/workflows/prepare-milestone.js`'s (+ `plugin/workflows/` mirror) generation-record
path computation reuse the SAME `_safeTaskIdSegment()`-style sanitization
`proposal-convergence.ts`'s own `_generationPath()`/`_leasePath()` (and DIR-126-A's
`prepare-admission-check.ts` before it) already apply, instead of raw `${_taskId}` interpolation.

## Finding

Discovered 2026-07-29 by the independent post-Land adversarial audit of M202/DIR-126-C: line ~202
of `prepare-milestone.js` builds `_generationRecordPath` via raw, unsanitized `${_taskId}`
interpolation, while `proposal-convergence.ts`'s own `_generationPath()`/`_leasePath()` sanitize via
`_safeTaskIdSegment()` (`/[\\/]/g → "_"`, "never let taskId escape leaseDir via a path separator" —
an explicit comment already present in DIR-126-A's `prepare-admission-check.ts`, lines 61-71, this
session's own precedent). For a slash-containing taskId, the two computations resolve to DIFFERENT
files:

```
workflow raw path resolved:  .quay/tmp/scratch-xyz/task.generation.json
CLI sanitized path:          .quay/prepare-leases/.._tmp_scratch-xyz_task.generation.json
MATCH: false
```

The audit assessed this correctly as fail-safe (a mismatch just means the pre-check never finds a
prior record, so it degrades to `cold` — never silently corrupts state or resumes unsafely) and
zero real-production blast radius today (no real `tasks/*.md` id in this repo contains `/` or `\`).
Not REFUTED-grade; filed as a real, if narrow and currently dormant, follow-up.

## Requested action

1. In `.claude/workflows/prepare-milestone.js` (+ `plugin/workflows/` mirror), replace the raw
   `${_taskId}` interpolation in the Stage-4 pre-check's `_generationRecordPath` computation with
   the same sanitization `proposal-convergence.ts`'s `_safeTaskIdSegment()`-equivalent applies (or,
   more simply, avoid the workflow-side path derivation entirely and let the `--decide-resume` CLI
   itself be the single source of truth for path resolution, since it already sanitizes correctly).
2. Add a regression test: a slash-containing taskId's pre-check path computation matches the real
   CLI's own sanitized path.
3. Re-verify no regression: `plugin/test/prepare-milestone-convergence.test.mjs` and
   `experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs` stay green.

## Acceptance Criteria

- [ ] The workflow-side path computation reuses (or defers entirely to) the same sanitization the
  real CLI applies — `cmp`/direct comparison confirms both computations resolve to the identical
  path for a slash-containing taskId.
- [ ] A new regression test confirms the fix using a slash-containing taskId fixture.
- [ ] No regression: both test files stay green.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [ ] Landed on `master` under human-steered discipline (this touches
  `.claude/workflows/prepare-milestone.js`, the control-plane script every future milestone's
  Prepare stage runs through).
- [ ] Real, non-fixture evidence: a slash-containing-taskId scratch dispatch's pre-check path now
  matches the real CLI's own sanitized path, confirmed via direct before/after comparison.

## Touches

- .claude/workflows/prepare-milestone.js
- plugin/workflows/prepare-milestone.js
- plugin/test/prepare-milestone-convergence.test.mjs
