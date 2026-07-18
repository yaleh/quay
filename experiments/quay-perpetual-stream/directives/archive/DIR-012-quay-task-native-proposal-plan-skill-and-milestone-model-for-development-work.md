# DIR-012

- status: pending
- created_by: human (Yale Huang), asserted directly in this live conversation
- created_at: 2026-07-18
- title: Adopt a quay-task-native proposal→plan skill and the milestone-model changes it requires, so exp5 can execute typical development work (up to ~2000 lines) with an explicit plan, not just acceptance criteria — diversity clamped at both ends (independent proposal re-derivation upstream, adversarial-audit downstream), the plan checked-not-re-derived in the middle

## Finding

exp5 milestone charters carry a Value hypothesis + In-scope work + Binary
Done-when (acceptance) + HARD GATES, but **no Phase/Stage implementation plan
with line budgets** — the charter freezes a milestone's shape and acceptance,
not its decomposition and implementation route (verified against M12/M14
charters: no `Phase`/`Stage`/`≤200`/`≤500` structure). Meanwhile a proven tool
for exactly this, the `proposal-to-plan` skill, already exists, has been used in
this repo (`docs/plans/1-…`, `docs/plans/2-…`) and heavily in sibling projects
(meta-cc project-split: a ~10,019-line change, 6 phases, 2 review rounds) — but
it writes free `docs/` markdown and is **not wired into the OUTER loop**. exp5
is also accreting a chain of design-doc-only milestones (M13, M14) that each
defer a large implementation; those deferred implementations are precisely the
~1000–2000-line tasks `proposal-to-plan` is proven for, and the current charter
machinery has no plan discipline for them.

