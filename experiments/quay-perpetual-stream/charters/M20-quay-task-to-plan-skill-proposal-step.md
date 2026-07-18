# Charter M20-quay-task-to-plan-skill-proposal-step — Phase 6 of the DIR-012/DIR-014 skill build (Tier-A)

**Milestone id:** M20-quay-task-to-plan-skill-proposal-step · **surface:** skill
(`.claude/skills/quay-task-to-plan/`) · **type:** explore
**Source:** `directives/pending/DIR-014-*.md` (human-asserted, 2026-07-18) — "charter a
development-class milestone that builds the skill." **Plan (phase/stage decomposition, per
M18's own ceiling-expansion requirement):** `docs/plans/3-7-quay-task-to-plan-skill.md` Phase 6
("The `quay-task-to-plan` skill — proposal step", ~460 est. lines, Stages 6.1-6.3). This charter
implements Phase 6 ONLY — Phase 7 (plan step + TDD gate + DISPATCH wiring) is a separate future
milestone, per the plan's own `6 → 7` mandatory-ordering rule.
**Charter authored:** m19→m20 boundary, 2026-07-18.

## Value hypothesis
- Value type (per `inherited-core.md`'s value-typed SELECT ledger): **capability-growth** (primary
  — a new standing skill artifact, the first concrete build toward closing DIR-012/DIR-014's
  "enforcement half never built" gap) + **discovery** (secondary — Phase 6 is genuinely new
  construction, not a re-derivation of existing substrate; real risk the N-subagent/adjudication
  design needs adjustment once actually built).
- Δv̂: **zero direct VT points** — `inherited-core.md`'s VT chart has no cell for a new skill
  artifact (mirrors M16-CLI-EDIT-PARITY-IMPL's own realized-Δv=0 precedent: capability-growth-typed
  but no chart cell exists to score it against). State this explicitly at ABSORB; do not fabricate
  a VT number.
- Metric `Y`: none (no VT chart move). Success is: does `.claude/skills/quay-task-to-plan/SKILL.md`
  exist with the scaffold + proposal step + adjudication/write-back step, matching Phase 6's three
  stages' acceptance criteria in the plan (Stage 6.1/6.2/6.3), citing the plan document as the
  authoritative build spec (this charter is thin per §3.1; the plan carries the detail).

## In-scope work (= plan Phase 6, Stages 6.1-6.3, verbatim scope — cite, do not re-derive)
Read `docs/plans/3-7-quay-task-to-plan-skill.md`'s "Phase 6" section (Stages 6.1-6.3) as the
authoritative build spec. Summary (full acceptance criteria live in the plan, not duplicated here):
1. **Stage 6.1 — Skill scaffold.** `.claude/skills/quay-task-to-plan/SKILL.md` frontmatter +
   overview + Steps skeleton, modeled on `.claude/skills/quay-directive/SKILL.md`'s shape. Define
   the provider read (`task_get`/`task_list`) and write (`task_write` / full-field `task edit`,
   never a status-only patch) contract. Encode DIR-011's portability rule (proposal → task `body`,
   portable; `extra{}` native-only mirror; GitHub degradation — no `extra`, parent/children via
   checkbox body per M12).
2. **Stage 6.2 — Proposal step.** Add the proposal step to `SKILL.md` + a parametrized subagent
   prompt template at `.claude/skills/quay-task-to-plan/prompts/proposal-subagent.md`. N independent
   Task-agent runs (default N=2), blank-slate-leaning, no inter-agent communication, persona
   differentiation. Architect-review retained as an *additional* pass. Writes nothing to the task
   until adjudication (Stage 6.3).
3. **Stage 6.3 — Adjudication + write-back.** Add the adjudication/write-back step to `SKILL.md` +
   `.claude/skills/quay-task-to-plan/prompts/adjudicate-proposal.md`. M13-style reconciliation of
   the N proposals (adjudicate on design-level divergence). Write-back to task `body` via
   `task_write`, with a regeneration discipline (a task's proposal is not write-once — must be
   regeneratable when the task is re-grouped, mirroring the M05 projection pattern). Read back with
   `task_get` to confirm the write landed.

