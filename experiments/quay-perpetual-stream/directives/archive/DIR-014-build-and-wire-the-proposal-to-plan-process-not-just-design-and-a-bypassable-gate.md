# DIR-014

- status: applied (CLOSED 2026-07-19 — ALL items 1-6 delivered; the wired pipeline ran on a
  REAL development milestone (M42) and caught a real approach bug both naive proposals missed.
  See "## Resolution — CLOSED" at the bottom. Superseded the earlier REVERTED-to-pending note.)
- created_by: human (Yale Huang), asserted directly in this live conversation
- created_at: 2026-07-18
- title: Make the quay task the SINGLE CANONICAL lifecycle record of a milestone — proposal embedded in the task body + plan tracked as a referenced link + AC/DoD as checklists (AC/DoD half already landed via DIR-020) — AND actually wire the proposal→plan process into DISPATCH for development milestones (DIR-012 item 3 perpetually deferred, the two-class diversity policy still discretionary, DISPATCH still never invokes proposal→plan, and no exp5-M-* task carries a `## Proposal`/plan reference), so the task board stops being an AC/DoD-only shell while the real proposal/plan design lives in scattered charter/docs files
- scope_expanded: 2026-07-19 (human directive, this conversation) — folded the "proposal+plan must be tracked IN the quay task" requirement into this DIR per the human's "扩展/重写 DIR-014" decision; hybrid form chosen: proposal EMBEDDED in task body, plan tracked as a REFERENCE link (see new Requested action item 6 + the runnable Acceptance Criteria / Definition of Done sections added below)

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
- **item 6 — task = single canonical lifecycle record (NEW, folded in 2026-07-19):** NOT built.
  0/24 `exp5-M-*` tasks carry a `## Proposal` section or a plan reference; only AC/DoD (DIR-020)
  are task-native today. Proposal must be EMBEDDED in the task body and plan tracked as a
  REFERENCE link, both enforced at authoring time (Clause 0-style HARD block). See Requested
  action item 6 + the runnable Acceptance Criteria / Definition of Done sections below.

Net: the skill was built but **never wired**, and the task board carries only AC/DoD while the
proposal/plan design lives in scattered charter/docs files — the exact "designed-but-not-wired"
pattern this DIR was filed to end, now sitting one artifact further along (skill exists, DISPATCH
ignores it; AC/DoD are task-native but proposal/plan are not). This is the single most important
unclosed methodology-infrastructure gap in exp5's directive set as of 2026-07-19. See also
[[DIR-012]] item 3 (the same gap, upstream), whose follow-up note points here.

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

6. **Make the quay task the SINGLE CANONICAL lifecycle record — proposal EMBEDDED,
   plan REFERENCED (NEW, folded in 2026-07-19 per human directive; hybrid form).**
   Today the loop authors `## Acceptance Criteria` + `## Definition of Done` into the
   SELECTed task body (DIR-020/M34 — landed and enforced by DoD Clause 0), but the
   milestone's *proposal* and *plan* live only in `charters/M-NN.md` and scattered
   `docs/proposals/*` / `docs/plans/*` files — **0 of 24 `exp5-M-*` tasks carry a
   `## Proposal` section or a plan reference** (verified 2026-07-19). The task board
   is therefore an AC/DoD-only shell, not the single source of truth the DIR-009
   task-canonical decision intended. Close this by making the task carry the WHOLE
   lifecycle, in the hybrid shape the human chose:
   - **(a) Proposal EMBEDDED in the task body.** At SELECT/authoring time (same
     `task_write` step that already writes AC/DoD, `OUTER-LOOP.md` step 1), the loop
     MUST also write the milestone's chosen proposal/approach as a `## Proposal`
     body section — portable per DIR-011 (body = cross-provider, `extra{}` native-only
     mirror), the same `task↔proposal` pairing DIR-012 item 1 already decided. This
     applies to EVERY milestone (like AC/DoD), independent of whether the full
     dev-class N-independent-proposal skill pipeline (items 1-3) runs — a
     methodology/design milestone embeds its single chosen approach; a dev-class
     milestone embeds the adjudicated proposal the skill produced. The QN/QC/QENG
     tasks already do exactly this (`## Proposal` body section) — reuse that shape.
   - **(b) Plan tracked as a REFERENCE link (NOT embedded, NOT a child-task tree).**
     This deliberately does NOT reverse DIR-012's "phase/stage are not written into
     the board" decision — the plan CONTENT stays a `docs/plans/*.md` file. What is
     new: a dev-class milestone's task body MUST carry a `## Plan` section that
     REFERENCES its `docs/plans/*.md` path (and, once DIR-023 lifecycle lands, a
     status). A milestone that legitimately has no plan (methodology/design class,
     no implementation) states `## Plan\nN/A — <reason>` explicitly rather than
     omitting the section. Cross-check: the M05 anti-drift discipline style — the
     reference must resolve (the `docs/plans/*.md` file exists) or the check fails.
   - **(c) Mechanical enforcement at authoring time, same shape as Clause 0.** Extend
     the DoD meta-enforcer's Clause 0 (AC/DoD presence check, `it0-dod-check.mjs`) —
     or add a sibling clause — so a missing/empty/placeholder `## Proposal`, or a
     `## Plan` whose referenced path does not resolve, HARD-BLOCKS `milestone_counter++`
     exactly as a missing AC section already does. Prose-only is the failure mode this
     DIR exists to end; the enforcement half must ship WITH the authoring half.