Inspecting `proposal-to-plan`'s real review-loop commits shows its review stages
catch a **distinct, verifiable-against-the-codebase** class of error —
wrong function signatures, wrong call-site line numbers, wrong stage ordering,
wrong TDD semantics, off-by-one counts, line-estimate and schema-conformance
gaps (meta-cc `8ad476a`/`3f851b0`; quay `a391032`) — and that review is
**independent and iterated** ("two rounds of independent review each on the
proposal and the plan", `feature-developer` orchestration), not one-shot.

The full design is written up in
`docs/proposals/exp5-quay-task-proposal-plan-skill.md` (committed alongside this
DIR). Its resolved decisions, from this conversation:

1. **Four-entity model, aligned in pairs.** `task ↔ proposal` (a task is a
   valuable unit described by a proposal, written back to the task's *body* —
   portable per DIR-011, `extra{}` native-only mirror). `milestone ↔ plan` (the
   plan sequences the implementation of a milestone's grouped tasks into
   phases/stages). **phase/stage are NOT written into the task board as a
   child-task tree** — the board tracks *value*, the plan tracks *process*.
   Accepted consequence: implementation process is **invisible in the Web UI**;
   DIR-009's self-hosting scope narrows to "self-host the value structure, not
   the process".
2. **Milestone ≤ ~2000 lines = one whole plan** (phases ≤500, stages ≤200),
   answering the sizing question M06-sizing/DIR-004 left open. Safe *only because*
   of the plan decomposition — so the size expansion and the plan skill must ship
   together.
3. **Two milestone classes, two diversity strategies.** Methodology/design
   milestones (M10–M14) keep whole-milestone independent re-derivation (cheap —
   the deliverable is a doc). Development milestones re-derive the **proposal**
   (the approach is the expensive, cheap-to-catch-early error — M13's two
   iterations diverging on the DIR-010 namespace decision is the existence proof),
   then implement **once**, then a light tail self-check.
4. **Diversity clamped at both ends.** Upstream: N independent subagents author
   proposals → reconcile/adjudicate. Downstream: the existing adversarial-audit
   gate (DIR-007/M10), unchanged, kept as a separate capability (not merged into
   tail verification). The single implementation runs between the two ends, so no
   separate independent tail-verifier is spawned.
5. **The plan is CHECKED, not re-derived.** Plan-class errors are verifiable
   against ground truth, so a single **codebase-grounded** independent subagent
   catches them reliably where two independent plans might both misread the same
   code; iterate to convergence (no material change), cap ~2–3 rounds, reusing
   BAIME's own ΔV-small-and-stable stop condition. Optional plan re-derivation is
   declined by default (ad hoc only if a decomposition is genuinely contested).
6. **Every generative/critical step is an independent subagent, grounded per
   role** — proposal-re-derivation subagents lean blank-slate (divergence is
   signal); the plan-check subagent is maximally codebase-grounded.
7. **TDD ≥80% per stage becomes a hard gate**, since single-implementation makes
   it the primary implementation-correctness net (stricter than exp5's current
   "paste test output" evidence gate).

## Requested action

Design-only at this stage (same routing as DIR-009/010/011 — do not implement,
do not charter yet from this DIR directly). Route as follows:

1. **Charter a design-doc milestone** that fully specifies the new skill (working
   name `quay-task-to-plan`): its quay task read/write behavior (provider tool
   per DIR-009 item 8; proposal→`body` write-back per DIR-011; milestone→task
   grouping via M12 parent/children WRITE); the proposal step as N-independent +
   adjudication (strengthening `proposal-to-plan`'s single architect-review into
   parallel re-derivation while keeping architect-review as an added adversarial
   pass); the plan step as author + grounded convergent check (§7 of the
   proposal); the TDD ≥80% hard gate; provider-agnostic degradation on GitHub;
   and reuse of `feature-developer`'s orchestration where it fits. Produce, as its
   own deliverable, a dispatch-ready "Done-when clauses a future implementing
   milestone would need" section (matching the M13/M14 pattern).
2. **Add the milestone-model changes to `inherited-core.md` / `OUTER-LOOP.md`** in
   that same or a following milestone: the ≤2000-line milestone ceiling with the
   ≤500/≤200 nested budgets and a **plan-time line-budget gate** (else this is the
   DIR-002 "enforcement half never built" pattern again); the two-class diversity
   policy keyed on the value-typed ledger; the two-ends-clamp pipeline. Keep these
   as reusable substrate other quay-using projects inherit, distinct from the
   adversarial-audit and release-cadence capabilities.
3. **Dogfood.** The first *implementation* milestone that builds the skill should
   itself be the first development-class milestone to run through the very pipeline
   the skill defines, cross-checked against the existing `proposal-to-plan`. The
   overdue implementation milestones already queued (M-TASK-BACKLOG-PROJECTION
   impl, M-CLI-EDIT-PARITY impl, release cadence) are the natural first customers.

Non-goals (carry through to the charter): do not render stage-level process in the
Web UI; do not delete or fork `proposal-to-plan` for non-quay use (the new skill
is additive); do not store `extra{}` on GitHub tasks (the hard-error floor stays).

Value type: capability-growth (a new methodology capability + the skill itself) +
governance-integrity (closes the "milestone has no plan" gap for development work).
Δv̂ is method-infra-dominated for the design milestone (≈0, like M-SIZING/
M-VMETA-GATE); the eventual skill-implementation milestone may carry a small
positive Δv̂ — size at SELECT time.

## Resolution
- resolved_by: outer-loop DRAIN at the m16→m17 SELECT boundary, 2026-07-18
- outcome: applied — routed exactly per this DIR's own "Requested action" item 1
- evidence: chartered `experiments/quay-perpetual-stream/charters/M17-task-to-plan-skill-design.md`
  as a design-doc-only milestone (same routing class as DIR-009/010/011/DIR-012 item 1's own
  instruction: design-only, do not implement, do not charter the skill's implementation yet).
  Requested-action items 2 (milestone-model changes to `inherited-core.md`/`OUTER-LOOP.md`) and 3
  (dogfooding on the first development-class implementation milestone) are explicitly out of scope
  for M17 and left for a following milestone once M17's design lands — see M17's own charter for the
  precise scope boundary.
