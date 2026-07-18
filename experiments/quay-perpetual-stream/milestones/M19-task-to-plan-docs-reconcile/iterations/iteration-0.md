# M19-task-to-plan-docs-reconcile — iteration-0

**Worktree:** `experiments/quay-perpetual-stream/milestones/M19-task-to-plan-docs-reconcile/worktrees/iteration-0`
**Branch:** `exp5-m19-iteration-0`
**Final commit:** `57bfc1a` (`57bfc1ae9db5fb3ec306e3ed6eb711f98e1df98e`)
**Pre-charter base commit:** `a99af9d` (`a99af9d94e6a0bcf17c70f67f11187c2e7321dd6` — worktree HEAD before any edits)

## HARD GATES evidence

**1. `ls -1 experiments/quay-perpetual-stream/directives/pending/`** (before work):

```
DIR-013-reconcile-auto-merged-task-to-plan-proposal-and-stale-plan-cross-references.md
```

(after work, DIR-013 moved to archive/ — see Done-when 7 below; `pending/` is now empty.)

**2. Branch/commit proof (worktree isolation), run from inside the worktree:**

```
$ git rev-parse HEAD
a99af9d94e6a0bcf17c70f67f11187c2e7321dd6      # before work
57bfc1ae9db5fb3ec306e3ed6eb711f98e1df98e      # after commit (this iteration's HEAD)
$ git branch --show-current
exp5-m19-iteration-0
```

All edits are committed as a single commit (`57bfc1a`) on `exp5-m19-iteration-0`, built on top of `a99af9d` (the repo's `master` HEAD at worktree-creation time), inside this isolated worktree — not the shared tree at repo root.

**3. hub.addr/curl gates — N/A.** This is a docs-only milestone (per the charter: "no live external system or web UI needed"). No live external system or Web UI verification applies; stated explicitly per the charter's own instruction.

## Work performed, by Done-when clause

### Done-when 1 — Status header + TOC heading + TOC table cover §12-19 (F2)

**Met.** Diff (full file diff at `docs/proposals/exp5-quay-task-proposal-plan-skill.md`, relevant hunks):

```diff
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
 degradation, a dispatch-ready Done-when checklist for a future implementing
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
+| §19 Status / next step (supersedes original §11's DRAFT-era framing; preserves §11's provenance) | (n/a — closing status section, not a numbered charter item) | (n/a) |
```

Also caught and fixed a **second occurrence of the same undercount** inside §19's own status paragraph (not explicitly named by DIR-013's finding text, but the same defect class):

```diff
@@ -779,7 +786,8 @@ cadence) are the natural first customers."
 **Current status (M17-task-to-plan-skill-design, this milestone):** the DIR was
 filed (`DIR-012`) and drained exactly per that routing — this milestone
 (charter item 1) has now produced the "fully specify the new skill" deliverable
-the DIR's Requested-action item 1 asked for (§§12-18 above). Still Design-only:
+the DIR's Requested-action item 1 asked for (§§12-19 above, this status section
+included). Still Design-only:
```

§19 was **not renumbered away** — it remains `## 19. Status / next step` in the body; only the header/TOC/status text describing it were corrected to include it.

### Done-when 2 — Every internal §N reference inside §§12-19 resolves to an existing section (F1)

**Met.** Full grep sweep, post-fix, of every `§[0-9]` token in the proposal file:

```
$ grep -on '§[0-9]\+\(\.[0-9]\+\)\?' docs/proposals/exp5-quay-task-proposal-plan-skill.md | sed 's/^[0-9]*://' | sort -u
§1
§10
§12
§12.2
§12.3
§13
§13.1
§13.2
§14
§14.1
§14.2
§15
§15.1
§15.2
§16
§17
§18
§19
§2
§3
§4
§5
§5.2
§6
§7
§8
```

Existing `##`/`###` headings in the file (ground truth):

