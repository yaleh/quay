# Charter M22-quay-task-to-plan-skill-phase7 — Phase 7 of the DIR-012/DIR-014 skill build (Tier-A)

**Milestone id:** M22-quay-task-to-plan-skill-phase7 · **surface:** skill
(`.claude/skills/quay-task-to-plan/`) · **type:** explore
**Backlog id:** `M-TASK-TO-PLAN-SKILL-IMPL-PHASE7` (created m21, `M-IMPL-ROW-ENFORCEMENT`'s
retroactive sweep, sourced to DIR-014 items 1-3, following on `M-TASK-TO-PLAN-SKILL-PROPOSAL-STEP`'s
(m20) Phase-6-only scope-down).
**Plan (phase/stage decomposition, per M18's own ceiling-expansion requirement):**
`docs/plans/3-7-quay-task-to-plan-skill.md` Phase 7 ("`quay-task-to-plan` skill: plan step (grounded
check) + TDD ≥80% hard gate + dogfood wiring", ~420 est. lines across Stages 7.1-7.3, well under the
phase's own ≤500-line phase budget, ≤200-line-per-stage budgets satisfied per the plan's own
per-stage `Files:` estimates 170/140/110). This charter implements Phase 7 ONLY.
**Charter authored:** m21→m22 boundary, 2026-07-18.

## Value hypothesis
- Value type (per `inherited-core.md`'s value-typed SELECT ledger): **capability-growth** (primary
  — completes the standing `quay-task-to-plan` skill artifact Phase 6 (m20) left half-built) +
  **governance-integrity** (secondary — closes the designed-but-not-wired proposal→plan gap DIR-014
  named, the same "enforcement half never built" pattern class M21 addressed one level up).
- Δv̂: **zero direct VT points** — mirrors M20-CLI-EDIT-PARITY-IMPL/M16's own realized-Δv=0
  precedent: capability-growth-typed but no VT chart cell exists for a skill-artifact's internal
  stage count. State this explicitly at ABSORB; do not fabricate a VT number.
- Metric `Y`: none (no VT chart move). Success is: does `.claude/skills/quay-task-to-plan/SKILL.md`
  gain the plan step + TDD ≥80% hard gate + dogfooding-wiring sections, matching Phase 7's three
  stages' acceptance criteria in the plan (Stage 7.1/7.2/7.3) — this charter is thin per §3.1; the
  plan carries the detail, cite it, do not re-derive it.

## In-scope work (= plan Phase 7, Stages 7.1-7.3, verbatim scope — cite, do not re-derive)
Read `docs/plans/3-7-quay-task-to-plan-skill.md`'s "Phase 7" section (Stages 7.1-7.3) as the
authoritative build spec. Summary (full acceptance criteria live in the plan, not duplicated here):
1. **Stage 7.1 — Plan step.** Add the plan step to `SKILL.md` + a new
   `.claude/skills/quay-task-to-plan/prompts/plan-check-subagent.md`. One subagent authors a
   milestone-level plan record (phases/stages/dependency-order/per-stage budgets/per-stage TDD
   acceptance); one maximally codebase-grounded check subagent iterates to convergence per the
   Phase-5 stopping rule, consuming the Phase-4 budget gate. State explicitly: the plan is
   milestone-level and NOT written as a child-task tree — process is deliberately invisible in the
   Web UI/task board.
2. **Stage 7.2 — TDD ≥80% hard gate.** Encode the TDD ≥80% hard gate with the code-vs-prose
   classifier: literal ≥80% line coverage for executable code; for prose/skill/template/manifest
   stages, degrade to the mechanical-check discipline (gate-hash / projection-check `it0-*` runs,
   scaffold-lint, isolation test) per plan 2's precedent. State that the skill's own implementation
   is largely prose, so this classifier applies to itself.
