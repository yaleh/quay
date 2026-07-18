# DIR-009

- status: pending
- created_by: human (Yale Huang), asserted directly in this live conversation
- created_at: 2026-07-18
- title: Track exp5's own non-directive work in quay's task board — as backlog-primitive tasks that predate and regroup into milestones (generalize M05's file-canonical projection beyond directives), so the OUTER stream is self-hosted and visible in the Web UI

## Finding

The `quay serve` Web UI (port 4173) renders only what the native provider's
`./tasks/` store contains. As of this conversation that store holds, for
Experiment 5, **only** the directive projections `DIR-003..DIR-008` (created
by M05-dir-projection's `/quay-directive` skill step). **Every other unit of
exp5's own work is invisible in quay**: the 11 milestones (M01..M11), their
iterations, and every `backlog.md` candidate exist purely as markdown under
`experiments/quay-perpetual-stream/{charters,milestones,backlog.md,dashboard.md}`
and were never written to the task store.

This is not an oversight — M05-dir-projection's charter (in-scope item 6)
explicitly scoped it out: "Do NOT build a general-purpose task-projection
framework beyond directives — scope is directives only." So the invisibility
of non-DIR work is exactly the half M05 deliberately deferred; it will NOT
self-resolve as milestones advance. (By contrast, the "DIR-009+ not yet
visible" case IS self-healing: the moment a new DIR is authored, the skill
projects it. And DIR-001/DIR-002 are a separate, non-self-healing historical
hole — they predate the M05 mechanism and were never backfilled.)

Two grounded precedents bound the design space:
- **M05 directive projection** — file canonical, task is a regenerated
  (never hand-edited) `label: directive` projection, an anti-drift check
  (`scripts/it0-dir-projection-check.{sh,mjs}`) fails on divergence, and the
  OUTER-LOOP drain step reconciles both channels. This is the reusable
  machinery to generalize.
- **exp4 practice** — exp4 DID self-host its dev work: ~55 `QX-*` tasks
  carrying `experiment-4` + `iteration-N` + surface labels (e.g. `QX-067`:
  `experiment-4/iteration-19/packaging`). exp5 dropped this practice. So
  "self-hosting the experiment's work as tasks" is not novel here — it is a
  regression from exp4 that M05 partially (directives-only) restored.

**Granularity correction (human, this conversation) — the projection
direction is NOT milestone→task 1:1.** Tasks are *backlog primitives that
are created long before a milestone is selected*, and their granularity is
inherently uneven: a large task becomes an **epic** that is split into
subtasks; several small tasks are **merged into one milestone at SELECT
time**. So the task↔milestone relationship is a many-to-many *regrouping*
decided at SELECT — a milestone is best modeled as a grouping/label applied
over one-or-more pre-existing tasks (and epics decompose via
`parent/children`, which the native store already supports), not as a 1:1
mirror of a milestone. This matches the existing `backlog.md` shape
(candidates exist ahead of selection; some big, some small).

## Requested action

Produce a **design document only** at this stage (per the human's routing
decision: "先只出设计文档/directive" — do not implement, do not add a
dispatch-ready charter, do not hand-edit `OUTER-LOOP.md` yet). The design
should be detailed enough to later become a backlog candidate that the OUTER
loop SELECTs → charters → dispatches through its own machinery (dogfooding-
consistent; a hand-hacked implementation would bypass the experiment's own
governance and would itself be an un-dogfooded "dogfooding" change).

The design must cover, at minimum:

1. **Task as the backlog primitive.** exp5 backlog candidates become
   `label: milestone-candidate` (or similar) quay tasks *when created*,
   ahead of selection — not derived from milestones after the fact. Reconcile
   this with `backlog.md`: decide whether `backlog.md` stays canonical with
   tasks as its projection (M05 pattern), or whether tasks become canonical
   and `backlog.md` becomes a generated view. State the single source of
   truth explicitly — the M05 lesson is that ambiguity here is the whole bug.

2. **Variable granularity + regrouping.** Model epics (a big task split into
   subtasks via `parent/children`) and small-task→milestone merging (several
   tasks grouped under one milestone at SELECT). Define how a milestone is
   represented over its member tasks — a shared `milestone:M-NN` label, a
   parent "milestone" task with the members as children, or an `extra` field
   — and how membership is assigned at SELECT and frozen for the milestone's
   duration (invariant: charter frozen mid-milestone).

3. **Status/lifecycle mapping.** Map task status across the OUTER lifecycle:
   backlog/unselected → SELECTED/dispatched → DONE (ABSORB), plus epic and
   deferred/stale states (cf. backlog rows marked STALE). Distinguish a
   task's own store status from any milestone-grouping status, the way M05
   distinguishes task status from the directive's mirrored `status:`.

4. **Projection + anti-drift, generalized from M05.** A regenerated (never
   hand-edited) projection body; a sibling anti-drift check (generalize
   `it0-dir-projection-check`) that fails on task↔canonical divergence; and
   the OUTER-LOOP drain/reconcile hook (the milestone analogue lives in
   SELECT/ABSORB, not in a skill, since the OUTER loop — not `/quay-directive`
   — drives the milestone lifecycle).

5. **Web UI surfacing = zero new UI code.** The generic `?label=` filter
   already works (QW-005), so a `label: milestone-candidate` / `milestone:M-NN`
   scheme surfaces exp5 work in the running Web UI with no serve.js change,
   exactly as directives did.

6. **One-time backfill plan.** M01..M11 (and any still-open backlog
   candidates) need a documented one-time backfill, same category as the
   DIR-001/DIR-002 historical hole — specify how, without rewriting history
   the OUTER loop will re-derive.

7. **Non-goals / guardrails.** Keep files canonical unless (1) explicitly
   decides otherwise; do not build task-projection for anything beyond exp5's
   own backlog/milestone work in this pass; do not perturb an in-flight
   milestone's frozen charter.

Deliverable: a design doc (e.g. under `docs/proposals/` or
`experiments/quay-perpetual-stream/`) capturing the above, cross-referencing
DIR-002/M05 as the pattern source and exp4's `QX-*` labeling as the prior
practice. It is then eligible to be drained into `backlog.md` as a real
milestone candidate at a future OUTER boundary.

## Resolution
<!-- added when moved to archive/, or updated in place if deferred:
- resolved_by: iteration-N / milestone M-NN
- outcome: applied | deferred | rejected
- evidence: pointer to the design doc / iteration report section / commit -->