```
$ grep -n '^## ' docs/proposals/exp5-quay-task-proposal-plan-skill.md
28:## Table of contents — M17 addition map (§12-19)
44:## 1. Problem — ...
77:## 2. Prior art, ...
103:## 3. The four-entity model ...
136:## 4. Milestone sizing: ...
159:## 5. Two milestone classes, ...
179:## 6. The pipeline ...
217:## 7. Plan is *checked*, ...
241:## 8. What the new skill is, concretely
267:## 9. Relationship to existing exp5 mechanisms ...
286:## 10. Non-goals / open decisions
306:## 12. Quay task read/write behavior ...
410:## 13. N-independent-proposal + adjudication step ...
483:## 14. Plan author + grounded convergent-check step ...
557:## 15. TDD ≥80%-per-stage hard gate ...
631:## 16. Provider-agnostic GitHub degradation ...
671:## 17. Dispatch-ready Done-when clauses ...
747:## 18. Non-goals ...
774:## 19. Status / next step ...

$ grep -n '^### ' docs/proposals/exp5-quay-task-proposal-plan-skill.md
308:### 12.1 Provider ABI tool(s) used
333:### 12.2 Proposal → `body` write-back shape ...
374:### 12.3 Milestone → task grouping ...
412:### 13.1 Mechanism
445:### 13.2 Relationship to `proposal-to-plan`'s existing architect-review ...
485:### 14.1 Mechanism
517:### 14.2 Convergence / stop condition ...
559:### 15.1 What it gates, precisely
580:### 15.2 Code-vs-prose per-stage classifier ...
603:### 15.3 Why load-bearing specifically here ...
```

