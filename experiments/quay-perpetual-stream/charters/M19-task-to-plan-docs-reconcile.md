# Charter M19-task-to-plan-docs-reconcile — fix DIR-013's three doc defects (Tier-A)

**Milestone id:** M19-task-to-plan-docs-reconcile · **surface:** docs
(`docs/proposals/exp5-quay-task-proposal-plan-skill.md`,
`docs/plans/3-7-quay-task-to-plan-skill.md`) · **type:** explore
**Source:** `directives/pending/DIR-013-*.md` (human-asserted directly in the live conversation,
2026-07-18) — Requested-action items 1-4. Finding: a concurrent human-directed `proposal-to-plan`
run and the autonomous M17 milestone independently designed the same skill in the same file; the
merge (`989e0cd`) took M17 iteration-0's body wholesale, leaving three concrete MUST-FIX defects
confined to the two design docs (no interleaved contradictory-value damage).
**Charter authored:** m18→m19 boundary, 2026-07-18.

## Value hypothesis
- Value type (per `inherited-core.md`'s value-typed SELECT ledger): **governance-integrity** — the
  record is self-contradictory (dangling `§N` cross-references that resolve to nothing, a
  status header/TOC that undercounts the sections actually present) and the companion plan is stale
  enough to misdirect the next real consumer (the future skill-implementation milestone). Not
  capability-growth.
- Δv̂: **zero** — documentation reconciliation only, mirrors M10/M13/M14/M17/M18's zero-VT,
  doc-editing precedent. DIR-013 itself states this explicitly.
- Metric `Y`: none (no VT chart move). Success is: does every internal `§N` reference in
  `docs/proposals/exp5-quay-task-proposal-plan-skill.md` resolve to a section that actually exists;
  does the status header/TOC accurately list all sections present (including §19); does
  `docs/plans/3-7-quay-task-to-plan-skill.md` cite sections that exist and reference the Part II
  (§12-19) operational spec + §17 Done-when checklist, with an explicit authority statement if the
  two ever drift.

## In-scope work (= DIR-013 Requested-action items 1-4, verbatim scope)
1. **Fix F2** — update the proposal's status header (`:7`), the TOC heading (`:16`, `:27`), and the
   TOC table (`:29-38`) to cover **§12-19** (add the §19 row). Do not silently renumber §19 away.
2. **Fix F1** — repoint each dangling `§8.4 / §8.5 / §8 point 6 / §11` reference inside §§12-19 to
   the section that actually carries that content (the code-vs-prose classifier now in §15.2; the
   GitHub-degradation/feature-developer reuse points in §8's flat 6-point list; the bootstrap
   resolution preserved under §19), or restate the referenced content inline. After the fix, every
   internal `§N` reference in the proposal must resolve to an existing section — verify with a full
   grep-and-check sweep, not a sample.
3. **Fix F3** — reconcile `docs/plans/3-7-quay-task-to-plan-skill.md` with the merged proposal:
   re-point its `§8.x`/`§11` citations to the sections that now exist, and add explicit references
   to the Part II (§12-19) operational spec and the §17 Done-when checklist. State explicitly which
   artifact is authoritative if the checklist and the plan's phase/stage decomposition ever drift
   (DIR-013 recommends: the proposal's §17 checklist is the acceptance authority, the plan is the
   build-route elaboration — adopt unless a concrete reason not to is found).
4. **Process note** — record (not necessarily act on) the lesson: this defect class arose from a
   human-directed design run and the autonomous loop writing the same file concurrently on
   `master`. Add a short note to `inherited-core.md` (or `OUTER-LOOP.md`'s merge-handling guidance,
   whichever fits better on inspection) capturing: prefer pausing the loop (`.halt`) or working on a
   branch when a human is live-editing a file the loop will also touch; the merge step must not
   claim "dispatch-ready / singular and unambiguous" when its own appended section contains
   unresolved internal cross-references — a post-merge cross-reference sweep is required. Whether to
   build a mechanical enforcement (a proposal-internal `§N`-reference-resolves check) is explicitly
   left to a future milestone's scoping — do NOT build that check here, only record the lesson.

## Explicitly OUT of scope this milestone
- **Do not** build the `quay-task-to-plan` skill or anything under `.claude/skills/quay-task-to-plan/`
  — that is DIR-012 item 3, untouched by DIR-013.
- **Do not** re-run or re-open M17 itself, or re-litigate its wholesale-selection merge decision —
  only fix the three concrete defects named above in the *result*.
- **Do not** build a mechanical `§N`-reference-resolves enforcement script — DIR-013 item 4
  explicitly defers that decision to a future milestone; this charter only records the lesson.
- **Do not** touch `inherited-core.md`'s or `OUTER-LOOP.md`'s M18-added sections (milestone ceiling,
  diversity policy, line-budget gate) — unrelated surface, already closed at m18.

## Binary Done-when (§3.4 — mandatory, freezes this milestone's shape)
1. `[ ]` Status header + TOC heading + TOC table in
   `docs/proposals/exp5-quay-task-proposal-plan-skill.md` accurately list §12-19 (§19 included) —
   pasted diff.
2. `[ ]` Every internal `§N` cross-reference inside the proposal's §§12-19 resolves to a section that
   actually exists — pasted `grep -n '§[0-9]'` (or equivalent) sweep of the fixed file showing no
   remaining reference to a nonexistent `§8.4/§8.5/§8 point 6/§11`, plus the specific diffs that
   repointed each one.
3. `[ ]` `docs/plans/3-7-quay-task-to-plan-skill.md`'s `§8.x`/`§11` citations are repointed to
   sections that exist, with explicit new references to the Part II (§12-19) spec and the §17
   Done-when checklist — pasted diff.
4. `[ ]` The plan states explicitly which artifact (proposal §17 checklist vs. plan phase/stage
   decomposition) is authoritative if the two ever drift — pasted excerpt.
5. `[ ]` A short process-note lesson (DIR-013 item 4) is recorded in `inherited-core.md` or
   `OUTER-LOOP.md` (whichever fits on inspection) about concurrent human/loop edits to the same file
   — pasted diff. No enforcement script built.
6. `[ ]` `git diff --stat` against this milestone's pre-charter base commit shows only the two named
   doc files (+ this milestone's own charter/iteration/backlog/dashboard bookkeeping, + the single
   process-note file from clause 5) changed — no `.claude/skills/` files, no CLI/product code, no
   M18-added `inherited-core.md`/`OUTER-LOOP.md` sections touched.
7. `[ ]` `directives/pending/DIR-013-*.md` moved to `directives/archive/` with a Resolution section
   (resolved_by, outcome: applied, evidence pointer) at ABSORB.
8. `[ ]` `backlog.md`'s `M-TASK-TO-PLAN-DOCS-RECONCILE` row marked DONE at ABSORB.

Milestone is DONE when all eight are met and stable ≥1 iteration (§3.2 condition 1). Terminate early
per §3.2 conditions 2-5 if they fire first. Sized well under the small-milestone norm (two doc files,
targeted cross-reference fixes, no new mechanism) — real independent-re-derivation material for
iteration-1 exists: whether iteration-0's repointing of each dangling reference is the *correct*
target section (a judgment call per reference) is independently checkable by a fresh read of §§8/15/19.

## Plan-time line-budget gate (M18-milestone-model-ceiling-and-diversity-policy) — run before dispatch
`scripts/it0-ceiling-line-budget-check.sh charters/M19-task-to-plan-docs-reconcile.md` — this
charter is well under the small-milestone norm (targeted cross-reference fixes to two existing
files, no new mechanism, no phase/stage plan needed).

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
c. **Dogfooding evidence-gate** — every Done-when clause requires pasted diff/grep-sweep evidence;
   no clause may be marked met on narrative alone.
d. **Domain-misfit audit-channel** — this milestone edits two markdown design docs + one short
   process-note addition, no live external system, no product code. Consistent with
   M10/M13/M14/M17's own doc-only precedent.
e. **Plan-time line-budget gate** (M18-milestone-model-ceiling-and-diversity-policy) —
   `scripts/it0-ceiling-line-budget-check.sh charters/M19-task-to-plan-docs-reconcile.md` against
   this drafted charter; run and record the result before dispatch.

## Adversarial-audit gate — NOT expected to trigger (state explicitly at ABSORB)
Per `inherited-core.md`'s Adversarial-audit cadence rule: condition (a) requires a capability-growth-
typed milestone with nonzero realized VT Δv appended at ABSORB — this milestone is typed
governance-integrity with Δv̂=0 by design, so condition (a) does not apply. Condition (b) requires
iteration-0 to recommend SKIPPING iteration-1 — this charter does not authorize that (real
independent-re-derivation material exists per the sizing note above), so condition (b) should also
not fire absent an iteration-0 self-exemption; if it does, override per the M-SIZING/M13/M14/M15/M17/
M18 precedent, dispatch iteration-1 regardless, record the override explicitly.

## Dispatcher
Run via `baime:iteration-executor`, one inner iteration at a time, non-blocking dispatch
(`run_in_background=true`), reading only this charter (Tier-A) + the pinned Tier-B pointer above +
the literal gate text resolved by the dispatcher + `docs/proposals/exp5-quay-task-proposal-plan-skill.md`
(the file to fix) + `docs/plans/3-7-quay-task-to-plan-skill.md` (the file to fix) +
`directives/pending/DIR-013-*.md` (the source directive, full finding text). Record each iteration
under `experiments/quay-perpetual-stream/milestones/M19-task-to-plan-docs-reconcile/iterations/`.
Worktree:
`experiments/quay-perpetual-stream/milestones/M19-task-to-plan-docs-reconcile/worktrees/iteration-N`,
branch `exp5-m19-iteration-N`.

**No live external-system access required** — markdown/design-doc editing only, reading this repo's
own `docs/proposals/`, `docs/plans/`, `directives/pending/DIR-013-*.md` for structural precedent and
the exact defects to fix.
