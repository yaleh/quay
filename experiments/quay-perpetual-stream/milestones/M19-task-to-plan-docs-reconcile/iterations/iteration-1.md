# M19-task-to-plan-docs-reconcile — iteration-1 (independent re-derivation)

**Worktree:** `experiments/quay-perpetual-stream/milestones/M19-task-to-plan-docs-reconcile/worktrees/iteration-1`
**Branch:** `exp5-m19-iteration-1`
**Date:** 2026-07-18
**Note on process:** this is the independent re-derivation iteration. Per dispatch instructions,
iteration-0's report and worktree were NOT read. All defects below were found and fixed by a fresh
read of the charter, DIR-013, and the two target files.

## HARD GATES

**Gate 1 — pending directives listing:**
```
$ ls -1 experiments/quay-perpetual-stream/directives/pending/
DIR-013-reconcile-auto-merged-task-to-plan-proposal-and-stale-plan-cross-references.md
```
(taken at the START of this iteration, before DIR-013 was moved to `archive/` as part of the
work — see Done-when 7 below for the post-fix state.)

**Gate 2 — branch/HEAD proof (taken inside the worktree, before any commits):**
```
$ git rev-parse HEAD
a99af9d94e6a0bcf17c70f67f11187c2e7321dd6
$ git branch --show-current
exp5-m19-iteration-1
```
All edits below are committed on this branch, in this worktree — not the shared tree at repo root.

**hub.addr/curl gates:** N/A — explicitly stated per dispatch instructions: no live external
system or web UI needed for this docs-only milestone.

## Summary of work

Fixed all three DIR-013 MUST-FIX defects (F1, F2, F3) plus the process-note item (4), entirely
inside `docs/proposals/exp5-quay-task-proposal-plan-skill.md`, `docs/plans/3-7-quay-task-to-plan-skill.md`,
`experiments/quay-perpetual-stream/OUTER-LOOP.md` (process note only), `experiments/quay-perpetual-stream/backlog.md`
(DONE row), and moved `DIR-013-*.md` to `directives/archive/` with a Resolution section.

**Final commit:** `c12cf6f` (branch `exp5-m19-iteration-1`)

## Done-when clause-by-clause (charter §, 8 clauses)

### 1. Status header + TOC heading + TOC table accurately list §12-19 (§19 included) — pasted diff

**MET.** Diff (full file diff at `docs/proposals/exp5-quay-task-proposal-plan-skill.md`, relevant
hunks):

```diff
--- a/docs/proposals/exp5-quay-task-proposal-plan-skill.md
+++ b/docs/proposals/exp5-quay-task-proposal-plan-skill.md
@@ -4,16 +4,17 @@
 m16→m17). Sections 1-11 are the original DRAFT (authored 2026-07-18 from a live
 human-steering conversation, git revision `05a8066`, the conversational draft
 DIR-012 references and cites verbatim as its precursor artifact) — kept
-unmodified as the rationale/evidence base. Sections 12-18 are NEW, added by this
+unmodified as the rationale/evidence base. Sections 12-19 are NEW, added by this
 milestone per its charter's in-scope items 1-8: they fully specify the skill's
 quay task read/write behavior, the N-independent-proposal + adjudication step,
 the plan author + grounded-convergent-check step (with a precise stop
 condition), the TDD ≥80%-per-stage hard gate, provider-agnostic GitHub
-milestone, and explicit non-goals — at the same fidelity M13
+milestone, explicit non-goals, and a closing status/next-step section — at the
+same fidelity M13
 (`docs/proposals/exp5-task-backlog-primitive-projection.md` §15) and M14
 (`docs/proposals/exp5-cli-edit-parity.md` §6) achieved for their own skill/design
-docs. Per this milestone's charter, sections 12-18 are **design-doc-only**: no
+docs. Per this milestone's charter, sections 12-19 are **design-doc-only**: no
 skill implementation, no code under `.claude/skills/`, no edits to
 `inherited-core.md`/`OUTER-LOOP.md` (DIR-012 items 2/3 stay explicitly out of
 scope here — see §18).
@@ -24,7 +25,7 @@ it usable inside the exp5 perpetual OUTER loop for typical *development* work
 (up to ~2000 lines of change), not just the small methodology milestones exp5
 has run so far.
 
-## Table of contents — M17 addition map (§12-18)
+## Table of contents — M17 addition map (§12-19)
 
 | Doc section | DIR-012/charter in-scope item | Charter Done-when clause |
 |---|---|---|
@@ -36,6 +37,7 @@ has run so far.
 | §16 Provider-agnostic GitHub degradation | 6 | 6 |
 | §17 Done-when clauses for a future implementing milestone | 7 | 7 |
 | §18 Non-goals (M17-level restatement) | 8 | 8 |
+| §19 Status / next step (closing summary, supersedes original §11's DRAFT-era framing) | (closing section, not a separate charter item) | — |
 
 ---
```
Also fixed a stale "§§12-18 above" cross-reference inside §19's own status text (line ~782):
```diff
 **Current status (M17-task-to-plan-skill-design, this milestone):** the DIR was
 filed (`DIR-012`) and drained exactly per that routing — this milestone
 (charter item 1) has now produced the "fully specify the new skill" deliverable
-the DIR's Requested-action item 1 asked for (§§12-18 above). Still Design-only:
+the DIR's Requested-action item 1 asked for (§§12-19 above, this closing status
+section included). Still Design-only:
```
§19 was NOT renumbered away — it remains `## 19. Status / next step`, unchanged in position.