Non-goals: do not re-open M17/M18/M19's already-landed design/policy/reconciliation
work; do not change the methodology/design class's whole-milestone re-derivation; **do
NOT embed plan phase/stage content into the task board or as a child-task tree (item
6b is a REFERENCE link only — DIR-012's "board tracks value, plan tracks process"
decision stands); do NOT retroactively backfill `## Proposal`/`## Plan` onto the ≤m38
milestones' tasks (applies FORWARD from the milestone that lands this, same as
DIR-020's AC/DoD forward-only rule) — a backward sweep, if ever wanted, is its own
separate scope.**

Value type: capability-growth (a new working skill + an actually-invoked process) +
governance-integrity (closes the designed-but-not-wired gap so the loop's own
development work becomes plan-disciplined). This is the milestone that finally makes
the proposal→plan design operative rather than shelfware; size the plan (it is
itself ≤2000 lines per `docs/plans/3-7`) at SELECT time.

## Acceptance Criteria (runnable — artifacts are necessary-not-sufficient)

Items 2/3/5 (DISPATCH wiring, de-optionalization, first customers) keep their original
intent; the checks below are the runnable form, PLUS the new item-6 lifecycle-record checks.

- [ ] **item 6a (proposal embedded):** the milestone that lands this DIR has, on its own
  quay task, a non-empty `## Proposal` body section — `quay task view <that-milestone-task>
  --json` (or the `tasks/<id>.md` body) shows `## Proposal` with real approach text, not a
  placeholder. Forward-rule: every milestone SELECTed AFTER this lands likewise gets one.
- [ ] **item 6b (plan referenced):** that same task carries a `## Plan` section that either
  references an existing `docs/plans/*.md` path (the file resolves) OR states `N/A — <reason>`
  for a no-implementation milestone. `grep -A2 '^## Plan' tasks/<id>.md` shows a resolving
  reference or an explicit N/A.
- [ ] **item 6c (enforcement is real, not prose):** a synthetic milestone-task stub with a
  missing/placeholder `## Proposal` (or a `## Plan` whose referenced path does not exist) is
  run through `scripts/it0-dod-check.{sh,mjs}` (Clause 0 or its new sibling) and EXITS NON-ZERO;
  a compliant stub exits 0. A new RED fixture pair under `fixtures/dod/` is wired into
  `scripts/dod-fixture-selfcheck.sh` and the suite stays green (all fixtures behave as asserted).
- [ ] **item 2 (DISPATCH wired):** `grep -n quay-task-to-plan
  experiments/quay-perpetual-stream/OUTER-LOOP.md` returns a match inside step 5 (DISPATCH INNER)
  as the OPERATIVE route for a development-class milestone, not a mention.
