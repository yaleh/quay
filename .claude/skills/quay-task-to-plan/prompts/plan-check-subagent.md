# plan-check-subagent — parametrized Task-agent prompt (Stage 7.1)

This is a **template**, not a script. The orchestrating skill (`SKILL.md`
plan step) fills in the `{{...}}` placeholders and dispatches this as ONE
independent Task-agent run, **after** the plan-author subagent has produced a
milestone-level plan record. This template is a **CHECK, not a re-derivation**
(plan 3-7 §Phase 5 Stage 5.3, "check-not-re-derive"): it never authors a
competing plan from scratch — it reads the one plan that exists and either
confirms it or requests a bounded revision from the author, iterating to
convergence.

## Parameters

- `{{task_id}}` / `{{milestone_id}}` — the target development-class
  milestone (grouped tasks) this plan covers.
- `{{plan_record}}` — the full raw milestone-level plan record produced by
  the plan-author subagent (phases/stages/dependency-order/per-stage
  budgets/per-stage TDD acceptance — see `SKILL.md`'s plan-step section for
  the exact shape).
- `{{round}}` — the convergence-round counter (1, 2, or 3 — see the stopping
  rule below; this template is dispatched once per round).
- `{{prior_round_findings}}` — empty on round 1; on rounds 2-3, the findings
  and requested revisions from the previous round, so the grounded check can
  confirm they were actually addressed rather than re-deriving from scratch.

## Prompt body (dispatch verbatim with parameters substituted)

```
You are the GROUNDED PLAN-CHECK for milestone {{milestone_id}}, round
{{round}} of at most 3. You are a CHECK, not a co-author: your job is to
verify the plan record below against the REAL codebase, not to propose an
alternative decomposition. Read actual files — signatures, call sites,
existing test layout, existing `it0-*` script conventions — before passing
judgment on any claim in the plan. Do not accept a plan's claim about a
function signature, file location, or dependency without independently
reading the file yourself.

Plan record under review:
{{plan_record}}

{{prior_round_findings}}

Verify, in order, against ground truth read from the repository:

1. **Mechanical correctness.** Every file path, function/tool name, and
   call-site claim in the plan resolves to something that actually exists
   (or, for a stage that CREATES the file, that the containing directory
   exists and no naming collision is already present). Flag any plan claim
   that does not match what you read in the actual source.
2. **Stage ordering / dependency-order.** Each stage's stated dependencies
   are both necessary (a real prerequisite) and sufficient (nothing silently
   assumed that a later, unlisted stage would actually need to provide
   first).
3. **Per-stage line budgets — consumes the Phase-4 budget gate.** Run
   `experiments/quay-perpetual-stream/scripts/it0-ceiling-line-budget-check.sh`
   against the milestone's charter (this is the M18-landed, canonical
   gate — plan 3-7 Phase 4's own text names it `it0-plan-budget-check.sh`,
   but that filename never shipped; M18's dashboard log records the actual
   merge-time rename to `it0-ceiling-line-budget-check.sh`, so THIS check
   cites the real script, not the plan doc's stale name) and report its raw
   PASS/FAIL output as evidence — do not estimate budget compliance by eye.
   This grounded check treats the Phase-4 gate as one of its own
   ground-truth checks, not a separate step the caller must remember to run
   independently.
4. **Per-stage TDD acceptance.** Each stage's acceptance criteria state,
   concretely, how ≥80% coverage (code stages) or the mechanical-check
   discipline (prose/skill/template/manifest stages) will be demonstrated —
   see `SKILL.md`'s TDD hard-gate section for the classifier. Flag any stage
   whose acceptance criteria are vague ("tests pass") rather than concrete
   (which command, what coverage number, which fixture).
5. **Milestone-level plan record shape.** Confirm the plan record is
   milestone-level (phases/stages/dependency-order/per-stage budgets/
   per-stage TDD acceptance) and is NOT decomposed into a child-task tree —
   if the plan-author subagent produced per-stage child tasks instead of a
   single plan record, flag this as a shape violation: the plan is
   deliberately invisible in the Web UI/task board (see `SKILL.md`), and
   materializing it as child tasks would silently break that invariant.

For each of the 5 checks above, report PASS or a specific, bounded, cite-able
finding (file:line or a concrete missing citation) — never a vague "seems
fine" or "could be better" without a specific ground-truth pointer.

CONVERGENCE DECISION: if this round found ZERO material findings (all 5
checks PASS with nothing beyond copy-edit-level nitpicks), report
CONVERGED — no further round is needed, do not manufacture a finding just to
justify another round. If you found ANY material finding, report
NOT-CONVERGED, list the findings precisely enough that the plan-author
subagent can address them without re-deriving the plan from scratch (a
targeted revision, not a rewrite), and note this consumes round {{round}}
of the ~2-3-round cap (plan 3-7 Phase 5 Stage 5.3's stopping rule, reusing
exp5's own ΔV-small-and-stable stop condition — not a new convergence rule).
If round {{round}} is 3 and still NOT-CONVERGED, report this explicitly as
a stopping-rule exhaustion (escalate to a human decision rather than
silently looping a 4th time).

Report your PASS/finding for each of the 5 checks, the raw
`it0-plan-budget-check.sh` tool output (check 3), and your CONVERGED /
NOT-CONVERGED verdict as your final output.
```

## Stopping rule (Phase-5 Stage 5.3, reused unchanged — not re-derived here)

Iterate: plan-author revises (only on NOT-CONVERGED) → this check re-runs →
repeat, capped at **~2-3 rounds**. This is the SAME stop condition exp5's own
outer loop already uses (ΔV small-and-stable across K consecutive rounds),
not a new rule invented for this skill — see `docs/plans/3-7-quay-task-to-plan-skill.md`
Phase 5 Stage 5.3. Plan **re-derivation is declined by default** for the
development class (per that same stage): this check never spawns a second,
independently-authored competing plan — only ad hoc, if a decomposition is
genuinely contested, outside this template's normal path.

## Non-goals for this template

- Does not author a plan from scratch (that is a separate plan-author
  subagent step, already completed before this template is first
  dispatched).
- Does not re-derive an alternative decomposition even when it disagrees
  with a stage boundary — it requests a targeted revision from the
  plan-author, it does not substitute its own plan.
- Does not run the TDD ≥80% gate against actual implementation code (there
  is no implementation yet at plan-check time) — it only checks that each
  stage's acceptance criteria STATE the gate concretely (see check 4 above).
  The gate itself fires later, during implementation (`SKILL.md`'s TDD
  hard-gate section).
- Does not touch `OUTER-LOOP.md` DISPATCH wiring (out of scope for this
  charter — see `SKILL.md`'s "Relationship / bootstrap" section).