### 2. Every internal §N cross-reference inside §§12-19 resolves to a section that actually exists — pasted grep sweep + specific diffs

**MET.** Full post-fix grep sweep of the fixed file (`grep -n '§[0-9]' docs/proposals/exp5-quay-task-proposal-plan-skill.md`,
107 total lines matched — full output saved at time of this report):

```
$ grep -c '§8\.[0-9]' docs/proposals/exp5-quay-task-proposal-plan-skill.md
0
```
(exit 1, "no matches" — confirms zero remaining `§8.4`/`§8.5`/any `§8.N` subsection reference.)

```
$ grep -n '§[0-9]' docs/proposals/exp5-quay-task-proposal-plan-skill.md | grep -E '§8\.[0-9]|§11'
40:| §19 Status / next step (closing summary, supersedes original §11's DRAFT-era framing) | (closing section, not a separate charter item) | — |
771:## 19. Status / next step (supersedes original §11's DRAFT-era framing)
773:**Original §11 (DRAFT, 05a8066), preserved for provenance:** "Design-only.
798:original §11 bootstrap-resolution paragraph (unchanged — still the correct
```
All four remaining `§11` mentions are legitimate provenance references (they describe what §19
*preserves from* / *supersedes*, i.e. explicitly historical framing of a section that no longer
exists as a live heading) — not claims that a live `§11` section can be navigated to. Confirmed
against the actual heading list:
```
$ grep -n '^#\{1,3\} ' docs/proposals/exp5-quay-task-proposal-plan-skill.md
...
44:## 1. Problem …
77:## 2. Prior art …
103:## 3. The four-entity model …
136:## 4. Milestone sizing …
159:## 5. Two milestone classes …
179:## 6. The pipeline …
217:## 7. Plan is checked …
241:## 8. What the new skill is, concretely
267:## 9. Relationship to existing exp5 mechanisms …
286:## 10. Non-goals / open decisions
306:## 12. Quay task read/write behavior …
308:### 12.1 Provider ABI tool(s) used
333:### 12.2 Proposal → body write-back shape …
374:### 12.3 Milestone → task grouping …
410:## 13. N-independent-proposal + adjudication step …
412:### 13.1 Mechanism
445:### 13.2 Relationship to proposal-to-plan's existing architect-review …
483:## 14. Plan author + grounded convergent-check step …
485:### 14.1 Mechanism
517:### 14.2 Convergence / stop condition …
557:## 15. TDD ≥80%-per-stage hard gate …
559:### 15.1 What it gates, precisely
580:### 15.2 Code-vs-prose per-stage classifier …
599:### 15.3 Why load-bearing specifically here …
627:## 16. Provider-agnostic GitHub degradation …
668:## 17. Dispatch-ready Done-when clauses …
744:## 18. Non-goals …
771:## 19. Status / next step …
```
`§1`-`§10`, `§12`-`§19` (with subsections `12.1-12.3`, `13.1-13.2`, `14.1-14.2`, `15.1-15.3`) all
exist. `§11` does NOT exist as a live heading (correctly — its content was dropped from the merge
except as the §19 provenance blockquote), and after this fix, `§11` is only ever cited as historical
provenance, never as a "go read §11 for X" pointer.