Every token in the sweep (§1-10, §12-19, §12.2/§12.3/§13.1/§13.2/§14.1/§14.2/§15.1/§15.2) resolves to a real heading. The two apparent exceptions are both non-dangling by inspection:
- `§11` — remaining occurrences (lines 40, 774, 776, 800) are all explicitly historical/provenance references describing the **superseded original §11** (preserved as a blockquote under §19), never a claim that §11 exists as a live section — this is exactly DIR-013's own recommended fix ("bootstrap resolution preserved under §19").
- `§5.2` — refers to a **different document** (`M14-cli-edit-parity`'s own §5.2, in the GitHub-degradation section), not an internal reference into this proposal.

**Zero-hit confirmation for the two literal dangling patterns DIR-013 named:**

```
$ grep -n '§8\.4\|§8\.5' docs/proposals/exp5-quay-task-proposal-plan-skill.md
$ echo "exit=$?"
exit=1
```

(no matches — grep exit 1 confirms zero hits.)

**The three concrete repointing diffs** (F1):

1. Line ~578 (`§8.4` → restated as new-to-Part-II, no §8 subsection exists to carry it from):
```diff
-### 15.2 Code-vs-prose per-stage classifier (scope caveat, carried from §8.4)
+### 15.2 Code-vs-prose per-stage classifier (scope caveat)
+
+This classifier is new content introduced here in Part II — §8 (the original
+draft's flat 6-point "what the new skill is" list) has no subsection matching
+it; there is no earlier home to carry it from.
```

2. Line ~627 (`§8.5` → repointed to §8's real flat-list point 5):
```diff
-Stated explicitly, extending §8.5's one-line summary into a precise behavior
-specification:
+Stated explicitly, extending §8 point 5's one-line summary ("Provider-agnostic
+... must degrade correctly on GitHub") into a precise behavior specification:
```

3. Line ~714 (`§11` → repointed to §19's provenance blockquote):
```diff
-      stage (e.g. the skill's own `SKILL.md` authoring, if self-hosted per §11's
-      bootstrap resolution) — pasted gate-hash/projection-check script output.
+      stage (e.g. the skill's own `SKILL.md` authoring, if self-hosted per the
+      bootstrap resolution preserved under §19's provenance blockquote) —
+      pasted gate-hash/projection-check script output.
```

`§8 point 6` (line 728/735, "carried through from this doc's §8 point 6") was **verified already correct** — §8 is a real flat 6-point list, and point 6 ("Reuse or wrap `feature-developer`'s orchestration where it fits") genuinely matches the citing text. Left unmodified; not a defect.

### Done-when 3 — plan's §8.x/§11 citations repointed + explicit Part II/§17 references (F3)

**Met.** Full diff at `docs/plans/3-7-quay-task-to-plan-skill.md` (179-line diff; key hunks):

```diff
 - **Source proposal:** `docs/proposals/exp5-quay-task-proposal-plan-skill.md`
-  (reviewed, DRAFT status, authored 2026-07-18). This plan decomposes the two
-  deliverable strands the proposal describes (§8 the skill; §4/§5/§6/§7 the
+  (status: MATURED — dispatch-ready skill design, per M17-task-to-plan-skill-design;
+  §§1-11 are the original DRAFT this plan was first authored against, §§12-19 are
+  the fully-specified Part II the M17 milestone later added — see the
+  "Post-M17 reconciliation note" immediately below for how this plan now relates
+  to Part II). This plan decomposes the two deliverable strands the proposal
+  describes (§8 the skill's original draft-level description; §4/§5/§6/§7 the
   milestone-model changes) into dependency-ordered phases/stages. Scope is drawn
   **strictly** from the proposal — nothing here extends it.
 
+- **Post-M17 reconciliation note (added at M19-task-to-plan-docs-reconcile,
+  2026-07-18) — authoritative-artifact statement.** ... every `§8.x`/`§11`
+  citation in this plan is repointed to the Part II section that now actually
+  carries that content (§12/§13/§14/§15/§16, and §19 for the bootstrap
+  resolution) ... **Authority if they ever drift:** per DIR-013's recommendation
+  (adopted here, no concrete reason found to deviate) — **the proposal's §17
+  Done-when checklist is the acceptance authority**; this plan's Phase/Stage
+  decomposition is the **build-route elaboration** ... If a future implementer
+  finds this plan's phase/stage content disagreeing with §17, **§17 wins**; the
+  plan should then be corrected to match, not the other way around.
```

Plus a new **"Strand-1 implementer pointer"** paragraph explicitly directing readers to read Part II (§12-19) and treat §17 as authority before starting Phase 6/7:

```diff
+- **Strand-1 implementer pointer.** Before starting Phase 6/7 (strand 1, the
+  skill itself), read `docs/proposals/exp5-quay-task-proposal-plan-skill.md`
+  **Part II (§12-19)** in full — it is the dispatch-ready operational spec this
+  plan's Phase 6/7 stages summarize and sequence, not a substitute for it — and
+  treat its **§17 Done-when checklist** as the acceptance authority per the
+  reconciliation note above.
```

Every load-bearing `§8.x`/`§11` citation repointed (Phase 6/7 Goal lines, Stage 6.2/7.1/7.2/7.3 Work lines, Phase 7 acceptance clause 3, the verification-strategy intro, the Dogfooding-note heading and body):

```diff
-**Goal (proposal §8.1, §8.2, §8.5, §8.6):** create the new skill's scaffold ...
+**Goal (proposal §12 read/write behavior, §13 proposal step, §16 GitHub degradation,
+§8 point 6 / §17's `feature-developer`-reuse Done-when item — Part II, see the
+reconciliation note above):** create the new skill's scaffold ...
...
-  (proposal §8.2, §6): blank-slate-leaning ...
+  (proposal §13.1 step 1, §6): blank-slate-leaning ...
...
-**Goal (proposal §8.3, §8.4, §8.6, §11):** complete the skill with the **plan step**
+**Goal (proposal §14 plan step, §15 TDD hard gate, §8 point 6 / §17's
+`feature-developer`-reuse item, §19 bootstrap resolution — Part II, see the
+reconciliation note above):** complete the skill with the **plan step**
...
-classifier, and the dogfooding wiring per §11.
+classifier, and the dogfooding wiring per §19.
...
-- **Work:** encode the plan step (proposal §8.3, §7): one subagent authors a
+- **Work:** encode the plan step (proposal §14, §7): one subagent authors a
...
-- **Work:** encode proposal §8.4: **TDD ≥80% per stage is a HARD GATE**, stricter
+- **Work:** encode proposal §15 (§15.1 gate, §15.2 classifier): **TDD ≥80% per stage
+  is a HARD GATE**, stricter
...
-- **Work:** encode proposal §8.6 (reuse/wrap `feature-developer`'s orchestration
-  where it fits rather than reinventing the review loop) and §11's **bootstrap
-  resolution**: ...
+- **Work:** encode proposal §8 point 6 / §17's `feature-developer`-reuse Done-when
+  item (reuse/wrap `feature-developer`'s orchestration
+  where it fits rather than reinventing the review loop) and §19's **bootstrap
+  resolution** (preserved from the pre-merge draft's original §11, see the
+  reconciliation note at the top of this plan): ...
...
-3. Bootstrap resolution (proposal §11), `feature-developer` reuse, `Output`, and
-   non-goals are all present.
+3. Bootstrap resolution (proposal §19, preserving the original draft's §11),
+   `feature-developer` reuse, `Output`, and non-goals are all present.
...
-and proposal §8.4 require — **not** a single blanket coverage number.
+and proposal §15.2 require — **not** a single blanket coverage number.
...
-## Dogfooding note (proposal §11)
+## Dogfooding note (proposal §19, preserving the original draft's §11)
 
-**This plan is itself intended to be the dogfooding subject.** Per proposal §11,
+**This plan is itself intended to be the dogfooding subject.** Per proposal §19
+(preserving the original draft's §11 bootstrap-resolution paragraph, see the
+reconciliation note at the top of this plan),
```

Final sweep on the plan file confirms no remaining **live** `§8.x` claim (the only surviving hit is the historical past-tense description inside the reconciliation note itself):

```
$ grep -n '§8\.[0-9]' docs/plans/3-7-quay-task-to-plan-skill.md
16:  `§8.1`-`§8.6` for the skill's design points; M17 subsequently added Part II
```

### Done-when 4 — explicit authority-if-drift statement

**Met.** Excerpt (from the "Post-M17 reconciliation note", quoted in full above under Done-when 3):

> **Authority if they ever drift:** per DIR-013's recommendation (adopted here, no concrete reason found to deviate) — **the proposal's §17 Done-when checklist is the acceptance authority**; this plan's Phase/Stage decomposition is the **build-route elaboration** of how to satisfy that checklist, not an independent source of requirements. If a future implementer finds this plan's phase/stage content disagreeing with §17, **§17 wins**; the plan should then be corrected to match, not the other way around.

No concrete reason to deviate from DIR-013's recommendation was found during this iteration (the plan's own structure is explicitly downstream of/subordinate to the proposal throughout, e.g. its own opening line "Scope is drawn strictly from the proposal — nothing here extends it") — so the recommended assignment was adopted as-is.

### Done-when 5 — process-note lesson recorded, no enforcement built

**Met.** Diff at `experiments/quay-perpetual-stream/OUTER-LOOP.md` (added to the "Human async control surface" section, which fits better on inspection than `inherited-core.md` — it is where the loop's human-interaction/merge-timing behavior already lives):

```diff
 - **Review:** read `checkpoints/` and `dashboard.md` any time — no interaction required.
 
+**Lesson recorded (DIR-013 / M19-task-to-plan-docs-reconcile, 2026-07-18) —
+concurrent human/loop edits to the same file.** A human-directed `proposal-to-plan`
+design run and the autonomous M17 milestone independently edited the same doc
+(`docs/proposals/exp5-quay-task-proposal-plan-skill.md`) at the same time on
+`master`; the auto-resolved merge (`989e0cd`) took one side's body wholesale,
+leaving dangling internal cross-references and a self-contradictory section
+count that a "clean" (no textual conflict) merge did not catch. Two lessons,
+recorded here (not enforced — no mechanism is built by this note):
+1. **Prefer pausing the loop or working on a branch when a human is live-editing
+   a file the loop will also touch.** ...
+2. **A merge must not claim "dispatch-ready" / "singular and unambiguous" without
+   a post-merge cross-reference sweep.** ...
+
+Whether to build a mechanical enforcement for lesson 2 (a proposal-internal
+`§N`-reference-resolves check) is explicitly **left to a future milestone's
+scoping** — this note only records the lesson; no check is built here.
+
 ## Chart transitions (§6.2)
```

No enforcement script was built (per instruction) — only the lesson text, with the last line explicitly deferring the enforcement-mechanism decision.

### Done-when 6 — git diff --stat shows only the expected files

**Met.** Against the pre-charter base commit `a99af9d`:

```
$ git diff --stat --cached a99af9d
 docs/plans/3-7-quay-task-to-plan-skill.md          | 83 ++++++++++++++++------
 .../exp5-quay-task-proposal-plan-skill.md          | 28 +++++---
 experiments/quay-perpetual-stream/OUTER-LOOP.md    | 24 +++++++
 experiments/quay-perpetual-stream/backlog.md       |  2 +-
 ...lan-proposal-and-stale-plan-cross-references.md | 33 +++++++--
 5 files changed, 134 insertions(+), 36 deletions(-)
```

Exactly: the two named doc files, the milestone's own DIR-013 archive-move + Resolution (its rename shows as the 5th path, truncated in `--stat` display but confirmed by `git status` below as the DIR-013 file), the backlog row update, and the single process-note file (`OUTER-LOOP.md`, clause 5's own file). No `.claude/skills/` files, no CLI/product code, and — confirmed by reading the diff itself — no M18-added `inherited-core.md`/`OUTER-LOOP.md` milestone-ceiling/diversity-policy/line-budget-gate sections touched (the only `OUTER-LOOP.md` change is the new "Lesson recorded" paragraph appended after the pre-existing "Human async control surface" bullets, an unrelated section).

`git status` immediately before commit, for the rename confirmation:

```
Changes to be committed:
	renamed:    experiments/quay-perpetual-stream/directives/pending/DIR-013-....md -> experiments/quay-perpetual-stream/directives/archive/DIR-013-....md
Changes not staged for commit:
	modified:   docs/plans/3-7-quay-task-to-plan-skill.md
	modified:   docs/proposals/exp5-quay-task-proposal-plan-skill.md
	modified:   experiments/quay-perpetual-stream/OUTER-LOOP.md
	modified:   experiments/quay-perpetual-stream/backlog.md
	modified:   experiments/quay-perpetual-stream/directives/archive/DIR-013-....md
```

(`inherited-core.md` — not touched at all this iteration; charter left the choice of `inherited-core.md` vs `OUTER-LOOP.md` open for the process note, and `OUTER-LOOP.md` was chosen.)

### Done-when 7 — DIR-013 moved to archive/ with Resolution

**Met.**

```
$ ls -1 experiments/quay-perpetual-stream/directives/pending/
(empty)
$ ls -1 experiments/quay-perpetual-stream/directives/archive/ | tail -1
DIR-013-reconcile-auto-merged-task-to-plan-proposal-and-stale-plan-cross-references.md
```

Resolution section added (excerpt; full text in the archived file):

```
## Resolution
- resolved_by: M19-task-to-plan-docs-reconcile, iteration-0, 2026-07-18
- outcome: applied — all four Requested-action items done
- evidence:
  - Item 1 (F2 — status header/TOC undercount): ...
  - Item 2 (F1 — dangling §8.4/§8.5/§8 point 6/§11 cross-refs): ...
  - Item 3 (F3 — stale plan citations): ...
  - Item 4 (process note): ...
  - Full detail: .../iterations/iteration-0.md.
```

Frontmatter `- status: pending` → `- status: applied` (matching the M12/M18 precedent pattern of correcting frontmatter at the same time as the archive move, avoiding the DIR-012 stale-frontmatter bug the plan file itself calls out as a known harness gap).

### Done-when 8 — backlog.md row marked DONE

**Met.** Diff:

```diff
-| M-TASK-TO-PLAN-DOCS-RECONCILE | ... | DIR-013 (drained at m18→m19 SELECT boundary — human-asserted directly this live conversation; see `directives/pending/DIR-013-*.md`) | explore | governance-integrity | pending (SELECTED for m19) |
+| M-TASK-TO-PLAN-DOCS-RECONCILE | ... | DIR-013 (drained at m18→m19 SELECT boundary — human-asserted directly this live conversation; see `directives/archive/DIR-013-*.md` Resolution) | explore | governance-integrity | **DONE (m19, 2026-07-18, iteration-0).** All 4 DIR-013 Requested-action items applied: ... **Realized Δv = 0**, by design ... Adversarial-audit gate correctly did NOT fire (Δv̂=0 governance-integrity type, no iteration-0 self-exemption). |
```

## Self-check against all 8 Done-when clauses

| # | Clause | Status | Evidence pointer |
|---|---|---|---|
| 1 | Status header/TOC heading/table cover §12-19 | **MET** | Diff hunks in this report, §"Done-when 1" |
| 2 | Every internal §N in §§12-19 resolves; grep sweep + repointing diffs | **MET** | Full sweep + `§8.4/§8.5` zero-hit grep + 3 repointing diffs, §"Done-when 2" |
| 3 | Plan's §8.x/§11 citations repointed + Part II/§17 references added | **MET** | Full diff excerpts, §"Done-when 3" |
| 4 | Explicit authority-if-drift statement | **MET** | Quoted excerpt, §"Done-when 4" |
| 5 | Process-note lesson recorded, no enforcement built | **MET** | Diff, §"Done-when 5" |
| 6 | `git diff --stat` shows only expected files | **MET** | Stat output + status output, §"Done-when 6" |
| 7 | DIR-013 archived with Resolution | **MET** | `ls` output + Resolution excerpt, §"Done-when 7" |
| 8 | backlog.md row marked DONE | **MET** | Diff, §"Done-when 8" |

All 8 Done-when clauses met at iteration-0. Per the charter, the milestone is DONE when all eight are met **and stable ≥1 iteration** (§3.2 condition 1) — this milestone therefore requires at least one further iteration (iteration-1) to independently re-verify (per the charter's own sizing note: "whether iteration-0's repointing of each dangling reference is the *correct* target section ... is independently checkable by a fresh read of §§8/15/19") before the milestone can be declared converged/DONE at ABSORB.

## Reflection

- **What I found:** DIR-013's finding text was accurate and specific enough to locate every defect directly by grep — no exploratory investigation was needed beyond reading the three source files and cross-checking the proposal's actual `##`/`###` heading structure against every `§N` token in both files.
- **One extra defect found beyond DIR-013's literal list:** the "§§12-18" undercount also appeared a second time, inside §19's own "Current status" paragraph (not one of the four `:7`/`:16`/`:27`/`:29-38` locations DIR-013's Requested-action item 1 named). Fixed it as part of the same F2 defect class rather than treating it as out of scope, since leaving one instance of the exact defect DIR-013 flagged would not satisfy "accurately list §12-19" charter language.
- **Judgment calls made (flagged for iteration-1's independent re-derivation, per the charter's own sizing note):** the exact repointing target for each dangling reference (e.g. whether §8.4's content "restates inline" vs. cites §8 more precisely; whether §16's `§8.5` should read "§8 point 5" verbatim vs. paraphrase) is a judgment call, not a mechanically-forced answer — DIR-013 itself frames this as real independent-re-derivation material for iteration-1.
- **No blockers, no scope creep:** did not touch `.claude/skills/`, did not re-open M17, did not build a §N-reference-resolves enforcement script, did not touch `inherited-core.md` or M18-added `OUTER-LOOP.md` sections.

## Artifacts

- `docs/proposals/exp5-quay-task-proposal-plan-skill.md` — F1/F2 fixes.
- `docs/plans/3-7-quay-task-to-plan-skill.md` — F3 fixes.
- `experiments/quay-perpetual-stream/OUTER-LOOP.md` — process note (Done-when 5).
- `experiments/quay-perpetual-stream/backlog.md` — row marked DONE.
- `experiments/quay-perpetual-stream/directives/archive/DIR-013-reconcile-auto-merged-task-to-plan-proposal-and-stale-plan-cross-references.md` — moved from `pending/`, Resolution added.
- Commit: `57bfc1ae9db5fb3ec306e3ed6eb711f98e1df98e` on branch `exp5-m19-iteration-0`.
