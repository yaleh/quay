# DIR-014

- status: pending (REVERTED 2026-07-19 from "applied (partial)" — items 2 & 3 are unbuilt and
  are the real live gap; see "Reverted to pending" note directly below. Items 1 & 4 remain done.)
- created_by: human (Yale Huang), asserted directly in this live conversation
- created_at: 2026-07-18
- title: Actually build AND wire the proposal→plan process for development milestones — DIR-012 item 3 has been perpetually deferred with no backlog row, the two-class diversity policy is discretionary and gated on a skill that does not exist, and DISPATCH still never invokes proposal→plan (only an escapable line-budget gate enforces anything), so no subsequent task will go through the process the proposal designed

## Reverted to pending (2026-07-19)

A directive audit re-verified this DIR against `master` and found its two core asks
**still unbuilt** — confirming the Resolution's own honest note that they "remain real,
unclosed gaps ... NOT silently dropped". Rather than re-file a fresh DIR (the Resolution's
suggested route), this directive is **reverted to `pending`** so the outer loop re-drains it
and SELECTs the missing work. It is deliberately NOT a duplicate — this is the original,
correctly-scoped ask.

**What is done (do NOT redo):**
- **item 1 — build the `quay-task-to-plan` skill:** DONE (M20 proposal step + M22 Phase 7).
  `.claude/skills/quay-task-to-plan/SKILL.md` (+ prompts/) exists.
- **item 4 — dogfood-record (narrow bootstrap sense):** DONE (the build ran through the existing
  `proposal-to-plan` substrate).

**What is the LIVE GAP (this DIR's remaining scope):**
- **item 2 — wire DISPATCH to invoke the skill:** NOT built. Re-verified 2026-07-19:
  `grep -n quay-task-to-plan experiments/quay-perpetual-stream/OUTER-LOOP.md` → **no match**.
  `OUTER-LOOP.md` step 5 (DISPATCH INNER) still runs the old whole-milestone dual-iteration on the
  charter alone; no development-class milestone is routed through the proposal→plan pipeline.
- **item 3 — de-optionalize the two-class diversity policy for the development class:** NOT built.
  `inherited-core.md`'s policy still reads "MAY, at a future charter's discretion"; the pipeline is
  never the default, and is still preconditioned on a skill that (now) exists but is never invoked.
- **item 5 — first customers** (M-TASK-BACKLOG-PROJECTION-IMPL etc. routed through the wired
  process) necessarily follows item 2, so it is still open too.

Net: the skill was built but **never wired** — the exact "designed-but-not-wired" pattern this DIR
was filed to end, now sitting one artifact further along (skill exists, DISPATCH ignores it). This
is the single most important unclosed methodology-infrastructure gap in exp5's directive set as of
2026-07-19. See also [[DIR-012]] item 3 (the same gap, upstream), whose follow-up note points here.

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
- resolved_by: M20-task-to-plan-skill-proposal-step (Phase 6, m20) + M22-quay-task-to-plan-skill-phase7
  (Phase 7, m22, iteration-0)
- outcome: **applied, partially** — requested-action item 1 (build the skill) is closed across the
  two milestones; item 4 (dogfood + record) is closed in the narrow sense the plan's own §19
  bootstrap resolution defines (this build itself ran through `proposal-to-plan`, the bootstrap
  substrate, cross-checked step-by-step against it — see `SKILL.md`'s "Relationship / bootstrap"
  section); requested-action items 2 (wire `OUTER-LOOP.md` DISPATCH to invoke the skill) and 3
  (de-optionalize the two-class diversity policy for the development class) are **explicitly NOT
  built** by either M20 or M22 — both charters name them out of scope, and M22's charter states this
  is intentional: Phase 7's own plan scope (`docs/plans/3-7-quay-task-to-plan-skill.md` Stages
  7.1-7.3) does not include DISPATCH wiring or policy de-optionalization; those two items remain
  real, unclosed gaps this directive originally named, and are NOT silently dropped — they should be
  re-filed as a fresh directive/backlog row if still wanted, rather than this DIR being closed as
  fully resolved.
- evidence:
  - Item 1 (build): `.claude/skills/quay-task-to-plan/SKILL.md` (413 lines) +
    `.claude/skills/quay-task-to-plan/prompts/{proposal-subagent,adjudicate-proposal,
    plan-check-subagent}.md` — proposal step (Phase 6, M20) + plan step / TDD ≥80% hard gate /
    dogfooding-bootstrap sections (Phase 7, M22) all present; see M22's own iteration-0 report
    (`experiments/quay-perpetual-stream/milestones/M22-quay-task-to-plan-skill-phase7/iterations/
    iteration-0.md`) for the Done-when-clause-by-clause evidence.
  - Item 2 (DISPATCH wiring): NOT built. `OUTER-LOOP.md` step 5 (DISPATCH INNER) is unchanged by
    either M20 or M22; no development-class milestone is automatically routed through this skill.
  - Item 3 (de-optionalize policy): NOT built. `inherited-core.md`'s two-class diversity policy still
    reads "MAY, at a future charter's discretion" — unchanged by M22 (explicit non-goal, per M22's
    charter "Explicitly OUT of scope" section: "Do not make the two-class diversity policy
    non-discretionary — that is Phase 5 territory, already built at M18; this charter only
    *references* the Phase-5 stopping rule, does not re-derive or re-wire it").
  - Item 4 (dogfood + record): this build (M20+M22) itself ran through the existing
    `proposal-to-plan` skill / the standard exp5 whole-milestone charter+iteration pattern, per the
    plan's own §19 bootstrap-resolution statement (a skill cannot run through itself before it
    exists) — recorded in `SKILL.md`'s "Relationship / bootstrap" section, naming
    `M-TASK-BACKLOG-PROJECTION-IMPL` and the release-cadence impl as the first TRUE dogfood
    customers (not this build itself, and explicitly not the already-complete
    M16-cli-edit-parity-impl).
  - Item 5 (first customers after landing): recorded as a forward-looking naming statement only
    (`M-TASK-BACKLOG-PROJECTION-IMPL`, materialized at m21 per DIR-015/DIR-016, still pending its own
    SELECT+charter+dispatch) — not actioned by this DIR's resolution; that remains DIR-015 item 2's
    own open scope.