**Specific diffs that repointed each dangling reference (F1):**

1. `§8.4` (code-vs-prose classifier, originally at old-line 578) → repointed to §8's flat-list
   point 4 (the actual TDD-hard-gate item that §15.2 is a scope caveat of):
```diff
-### 15.2 Code-vs-prose per-stage classifier (scope caveat, carried from §8.4)
+### 15.2 Code-vs-prose per-stage classifier (scope caveat, carried from §8's point 4, "TDD ≥80% per stage is a hard gate")
```

2. `§8.5` (GitHub degradation one-line summary, originally at old-line 627) → repointed to §8's
   flat-list point 5 (Provider-agnostic):
```diff
-Stated explicitly, extending §8.5's one-line summary into a precise behavior
-specification:
+Stated explicitly, extending §8's point 5 ("Provider-agnostic: everything the
+skill writes to tasks respects the body-portable / extra-native-only rule...")
+one-line summary into a precise behavior specification:
```

3. `§11's bootstrap resolution` (originally at old-line 714, in the §17 Done-when checklist) →
   repointed to §19's preserved provenance blockquote:
```diff
-      stage (e.g. the skill's own `SKILL.md` authoring, if self-hosted per §11's
-      bootstrap resolution) — pasted gate-hash/projection-check script output.
+      stage (e.g. the skill's own `SKILL.md` authoring, if self-hosted per §19's
+      preserved bootstrap-resolution paragraph, "bootstrapped on the existing
+      `proposal-to-plan`") — pasted gate-hash/projection-check script output.
```

