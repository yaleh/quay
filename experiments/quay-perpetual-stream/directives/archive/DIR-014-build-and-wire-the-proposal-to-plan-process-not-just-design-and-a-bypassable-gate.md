# DIR-014

- status: pending
- created_by: human (Yale Huang), asserted directly in this live conversation
- created_at: 2026-07-18
- title: Actually build AND wire the proposal→plan process for development milestones — DIR-012 item 3 has been perpetually deferred with no backlog row, the two-class diversity policy is discretionary and gated on a skill that does not exist, and DISPATCH still never invokes proposal→plan (only an escapable line-budget gate enforces anything), so no subsequent task will go through the process the proposal designed

## Finding

Tracing DIR-012's execution through m17/m18/m19 shows the proposal
`docs/proposals/exp5-quay-task-proposal-plan-skill.md` has had its *scaffolding*
built but not its *engine*, and — decisively — **no queued work will close the
gap**:

- **DIR-012 item 3 (build the skill + dogfood it) is not queued anywhere.** M17
  delivered the skill *design* (item 1); M18 delivered the sizing ceiling + a
  mechanical plan-time line-budget gate + a *written* two-class diversity policy
  (item 2). Both milestones' records explicitly defer item 3 "to a future
  milestone," but **no `backlog.md` row for it was ever created** — the OPEN
  backlog contains no "build `quay-task-to-plan` skill" candidate. A deferral with
  no backlog row is a deferral to never.