## Explicitly OUT of scope this milestone
- **Do not** build Phase 7 (the plan step, grounded convergent check, TDD ≥80% hard gate, or
  DISPATCH wiring) — that is a separate future milestone per the plan's own `6 → 7` ordering.
- **Do not** wire `OUTER-LOOP.md` DISPATCH to invoke this skill, and do not make the two-class
  diversity policy non-discretionary — both are explicitly DIR-014's Phase-7-adjacent asks, out of
  Phase 6's scope.
- **Do not** touch `inherited-core.md`'s or `OUTER-LOOP.md`'s M18-added sections (ceiling, diversity
  policy, line-budget gate) — unrelated surface, already closed at m18.
- **Do not** re-litigate or re-derive Phase 3/4/5 (already built at M18) or the design doc/plan
  content itself (already matured/fixed at M17/M19) — cite them, do not re-author them.
- **Do not** actually run the skill end-to-end against live production tasks this milestone — Stage
  6.3's acceptance is about the skill's documented contract + a demonstrated dry-run/self-test, not
  a live dogfooding pass against real backlog tasks (that's Phase 7/DIR-014's "dogfoods itself" ask).

## Binary Done-when (§3.4 — mandatory, freezes this milestone's shape)
1. `[ ]` `.claude/skills/quay-task-to-plan/SKILL.md` exists with valid frontmatter (matching the
   in-repo shape of `.claude/skills/quay-directive/SKILL.md`) — pasted file listing + frontmatter.
2. `[ ]` The provider read/write contract (Stage 6.1) is documented: MCP `task_get`/`task_list` read,
   MCP `task_write` / full-field `task edit` write (not status-only), DIR-011 portability rule
   (body-portable, extra-native-only, GitHub degradation) — pasted excerpt.
3. `[ ]` The proposal step (Stage 6.2) is documented in `SKILL.md` + a real prompt template exists at
   `.claude/skills/quay-task-to-plan/prompts/proposal-subagent.md` (N=2 default, blank-slate,
   persona-differentiated, architect-review retained as additional pass) — pasted file + excerpt.
4. `[ ]` The adjudication/write-back step (Stage 6.3) is documented in `SKILL.md` + a real prompt
   template exists at `.claude/skills/quay-task-to-plan/prompts/adjudicate-proposal.md`
   (reconciliation-on-divergence, regeneration discipline stated) — pasted file + excerpt.
