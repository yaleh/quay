# Charter M23-outer-driver-isolation — isolate the OUTER loop's own commit stream from human-shared `master` (Tier-A)

**Milestone id:** M23-outer-driver-isolation · **surface:** method infra (`OUTER-LOOP.md`, git
branch topology) · **type:** explore
**Source:** `directives/pending/DIR-018-*.md` (human-asserted, 2026-07-18, commit `cf4cad3`) —
"isolate the autonomous driver from human steering — run the loop on its own branch/worktree and
merge human-directed changes deliberately, so the two writers stop sharing `master` and racing."
**Charter authored:** m22→m23 boundary, 2026-07-18.

## Value hypothesis
- Value type (per `inherited-core.md`'s value-typed SELECT ledger): **risk/option** (primary —
  prevents a whole class of silent record corruption/racing, concretely observed THIS session: the
  M17/DIR-013 auto-resolve-wholesale content loss, the M18 shared-index merge blocking a human
  commit, the DIR-013 projection-drift miss, and the two non-trivial per-file conflict resolutions
  this loop had to manually perform at M21 and M22 because iteration worktrees were created off
  `master` HEAD directly) + **governance-integrity** (secondary — codifies a discipline that was
  previously informal/ad hoc).
- Δv̂: **zero VT points** (infra, no VT chart cell — mirrors M18/M21's own zero-VT precedent for
  method-infra milestones). State this explicitly at ABSORB.
- Metric `Y`: none (no VT chart move). Success is: does the loop's own commit stream separate from
  `master` in the way DIR-018's "Human verification when exp5 marks this DIR done" checklist
  describes, demonstrated by this milestone dogfooding the new pattern on itself.

## In-scope work
1. **Define and create the driver branch.** A single dedicated branch, `exp5-outer-driver`, created
   from current `master` HEAD. This branch is where the OUTER loop's own milestone-level work lives:
   charter authoring commits, per-iteration worktree base points, and inner-merge conflict
   resolution — NOT `master` directly.
2. **Amend `OUTER-LOOP.md` step 0 (DRAIN)** to add an explicit sub-step: before SELECT, the loop
   fast-forwards/merges `master` → `exp5-outer-driver` (deliberate, reviewed — this is where human
   commits made directly to `master` via `/quay-directive` or manual edits enter the driver's own
   history). Any conflict at this merge must be resolved per-file (never a blanket
   `checkout --ours`/`--theirs` without reading both sides — the DIR-013 failure this DIR names) and
   recorded as a reconciliation note in the DRAIN log, not silently taken wholesale.
3. **Amend `OUTER-LOOP.md` step 6/7 (ABSORB / UPDATE DASHBOARD)** to add an explicit publish
   sub-step: after the existing gates (adversarial-audit, V_meta consolidation-lag, design-only
   impl-row) all clear, the loop merges `exp5-outer-driver` → `master` via a single
   `git merge --no-ff` (one atomic, deliberate publish per milestone boundary) — this is the ONLY
   point at which the loop's own work lands on `master`. Iteration worktrees/branches, charter
   drafts, and any inner-merge conflict resolution all happen upstream of this point, on the driver
   branch, so a human commit landing on `master` mid-milestone cannot race an in-progress loop merge
   index (the concrete M18 damage DIR-018 cites).
4. **No-silent-drop discipline, made explicit in `OUTER-LOOP.md` text.** Add a short standing
   instruction (not a new script — DIR-018 explicitly asks to keep this minimal/mechanically
   checkable, not a heavy process): any conflict resolution during either merge direction above
   (master→driver at DRAIN, driver→master at ABSORB) must read both sides' actual content, resolve
   per-file with a stated reason, and record a reconciliation note — the same discipline this loop
   has been applying ad hoc since M21, now written down as a requirement rather than tribal
   knowledge.
5. **Dogfood the new pattern on this milestone itself.** M23's own two iteration worktrees are
   created off `exp5-outer-driver` (not `master` directly); this milestone's charter/dispatch/merge
   work happens on the driver branch; only the final ABSORB publish merges the result into `master`.
   This is the concrete proof the new pattern actually works, not just documentation of intent.

## Explicitly OUT of scope this milestone
- **Do not** build any new automated/scripted enforcement of the branch discipline (e.g., a
  pre-commit hook blocking direct `master` commits) — DIR-018 asks for a minimal, human-followable
  convention plus dogfooded proof, not a heavy mechanism. A future milestone may add mechanical
  enforcement if drift is observed.
- **Do not** touch DIR-017's scope (the Definition-of-Done meta-enforcer) — that is a separate,
  larger, human-verification-gated program; this milestone is purely the git-topology/process fix
  DIR-018 names, independent of DIR-017's own ordering.
- **Do not** re-architect the per-iteration worktree pattern itself (`milestones/M<NN>/worktrees/
  iteration-{0,1}`) — that pattern is unchanged; only its BASE POINT moves from `master` HEAD to
  `exp5-outer-driver` HEAD.
- **Do not** retroactively rewrite history for M01-M22 — this milestone is forward-looking only, per
  the same "governs forward" discipline DIR-016 established.
- **Do not** touch `inherited-core.md` — this is purely an `OUTER-LOOP.md` process/topology change,
  no methodology-substrate content changes.