- **M19 will not fill it.** M19-task-to-plan-docs-reconcile is documentation-only
  (DIR-013's F1/F2/F3) and its charter's "Explicitly OUT of scope" section states
  verbatim: "Do not build the `quay-task-to-plan` skill or anything under
  `.claude/skills/quay-task-to-plan/` — that is DIR-012 item 3, untouched by
  DIR-013" and "Do not touch `inherited-core.md`'s or `OUTER-LOOP.md`'s M18-added
  sections."
- **The skill does not exist.** `.claude/skills/` has no `quay-task-to-plan/`.
  A `docs/plans/3-7-quay-task-to-plan-skill.md` build plan exists, but no milestone
  consumes it.

Even if the skill were built tomorrow, three structural facts mean subsequent
development milestones would *still* not go through proposal→plan:

1. **Discretionary, not default.** `inherited-core.md`'s two-class diversity policy
   says development milestones "**MAY, at a future charter's discretion**, use the
   narrower pattern" (N-independent-proposal re-derivation + adjudication). Nothing
   makes it the default or forces it — and it is explicitly preconditioned on "the
   `quay-task-to-plan` skill ... actually exists", which is currently false.
2. **DISPATCH is unchanged.** `OUTER-LOOP.md` step 5 (DISPATCH INNER) still runs the
   old whole-milestone dual-iteration on the charter alone. There is no step that,
   for a development-class milestone, runs proposal re-derivation → plan → grounded
   check → single implementation (the proposal §6 "clamp at both ends" pipeline).
   The pipeline lives in `inherited-core.md` only as descriptive policy.
3. **The one enforced gate is bypassable.** The only mechanical enforcement is the
   plan-time line-budget gate, which bites only when a charter *declares* a budget
   above ~2000 lines with no phase/stage plan. The loop can (and does) keep
   milestones under the norm and chartered the old charter+Done-when way, so the
   gate never forces a proposal or plan. Every milestone to date — including the
   real product-code ones (M16-cli-edit-parity-impl, M18's own gate script) — was
   chartered the old way; **the process is not even self-applied.**

Net: this is the DIR-002 "enforcement half never built" / "designed but not wired"
pattern recurring one level up, on the proposal→plan mechanism itself. The
experiment has produced a design doc, a policy, and a bypassable gate for making
milestones go through proposal→plan, but not the working, invoked, default process
— and nothing on the current backlog will change that.

## Requested action

Charter this as a real **development-class** milestone (it touches product/skill
code and `OUTER-LOOP.md`), and let it be the **first dogfooding subject** — it
should itself be executed through the proposal→plan process it installs, per the
proposal's §11 and DIR-012 item 3. Cover at least:

1. **Build the `quay-task-to-plan` skill** under `.claude/skills/quay-task-to-plan/`
   per `docs/plans/3-7-quay-task-to-plan-skill.md` (as reconciled by M19) and the
   proposal's §12-19 operational spec: task read/write via the provider tool
   (`task edit`/`task_write`, portable body per DIR-011, M12 parent/children),
   proposal step = N-independent-proposal subagents + adjudication, plan step =
   author + grounded convergent check, TDD ≥80% hard gate, GitHub degradation.
2. **Wire DISPATCH to invoke it.** Amend `OUTER-LOOP.md` step 5 so a development-
   class milestone actually runs the proposal→plan pipeline (upstream N-proposal
   re-derivation + adjudication → plan → grounded plan-check → single implementation
   → light tail self-check → existing downstream adversarial-audit gate) — not just
   the whole-milestone dual iteration. The pipeline must be an executed cycle step,
   not only prose in `inherited-core.md`.
3. **De-optionalize for the development class.** Make the proposal→plan pipeline the
   **default** for development/`capability-growth`-typed milestones (keep the
   methodology/design class on whole-milestone re-derivation, unchanged). Consider
   strengthening the enforcement so it does not depend on a milestone self-declaring
   a >2000-line budget: e.g. require a plan reference for any `capability-growth`-
   typed charter, not only for charters that declare a large line budget — closing
   the "keep it small to bypass" escape hatch. Removing the "MAY, at discretion"
   language for this class is the point.
4. **Dogfood + record.** Run this milestone through its own pipeline and record the
   result (the proposal re-derivation, the plan, the plan-check convergence) as the
   first live instance, cross-checked against the existing `proposal-to-plan` skill,
   per the proposal's §11 dogfooding intent.
5. **First customers after this lands:** the still-deferred implementation
   milestones (M-TASK-BACKLOG-PROJECTION impl, the release-cadence impl) should be
   the first *other* development milestones routed through the now-wired process.

Non-goals: do not re-open M17/M18/M19's already-landed design/policy/reconciliation
work; do not change the methodology/design class's whole-milestone re-derivation.

Value type: capability-growth (a new working skill + an actually-invoked process) +
governance-integrity (closes the designed-but-not-wired gap so the loop's own
development work becomes plan-disciplined). This is the milestone that finally makes
the proposal→plan design operative rather than shelfware; size the plan (it is
itself ≤2000 lines per `docs/plans/3-7`) at SELECT time.

## Resolution
- resolved_by: M22-quay-task-to-plan-skill-phase7, iteration-1, 2026-07-18
- outcome: **partially applied** — item 1 (build the skill) DONE across
  M20 (Phase 6) + M22 (Phase 7, this milestone); items 2-3 (DISPATCH wiring,
  de-optionalizing the diversity policy) explicitly deferred, NOT built by
  this milestone, by charter design (see below) — this DIR is archived
  because item 1's completion is what DIR-014's own Finding named as the
  concrete, actionable, currently-unqueued gap ("no backlog row for building
  the skill"); items 2-3 are recorded here as the still-open remainder for a
  future DIR/milestone, not silently dropped.
- evidence:
  - **Requested-action item 1 (build the skill) — DONE.** M20
    (`M-TASK-TO-PLAN-SKILL-PROPOSAL-STEP`) built Phase 6 (proposal step:
    N-independent-subagent authoring + adjudication + provider-tool
    write-back, portable body per DIR-011). THIS milestone (M22) built
    Phase 7: the plan step (`SKILL.md` steps 5-6 + new
    `.claude/skills/quay-task-to-plan/prompts/plan-check-subagent.md`), the
    TDD ≥80% hard gate with the code-vs-prose classifier (`SKILL.md`'s "TDD
    ≥80% hard gate" section + `Constraints` block), and the
    dogfooding/bootstrap-resolution wiring (`SKILL.md`'s "Relationship /
    bootstrap" section). `.claude/skills/quay-task-to-plan/` now covers all
    of `docs/plans/3-7-quay-task-to-plan-skill.md`'s Phases 6-7 — the skill
    referenced in DIR-014's Finding as "does not exist" now exists in full.
  - **Requested-action item 2 (wire DISPATCH to invoke it) — deferred, NOT
    built, by explicit charter design.** M22's charter's "Explicitly OUT of
    scope" section states: "Do not wire `OUTER-LOOP.md` DISPATCH to actually
    invoke this skill for a real milestone this charter." `SKILL.md`'s own
    header and `Constraints` block state this explicitly
    (`forbid(DISPATCH auto-wiring into OUTER-LOOP.md — manual invocation
    only, this milestone)`) so a future reader does not mistake the skill's
    existence for the pipeline being live. This item remains genuinely open
    — a future milestone (targeting `OUTER-LOOP.md` step 5) is still needed
    to close it. Not re-filing a new DIR for this at archive time per the
    dispatcher's request; if a future SELECT boundary does not naturally
    pick this up, a new DIR should be filed then.
  - **Requested-action item 3 (de-optionalize for the dev class) — deferred,
    NOT built, out of scope by explicit charter design.** M22's charter
    states: "Do not make the two-class diversity policy non-discretionary —
    that is Phase 5 territory, already built at M18." `inherited-core.md`'s
    "MAY, at a future charter's discretion" language (the exact clause
    DIR-014's Finding #1 cited) is UNCHANGED by this milestone.
  - **Requested-action item 4 (dogfood + record) — addressed via explicit
    bootstrap-resolution statement, not a live dogfood run.**
    `SKILL.md`'s "Relationship / bootstrap" section records: the
    skill-implementation milestones themselves (M20, M22) necessarily ran
    through the pre-existing `proposal-to-plan` (a skill cannot build its
    own deliverable before it exists) — this IS the dogfooding-intent
    proposal §11/§19 describes, executed exactly as that section
    anticipates, not a deviation from it. A live end-to-end dogfood run of
    `quay-task-to-plan` against a real second-milestone customer is
    explicitly named as future work (item 5 below), not claimed here.
  - **Requested-action item 5 (first customers after this lands) —
    named.** `SKILL.md`'s "Relationship / bootstrap" section names
    `M-TASK-BACKLOG-PROJECTION-IMPL` (`backlog.md`, DIR-015 item 2 /
    DIR-016 retroactive-sweep row) and a future release-cadence
    implementation as the first true-dogfood candidates, explicitly ruling
    out `M16-cli-edit-parity-impl` (already complete, predates this skill).
  - Full disposition + pasted evidence:
    `experiments/quay-perpetual-stream/milestones/M22-quay-task-to-plan-skill-phase7/iterations/iteration-1.md`.
