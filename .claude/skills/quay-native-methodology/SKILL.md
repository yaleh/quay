---
name: quay-native-methodology
description: Use when inheriting or extending quay's task-authoring/execution methodology (Layer-2 quay:author/quay:execute Skills, task check gate, directive lifecycle, G3 out-of-band audit discipline) into a new scope — e.g. quay Core development, a follow-on BAIME experiment, or a new Provider. Extracted HALTED-NOT-CONVERGED from experiments/quay-native-bootstrap/ (quay-native bootstrap) at iteration 88. Do not present this as a converged methodology; it is an inheritance snapshot.
status: halted
V_instance: 0.6016
V_meta: 0.0973
σ: 0.8493
---

# quay-native-methodology

λ(scope, task) → GatedOutcome | inherit({skills, gate, directives, audit}) ∧ apply(scope, task)

## Status (see provenance.md)

Extracted from `experiments/quay-native-bootstrap/` at iteration 88 — halted by
human owner, NOT converged. V_instance=0.6016, V_meta=0.0973 (flat since
iteration 66, 22+ consecutive iterations), σ_strict=62/73=0.8493. Full
convergence-criteria accounting and iteration narrative in `provenance.md`
§Skill extraction — methodology.

## What this Skill packages (inherited, stage 0 — per v2 proposal §2.2)

1. Layer-2 orchestration Skills `quay:author` (todo→ready) and `quay:execute`
   (ready→done), copied verbatim in `examples/` from
   `packages/quay-native/skills/{author,execute}/SKILL.md`. Layer-1
   operation steps (write-proposal, review-proposal, write-plan,
   review-plan, implement, adjudicate) were **never materialized as
   standalone Skill files** — they exist only as named Method steps inside
   these two Layer-2 Skills, each carrying its own degraded-fallback note
   (no subagent-dispatch primitive was available for most of the source
   experiment's life). Preserve this structure; do not invent standalone
   Layer-1 files that never existed.
2. The `task check` gate mechanics — `store.js`'s `check()`/`childrenStatus()`
   functions asserting `todo→ready` and `ready→done`, including compound
   (epic) recursive children-done checking. See `reference/gate-mechanics.md`.
3. The directive mechanism (`experiments/quay-native-bootstrap/directives/{pending,archive}/`) and
   its one-time-consumed lifecycle. See `reference/directive-lifecycle.md`
   and `templates/directive-template.md`.
4. The out-of-band audit (G3) discipline: every σ lift is co-signed by an
   independently-dispatched adjudicate check, never self-performed by the
   iteration that did the work. See `reference/g3-audit-discipline.md`.

## Constraints

- honest_inheritance: cite `experiments/quay-native-bootstrap/provenance.md` and iteration reports
  as the evidence source for any claim about what this methodology can/
  cannot do — never assert capability from this Skill's own prose alone.
- ¬imply_convergence: never state or imply experiment 1 converged. It did
  not (V_meta 0.0973 << 0.80).
- σ_boundary: a consuming scope (e.g. quay-core-bootstrap) must reset its
  own provenance ledger and task-ID prefix (§6 of the v2 proposal) rather
  than concatenating with this experiment's σ_strict.
- stalled_factors_are_starting_hypotheses: the four V_meta stall reasons
  in `reference/v-meta-stall-analysis.md` are the inherited scope's meta
  objective raw material, not settled conclusions — a consuming experiment
  must show either genuine movement or a **different** stalling reason,
  per v2 proposal §5.
- gate_before_status_advance: any task driven through this methodology
  must pass `quay task check <id>` before `--status ready`/`--status done`
  is applied; never force a status edit past a `false` gate result.
- g3_before_credit: no σ/provenance credit is claimed without a separately
  dispatched (not self-performed) out-of-band audit co-sign.

## Validation

- V_instance_snapshot ≥ 0.60 (source experiment's own achieved floor;
  do not claim higher without new evidence in the consuming scope)
- V_meta_snapshot honestly carried forward as 0.0973, not re-baselined to
  the 0.15-0.25 seed range (v2 proposal §5)
- reference/patterns.md ≤ 400 lines
- every example in examples/ traceable to a specific iteration/task in
  experiments/quay-native-bootstrap/provenance.md or experiments/quay-native-bootstrap/iterations/

## Implementation

When a consuming scope invokes this Skill:

1. Read `reference/patterns.md` for the σ/V-function mechanics and the
   final-state numbers before writing any new task.
2. Read `reference/v-meta-stall-analysis.md` before setting a new meta
   objective — do not silently re-derive a low V_meta baseline as if
   starting fresh (v2 proposal §5's "scoring error" warning).
3. Copy/adapt `examples/quay-author-SKILL.md` and
   `examples/quay-execute-SKILL.md` only if the consuming scope's task
   store/status model matches quay-native's (`todo/ready/done/needs-human`,
   AC/DoD artifact-gated transitions). If the status model differs, treat
   these as reference method-shape, not a drop-in copy.
3a. If the consuming scope has a working subagent-dispatch primitive that
   quay-native's source environment lacked, do **not** silently assume
   fresh-context Layer-1 isolation now works — re-verify it live (the
   source experiment's own iteration 14 found a synchronous `Agent` spawn
   timing out after 30s; iterations 78-87 later found an async manda
   nested-subagent path that *did* work, but only under a strict
   background-caller hard rule, §0b). Check `reference/g3-audit-discipline.md`
   for the exact precedent before assuming either way.
4. Reuse `reference/directive-lifecycle.md`'s pending/archive convention
   verbatim if the consuming scope wants an out-of-band steering channel;
   it is orthogonal to provenance.md and audits/, not a replacement for
   either.
5. Reuse `reference/g3-audit-discipline.md`'s co-sign requirement for any
   status/gate transition the consuming scope treats as load-bearing
   evidence (a σ lift, a convergence claim, a stall-factor re-open).
6. Before claiming any V_meta factor has "moved," check
   `reference/v-meta-stall-analysis.md`'s re-trigger conditions for that
   factor — they are concrete and checkable, not vibes-based.
