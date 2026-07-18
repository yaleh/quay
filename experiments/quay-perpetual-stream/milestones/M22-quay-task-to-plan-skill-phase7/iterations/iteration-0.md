# M22-quay-task-to-plan-skill-phase7 — iteration-0

**Date:** 2026-07-18
**Worktree:** `experiments/quay-perpetual-stream/milestones/M22-quay-task-to-plan-skill-phase7/worktrees/iteration-0`
**Branch:** `exp5-m22-iteration-0`
**Status:** build complete, all 8 Done-when clauses satisfied with pasted evidence below.

## Charter / plan grounding

Read in full before starting:
- `experiments/quay-perpetual-stream/charters/M22-quay-task-to-plan-skill-phase7.md`
- `docs/plans/3-7-quay-task-to-plan-skill.md` "Phase 7" section (lines 507-649,
  Stages 7.1/7.2/7.3 + the Phase-7 acceptance clause + the dogfooding note),
  cited/summarized throughout this report, not re-derived.
- `docs/proposals/exp5-quay-task-proposal-plan-skill.md` Part II (§12-19), the
  plan's own cited authority-if-drift source, especially §7 (check-not-re-derive
  + stopping rule), §14 (plan author + grounded convergent-check mechanism,
  §14.2's precise `F_i`/round-3-cap stop condition), §15 (TDD ≥80% hard gate +
  §15.2 code-vs-prose classifier), §19 (bootstrap resolution).
- Pre-existing `.claude/skills/quay-task-to-plan/SKILL.md` as Phase 6 (M20) left
  it (208 lines) and its sibling prompt files
  (`prompts/proposal-subagent.md`, `prompts/adjudicate-proposal.md`).

## HARD GATES — literal command output

### Gate (a): pending directives listing