## Binary Done-when (§3.4 — mandatory, freezes this milestone's shape)
1. `[ ]` Branch `exp5-outer-driver` exists, created from `master` HEAD as of the m22→m23 boundary —
   pasted `git branch -v` / `git log --oneline -1 exp5-outer-driver` output.
2. `[ ]` `OUTER-LOOP.md` step 0 (DRAIN) gains the explicit master→driver merge sub-step described
   in in-scope item 2, including the per-file/no-silent-drop reconciliation requirement — pasted
   diff/excerpt.
3. `[ ]` `OUTER-LOOP.md` step 6/7 gains the explicit driver→master publish sub-step described in
   in-scope item 3 — pasted diff/excerpt.
4. `[ ]` The no-silent-drop reconciliation-note requirement (in-scope item 4) is written into
   `OUTER-LOOP.md` as a standing instruction, not left implicit — pasted excerpt.
5. `[ ]` This milestone's own two iteration worktrees are demonstrated created off
   `exp5-outer-driver` (not `master`) — pasted `git worktree list` / `git log --oneline` showing the
   branch ancestry.
6. `[ ]` This milestone's own ABSORB is demonstrated landing on `master` via exactly one
   `git merge --no-ff exp5-outer-driver` publish commit — pasted `git log --oneline --first-parent
   master` excerpt spanning this milestone's boundary, showing no intermediate loop-authored commits
   interleaved directly on `master` before that publish.
7. `[ ]` `git diff --stat` against this milestone's pre-charter base commit shows only
   `OUTER-LOOP.md` + this milestone's own charter/iteration/backlog/dashboard bookkeeping changed —
   no `inherited-core.md` edits, no Core CLI/skill code.
8. `[ ]` `backlog.md` gains an `M-OUTER-DRIVER-ISOLATION` (or similarly named) row, marked DONE at
   ABSORB; DIR-018 itself is archived with a filled `## Resolution` section (delegated to the
   dispatched iterations per the DIR-013/DIR-016/DIR-014 archival-discipline precedent — never done
   pre-emptively by the orchestrator before the work exists).

Milestone is DONE when all eight are met and stable ≥1 iteration (§3.2 condition 1). Terminate early
per §3.2 conditions 2-5 if they fire first. Real independent-re-derivation material for iteration-1
exists: whether the DRAIN-time and ABSORB-time merge sub-steps are worded precisely enough to survive
a skeptical re-read (e.g., do they actually prevent the M18-class shared-index collision, or just
relocate it), and whether the dogfooded proof (clauses 5-6) genuinely demonstrates isolation rather
than merely asserting it, are both independently checkable.

## Plan-time line-budget gate (M18-milestone-model-ceiling-and-diversity-policy) — run before dispatch
This charter's in-scope work is a small, well-bounded process/topology edit to a single file
(`OUTER-LOOP.md`) plus one new git branch — well under the small-milestone norm (≤8 in-scope items,
no phase/stage plan required).
`scripts/it0-ceiling-line-budget-check.sh charters/M23-outer-driver-isolation.md` — run and record
the result before dispatch.

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
a. **Ceiling/floor arithmetic** — N/A this milestone (directive/backlog-sourced, not a `gap-list.md`
   gap id — same confirmed limitation as M21/M22; DIR-018's own text is the direct source,
   confirmed present and unresolved in `directives/pending/DIR-018-*.md` as of charter authoring).
b. **Gate-hash/transclusion** — verified above via `--by-reference` mode; re-run before dispatch.
c. **Dogfooding evidence-gate** — every Done-when clause requires pasted output evidence; clauses
   5-6 specifically require real `git`/`git worktree` output, not narrative alone.
d. **Domain-misfit audit-channel** — this milestone edits `OUTER-LOOP.md` prose and git branch
   topology; the audit channel is direct `git log`/`git worktree list` inspection (fully
   independent of any self-report), no domain-misfit risk.
e. **Plan-time line-budget gate** — see above, run and record before dispatch.

## Adversarial-audit gate — evaluate at ABSORB (state explicitly)
Per `inherited-core.md`'s Adversarial-audit cadence rule: condition (a) requires a capability-growth-
typed milestone with a NONZERO realized VT Δv — this milestone is typed risk/option+governance-
integrity with Δv̂=0 by design, so condition (a) does not apply regardless of outcome. Condition (b)
requires iteration-0 to recommend skipping iteration-1 — not authorized; both iterations run. State
plainly at ABSORB that neither condition fired and why, per the documented-no-op discipline.

## Dispatcher notes
Standard 2-iteration pattern: iteration-0 (build) + iteration-1 (fresh worktree, independent
re-derivation, NOT reading iteration-0's report/materials). **Both worktrees created off
`exp5-outer-driver` HEAD, not `master`** — this is itself part of the dogfooded proof (Done-when
clause 5). Worktree/branch paths: `milestones/M23-outer-driver-isolation/worktrees/iteration-{0,1}`,
branches `exp5-m23-iteration-{0,1}`. Merge iteration-0/iteration-1 results into
`exp5-outer-driver` first (per-file conflict resolution, reconciliation notes per in-scope item 4);
only THEN merge `exp5-outer-driver` → `master` as the single ABSORB publish commit (Done-when
clause 6). Archive DIR-018 with a filled Resolution section as the dispatched iterations' own
deliverable — not pre-emptively by the orchestrator before the work exists (standing discipline,
per the DIR-013/DIR-014/DIR-016 precedent).