3. **Stage 7.3 — Dogfooding wiring + bootstrap resolution.** Encode the `feature-developer`-reuse
   note (reuse/wrap where it fits, don't reinvent the review loop) and the bootstrap resolution: the
   skill-implementation milestones (Phase 6/7, i.e. M20/M22 themselves) run through the existing
   `proposal-to-plan` process, not through `quay-task-to-plan` itself (it cannot build its own
   deliverable); only the second dev-class milestone onward (named candidates:
   `M-TASK-BACKLOG-PROJECTION-IMPL`, a release-cadence impl) is the first true-dogfood customer.
   Record the `Output` contract (tasks with proposals in `body`; a milestone-level plan record) and
   non-goals (not deleting/forking `proposal-to-plan`; not rendering stage process in the Web UI).

## Explicitly OUT of scope this milestone
- **Do not** wire `OUTER-LOOP.md` DISPATCH to actually invoke this skill for a real milestone this
  charter — Stage 7.3's acceptance is the bootstrap-resolution *statement* + the dogfood-customer
  naming, not a live end-to-end dogfooding run against `M-TASK-BACKLOG-PROJECTION-IMPL` itself (that
  is `M-TASK-BACKLOG-PROJECTION-IMPL`'s own future milestone's job, per Stage 7.3's own naming).
- **Do not** make the two-class diversity policy non-discretionary — that is Phase 5 territory,
  already built at M18; this charter only *references* the Phase-5 stopping rule, does not re-derive
  or re-wire it.
- **Do not** touch `inherited-core.md`'s or `OUTER-LOOP.md`'s M18/M21-added sections (ceiling,
  diversity policy, line-budget gate, impl-row gate) — unrelated surface, already closed.
- **Do not** re-litigate or re-derive Phase 3/4/5/6 (already built at M18/M20) or the design
  doc/plan content itself (already matured/fixed at M17/M19) — cite them, do not re-author them.
- **Do not** begin `M-TASK-BACKLOG-PROJECTION-IMPL`'s own implementation — that is a separate,
  already-materialized (m21), not-yet-SELECTed backlog row.

## Binary Done-when (§3.4 — mandatory, freezes this milestone's shape)
1. `[ ]` `.claude/skills/quay-task-to-plan/SKILL.md` gains a plan-step section (Stage 7.1):
   milestone-level plan record shape (phases/stages/dependency-order/per-stage budgets/per-stage TDD
   acceptance), the grounded-convergent-check description (Phase-5 stopping rule, consumes the
   Phase-4 budget gate), and the explicit "plan is NOT a child-task tree / process invisible in the
   Web UI" statement — pasted excerpt.
2. `[ ]` `.claude/skills/quay-task-to-plan/prompts/plan-check-subagent.md` exists — pasted file +
   excerpt.
3. `[ ]` `SKILL.md` gains a TDD ≥80% hard-gate section (Stage 7.2) with the code-vs-prose classifier
   present (both the coverage-% branch for code and the mechanical-check branch for prose,
   `grep`-checkable) and a `Constraints`-block entry forbidding skipping the gate — pasted excerpt.
4. `[ ]` `SKILL.md` gains a "Relationship / bootstrap" section (Stage 7.3): the bootstrap
   chicken-and-egg resolved explicitly (Phase 6/7 milestones ran on `proposal-to-plan`; second-onward
   dev-class milestones run on `quay-task-to-plan`, naming `M-TASK-BACKLOG-PROJECTION-IMPL` as a
   first true-dogfood candidate), the `feature-developer` reuse note, an `Output` block, and
   non-goals — pasted excerpt.
5. `[ ]` Prose-asset mechanical checks pass: frontmatter valid, all referenced tools/commands/skills
   in the new/edited sections resolve (no dangling references to nonexistent skills/scripts) —
   pasted verification.
6. `[ ]` `git diff --stat` against this milestone's pre-charter base commit shows only
   `.claude/skills/quay-task-to-plan/` files (+ this milestone's own charter/iteration/backlog/
   dashboard bookkeeping) changed — no Core CLI code, no `inherited-core.md`/`OUTER-LOOP.md` edits,
   no `M-TASK-BACKLOG-PROJECTION-IMPL` implementation.
7. `[ ]` Total change ≤ ~500 lines (Phase 7's own acceptance clause 4 budget) — confirmed via
   `git diff --stat` line-count sum.
8. `[ ]` `backlog.md`'s `M-TASK-TO-PLAN-SKILL-IMPL-PHASE7` row marked DONE at ABSORB, explicitly
   noting this closes the remainder of DIR-014's ask (items 1-3) and that DIR-014 itself may now be
   archived (delegate the archival-with-Resolution action to the dispatched iteration, mirroring the
   DIR-013/DIR-016 precedent).

Milestone is DONE when all eight are met and stable ≥1 iteration (§3.2 condition 1). Terminate early
per §3.2 conditions 2-5 if they fire first. Real independent-re-derivation material for iteration-1
exists: whether the plan-step's grounded-check description faithfully consumes the Phase-4 budget
gate as its own acceptance criterion states, whether the TDD classifier's two branches are
`grep`-checkably distinguishable (not just prose-adjacent), and whether the bootstrap-resolution
naming is internally consistent with M21's own newly-created `M-TASK-BACKLOG-PROJECTION-IMPL` row
are all independently checkable.

## Plan-time line-budget gate (M18-milestone-model-ceiling-and-diversity-policy) — run before dispatch
This charter cites an external phase/stage plan (`docs/plans/3-7-quay-task-to-plan-skill.md`,
Phase 7 ≈420 est. lines across 3 stages, well under the ≤500-line phase budget and each stage under
the ≤200-line stage budget per the plan's own `Files:` line estimates) — satisfies the "budget
≤2000 WITH a phase/stage plan present" PASS condition.
`scripts/it0-ceiling-line-budget-check.sh charters/M22-quay-task-to-plan-skill-phase7.md` — run and
record the result before dispatch.

## HARD GATES (Tier-A, cited BY REFERENCE — §3.1, DIR-009 defense; M06-sizing by-reference form)

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

Verify: `experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh --by-reference
charters/M22-quay-task-to-plan-skill-phase7.md`. The dispatched `baime:iteration-executor` agent's
own prompt must still contain the LITERAL gate text in full (resolved from `GATE-HASH-REF` by the
dispatcher before agent spawn) — never only a hash, or this reintroduces DIR-009 dilution.

## Inner termination (§3.2, five conditions — unchanged from prior milestones)
Done-when-complete & stable≥1 iter | ΔV<0.02 both layers K=2 consecutive | ceiling→redesign-OR-stop
| budget≈10 backstop | external HALT.

## it0 systematic-explore checks (run before dispatch)
- (a) ceiling/floor arithmetic — N/A in the `it0-ceiling-check.sh` gap-list sense (this milestone's
  source is a `backlog.md` row, not an exp4 gap). Confirmed OPEN/pending directly: `backlog.md`'s
  `M-TASK-TO-PLAN-SKILL-IMPL-PHASE7` row status is `pending`.
- (b) gate-hash check: `scripts/it0-gate-hash-check.sh --by-reference
  charters/M22-quay-task-to-plan-skill-phase7.md`
- (e) plan-time line-budget gate: `scripts/it0-ceiling-line-budget-check.sh
  charters/M22-quay-task-to-plan-skill-phase7.md` — expect PASS via the external-plan-with-Phase/Stage-
  markers route (see above).

## Dispatcher notes
Two independent inner iterations, standard pattern: iteration-0 builds; iteration-1 independently
re-derives from this charter + `docs/plans/3-7-quay-task-to-plan-skill.md` Phase 7 + the current
`.claude/skills/quay-task-to-plan/SKILL.md` (as Phase 6 left it), explicitly told NOT to read
iteration-0's materials. Worktrees at
`milestones/M22-quay-task-to-plan-skill-phase7/worktrees/iteration-{0,1}`, branches
`exp5-m22-iteration-{0,1}`, off master HEAD at dispatch time. Both iterations are editing the SAME
`SKILL.md` file (adding three new sections to the file Phase 6 already populated) — expect a
same-file, likely-non-conflicting-by-location but still-worth-a-consistency-sweep merge, per the
M18/M21-discovered "conflict-free auto-merge can still be internally inconsistent" failure mode:
even if git reports no conflict, manually grep the merged `SKILL.md` for duplicate section headings
or contradictory statements before committing the merge. This milestone additionally closes DIR-014
(all items now addressed across M20+M22) — instruct the dispatched iterations to move
`directives/pending/DIR-014-*.md` to `directives/archive/DIR-014-*.md` with a filled `## Resolution`
section as part of their own deliverable, mirroring the DIR-013/DIR-016 precedent (do NOT
pre-emptively archive it at SELECT time, per the M21 self-correction on this exact point).