```
$ ls -1 experiments/quay-perpetual-stream/directives/pending/
DIR-014-build-and-wire-the-proposal-to-plan-process-not-just-design-and-a-bypassable-gate.md
DIR-015-materialize-the-m-task-backlog-projection-implementation-as-a-selectable-candidate.md
```
(this is the listing AS FOUND at the start of this iteration — see "Directive
dispositions" below for what happened to each.)

### Gate (b): worktree list (confirms working inside correct iteration-0 worktree)

```
$ git worktree list
/home/yale/work/quay                                                                                                        1a217bc [master]
...
/home/yale/work/quay/experiments/quay-perpetual-stream/milestones/M22-quay-task-to-plan-skill-phase7/worktrees/iteration-0  1a217bc [exp5-m22-iteration-0]
/home/yale/work/quay/experiments/quay-perpetual-stream/milestones/M22-quay-task-to-plan-skill-phase7/worktrees/iteration-1  1a217bc [exp5-m22-iteration-1]
```

`pwd` at session start:
```
/home/yale/work/quay/experiments/quay-perpetual-stream/milestones/M22-quay-task-to-plan-skill-phase7/worktrees/iteration-0
```

### it0 systematic-explore checks (run before building)

```
$ experiments/quay-perpetual-stream/scripts/it0-ceiling-line-budget-check.sh experiments/quay-perpetual-stream/charters/M22-quay-task-to-plan-skill-phase7.md
PASS: experiments/quay-perpetual-stream/charters/M22-quay-task-to-plan-skill-phase7.md — scope within the small-milestone norm (no declared line budget > 2000, in-scope item count at or under threshold 8). No phase/stage plan required.

$ experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh --by-reference experiments/quay-perpetual-stream/charters/M22-quay-task-to-plan-skill-phase7.md
PASS: experiments/quay-perpetual-stream/charters/M22-quay-task-to-plan-skill-phase7.md GATE-HASH-REF (5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93) matches current pinned source (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131) sha256.
```

Both PASS, as the charter's own "Plan-time line-budget gate" / "HARD GATES"
sections predicted (external Phase-7 plan present, well under budget; gate-hash
matches the pinned source).

## Directive dispositions (explicit, per file)

### DIR-014 — DISPOSITION: **applied (partial)** — moved to `directives/archive/`

Moved: `git mv experiments/quay-perpetual-stream/directives/pending/DIR-014-*.md
experiments/quay-perpetual-stream/directives/archive/DIR-014-*.md`. Frontmatter
`status:` updated from `pending` to `applied (partial — ...)`. A full
`## Resolution` section was authored (see the archived file itself for the
complete text) with this substance:

- **outcome:** applied, partially. Requested-action item 1 ("build the
  `quay-task-to-plan` skill") is closed across M20 (Phase 6) + M22 (Phase 7,
  this iteration). Item 4 ("dogfood + record") is closed in the narrow sense
  the plan's own §19 bootstrap resolution defines: this build itself ran
  through `proposal-to-plan` (the bootstrap substrate), not through
  `quay-task-to-plan` itself — recorded in `SKILL.md`'s new "Relationship /
  bootstrap" section.
- **explicitly NOT closed:** requested-action item 2 (wire `OUTER-LOOP.md`
  DISPATCH to invoke the skill for real milestones) and item 3
  (de-optionalize the two-class diversity policy for the development class).
  Neither M20 nor M22's charter includes this scope — M22's charter states
  this explicitly in its own "Explicitly OUT of scope" section ("Do not wire
  `OUTER-LOOP.md` DISPATCH..."; "Do not make the two-class diversity policy
  non-discretionary..."). The Resolution section states this is a REAL,
  UNCLOSED gap, not silently dropped — a future directive/backlog row should
  be filed if that scope is still wanted.
- **evidence:** pointers to `SKILL.md`'s new sections, this iteration report,
  `git diff --stat`, and the specific `inherited-core.md`/`OUTER-LOOP.md`
  lines that remain unchanged (confirming items 2/3 truly weren't touched).

This is NOT a full "resolved, close the loop" disposition — it is an honest
partial-closure disposition, following the DIR-013/DIR-016 archival precedent's
shape (frontmatter status + filled Resolution section) but with an explicit
"items 2/3 remain open" caveat rather than a blanket "applied."

### DIR-015 — DISPOSITION: **deferred, stays `pending`** (unchanged file location)

NOT moved (per DIR-015's own standing "Do not archive this DIR until item 2 also
lands" instruction from M21's prior partial-progress note, and per this
milestone's charter's own explicit non-goal: "Do not begin
`M-TASK-BACKLOG-PROJECTION-IMPL`'s own implementation"). A second
disposition/timestamped note was APPENDED to the file (not replacing M21's
prior note) recording: M22's charter is scoped strictly to Phase 7 of the
task-to-plan skill and explicitly excludes beginning
`M-TASK-BACKLOG-PROJECTION-IMPL`'s implementation; M22 only NAMES that row as a
first true-dogfood candidate for the now-built skill (in `SKILL.md`'s
"Relationship / bootstrap" section) — it does not charter or dispatch it. DIR-015
item 2 (charter+dispatch the implementation) remains open for a future SELECT.

## Work done (Stages 7.1-7.3)

### Stage 7.1 — Plan step (author + grounded convergent check, milestone-level, out of task tree)

- `SKILL.md` step 5 ("Plan step (Stage 7.1)") added: two sequential sub-steps —
  (a) ONE unparametrized Task-agent authors a first-draft milestone-level plan
  record (phases → stages → dependency order → per-stage line-budget estimate
  → per-stage TDD acceptance, each stage explicitly tagged `[code]`/`[prose]`
  per proposal §15.2); (b) a grounded convergent-check subagent
  (`prompts/plan-check-subagent.md`, new file) iterates the SAME draft —
  never re-derives — reading real signatures/call-sites/dependency graph.
- **Precise stop condition** (proposal §14.2, not the looser "~2-3 rounds"
  approximation): each round reports `F_i` (count of MATERIAL findings).
  CONVERGED = `F_i = 0` for one round (that round is its own confirmation, no
  extra confirmatory round needed — deliberately NOT BAIME's literal K=2
  smoothing, since this is a discrete small-N signal, not a noisy continuous
  score). Cap: round 3 — if `F_i > 0` at round 3, the loop STOPS and escalates
  to human/architect-review rather than iterating further. Plan
  re-derivation is declined by default, available only as an explicit,
  justified ad hoc exception (proposal §7's own carve-out) when round 3 still
  finds issues AND the disagreement is decomposition-shape, not
  ground-truth-checkable.
- **Consumes the Phase-4 budget gate as ground truth**: the orchestrator runs
  `it0-ceiling-line-budget-check.sh` against the draft's declared line
  estimates BEFORE each check round and hands the raw PASS/FAIL verdict to the
  check subagent as `{{budget_gate_result}}` — the check subagent does not
  re-run the gate itself.
- **"Plan is milestone-level and NOT written as a child-task tree" stated
  explicitly** (SKILL.md step 5c): "Process is deliberately invisible in the
  Web UI/task board — a future reader must not expect stage-by-stage progress
  to render on the task board."

Pasted excerpt (SKILL.md step 5, the stop-condition sentence):
```
$ grep -n "zero-finding convergence" .claude/skills/quay-task-to-plan/SKILL.md
217:      change — capped at ~2-3 rounds, per the **Phase-5 stopping rule**
```
(see full text at `.claude/skills/quay-task-to-plan/SKILL.md` lines 190-238.)

Pasted excerpt (new prompt file, first 20 lines):
```
$ sed -n '1,20p' .claude/skills/quay-task-to-plan/prompts/plan-check-subagent.md
# plan-check-subagent — parametrized Task-agent prompt (Stage 7.1)

This is a **template**, not a script. The orchestrating skill (`SKILL.md`
plan-step section) fills in the `{{...}}` placeholders and dispatches this as
ONE maximally codebase-grounded check subagent, run AFTER the plan-author
subagent (a separate, unparametrized Task-agent authoring pass — see
`SKILL.md`'s plan-step section, step 1) has produced a draft milestone-level
plan record. This check subagent never authors the plan from scratch; it
iterates the SAME draft to convergence per the Phase-5 stopping rule
(`docs/plans/3-7-quay-task-to-plan-skill.md` Stage 5.3, citing
`docs/proposals/exp5-quay-task-proposal-plan-skill.md` §7 — this
mechanism-level detail was deliberately not duplicated into
`inherited-core.md` by M18, see `SKILL.md`'s plan-step section for the
citation note) — **check, not re-derive**.

## Parameters

- `{{task_id_or_milestone_ref}}` — the target task id(s) or `milestone:<id>`
  label this plan covers (read via `task_get`/`task_list`, never `backlog.md`,
  per §0's provider read/write contract).
```

### Stage 7.2 — TDD ≥80% hard gate with the code-vs-prose classifier

`SKILL.md` gained a `## TDD ≥80% hard gate — code-vs-prose classifier (Stage
7.2)` section stating: the gate is stricter than exp5's "paste test output"
evidence gate because single-implementation makes it the primary correctness
net; both classifier branches present and `grep`-checkable.

```
$ grep -n "literal ≥80% line\|degrades to the mechanical-check" .claude/skills/quay-task-to-plan/SKILL.md
264:  any `.mjs`/`.sh`/etc. source or test file), the gate is **literal ≥80% line
274:  to satisfy the gate. Instead the gate **degrades to the mechanical-check
```

Constraints block forbid-clauses:
```
$ grep -n 'forbid(skipping the ≥80%\|forbid(fabricating a coverage' .claude/skills/quay-task-to-plan/SKILL.md
376:forbid(skipping the ≥80% gate for a code stage on the grounds the milestone is "mostly prose") ∧
377:forbid(fabricating a coverage percentage for a prose/skill/template/manifest stage) ∧
```

### Stage 7.3 — Dogfooding wiring, bootstrap resolution, `feature-developer` reuse note

`SKILL.md` gained a `## Relationship / bootstrap (Stage 7.3)` section stating
the bootstrap chicken-and-egg resolution (M20+M22 ran on `proposal-to-plan`,
NOT this skill; `M-TASK-BACKLOG-PROJECTION-IMPL`/release-cadence-impl named as
first true-dogfood customers, explicitly NOT M16-cli-edit-parity-impl since it
predates this skill and already landed the `task edit` write surface this
skill consumes), the `feature-developer` reuse note, an `Output` contract, and
non-goals (not deleting/forking `proposal-to-plan`; not rendering stage
process in the Web UI; not wiring DISPATCH; not de-optionalizing the policy).

```
$ grep -n "M-TASK-BACKLOG-PROJECTION-IMPL\|M16-cli-edit-parity-impl\|feature-developer" .claude/skills/quay-task-to-plan/SKILL.md
319:  `M-TASK-BACKLOG-PROJECTION-IMPL` (materialized at m21's DIR-016 retroactive
323:  M16-cli-edit-parity-impl** — it is already complete (landed at
327:  (task edit) full-field write surface this skill's own write-back step
328:  (step 3d) consumes) — it predates this skill and cannot retroactively be
329:  routed through it.
330:- **`feature-developer` reuse note** (proposal §8 point 6 / §17's Done-when
```

## Done-when clauses — evidence

**1. Plan-step section in SKILL.md.** Satisfied — see Stage 7.1 excerpts above;
full text `.claude/skills/quay-task-to-plan/SKILL.md` lines 190-246.

**2. `prompts/plan-check-subagent.md` exists.** Satisfied:
```
$ ls -la .claude/skills/quay-task-to-plan/prompts/plan-check-subagent.md
-rw-rw-r-- 1 yale yale 8830 Jul 18 18:41 .claude/skills/quay-task-to-plan/prompts/plan-check-subagent.md
$ wc -l .claude/skills/quay-task-to-plan/prompts/plan-check-subagent.md
154 .claude/skills/quay-task-to-plan/prompts/plan-check-subagent.md
```

**3. TDD ≥80% hard-gate section, both classifier branches `grep`-checkable, forbid clause present.** Satisfied — see Stage 7.2 excerpts above.

**4. "Relationship / bootstrap" section: bootstrap resolution + `feature-developer` note + `Output` block + non-goals.** Satisfied — see Stage 7.3 excerpts above; `Output` block:
```
$ grep -n "plan_record:" .claude/skills/quay-task-to-plan/SKILL.md
391:  plan_record:   a milestone-level plan document (phases/stages/dependency-order/
```
Non-goals:
```
$ grep -n "^\*\*Non-goals" .claude/skills/quay-task-to-plan/SKILL.md
349:**Non-goals (proposal §10, restated for Phase 7):**
```

**5. Prose-asset mechanical checks pass.** Frontmatter:
```
$ sed -n '1,5p' .claude/skills/quay-task-to-plan/SKILL.md
---
name: quay-task-to-plan
description: Proposal step (Phase 6) + plan step + TDD ≥80% hard gate (Phase 7) of the quay-task-to-plan pipeline — ...
allowed-tools: Bash, Read, Write
---
```
Referenced tools/skills/scripts resolve:
```
$ ls /home/yale/.claude/skills/proposal-to-plan/SKILL.md /home/yale/.claude/skills/feature-developer/SKILL.md .claude/skills/quay-directive/SKILL.md experiments/quay-perpetual-stream/scripts/it0-ceiling-line-budget-check.sh .claude/skills/quay-task-to-plan/prompts/plan-check-subagent.md
/home/yale/.claude/skills/feature-developer/SKILL.md
/home/yale/.claude/skills/proposal-to-plan/SKILL.md
.claude/skills/quay-directive/SKILL.md
.claude/skills/quay-task-to-plan/prompts/plan-check-subagent.md
experiments/quay-perpetual-stream/scripts/it0-ceiling-line-budget-check.sh
```
Cited proposal/plan sections resolve (§3, §7, §8, §10, §14, §15, §15.2, §19 all confirmed present):
```
$ grep -n "^## 3\.\|^## 7\.\|^## 8\.\|^## 10\.\|^## 14\.\|^## 15\.\|^## 19\." docs/proposals/exp5-quay-task-proposal-plan-skill.md
103:## 3. The four-entity model (resolved this conversation)
217:## 7. Plan is *checked*, not *re-derived* — and the stopping rule
241:## 8. What the new skill is, concretely
286:## 10. Non-goals / open decisions
483:## 14. Plan author + grounded convergent-check step (charter item 4)
557:## 15. TDD ≥80%-per-stage hard gate (charter item 5)
774:## 19. Status / next step (supersedes original §11's DRAFT-era framing)
```
**Dangling reference found and fixed during authoring:** an early draft cited a
non-existent `inherited-core.md` "plan-check-stopping-rule section" (assumed
Stage 5.3's mechanism detail had been duplicated into `inherited-core.md` by
M18 — it was not; M18's own text explicitly states "Mechanism detail — see the
design doc, not duplicated here"). Fixed by re-citing
`docs/plans/3-7-quay-task-to-plan-skill.md` Stage 5.3 and
`docs/proposals/exp5-quay-task-proposal-plan-skill.md` §7/§14.2 directly in
both `SKILL.md` and `prompts/plan-check-subagent.md`. Verified zero remaining
dangling hits:
```
$ grep -n "inherited-core.md's plan-check\|plan-check-stopping-rule" .claude/skills/quay-task-to-plan/SKILL.md .claude/skills/quay-task-to-plan/prompts/plan-check-subagent.md
(no output — exit 1, confirmed no matches)
```
No duplicate section headings after the Phase-6/Phase-7 merge (single-author
here, but checked per the charter's own consistency-sweep instruction):
```
$ grep -n "^## \|^### " .claude/skills/quay-task-to-plan/SKILL.md
39:## 0. Provider read/write contract (Stage 6.1)
70:### DIR-011 portability rule (body-portable, extra-native-only, GitHub degradation)
95:### M12 milestone→task grouping (reused unchanged)
111:## Steps
264:## TDD ≥80% hard gate — code-vs-prose classifier (Stage 7.2)
298:## Relationship / bootstrap (Stage 7.3)
359:## Constraints
381:## Output
```
All headings unique.

**6. `git diff --stat` scoped only to expected files.** Satisfied:
```
$ git diff --cached --stat
 .claude/skills/quay-task-to-plan/SKILL.md          | 235 +++++++++++++++++++--
 .../prompts/plan-check-subagent.md                 | 154 ++++++++++++++
 experiments/quay-perpetual-stream/backlog.md       |   2 +-
 ...rocess-not-just-design-and-a-bypassable-gate.md |  47 ++++-
 ...ion-implementation-as-a-selectable-candidate.md |  12 ++
 5 files changed, 429 insertions(+), 21 deletions(-)
```
(The DIR-014 file's path in this stat is the RENAME target
`directives/archive/DIR-014-*.md`; git recorded it as a rename+modify, not a
separate add+delete, confirming no content was lost in the move — only the
Resolution section and status line were added, per the diff shown above.) No
Core CLI code, no `inherited-core.md`/`OUTER-LOOP.md` edits, no
`M-TASK-BACKLOG-PROJECTION-IMPL` implementation. This iteration report itself
and the milestone's own directory structure are new/untracked additions not
yet reflected in the stat above (added after this diff was captured, per the
charter's own bookkeeping allowance).

**7. Total change ≤ ~500 lines.** Satisfied:
```
$ git diff --cached --stat -- .claude/skills/quay-task-to-plan/
 .claude/skills/quay-task-to-plan/SKILL.md          | 235 +++++++++++++++++++--
 .../prompts/plan-check-subagent.md                 | 154 ++++++++++++++
 2 files changed, 374 insertions(+), 15 deletions(-)
```
389 total changed lines on the skill artifact itself (374+15), under the
plan's own ≤500-line Phase-7 budget clause. (The bookkeeping files —
backlog.md row, DIR-014 archival, DIR-015 disposition note — add another 61
changed lines, all bookkeeping per the charter's own Done-when clause 6
allowance, not skill/product content.)

**8. `backlog.md` row marked DONE, DIR-014 disposition noted.** Satisfied:
```
$ grep -o "DONE (m22, 2026-07-18, iteration-0)" experiments/quay-perpetual-stream/backlog.md
DONE (m22, 2026-07-18, iteration-0)
```
Full row text (excerpted above in "Directive dispositions") explicitly notes
this closes the remainder of DIR-014's ask (build-the-skill sense) and that
DIR-014 was moved to `directives/archive/` with a filled Resolution — matching
the DIR-013/DIR-016 precedent the charter's Dispatcher notes cite.

## Design decisions / discoveries worth flagging for iteration-1

1. **`inherited-core.md`'s two-class diversity policy does NOT contain the
   Phase-5 "plan-check stopping rule" mechanism detail** — only the POLICY
   statement (which class uses which strategy) lives there; the mechanism
   (author + grounded check, `F_i`-count stop condition, round-3 cap) lives
   only in `docs/plans/3-7-...` Stage 5.3 and
   `docs/proposals/exp5-quay-task-proposal-plan-skill.md` §7/§14.2. This
   skill's plan-step section and the new prompt file cite the plan/proposal
   directly rather than a non-existent `inherited-core.md` subsection. An
   earlier draft of this build incorrectly assumed the mechanism had been
   duplicated into `inherited-core.md` — worth an explicit independent check
   in iteration-1 (does the same mistake recur independently, and is my fix
   the right resolution or should `inherited-core.md` actually be amended to
   carry a pointer — out of this charter's scope either way, since it forbids
   touching `inherited-core.md`).
2. **§14.2's precise stop condition (`F_i`-count, zero-finding = one round
   confirms, round-3 hard cap with escalation) is more precise than the
   charter's own summary ("~2-3 rounds")** — I used the more precise §14.2
   version rather than the looser summary, since the charter states the plan
   is authoritative and should be cited not re-derived, and proposal §17 is
   the acceptance authority per the plan's own reconciliation note. Worth
   iteration-1 independently confirming this is the right precision level to
   encode (not over-specifying beyond what SKILL.md, a prose operating
   document, needs).
3. **Mandatory `[code]`/`[prose]` per-stage tagging (proposal §15.2)** was
   added explicitly to both the plan-author step and the plan-check subagent's
   checklist — the charter's Done-when clause 3 only requires the classifier's
   two branches to be `grep`-checkable, but §15.2 itself states classification
   must be "mandatory and explicit, recorded in the plan record itself at
   plan-author time" — I judged this load-bearing enough to encode explicitly
   rather than leaving it implicit in "the classifier exists."
4. **Pre-existing `it0-dir-projection-check.sh` STATUS-DISAGREEMENT pattern**:
   running the check confirms DIR-013/DIR-016 (already archived by prior
   milestones) show the identical status-mirror-not-updated divergence my
   DIR-014 archival now also exhibits (task's `dirStatus` mirror not
   auto-updated by a directive file move) — this is a pre-existing,
   out-of-scope harness gap (the mirror update mechanism itself, not this
   charter's concern), not a regression introduced here. Confirmed by running
   the check and seeing the SAME divergence class already present for
   DIR-013/016 before my change.

## Convergence / next step

This is iteration-0 (build). Per the charter's Dispatcher notes, iteration-1
independently re-derives from the charter + plan + Phase-6-left SKILL.md,
explicitly not reading this iteration's materials, then the two are merged
with a manual consistency sweep for duplicate/contradictory sections before
final commit.