4. `§8 point 6` (feature-developer reuse, originally at old-line 728) — **investigated, found
   already correct.** §8 is genuinely a flat 6-point list (verified: `## 8. What the new skill is,
   concretely` at line 241, points 1-6 at lines 244-263, point 6 = "Reuse or wrap
   `feature-developer`'s orchestration…"). The phrase "carried through from this doc's §8 point 6"
   already names a flat-list point correctly, matching DIR-013's own recommended target verbatim
   — this citation was never dangling and required no edit.

### 3. `docs/plans/3-7-quay-task-to-plan-skill.md`'s §8.x/§11 citations repointed to sections that exist, with explicit new references to Part II (§12-19) spec and §17 checklist — pasted diff

**MET.** Full diff of the plan file (155 lines total; representative excerpts below; complete diff
available via `git show c12cf6f -- docs/plans/3-7-quay-task-to-plan-skill.md`):

```diff
--- a/docs/plans/3-7-quay-task-to-plan-skill.md
+++ b/docs/plans/3-7-quay-task-to-plan-skill.md
@@ -1,14 +1,33 @@
 # Plan: A quay-task-native `quay-task-to-plan` skill + the exp5 milestone-model changes it requires
 
 - **Source proposal:** `docs/proposals/exp5-quay-task-proposal-plan-skill.md`
-  (reviewed, DRAFT status, authored 2026-07-18). This plan decomposes the two
-  deliverable strands the proposal describes (§8 the skill; §4/§5/§6/§7 the
-  milestone-model changes) into dependency-ordered phases/stages. Scope is drawn
-  **strictly** from the proposal — nothing here extends it.
+  (MATURED, dispatch-ready skill design, post-M17-merge status — see
+  **Authoritative-artifact note** below). This plan decomposes the two
+  deliverable strands the proposal describes (§8's flat list + Part II §§12-19
+  the skill; §4/§5/§6/§7 the milestone-model changes) into dependency-ordered
+  phases/stages. Scope is drawn **strictly** from the proposal — nothing here
+  extends it.
+  - **Authoritative-artifact note (added at M19-task-to-plan-docs-reconcile,
+    per DIR-013 item 3):** the proposal's Part II (§§12-19) is the
+    dispatch-ready OPERATIONAL SPEC an implementer needs (exact tool names, the
+    `## Proposal` body shape, N-independent-proposal adjudication mechanics, the
+    plan-check stop condition, and — above all — **§17's Done-when checklist**).
+    This plan (`docs/plans/3-7-…`) is the BUILD-ROUTE ELABORATION: it decomposes
+    §§12-19's spec into dependency-ordered phases/stages with line budgets. If
+    this plan's phase/stage decomposition and the proposal's §17 checklist ever
+    drift (e.g. after further edits to either document), **the proposal's §17
+    checklist is the acceptance authority; this plan's phase/stage breakdown is
+    advisory build-route elaboration and must be reconciled to match §17, not
+    the other way around.** (DIR-013's own recommendation, adopted here — no
+    concrete reason found during this reconciliation pass to prefer the
+    opposite.) Every phase below MUST be read alongside proposal §§12-19, not
+    only the pre-merge §8 flat list this plan was originally drafted against.
```

Section-goal citation fixes (each `§8.N` repointed to its real Part-II target):
```diff
 ## Phase 6 — `quay-task-to-plan` skill: proposal step (N-subagents + adjudication)
-**Goal (proposal §8.1, §8.2, §8.5, §8.6):** create the new skill's scaffold and its
+**Goal (proposal §12 read/write behavior, §13 N-independent-proposal step, §16
+GitHub degradation, §8's point 6 feature-developer reuse):** create the new skill's scaffold and its
```
```diff
 - **Work:** encode the proposal step as **N independent Task-agent runs**
-  (proposal §8.2, §6): blank-slate-leaning (minimize shared context; no
+  (proposal §13, §6): blank-slate-leaning (minimize shared context; no
```
```diff
 ## Phase 7 — `quay-task-to-plan` skill: plan step (grounded check) + TDD ≥80% hard gate + dogfood wiring
-**Goal (proposal §8.3, §8.4, §8.6, §11):** complete the skill with the **plan step**
+**Goal (proposal §14 plan step, §15 TDD ≥80% hard gate, §8's point 6
+feature-developer reuse, §19 bootstrap resolution):** complete the skill with the **plan step**
 (author + grounded convergent check producing a milestone-level plan record kept
 **out of the task tree**), the **TDD ≥80% hard gate** with the code-vs-prose
-classifier, and the dogfooding wiring per §11.
+classifier, and the dogfooding wiring per §19 (the bootstrap-resolution paragraph
+preserved from the original draft's §11).
```
```diff
 ### Stage 7.1 — Plan step: author + grounded convergent check (milestone-level, out of task tree)
-- **Work:** encode the plan step (proposal §8.3, §7): one subagent authors a
+- **Work:** encode the plan step (proposal §14, §7): one subagent authors a
```
```diff
 ### Stage 7.2 — TDD ≥80% hard gate with the code-vs-prose classifier
-- **Work:** encode proposal §8.4: **TDD ≥80% per stage is a HARD GATE**, stricter
+- **Work:** encode proposal §15.1/§15.2: **TDD ≥80% per stage is a HARD GATE**, stricter
```
```diff
 ### Stage 7.3 — Dogfooding wiring, bootstrap resolution, and `feature-developer` reuse note
-- **Work:** encode proposal §8.6 (reuse/wrap `feature-developer`'s orchestration
-  where it fits rather than reinventing the review loop) and §11's **bootstrap
-  resolution**: the skill-implementation milestone itself **cannot** run through
+- **Work:** encode proposal §8's point 6 (reuse/wrap `feature-developer`'s orchestration
+  where it fits rather than reinventing the review loop) and §19's **preserved
+  bootstrap resolution** (carried forward, unchanged, from the original draft's
+  §11): the skill-implementation milestone itself **cannot** run through
```
Plus the "Dogfooding note" heading and the code-vs-prose-classifier citations (`§8.4`→`§15.2`)
in the preamble and "Test / verification strategy" section — see full diff.

**Post-fix grep sweep confirming zero remaining `§8.x` in the plan:**
```
$ grep -c '§8\.[0-9]' docs/plans/3-7-quay-task-to-plan-skill.md
0
(exit 1 — no matches)
```

**Remaining `§11` mentions in the plan — all legitimate provenance framing, not dangling
pointers** (verified each individually):
```
$ grep -n '§11' docs/plans/3-7-quay-task-to-plan-skill.md
28:  §19 (bootstrap resolution, preserved from the original draft's §11 — see the
498:preserved from the original draft's §11).
549:  §11): the skill-implementation milestone itself **cannot** run through
571:3. Bootstrap resolution (proposal §19, preserved from original §11), `feature-developer` reuse, `Output`, and
615:## Dogfooding note (proposal §19, preserving the original draft's §11 bootstrap resolution)
618:(which preserves, unchanged, the original draft's §19 bootstrap-resolution
```
Each of these frames `§11` explicitly as historical ("preserved from," "preserving," carried
forward unchanged) — the live pointer in every case is `§19`.

**Explicit new references to Part II (§12-19) and §17 checklist** — satisfied by the
Authoritative-artifact note quoted above ("the proposal's Part II (§§12-19) is the dispatch-ready
OPERATIONAL SPEC…", "above all — §17's Done-when checklist").

### 4. Plan states explicitly which artifact is authoritative if the two ever drift — pasted excerpt

**MET.** Verbatim excerpt from the Authoritative-artifact note (see full diff above), the
load-bearing sentence:

> If this plan's phase/stage decomposition and the proposal's §17 checklist ever drift (e.g. after
> further edits to either document), **the proposal's §17 checklist is the acceptance authority;
> this plan's phase/stage breakdown is advisory build-route elaboration and must be reconciled to
> match §17, not the other way around.** (DIR-013's own recommendation, adopted here — no concrete
> reason found during this reconciliation pass to prefer the opposite.)

This adopts DIR-013's own recommendation verbatim (proposal §17 checklist = acceptance authority,
plan = build-route elaboration). I looked for a concrete reason to prefer the opposite (e.g. the
plan containing load-bearing sequencing/dependency information not in §17) and found none — §17's
checklist items are all independently checkable acceptance criteria; the plan's phase/stage
ordering is purely a scheduling/decomposition device layered on top, consistent with DIR-013's
framing.

### 5. Process-note lesson recorded in `inherited-core.md` or `OUTER-LOOP.md` — pasted diff, no enforcement script built

**MET.** Chose `OUTER-LOOP.md` (not `inherited-core.md`): the lesson is specifically about the
loop's own DRAIN/dispatch/ABSORB behavior around live human steering, and `OUTER-LOOP.md` already
has a dedicated "Human async control surface (never blocks the loop — §4.7)" section covering
exactly this topic (`.halt`, `/quay-directive`, branch-vs-master framing) — a better fit than
`inherited-core.md`'s more general methodology-core content. Full diff:

```diff
--- a/experiments/quay-perpetual-stream/OUTER-LOOP.md
+++ b/experiments/quay-perpetual-stream/OUTER-LOOP.md
@@ -197,6 +197,31 @@ only two — stop signals:
 - **Stop:** `touch experiments/quay-perpetual-stream/.halt` → clean exit at next boundary.
 - **Review:** read `checkpoints/` and `dashboard.md` any time — no interaction required.
 
+- **Lesson recorded (DIR-013 item 4, M19-task-to-plan-docs-reconcile, 2026-07-18)
+  — concurrent human/loop edits to the same live-steering file:** a human-directed
+  `proposal-to-plan` run and the autonomous M17 milestone independently designed
+  the same skill by writing to the same file (`docs/proposals/exp5-quay-task-
+  proposal-plan-skill.md`) concurrently on `master`; their commits interleaved
+  and the merge, though clean at the git level, left dangling internal
+  cross-references and a self-contradictory section count (fixed at
+  M19-task-to-plan-docs-reconcile). Recorded, not enforced (mechanical
+  enforcement is explicitly deferred to a future milestone's scoping — not built
+  here):
+  - When a human is live-editing (or about to live-edit) a file the loop will
+    also touch this session, **prefer pausing the loop** (touch `.halt`, per the
+    Stop control above) **or working on a branch**, rather than letting both
+    write the same file on `master` concurrently.
+  - The loop's merge/ABSORB step must **not** claim a design doc is
+    "dispatch-ready" / "singular and unambiguous" when its own newly-appended
+    section still contains unresolved internal cross-references (a `§N` citation
+    that does not resolve to an existing section) — a **post-merge
+    cross-reference sweep is required** before such a claim is made, not assumed
+    from a clean git merge alone (a clean auto-merge says nothing about
+    cross-document consistency).
+  - Whether to build a mechanical enforcement check for this (e.g. a
+    proposal-internal `§N`-reference-resolves script) is left to a future
+    milestone's scoping — this note only records the lesson.
+
 ## Chart transitions (§6.2)
```

No enforcement script was built — confirmed: `git diff --stat` (below, Done-when 6) shows no new
`.sh`/`.mjs` files under `experiments/quay-perpetual-stream/scripts/`.

### 6. `git diff --stat` against pre-charter base shows only the two named doc files + bookkeeping + process-note file changed

**MET.**
```
$ git diff --stat a99af9d HEAD
 docs/plans/3-7-quay-task-to-plan-skill.md          | 68 +++++++++++++++-------
 .../exp5-quay-task-proposal-plan-skill.md          | 25 ++++----
 experiments/quay-perpetual-stream/OUTER-LOOP.md    | 25 ++++++++
 experiments/quay-perpetual-stream/backlog.md       |  2 +-
 ...lan-proposal-and-stale-plan-cross-references.md | 33 +++++++++--
 5 files changed, 115 insertions(+), 38 deletions(-)
```
(`a99af9d` = this worktree's starting HEAD = the pre-charter base commit, confirmed identical to
the Gate-2 `git rev-parse HEAD` output taken at the very start of this iteration, before any
commits.)

Files touched, matching the charter's expectation exactly:
1. `docs/proposals/exp5-quay-task-proposal-plan-skill.md` — one of the two named doc files.
2. `docs/plans/3-7-quay-task-to-plan-skill.md` — the other named doc file.
3. `experiments/quay-perpetual-stream/OUTER-LOOP.md` — the single process-note file (clause 5).
4. `experiments/quay-perpetual-stream/backlog.md` — this milestone's own bookkeeping (clause 8).
5. `experiments/quay-perpetual-stream/directives/{pending→archive}/DIR-013-*.md` (rename +
   Resolution edit) — this milestone's own bookkeeping (clause 7).

No `.claude/skills/` files, no CLI/product code, no other `inherited-core.md`/`OUTER-LOOP.md`
sections touched (the `OUTER-LOOP.md` diff above is purely additive to the existing §4.7 "Human
async control surface" section — verified by inspection, no lines removed/altered elsewhere in
that file, no M18 milestone-ceiling/diversity-policy/line-budget-gate section touched).

### 7. `directives/pending/DIR-013-*.md` moved to `directives/archive/` with a Resolution section (resolved_by, outcome: applied, evidence pointer) — at ABSORB

**MET** (moved and Resolution added at this iteration; final ABSORB is an outer-loop step beyond
this inner iteration's scope, but the artifact-level work is complete and evidenced here). Diff:
```diff
diff --git a/experiments/quay-perpetual-stream/directives/pending/DIR-013-...md b/experiments/quay-perpetual-stream/directives/archive/DIR-013-...md
similarity index 75%
rename from experiments/quay-perpetual-stream/directives/pending/DIR-013-reconcile-auto-merged-task-to-plan-proposal-and-stale-plan-cross-references.md
rename to experiments/quay-perpetual-stream/directives/archive/DIR-013-reconcile-auto-merged-task-to-plan-proposal-and-stale-plan-cross-references.md
index cd8ddbb..b21bd33 100644
--- a/experiments/quay-perpetual-stream/directives/pending/DIR-013-...md
+++ b/experiments/quay-perpetual-stream/directives/archive/DIR-013-...md
@@ -1,6 +1,6 @@
 # DIR-013
 
-- status: pending
+- status: applied
 - created_by: human (Yale Huang), asserted directly in this live conversation
 - created_at: 2026-07-18
@@ -102,7 +102,30 @@ not expected to fire (no capability-growth typing, Δv=0).
 
 ## Resolution
-<!-- added when moved to archive/, or updated in place if deferred:
-- resolved_by: iteration-N / milestone M-NN
-- outcome: applied | deferred | rejected
-- evidence: pointer to the design doc / iteration report section / commit -->
+- resolved_by: M19-task-to-plan-docs-reconcile, iteration-1, 2026-07-18
+- outcome: applied
+- evidence: all four Requested-action items fixed in a single milestone, documentation-only, per
+  this DIR's own scope:
+  1. **Fix F2** — ... (§12-19 header/TOC fix)
+  2. **Fix F1** — ... (dangling §8.4/§8.5/§11 repointed)
+  3. **Fix F3** — ... (plan citations repointed + authority statement)
+  4. **Process note** — ... (OUTER-LOOP.md lesson, no enforcement built)
+  - Full evidence (pasted diffs/greps): `experiments/quay-perpetual-stream/milestones/
+    M19-task-to-plan-docs-reconcile/iterations/iteration-1.md`.
```
(full Resolution text in the archived file itself; `status:` frontmatter also flipped
`pending`→`applied` to match the archive location, avoiding the same stale-frontmatter drift the
plan file itself notes as a known harness bug elsewhere.)

### 8. `backlog.md`'s `M-TASK-TO-PLAN-DOCS-RECONCILE` row marked DONE — at ABSORB

**MET** (row updated at this iteration; final ABSORB is an outer-loop step, but the row-level work
is complete). Diff:
```diff
-| M-TASK-TO-PLAN-DOCS-RECONCILE | Fix DIR-013's three MUST-FIX defects ... | docs (...) | DIR-013 (drained at m18→m19 SELECT boundary — human-asserted directly this live conversation; see `directives/pending/DIR-013-*.md`) | explore | governance-integrity | pending (SELECTED for m19) |
+| M-TASK-TO-PLAN-DOCS-RECONCILE | Fix DIR-013's three MUST-FIX defects ... | docs (...) | DIR-013 (drained at m18→m19 SELECT boundary — human-asserted directly this live conversation; see `directives/archive/DIR-013-*.md` Resolution) | explore | governance-integrity | **DONE (m19, 2026-07-18, iteration-1).** Fixed F2 (...); fixed F1 (...); fixed F3 (...). Process-note lesson (DIR-013 item 4) recorded in `OUTER-LOOP.md`'s "Human async control surface" section (no enforcement mechanism built, per explicit scope limit). See `.../iterations/iteration-1.md` for full evidence. |
```

## Self-check against all 8 Done-when clauses

| # | Clause | Status | Evidence pointer |
|---|---|---|---|
| 1 | Status header/TOC/TOC-table cover §12-19 | **MET** | This report §1, diffs above; §19 not renumbered away |
| 2 | Every internal §N in proposal resolves | **MET** | This report §2, full grep sweep (0 remaining `§8.x`; all `§11` mentions are provenance-only) |
| 3 | Plan's §8.x/§11 repointed + Part-II/§17 refs added | **MET** | This report §3, full plan diff + Authoritative-artifact note |
| 4 | Authority statement if plan/§17 drift | **MET** | This report §4, verbatim excerpt: §17 = acceptance authority |
| 5 | Process-note lesson recorded, no enforcement built | **MET** | This report §5, OUTER-LOOP.md diff; confirmed no new scripts in git diff --stat |
| 6 | git diff --stat scoped to expected files only | **MET** | This report §6, `git diff --stat a99af9d HEAD` — 5 files, all expected |
| 7 | DIR-013 archived with Resolution | **MET** | This report §7, rename + Resolution diff |
| 8 | backlog.md row DONE | **MET** | This report §8, row diff |

All 8 Done-when clauses are MET with pasted-diff/grep-sweep evidence in this report. No clause
relies on narrative claims alone.

## Final commit

```
$ git log --oneline -1
c12cf6f M19-task-to-plan-docs-reconcile iteration-1: fix DIR-013's three doc defects
```

## Notes on independent re-derivation (per charter's sizing note)

The charter explicitly calls out that "whether iteration-0's repointing of each dangling reference
is the *correct* target section (a judgment call per reference) is independently checkable by a
fresh read of §§8/15/19" as the real material for this iteration. Having derived the repointing
targets independently (without reading iteration-0's report), my mapping was:
- `§8.4` → §8's flat-list point 4 (TDD hard gate) as the origin, §15/§15.2 as the destination
  content — both directions cited in the fix.
- `§8.5` → §8's flat-list point 5 (Provider-agnostic) as the origin, §16 as the destination content.
- `§8 point 6` → already correctly phrased pre-fix; feature-developer reuse content is genuinely
  still in §8 itself (not moved to Part II), so no repoint was needed — verified by re-reading §8's
  point 6 text directly.
- `§11` → §19's preserved provenance blockquote, for all "bootstrap resolution" references.

This matches DIR-013's own suggested targets essentially verbatim ("the code-vs-prose classifier
now in §15.2; the GitHub-degradation/feature-developer reuse points in §8's flat list; the
bootstrap resolution preserved under §19"), giving independent convergence on the same repointing
choices DIR-013's finding text itself anticipated.
