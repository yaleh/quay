# Charter M17-task-to-plan-skill-design — quay-task-native proposal→plan skill design doc (Tier-A)

**Milestone id:** M17-task-to-plan-skill-design · **surface:** method infra (new skill design,
milestone-model concepts) · **type:** explore
**Source:** `directives/archive/DIR-012-*.md`, Requested-action item 1 ("Charter a design-doc
milestone that fully specifies the new skill... Produce, as its own deliverable, a dispatch-ready
'Done-when clauses a future implementing milestone would need' section, matching the M13/M14
pattern"). Precursor artifact: `docs/proposals/exp5-quay-task-proposal-plan-skill.md` (status DRAFT
at charter-authoring time, produced live in the same conversation that raised DIR-012) — this
milestone's job is to take that conversational-draft design and turn it into a fully specified,
dispatch-ready skill design, the same maturation M13/M14 each performed on their own source
directives (DIR-009/010 and DIR-011 respectively).
**Charter authored:** m16→m17 boundary, 2026-07-18.

## Value hypothesis
- Value type (per `inherited-core.md`'s value-typed SELECT ledger): **discovery** (primary — DIR-012
  itself identifies a real structural gap: exp5 milestone charters have no Phase/Stage implementation
  plan with line budgets, verified against M12/M14's own charter text; formalizing a design for
  closing that gap is a discovery-instrument improvement, mirroring M-SIZING's own
  "closes a blind spot before it causes drift" precedent) + **governance-integrity** (secondary —
  closes the "milestone has no plan" gap for development-class work, the DIR-002-class "invariant
  with no mechanical enforcement" pattern recurring one level up, same framing DIR-012 itself uses).
- Δv̂: **zero direct VT points** — this is method infra (a skill design doc + dispatch-ready
  Done-when checklist), not a capability-surface change. Mirrors M13/M14's own zero-VT,
  design-doc-only precedent (both DONE, both design delivered / not yet charter-ready for
  implementation).
- Metric `Y`: none (no VT chart move). Success is: does the design doc fully specify the
  `quay-task-to-plan` skill (task/proposal read-write behavior, N-independent-proposal +
  adjudication step, plan author + grounded-convergent-check step, TDD ≥80% hard gate,
  provider-agnostic degradation on GitHub) at the same fidelity M13/M14's own docs achieved; does it
  produce a concrete, pasted, dispatch-ready "Done-when clauses a future implementing milestone would
  need" section (§6-equivalent, matching M13/M14's own doc structure).

## In-scope work (= DIR-012 Requested-action item 1, verbatim scope — items 2 and 3 explicitly OUT)
1. **Read `docs/proposals/exp5-quay-task-proposal-plan-skill.md` in full** (the live-conversation
   draft DIR-012 references) as the starting design, not a blank slate — this milestone matures and
   completes that draft, it does not re-derive it from zero. Note its `Status: DRAFT` marker at
   charter-authoring time; if it has been further revised since (check `git log` on the file) before
   or during this milestone, read the current version, not a stale cached copy.
2. **Fully specify the skill's quay task read/write behavior**: which Provider ABI tool(s) it calls
   (per DIR-009 item 8's existing provider-tool convention), the proposal→`body` write-back shape
   (per DIR-011's portable-metadata rule — body-first, `extra{}` native-only, already landed in
   `inherited-core.md` at M16), and the milestone→task grouping mechanism (reusing M12's real
   parent/children WRITE capability, not a new mechanism).
3. **Fully specify the proposal step**: N-independent-subagent proposal authoring + an adjudication
   step, explicitly positioned as strengthening `proposal-to-plan`'s existing single-architect-review
   step into parallel re-derivation (not replacing architect-review — keep it as an added adversarial
   pass, per the source draft's own §4/§5 framing).
4. **Fully specify the plan step**: author + a grounded, convergent independent-check subagent
   (checked-not-re-derived, per the source draft's §7 reasoning — plan errors are checkable against
   ground truth, unlike proposal-approach divergence). State the convergence/stop condition precisely
   (reuse BAIME's own ΔV-small-and-stable pattern, cap ~2-3 rounds, as the source draft proposes).
5. **State the TDD ≥80%-per-stage hard gate** precisely — what it gates, how it's verified, why it
   becomes load-bearing specifically because single-implementation (not independently re-derived)
   removes the tail-verification net M09-style milestones currently rely on.
6. **State provider-agnostic degradation on GitHub** explicitly (what happens when a plan/proposal
   step's provider-tool calls hit the GitHub hard-error floor established by M09/PR-ABI-001).
7. **Produce a dispatch-ready "Done-when clauses a future implementing milestone would need" section**
   — matching the concrete, checklist-shaped form M13 §11-equivalent and M14 §6 both used (pasted
   diff/invocation-style clauses, not narrative).
8. **Explicitly state non-goals** (carried through from DIR-012's own list): no stage-level process
   rendered in the Web UI; no fork/deletion of `proposal-to-plan` for non-quay use (additive only);
   no `extra{}` storage on GitHub tasks (hard-error floor unchanged).

## Explicitly OUT of scope this milestone (DIR-012's items 2 and 3 — do NOT do these here)
- **Do not** edit `inherited-core.md`/`OUTER-LOOP.md` with the ≤2000/≤500/≤200-line milestone-model
  changes yet (DIR-012 item 2) — that is a separate future milestone, once this design lands and is
  itself reviewed. This charter produces the skill design only.
- **Do not** implement the skill itself, and do not dogfood it (DIR-012 item 3) — no code, no actual
  skill file under `.claude/skills/` or equivalent. Design-doc-only, exactly like M13/M14.

## Binary Done-when (§3.4 — mandatory, freezes this milestone's shape)
1. `[ ]` The starting draft (`docs/proposals/exp5-quay-task-proposal-plan-skill.md`, current version
   at time of work, checked via `git log`) has been read in full and is cited, not re-derived from
   scratch — confirm explicitly which git revision was read.
2. `[ ]` The skill's quay task read/write behavior (Provider ABI tool(s), proposal→body write-back,
   milestone→task grouping via M12 parent/children) is fully specified — pasted doc section.
3. `[ ]` The N-independent-proposal + adjudication step is fully specified, including how it relates
   to (strengthens, doesn't replace) `proposal-to-plan`'s existing architect-review — pasted doc
   section.
4. `[ ]` The plan author + grounded-convergent-check step is fully specified, including the
   convergence/stop condition — pasted doc section.
5. `[ ]` The TDD ≥80%-per-stage hard gate is stated precisely, with the single-implementation
   rationale — pasted doc section.
6. `[ ]` Provider-agnostic GitHub degradation is stated explicitly — pasted doc section.
7. `[ ]` A dispatch-ready "Done-when clauses a future implementing milestone would need" checklist is
   produced, in the same concrete/checklist form as M13/M14's own — pasted in full.
8. `[ ]` Non-goals are stated explicitly (no Web UI process rendering, no `proposal-to-plan`
   fork/deletion, no GitHub `extra{}` storage) — pasted doc section.
9. `[ ]` Confirm explicitly that DIR-012 items 2 (milestone-model changes to
   `inherited-core.md`/`OUTER-LOOP.md`) and 3 (dogfooding/implementation) were NOT performed this
   milestone — `git diff --stat` against this milestone's pre-charter base commit shows only the
   design doc (+ this milestone's own charter/iteration/backlog/dashboard bookkeeping) changed, no
   `inherited-core.md`/`OUTER-LOOP.md`/skill-implementation files touched.
10. `[ ]` `backlog.md` gains an `M-TASK-TO-PLAN-SKILL-DESIGN` row (or similarly named), marked DONE
    at ABSORB, pointing at the finished doc.

Milestone is DONE when all ten are met and stable ≥1 iteration (§3.2 condition 1). Terminate early
per §3.2 conditions 2-5 if they fire first. Sized comparably to M13/M14 (design-doc-only, real
independent-re-derivation material for iteration-1 — whether the proposal/plan step specs are
internally consistent, whether the Done-when checklist is genuinely dispatch-ready or still vague,
whether DIR-012's items 2/3 boundary was actually respected are all independently checkable).

## HARD GATES (Tier-A, cited BY REFERENCE — §3.1, DIR-009 defense; M06-sizing by-reference form)

Source: pinned HARD GATES block, `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` lines
100-131. Cited by hash instead of transcribed (literal text deliberately not duplicated here):

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

Verify: `experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh --by-reference <this
file>` — PASS = hash still matches pinned source's current block (no drift); FAIL = re-derive
before dispatch.

**Charter thinness ≠ agent prompt thinness.** The dispatched `baime:iteration-executor` prompt
must still contain the LITERAL gate text in full (resolved from `GATE-HASH-REF` by the dispatcher
before constructing the prompt) — never only a hash, or this reintroduces DIR-009 dilution.

## Inner termination — five conditions (verbatim pointer, §3.2)
Applies unmodified: (1) Done-when complete & stable ≥1 iter · (2) ΔV<0.02 both layers K=2
consecutive · (3) ceiling→redesign-OR-stop · (4) budget≈10 backstop, past→default HALT ·
(5) external HALT.

## it0 systematic-explore checks (§4.4 — run and record BEFORE first work)
a. **Ceiling/floor arithmetic** — N/A this milestone (zero VT points by design, stated above);
   confirm at it0 that no VT-chart claim is accidentally introduced.
b. **Gate-hash/transclusion** — verified above via `--by-reference` mode; re-run before dispatch.
c. **Dogfooding evidence-gate** — every Done-when clause requires a pasted doc-section/diff; no
   clause may be marked met on narrative alone.
d. **Domain-misfit audit-channel** — this milestone edits/creates one markdown design doc, no live
   external system, no product code. Consistent with M-SIZING/M-VMETA-GATE/M13/M14/M15's own
   doc/method-infra-only precedent.

## Adversarial-audit gate — NOT expected to trigger (state explicitly at ABSORB)
Per `inherited-core.md`'s Adversarial-audit cadence rule: condition (a) requires a capability-growth-
typed milestone with nonzero realized VT Δv appended at ABSORB — this milestone is typed
discovery+governance-integrity with Δv̂=0 by design, so condition (a) does not apply. Condition (b)
requires iteration-0 to recommend SKIPPING iteration-1 — this charter does not authorize that (real
independent-re-derivation material exists per the sizing note above), so condition (b) should also
not fire absent an iteration-0 self-exemption; if it does, override per the m6/M13/M14/M15
precedent, dispatch iteration-1 regardless, record the override explicitly.

## Dispatcher
Run via `baime:iteration-executor`, one inner iteration at a time, non-blocking dispatch
(`run_in_background=true`), reading only this charter (Tier-A) + the pinned Tier-B pointer above +
the literal gate text resolved by the dispatcher + `docs/proposals/exp5-quay-task-proposal-plan-skill.md`
(the starting draft this charter matures — required reading) + `directives/archive/DIR-012-*.md`
(the source directive). Record each iteration under
`experiments/quay-perpetual-stream/milestones/M17-task-to-plan-skill-design/iterations/`. Worktree:
`experiments/quay-perpetual-stream/milestones/M17-task-to-plan-skill-design/worktrees/iteration-N`,
branch `exp5-m17-iteration-N`.

**No live external-system access required** — pure design-doc markdown editing, reading this repo's
own `docs/proposals/`, `directives/archive/`, `inherited-core.md`, prior M13/M14 charters/docs for
structural precedent.
