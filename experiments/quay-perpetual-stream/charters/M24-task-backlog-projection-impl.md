# Charter M24-task-backlog-projection-impl — implement `M-TASK-BACKLOG-PROJECTION`'s design (Tier-A)

**Milestone id:** M24-task-backlog-projection-impl · **surface:** method infra (task store,
`OUTER-LOOP.md`, `it0-dir-projection-check.mjs`, `backlog.md`/`dashboard.md` regeneration) ·
**type:** explore
**Source:** `backlog.md` row `M-TASK-BACKLOG-PROJECTION-IMPL` (created m21, `M-IMPL-ROW-ENFORCEMENT`
retroactive sweep, satisfying DIR-015 item 1) — implements DIR-015 item 2, the m13 design doc
`docs/proposals/exp5-task-backlog-primitive-projection.md` §15's own dispatch-ready checklist.
**Charter authored:** m23→m24 boundary, 2026-07-18.

## Value hypothesis
- Value type (per `inherited-core.md`'s value-typed SELECT ledger): **capability-growth** (primary
  — closes the "quay only shows DIRs, not milestone-candidate backlog rows" distortion by
  materializing `backlog.md` rows as real projected tasks) + **governance-integrity** (secondary —
  makes SELECT/ABSORB's provenance claims mechanically checkable against the task store instead of
  resting on hand-maintained prose, and satisfies the standing hard floor: this row's own scope
  already includes BOTH the enabling half (backfill + forward creation) AND the enforcement half
  (anti-drift check + OUTER-LOOP.md wiring) per the governance/infra hard floor rule — it is not
  dispatched partial).