- [ ] **item 3 (de-optionalized):** `inherited-core.md`'s two-class diversity policy no longer
  reads "MAY, at a future charter's discretion" for the development class — it is the DEFAULT,
  and the plan-reference requirement (item 6b) is keyed on `capability-growth` type, not on a
  self-declared >2000-line budget (closing the "keep it small to bypass" hatch).

## Definition of Done — REAL LANDING is the bar, not artifacts

NOT done when the skill is wired in prose, `OUTER-LOOP.md`/`inherited-core.md` are edited, or a
fixture passes. Done ONLY when a **REAL development-class exp5 milestone** has actually been
**driven through the wired proposal→plan pipeline AND carries its proposal embedded + plan
referenced on its own quay task**, verifiable by:
(a) that milestone's task shows a real `## Proposal` + a resolving `## Plan` reference (item 6a/6b);
(b) `it0-dod-check` HARD-BLOCKS a synthetic proposal-missing / plan-reference-broken stub and passes
    a compliant one, with the new fixtures committed and `dod-fixture-selfcheck.sh` green (item 6c);
(c) `OUTER-LOOP.md` step 5 shows the `quay-task-to-plan` invocation as the operative dev-class route
    (item 2), and the two-class policy is the default not discretionary (item 3);
(d) at least one real milestone's DISPATCH actually ran the pipeline (not a fixture) — its iteration
    record shows the N-independent-proposal re-derivation + adjudication + grounded plan-check.
A green fixture, an edited doc, or a single seeded `## Proposal` alone is necessary but NOT
sufficient. Escrow discipline: until (a)–(d) hold for a real milestone, this DIR stays `pending`.

## Resolution (HISTORICAL — partial, from the "applied (partial)" era; SUPERSEDED by the revert + scope expansion above)

> The Resolution below records the M20/M22 partial close as it stood before the 2026-07-19
> audit reverted this DIR to `pending` and the human expanded its scope with item 6. It is
> retained as history; the authoritative current state is the "Reverted to pending" note (top)
> plus the Acceptance Criteria / Definition of Done sections directly above.
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

## Resolution — CLOSED (2026-07-19)
- resolved_by: items 1 (M20/M22), 2+3 (human-direct wiring, master `7c0b275` — OUTER-LOOP step 5a +
  inherited-core de-optionalization, independently audited NO REFUTATION FOUND), 4+5
  (M42-gate-cli-arg-order — the wired pipeline's first live customer / dogfood), 6 (M40 Clause 8).
- outcome: **applied — the full program is delivered and the pipeline is PROVEN on a real milestone.**
  - **item 1** build skill: DONE (M20/M22).
  - **item 2** wire DISPATCH: DONE — OUTER-LOOP step 5a mandatorily routes development-class
    milestones through `quay-task-to-plan` (executed cycle step, not prose).
  - **item 3** de-optionalize: DONE — inherited-core two-class policy is MUST(DEFAULT), not MAY.
  - **item 4** dogfood + **item 5** first customer: DONE — M42-gate-cli-arg-order ran through step
    5a's pipeline. Evidence it is REAL, not ceremony: 2 independent proposals converged on the
    surface fix but a grounded adjudication caught that BOTH were insufficient (parseFlags(rest)
    mis-parses a leading flag), so a single-proposal path would have SHIPPED a regression. The
    pipeline's upstream diversity caught an expensive approach error before code was written —
    exactly its purpose. See `milestones/M42-gate-cli-arg-order/iterations/iteration-0.md`.
  - **item 6** task = canonical lifecycle record: DONE (M40, DoD Clause 8).
- evidence: master commits `7c0b275` (items 2/3, audited), `3ae3455`-line M42 (items 4/5:
  code fix + tests 144/144 non-network green + task write-back + dogfood record, audited NO
  REFUTATION FOUND); M40 (item 6). The "designed-but-not-wired" disease this DIR was filed to end
  is, for the proposal→plan mechanism, ended: it is wired, mandatory, and has run for real.
