---
id: ADR-014
title: "SPLIT-OR-COMMIT: a milestone is either fully done or needs-human (external
  blockers only) — no partial/pending outcome; in-project difficulty must be split,
  not deferred"
status: accepted
date: 2026-07-21
tags:
  - process
  - methodology
applies-to:
  - "experiments/quay-perpetual-stream/OUTER-LOOP.md"
  - "experiments/quay-perpetual-stream/inherited-core.md"
  - "tasks/DIR-026.md"
enforcement: "node experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.mjs ."
---
## Context

Prior to DIR-026, exp5's DoD tolerated "phased/partial delivery": a milestone could do a
slice of a compound task and leave the parent `pending`. This gave the loop a standing
licence to defer the hardest core item indefinitely — across M17/M18/M20/M22/M40 the
pipeline wiring in DIR-012/DIR-014 was deferred five times while each milestone did an
easier adjacent slice. The phrase "necessary-not-sufficient" had two conflicting readings:
the correct anti-fakery guard (Reading A) and a phased-partial-tolerance loophole
(Reading B). DIR-026 deletes Reading B and makes the two-outcome rule mechanical.

The enforcement mechanism (`it0-split-or-commit-check.mjs`, registered as the
`split-or-commit` gate in `.quay/gates.yml`) has been running since DIR-026 landed.

## Decision

1. **Two-outcome rule.** At ABSORB a milestone is in exactly one terminal outcome:
   (a) its selected task's AC + DoD are ALL satisfied → `done`; OR (b) the task is
   set to `needs-human` with a recorded reason. There is NO "partial delivery / stays
   pending" outcome. A `done` compound task MUST have ALL children `done`.

2. **needs-human legitimacy constraint.** `needs-human` is legitimate ONLY when
   completion is blocked by a factor OUTSIDE project control — an external service
   being down, a missing external credential/resource, an upstream dependency not yet
   released, or equivalent. In-project factors (architecture mismatch, algorithm
   complexity, large change volume, "this is hard") are NOT valid reasons for
   `needs-human` — they justify splitting smaller and completing.

3. **Mandatory split rule at SELECT.** If at charter time a candidate task cannot be
   FULLY completed within one milestone, the loop MUST split it into sub-tasks each
   of which IS fully completable (recursively until each child fits and is
   completable), and SELECT one child. Selecting a task with intent to complete only
   part of it is prohibited — split first, then select a whole child.

4. **Parent-done-iff-children rule.** A compound task (role=compound or non-empty
   children) is `done` iff ALL its children are `done`. A `done` parent with any
   non-done child is a violation caught by the mechanical gate.

## Consequences

- **Forbids:** a milestone ABSORBing a partial as "progress" with the parent left
  pending; using `needs-human` for an in-project factor (architecture, algorithm,
  change-volume); selecting a compound task without first splitting it into completable
  children; marking a compound task `done` while any child is non-done.
- **Enables:** every open piece of work is board-visible as an explicit child task, not
  prose; the deferral disease (hardest item deferred by easier-slice milestones) is
  structurally blocked; `needs-human` remains meaningful as a genuine external-blocker
  signal.
- **Mechanical enforcement:** `it0-split-or-commit-check.mjs` checks (1) every `done`
  compound task has all children `done`, and (2) every `todo`/`ready` compound task
  has non-empty children (split has occurred). The DoD meta-enforcer (`it0-dod-check.mjs`
  Clause 9) blocks any ABSORB outcome other than fully-green-done or external-reason
  needs-human. Fixtures pin both failure modes (partial→FAIL, internal-reason-needs-
  human→FAIL) and success modes (full-done→PASS, external-reason-needs-human→PASS).
- **Supersedes:** the "phased/partial delivery" reading (Reading B) in prior OUTER-LOOP.md /
  inherited-core.md DoD prose. Reading A (anti-fakery: done = real object operated, not
  a file created or fixture passed) is explicitly preserved and unaffected.
- **Source:** canonical decision is THIS ADR; DIR-026 (tasks/DIR-026.md) is the
  originating directive and points here. See [[DIR-026]] for the full finding + working
  history.
