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
<!-- added when moved to archive/, or updated in place if deferred:
- resolved_by: iteration-N / milestone M-NN
- outcome: applied | deferred | rejected
- evidence: pointer to the design doc / iteration report section / commit -->