- Δv̂: **zero VT points** claimed at SELECT time (method infra, no VT chart cell — mirrors
  M13/M14/M16-M23's zero-VT precedent for method-infra/design-impl milestones). State this
  explicitly at ABSORB.
- Metric `Y`: none (no VT chart move). Success is the §15 checklist below landing in full, with
  live `task_list`/Web UI evidence that `backlog.md` rows are now real, queryable quay tasks.

## Line budget: ~2000 lines — phase/stage plan required and provided below
This milestone's full scope (§15's 13 Done-when clauses: script updates to
`it0-dir-projection-check.mjs`, the one-time M01-M12 backfill, forward-looking candidate-task
creation, two `OUTER-LOOP.md` wiring changes, a `backlog.md`/`dashboard.md` regeneration script, a
new anti-drift check, Web UI verification, full test-suite pass) plausibly exceeds the small-
milestone norm — it is chartered as ONE milestone using the ceiling-expansion regime
(`inherited-core.md`'s "Milestone ceiling expansion" subsection), decomposed into 4 phases below.
Each phase is independently sized to the ≤500-line phase budget; no stage further splits a phase
(all four phases are single coherent build+verify units at the ≤200-line stage grain already).

### Phase 1 — Projection-check script updates (≤500 lines)
Stage 1.1: update `it0-dir-projection-check.mjs` to join file↔task via the experiment-prefixed id
scheme (`exp5-DIR-NNN`, per §14 item 1 / the m13 design doc's adopted iteration-1 resolution);
re-run against real DIR-004/DIR-005 and confirm 0 divergences.
Stage 1.2: extend the same script to ignore `milestone:M-NN` labels and `## Execution record` body
sections when computing divergence (§10's DIR sub-tension resolution); demonstrate a DIR task
carrying both fields still PASSing.
Stage 1.3: extend the mirror-status vocabulary to accept `resolved` as a synonym of `applied`
(§14 item 3); demonstrate a `status: resolved` DIR file producing PASS, not a false divergence.

### Phase 2 — Backfill + forward-looking candidate creation (≤500 lines)
Stage 2.1: execute the one-time backfill (§6) for all M01-M12 DONE (and STALE, if any) `backlog.md`
rows — one task per row, fields matching the §6 worked-example shape; paste
`task_list --label backfill` output showing the full set.
Stage 2.2: create a `milestone-candidate`-labeled task for every open `backlog.md` candidate row not
yet backed by a task (forward-looking creation, distinct from the historical backfill).

### Phase 3 — `OUTER-LOOP.md` wiring (SELECT read path + ABSORB write-back) (≤500 lines)
Stage 3.1: update `OUTER-LOOP.md`'s SELECT step (cycle step 1) to read candidates via `task_list`
(§8) instead of `backlog.md` prose; paste a transcript of a live SELECT pass using the new read
path.
Stage 3.2: extend SELECT to write `milestone:M-NN` onto the chosen task(s) and a not-selected
body/`extra` note onto every other candidate considered that pass (§9); paste `task_get` evidence
for both a selected and a not-selected task from the same real pass.
Stage 3.3: extend `OUTER-LOOP.md`'s ABSORB step (cycle step 6) to append an execution-provenance
body section + `status: done` to every task executed by the milestone, including any in-scope DIR
tasks that pass (§10); paste `task_get` evidence.

### Phase 4 — Regeneration, anti-drift check, Web UI verification, closing gates (≤500 lines)
Stage 4.1: build a regeneration script producing `backlog.md`/`dashboard.md` as a generated view
from the task store, value-ordered by default with a recency alternate (§13); paste a before/after
diff of a regenerated `backlog.md` matching live task-store state.
Stage 4.2: build a backlog-projection anti-drift check (`it0-backlog-projection-check.{sh,mjs}`, or
folded into the DIR one) demonstrating both STALE-VIEW and GROUPING-DISAGREEMENT failure modes with
real PASS/FAIL output, mirroring M05's own three-mode demonstration precedent.
Stage 4.3: verify `?label=milestone-candidate` and `?label=milestone%3AM-NN` live in the Web UI
(screenshot or `curl` transcript per the Web UI verification requirement below) surfacing
backfilled/newly-created tasks with zero `serve.js` changes (§5).
Stage 4.4: run the full existing test suite (pasted raw output) and a scoped `git diff --stat`
against the pre-charter base commit confirming only the expected files changed (script(s),
`OUTER-LOOP.md`, `backlog.md`/`dashboard.md` regeneration output, no unrelated product code).

**Gauge note:** the verify-iteration size gauge (`inherited-core.md`) applies per-phase, not to the
whole ~2000-line milestone — each phase above is judged as its own "iteration-0 lands it in one
pass, iteration-1 re-derives" unit.

## Web UI verification requirement (M10-audit-consolidation, DIR-006)
Stage 4.3's Done-when clause claims Web UI rendering/query verification. Per
`inherited-core.md`'s "Web UI verification requirement" evidence rule: a `curl` liveness/status
check alone is NEVER sufficient evidence for this clause — the evidence must show the actual
rendered/queried content (a screenshot of the filtered task list, or a `curl` transcript of the
JSON/HTML response body containing the expected backfilled/newly-created task ids), not merely that
the server responded 200.

## In-scope work (top-level, maps 1:1 to the four phases above)
1. Phase 1 — projection-check script updates (id scheme, ignore-sections, `resolved` synonym).
2. Phase 2 — M01-M12 backfill + forward-looking `milestone-candidate` task creation.
3. Phase 3 — `OUTER-LOOP.md` SELECT read-path + write-back wiring.
4. Phase 4 — `OUTER-LOOP.md` ABSORB execution-provenance write-back (bundled with Phase 3's wiring
   work as the second half of the same file's edit, tracked as Stage 3.3 above).
5. Phase 4 — regeneration script (`backlog.md`/`dashboard.md` generated view).
6. Phase 4 — backlog-projection anti-drift check (STALE-VIEW + GROUPING-DISAGREEMENT).
7. Phase 4 — Web UI `?label=` live verification.
8. Phase 4 — full test suite pass + scoped `git diff --stat` closing evidence.

## Explicitly OUT of scope this milestone
- **Do not** retroactively rewrite or re-score any milestone's VT/history beyond the M01-M12
  backfill's own field-population scope (§6) — the backfill creates provenance tasks, it does not
  re-derive or alter any already-recorded VT curve value.
- **Do not** change `serve.js` or add new Web UI code — §5's design explicitly requires zero new UI
  code; verification uses existing `?label=` query support only.
- **Do not** rename or migrate exp4's existing bare `DIR-NNN` task ids — the experiment-prefixed
  scheme applies to new/backfilled exp5 projections going forward only (m13's adopted resolution).
- **Do not** fold `M-TASK-TO-PLAN-SKILL-IMPL-PHASE7`'s remaining DIR-014 items 2-3 scope (DISPATCH
  auto-wiring of the proposal→plan pipeline itself, diversity-policy de-optionalization) into this
  milestone — that is a separate backlog row, out of scope here.
- **Do not** build any mechanical enforcement of the DIR-018 branch-isolation discipline beyond
  what M23 already shipped — unrelated surface.
- **Do not** touch `inherited-core.md`'s substantive methodology text — this milestone edits
  `OUTER-LOOP.md` process wiring, a projection-check script, and generated-view tooling; no Tier-B
  methodology-substrate rewrite.

## Binary Done-when (§3.4 — mandatory, freezes this milestone's shape)
1. `[ ]` `it0-dir-projection-check.mjs` updated to the experiment-prefixed id scheme (Stage 1.1) —
   re-run against real DIR-004/DIR-005, pasted PASS output showing 0 divergences.
2. `[ ]` `it0-dir-projection-check.mjs` extended to ignore `milestone:M-NN` labels + `## Execution
   record` body sections (Stage 1.2) — pasted evidence of a DIR task carrying both fields PASSing.
3. `[ ]` `resolved` accepted as a `status:` synonym of `applied` (Stage 1.3) — pasted PASS evidence.
4. `[ ]` `milestone-candidate`-labeled task created for every open `backlog.md` row not yet backed
   by a task (Stage 2.2) — pasted `task_list` evidence.
5. `[ ]` One-time M01-M12 DONE/STALE backfill executed (Stage 2.1) — pasted
   `task_list --label backfill` output showing the full set.
6. `[ ]` `OUTER-LOOP.md` SELECT step reads candidates via `task_list` instead of `backlog.md` prose
   (Stage 3.1) — pasted live-pass transcript.
7. `[ ]` SELECT writes `milestone:M-NN` on chosen task(s) + not-selected notes on other candidates
   considered that pass (Stage 3.2) — pasted `task_get` evidence for both a selected and a
   not-selected task from the same real pass.
8. `[ ]` `OUTER-LOOP.md` ABSORB step appends execution-provenance + `status: done` to every executed
   task, including in-scope DIR tasks (Stage 3.3) — pasted `task_get` evidence.
9. `[ ]` Regeneration script produces `backlog.md`/`dashboard.md` as a generated view from the task
   store, value-ordered default + recency alternate (Stage 4.1) — pasted before/after diff matching
   live task-store state.
10. `[ ]` Backlog-projection anti-drift check exists and demonstrates both STALE-VIEW and
    GROUPING-DISAGREEMENT failure modes with real PASS/FAIL output (Stage 4.2).
11. `[ ]` Web UI `?label=milestone-candidate` and `?label=milestone%3AM-NN` verified live per the
    Web UI verification requirement above (Stage 4.3) — screenshot or full-body `curl` transcript,
    not a liveness-only check; zero `serve.js` changes confirmed via `git diff --stat`.
12. `[ ]` Full existing test suite passes post-change (Stage 4.4) — pasted raw output.
13. `[ ]` `git diff --stat` against the pre-charter base commit shows only the expected files
    touched (script(s), `OUTER-LOOP.md`, `backlog.md`/`dashboard.md` regeneration output, task-store
    writes) — no unrelated product code (Stage 4.4).

Milestone is DONE when all thirteen are met and stable ≥1 iteration (§3.2 condition 1). Terminate
early per §3.2 conditions 2-5 if they fire first. Real independent-re-derivation material for
iteration-1 exists per phase: whether the id-scheme/ignore-section script changes (Phase 1) actually
close the 2 divergences the design doc documents (not just relocate them), whether the backfill
(Phase 2) faithfully reproduces the §6 worked-example field shape across all M01-M12 rows without
silent omissions, whether the SELECT/ABSORB wiring (Phase 3) is precise enough to survive a
skeptical re-read against a live pass (not just narrated), and whether the anti-drift check
(Phase 4) genuinely catches both named failure modes with real fixtures — all independently
checkable, not empty verification.

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
a. **Ceiling/floor arithmetic** — N/A this milestone (backlog-row/design-doc-sourced, not a
   `gap-list.md` gap id — same confirmed limitation as M13/M21/M22/M23). The design doc §15
   checklist is the direct source, confirmed present at `docs/proposals/exp5-task-backlog-
   primitive-projection.md` lines 570-608 as of charter authoring.
b. **Gate-hash/transclusion** — verified above via `--by-reference` mode; re-run before dispatch.
c. **Dogfooding evidence-gate** — every Done-when clause requires pasted output evidence
   (`task_list`/`task_get` transcripts, PASS/FAIL script output, `git diff --stat`, test-suite raw
   output, Web UI screenshot/full-body transcript) — no clause is narrative-only.
d. **Domain-misfit audit-channel** — this milestone edits scripts, `OUTER-LOOP.md` prose, and the
   task store; the audit channel is direct `task_list`/`task_get`/script re-run inspection plus the
   Web UI's own live query rendering — fully independent of any self-report, no domain-misfit risk.
e. **Plan-time line-budget gate** — this charter declares the ceiling-expansion regime explicitly
   (see "Line budget" section above) with a 4-phase plan inline (Phase 1-4, each with Stage
   sub-numbering) satisfying the phase/stage-plan requirement; run
   `scripts/it0-ceiling-line-budget-check.sh charters/M24-task-backlog-projection-impl.md` and
   record PASS before dispatch.

## Adversarial-audit gate — evaluate at ABSORB (state explicitly)
Per `inherited-core.md`'s Adversarial-audit cadence rule: condition (a) requires a capability-growth-
typed milestone with a NONZERO realized VT Δv — this milestone is typed capability-growth+
governance-integrity but Δv̂=0 by design (method infra, no VT chart cell), so condition (a) does not
apply regardless of outcome UNLESS the realized Δv turns out nonzero at ABSORB (re-check then, not
assumed here). Condition (b) requires iteration-0 to recommend skipping iteration-1 — not
authorized; both iterations run regardless. State plainly at ABSORB which condition (if either)
actually fired, per the documented-no-op discipline.

## Dispatcher notes
Standard 2-iteration pattern: iteration-0 (build) + iteration-1 (fresh worktree, independent
re-derivation, NOT reading iteration-0's report/materials). **Both worktrees created off
`exp5-outer-driver` HEAD, not `master`** — per the M23-outer-driver-isolation discipline now
standing (DIR-018): at DRAIN (before this milestone's SELECT), `master` was already merged into
`exp5-outer-driver`; both iteration worktrees for M24 branch from that current `exp5-outer-driver`
HEAD. Worktree/branch paths: `milestones/M24-task-backlog-projection-impl/worktrees/
iteration-{0,1}`, branches `exp5-m24-iteration-{0,1}`. Merge iteration-0/iteration-1 results into
`exp5-outer-driver` first (per-file conflict resolution, reconciliation notes per DIR-018 item 3's
no-silent-drop discipline); only THEN merge `exp5-outer-driver` → `master` as the single ABSORB
publish commit (`git checkout master && git merge --no-ff exp5-outer-driver`), sequenced after the
adversarial-audit gate, V_meta consolidation-lag gate, and design-only-milestone impl-row gate all
clear (this milestone is itself the IMPL row satisfying DIR-016/M21's gate for
`M-TASK-BACKLOG-PROJECTION`'s design-only m13 delivery — its own ABSORB must mark this
`backlog.md` row DONE, not create a further `-IMPL` row, since this row already IS the implementing
milestone). Given the 4-phase structure, dispatch iteration-0 with all four phases in scope (single
build pass across Phase 1-4, per the ceiling-expansion regime's "one whole plan, multiple phases"
framing — NOT four separate BAIME iterations); iteration-1 independently re-derives/verifies across
all four phases in its own fresh worktree, per the standard 2-iteration pattern's shape, not
per-phase re-derivation.