5. `[ ]` A demonstrated dry-run/self-test evidence: run the skill's documented steps against a small
   real or synthetic task set in this repo's own task store (native provider, scratch task(s) —
   never against a real GitHub repo without explicit scratch-issue precedent per M09/M16) and paste
   the raw provider read/write output proving the contract as documented actually works end-to-end
   for at least the write-back step (Stage 6.3's `task_write` + `task_get` read-back).
6. `[ ]` `git diff --stat` against this milestone's pre-charter base commit shows only
   `.claude/skills/quay-task-to-plan/` files (+ this milestone's own charter/iteration/backlog/
   dashboard bookkeeping) changed — no Core CLI code, no `inherited-core.md`/`OUTER-LOOP.md` edits,
   no Phase 7 content.
7. `[ ]` Full existing test suite still passes post-change if any script/tooling changed (pasted raw
   output); N/A-and-stated if only skill/prompt markdown + a scratch-task dry-run were touched.
8. `[ ]` `backlog.md` gains an `M-TASK-TO-PLAN-SKILL-PROPOSAL-STEP` row (or similarly named), marked
   DONE at ABSORB, explicitly noting Phase 7 (plan step + TDD gate + DISPATCH wiring) remains open
   future work.

Milestone is DONE when all eight are met and stable ≥1 iteration (§3.2 condition 1). Terminate early
per §3.2 conditions 2-5 if they fire first. Real independent-re-derivation material for iteration-1
exists: whether the N-subagent proposal design is faithful to the plan's blank-slate/no-communication
discipline, whether the write-back regeneration discipline is stated precisely enough to survive a
skeptical re-read, and whether the dry-run evidence actually demonstrates the full-field write path
(not a status-only patch) are all independently checkable.

## Plan-time line-budget gate (M18-milestone-model-ceiling-and-diversity-policy) — run before dispatch
This charter cites an external phase/stage plan (`docs/plans/3-7-quay-task-to-plan-skill.md`,
Phase 6 ≈460 est. lines, well under the ≤500-line phase budget) — satisfies the "budget ≤2000 WITH a
phase/stage plan present" PASS condition even though the skill's total estimated line count across
all in-scope-work items may run higher than a typical small milestone.
`scripts/it0-ceiling-line-budget-check.sh charters/M20-quay-task-to-plan-skill-proposal-step.md` — run
and record the result before dispatch.

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
c. **Dogfooding evidence-gate** — every Done-when clause requires pasted file/excerpt/raw-output
   evidence; clause 5 specifically requires a real provider read/write run, not narrative alone.
d. **Domain-misfit audit-channel** — this milestone creates new skill/prompt markdown files plus a
   real (but scratch-scoped) provider read/write dry-run against this repo's own native task store —
   no live external system beyond this repo's own already-in-use native provider, consistent with
   M09/M16's own scratch-task precedent.
e. **Plan-time line-budget gate** (M18-milestone-model-ceiling-and-diversity-policy) — see above,
   run and record before dispatch. This charter cites the plan document rather than duplicating its
   detail, keeping the charter itself thin per §3.1.

## Adversarial-audit gate — evaluate at ABSORB (state explicitly)
Per `inherited-core.md`'s Adversarial-audit cadence rule: condition (a) fires on a capability-growth-
typed milestone with a NONZERO realized VT Δv appended at ABSORB — this milestone is typed
capability-growth+discovery but Δv̂=0 by design (no VT chart cell for a new skill artifact, mirrors
M16's own precedent) — if realized Δv is confirmed zero at ABSORB (expected), condition (a) does NOT
fire; if for any reason a nonzero Δv is claimed, the gate MUST fire and an adversarial audit must run
before ABSORB completes. Condition (b) requires iteration-0 to recommend SKIPPING iteration-1 — this
charter does not authorize that (substantial independent-re-derivation material exists per the sizing
note above); if iteration-0 attempts this, override per the M-SIZING/M13/M14/M15/M17/M18 precedent,
dispatch iteration-1 regardless, record the override explicitly.

## Dispatcher
Run via `baime:iteration-executor`, one inner iteration at a time, non-blocking dispatch
(`run_in_background=true`), reading only this charter (Tier-A) + the pinned Tier-B pointer above +
the literal gate text resolved by the dispatcher + `docs/plans/3-7-quay-task-to-plan-skill.md`'s
Phase 6 section (Stages 6.1-6.3, the authoritative build spec) +
`docs/proposals/exp5-quay-task-proposal-plan-skill.md` §§12-13 (read/write behavior, proposal step
detail, Part II) + `.claude/skills/quay-directive/SKILL.md` (structural precedent for the new
skill's shape) + `directives/pending/DIR-014-*.md` (the source directive). Record each iteration
under `experiments/quay-perpetual-stream/milestones/M20-quay-task-to-plan-skill-proposal-step/iterations/`.
Worktree:
`experiments/quay-perpetual-stream/milestones/M20-quay-task-to-plan-skill-proposal-step/worktrees/iteration-N`,
branch `exp5-m20-iteration-N`.

**Live external-system access:** MCP `task_write`/`task_get`/`task_list` (native provider) or
`packages/quay/bin/quay.js task ...` CLI equivalents, against this repo's own native task store,
scratch-scoped (create/use throwaway scratch task(s), do not mutate real backlog/directive tasks).
No GitHub provider access required for Phase 6's dry-run evidence (GitHub degradation is documented,
not live-tested, this phase — Phase 7/a future milestone can add the GitHub-path live probe).
