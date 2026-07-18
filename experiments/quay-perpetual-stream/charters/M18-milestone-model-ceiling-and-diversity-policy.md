# Charter M18-milestone-model-ceiling-and-diversity-policy — land DIR-012 item 2 (Tier-A)

**Milestone id:** M18-milestone-model-ceiling-and-diversity-policy · **surface:** method infra
(`inherited-core.md`, `OUTER-LOOP.md`) · **type:** explore
**Source:** `directives/archive/DIR-012-*.md`, Requested-action item 2 ("Add the milestone-model
changes to `inherited-core.md`/`OUTER-LOOP.md` in that same or a following milestone"). Precursor
artifact: `docs/proposals/exp5-quay-task-proposal-plan-skill.md` §4 (the ≤2000-line milestone
ceiling with nested ≤500/≤200 budgets, resolved this conversation), §5 (two milestone classes, two
diversity strategies), §6 (the "clamp at both ends" pipeline) — all matured and dispatch-ready as of
M17's ABSORB (m17, `milestone_counter=17`).
**Charter authored:** m17→m18 boundary, 2026-07-18.

## Value hypothesis
- Value type (per `inherited-core.md`'s value-typed SELECT ledger): **governance-integrity**
  (primary — closes the "invariant with no mechanical enforcement" gap DIR-012 itself names,
  the same DIR-002/DIR-005/DIR-006-class pattern recurring one level up: a sizing/diversity policy
  that exists only in a design doc, not in the substrate SELECT/charter-authoring actually reads) +
  **risk/option** (secondary — lands the ceiling-expansion prerequisite before any future milestone
  needs to exceed the current small-milestone-only regime, avoiding a repeat of M06-sizing's own
  "left open" deferral pattern).
- Δv̂: **zero direct VT points** — this is method infra (substrate document edits), not a
  capability-surface change. Mirrors M-SIZING/M-VMETA-GATE/M-DIR-PROJECTION's own zero-VT,
  method-infra precedent.
- Metric `Y`: none (no VT chart move). Success is: does `inherited-core.md` gain a mechanically
  checkable milestone-sizing rubric (≤2000/≤500/≤200-line budgets) and a value-typed diversity
  policy (methodology/design milestones keep whole-milestone re-derivation; development milestones
  re-derive the proposal, implement once, light tail check) at the same rigor M-SIZING's own
  sizing-rubric section achieved; does `OUTER-LOOP.md` gain a plan-time line-budget gate (not just a
  narrative mention) enforcing the ceiling at SELECT/charter time, avoiding DIR-002's own
  "enforcement half never built" failure mode.

## In-scope work (= DIR-012 Requested-action item 2, verbatim scope)
1. **Add the ≤2000-line milestone ceiling with nested ≤500/≤200 phase/stage budgets** to
   `inherited-core.md`'s existing sizing-rubric section (built at M-SIZING, m6) — as an amendment,
   not a replacement: state explicitly that a milestone sized above the current small-milestone norm
   is safe *only when* decomposed into a phase/stage plan (per the design doc §4's own reasoning),
   and unsafe otherwise. Cite `docs/proposals/exp5-quay-task-proposal-plan-skill.md` §4 as the
   source.
2. **Add a plan-time line-budget gate** to `OUTER-LOOP.md`'s SELECT/charter-authoring step — a real,
   mechanically-checkable gate (not narrative-only), following the same it0-gate-hash-check.sh /
   it0-ceiling-check.sh precedent M-GATES (m2) established: a milestone whose charter declares a
   line-budget above ~2000 (or whose in-scope work items, at charter-authoring judgment, plausibly
   exceed that without a nested phase/stage plan) must not be dispatched without one. This closes the
   exact DIR-002-class gap DIR-012 itself flags (design says "must ship together"; this milestone is
   what makes that mechanically true, not merely asserted).
3. **Add the value-typed two-class diversity policy** to `inherited-core.md`'s existing value-typed
   SELECT ledger section (built at M-SIZING, m6): methodology/design-class milestones (the M10-M17
   precedent — doc-only deliverables) keep whole-milestone independent re-derivation, unchanged;
   development-class milestones (the M16-CLI-EDIT-PARITY-IMPL precedent — real product-code changes)
   MAY, at a future charter's discretion, use the narrower N-independent-proposal + single-
   implementation + light-tail-check pattern instead of whole-milestone dual iteration, once the
   `quay-task-to-plan` skill (or an equivalent proposal-adjudication step) actually exists to run it
   through. State explicitly: **this milestone does NOT change M18's own dispatch pattern** — M18
   itself still runs the existing whole-milestone dual-iteration pattern (the skill this policy
   describes is not yet built; DIR-012 item 3 remains future work). This is a policy statement for
   *future* development-class milestones, not a self-referential change to how M18 itself is run.
4. **Cite `docs/proposals/exp5-quay-task-proposal-plan-skill.md` §6** ("clamp at both ends") as the
   substrate description of the pipeline shape the diversity policy above refers to, without
   duplicating its full content into `inherited-core.md` — `inherited-core.md` should state the
   policy and point at the design doc for the mechanism detail, keeping Tier-B pinned-substrate size
   controlled (per DIR-009's own charter-thinness discipline).

## Explicitly OUT of scope this milestone (DIR-012's item 3 — do NOT do this here)
- **Do not** build the `quay-task-to-plan` skill itself, and do not create anything under
  `.claude/skills/quay-task-to-plan/` — that is DIR-012 item 3, a separate future (development-class)
  milestone, per the design doc's own §17 dispatch-ready checklist (not consumed by this charter).
- **Do not** change M18's own dispatch pattern to the narrower development-class diversity strategy
  described in in-scope item 3 above — M18 is method-infra/doc-editing, runs the existing
  whole-milestone dual-iteration pattern like M13-M17.

## Binary Done-when (§3.4 — mandatory, freezes this milestone's shape)
1. `[ ]` `inherited-core.md`'s sizing-rubric section (from M-SIZING) is amended with the ≤2000/≤500/
   ≤200-line ceiling and nested budgets, citing the design doc §4 — pasted diff.
2. `[ ]` `OUTER-LOOP.md`'s SELECT/charter-authoring step gains an explicit, mechanically-checkable
   plan-time line-budget gate (a real check, not narrative) — pasted diff.
3. `[ ]` A gate script or gate-check procedure exists (new script under `scripts/`, or an explicit
   reuse/extension of an existing `it0-*-check.sh` script) demonstrating the line-budget gate can
   actually fire on a deliberately-oversized test charter — pasted script + a real run showing both
   a PASS (small charter) and a FAIL/flag (oversized charter, no phase/stage plan) case.
4. `[ ]` `inherited-core.md`'s value-typed SELECT ledger section is amended with the two-class
   diversity policy (methodology/design vs. development-class), explicitly stating M18 itself is
   NOT switching patterns — pasted diff.
5. `[ ]` `inherited-core.md` cites (not duplicates) `docs/proposals/exp5-quay-task-proposal-plan-skill.md`
   §6 for the diversity-policy mechanism detail — pasted diff showing the citation.
6. `[ ]` Confirm explicitly that DIR-012 item 3 (skill implementation/dogfooding) was NOT performed
   this milestone — `git diff --stat` against this milestone's pre-charter base commit shows only
   `inherited-core.md`/`OUTER-LOOP.md` (+ any new/extended gate script) + this milestone's own
   charter/iteration/backlog/dashboard bookkeeping changed, no `.claude/skills/` files touched.
7. `[ ]` Full existing test suite still passes post-change if any script/tooling changed (pasted raw
   output); N/A-and-stated if only markdown changed and no script/tooling touched.
8. `[ ]` `backlog.md` gains an `M-MILESTONE-CEILING-DIVERSITY-POLICY` row (or similarly named), marked
   DONE at ABSORB, pointing at the finished substrate changes and noting DIR-012 item 3 remains open.

Milestone is DONE when all eight are met and stable ≥1 iteration (§3.2 condition 1). Terminate early
per §3.2 conditions 2-5 if they fire first. Sized comparably to M-SIZING/M-VMETA-GATE (method-infra
substrate edit with a real mechanized gate, not narrative-only) — real independent-re-derivation
material for iteration-1 exists: whether the line-budget gate script actually fires correctly on
both PASS/FAIL cases, whether the diversity-policy wording is internally consistent with the
existing value-typed ledger, and whether M18's own self-exemption (item 3 in-scope note) is stated
precisely enough to survive a skeptical re-read are all independently checkable.

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
c. **Dogfooding evidence-gate** — every Done-when clause requires pasted diff/script-output
   evidence; no clause may be marked met on narrative alone. This is especially load-bearing here
   since this milestone's own deliverable IS a dogfooding/evidence-gate mechanism (the line-budget
   gate) — it must demonstrate itself working, not just describe itself.
d. **Domain-misfit audit-channel** — this milestone edits two markdown substrate files + possibly one
   shell/JS gate script, no live external system, no product code. Consistent with
   M-SIZING/M-VMETA-GATE/M-GATES's own method-infra-only precedent.

## Adversarial-audit gate — NOT expected to trigger (state explicitly at ABSORB)
Per `inherited-core.md`'s Adversarial-audit cadence rule: condition (a) requires a capability-growth-
typed milestone with nonzero realized VT Δv appended at ABSORB — this milestone is typed
governance-integrity+risk/option with Δv̂=0 by design, so condition (a) does not apply. Condition (b)
requires iteration-0 to recommend SKIPPING iteration-1 — this charter does not authorize that (real
independent-re-derivation material exists per the sizing note above), so condition (b) should also
not fire absent an iteration-0 self-exemption; if it does, override per the M-SIZING/M13/M14/M15/M17
precedent, dispatch iteration-1 regardless, record the override explicitly.

## Dispatcher
Run via `baime:iteration-executor`, one inner iteration at a time, non-blocking dispatch
(`run_in_background=true`), reading only this charter (Tier-A) + the pinned Tier-B pointer above +
the literal gate text resolved by the dispatcher + `docs/proposals/exp5-quay-task-proposal-plan-skill.md`
§4-6 (the source design this charter implements as substrate) + `directives/archive/DIR-012-*.md`
(the source directive) + existing `experiments/quay-perpetual-stream/scripts/it0-*-check.sh` scripts
(precedent for the new/extended line-budget gate script). Record each iteration under
`experiments/quay-perpetual-stream/milestones/M18-milestone-model-ceiling-and-diversity-policy/iterations/`.
Worktree:
`experiments/quay-perpetual-stream/milestones/M18-milestone-model-ceiling-and-diversity-policy/worktrees/iteration-N`,
branch `exp5-m18-iteration-N`.

**No live external-system access required** — markdown substrate editing + a shell/JS gate script,
reading this repo's own `docs/proposals/`, `directives/archive/`, `inherited-core.md`,
`OUTER-LOOP.md`, `experiments/quay-perpetual-stream/scripts/` for structural precedent.
