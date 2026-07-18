# M23-outer-driver-isolation — iteration-1 (independent re-derivation)

Worktree: `milestones/M23-outer-driver-isolation/worktrees/iteration-1`, branch
`exp5-m23-iteration-1`, based on `exp5-outer-driver`. This iteration was run BLIND to
iteration-0's report/materials, per standard BAIME independent-re-derivation practice.

## HARD GATES (pasted, not summarized)

### `ls -1 experiments/quay-perpetual-stream/directives/pending/`

```
DIR-015-materialize-the-m-task-backlog-projection-implementation-as-a-selectable-candidate.md
DIR-017-dod-installation-program-mandatory-order-and-the-meta-enforcer-human-verified-foothold.md
DIR-018-isolate-the-autonomous-driver-from-human-steering-own-worktree-deliberate-merge.md
```

**Disposition, each:**

- **DIR-018 — APPLIED.** This is what M23 builds toward. Fully archived to
  `directives/archive/DIR-018-*.md` with a filled `## Resolution` section
  (item-by-item accounting of all 4 Requested-action items — see below). Status
  header changed `pending` → `applied`.
- **DIR-015 — deferred, out of scope for M23.** M23's charter is purely the
  git-topology/process fix DIR-018 names; it does not charter or dispatch
  `M-TASK-BACKLOG-PROJECTION-IMPL` (DIR-015 item 2's ask) and does not touch the
  task-store/`it0-dir-projection-check.mjs` surface DIR-015 names. A disposition
  note was appended to the pending file (status left `pending`, unchanged) stating
  this reason explicitly, rather than silently ignoring it.
- **DIR-017 — deferred, out of scope for M23.** M23's own charter states verbatim
  in its "Explicitly OUT of scope" section: "Do not touch DIR-017's scope ... that
  is a separate, larger, human-verification-gated program." A disposition note was
  appended to the pending file (status left `pending`, unchanged) stating this
  reason explicitly.

### `git worktree list`

```
/home/yale/work/quay                                                                                                e3602c6 [master]
... (M01-M12 worktrees omitted for brevity, unrelated to M23) ...
/home/yale/work/quay/experiments/quay-perpetual-stream/milestones/M23-outer-driver-isolation/worktrees/iteration-0  e3602c6 [exp5-m23-iteration-0]
/home/yale/work/quay/experiments/quay-perpetual-stream/milestones/M23-outer-driver-isolation/worktrees/iteration-1  907ce08 [exp5-m23-iteration-1]
```

Confirms this worktree's branch (`exp5-m23-iteration-1`) traces to `exp5-outer-driver`,
not `master` directly — verified mechanically:

```
$ git merge-base --is-ancestor exp5-outer-driver exp5-m23-iteration-1 && echo YES
YES
```

### `git log --oneline exp5-outer-driver -3`

```
e3602c6 exp5 SELECT m23: charter M23-outer-driver-isolation (DIR-018)
477e7a6 exp5 ABSORB m22: quay-task-to-plan skill Phase 7 landed, milestone_counter 21→22
372ef2a Merge exp5-m22-iteration-0 into master: M22 quay-task-to-plan skill Phase 7 (iteration-0 kept for skill files)
```

`exp5-outer-driver` is a dedicated branch created from `master` HEAD at the m22→m23
charter-authoring commit `e3602c6` — it has not diverged from `master` yet (no prior
milestone has run the new DRAIN/ABSORB merge sub-steps this iteration adds), which is
expected: this milestone is what CREATES the branch and the process, so its own
dogfooded proof is the two iteration worktrees building on top of it and the eventual
single publish merge back to `master` (performed by the orchestrator after both
iterations land on the driver branch, per the charter's dispatcher notes).

## Work done

1. **Branch `exp5-outer-driver`** already existed (created by the orchestrator/
   dispatcher per the charter's dispatcher notes) from `master` HEAD `e3602c6` — this
   iteration's worktree/branch (`exp5-m23-iteration-1`) was created off it, not off
   `master`, satisfying in-scope item 5 (dogfooding).
2. **`OUTER-LOOP.md` step 0/DRAIN** gained an explicit "Driver-isolation merge
   sub-step" (run BEFORE SELECT): `git checkout exp5-outer-driver && git merge
   master`, with the per-file/no-blanket-`--ours`/`--theirs` and DRAIN-log
   reconciliation-note requirements spelled out, including the "conflict-free but
   combined content from both sides" case (the M18 lesson).
3. **`OUTER-LOOP.md` step 6/ABSORB** gained an explicit "Driver→master publish
   sub-step": exactly one `git checkout master && git merge --no-ff
   exp5-outer-driver`, sequenced AFTER the three existing HARD-BLOCK gates
   (adversarial-audit, V_meta consolidation-lag, design-only impl-row) and BEFORE
   step 7's `milestone_counter++` — the only point the loop's own work lands on
   `master`. Same no-silent-drop discipline applies to any conflict here too.
4. **No-silent-drop discipline** is written into both sub-steps' own text (not a
   separate section, not a new script) — see the diff excerpt below.
5. **`backlog.md`** gained a `M-OUTER-DRIVER-ISOLATION` row, marked DONE, in the
   same table-row style/tone as existing DONE rows (M-IMPL-ROW-ENFORCEMENT,
   M-TASK-TO-PLAN-SKILL-IMPL-PHASE7 read as reference before writing).
6. **DIR-018** archived to `directives/archive/` with a filled `## Resolution`
   section (item-by-item accounting of all 4 Requested-action items, noting item 3's
   second sentence — "the standing checks (DIR-017) should catch it" — is correctly
   NOT closed by this milestone, since DIR-017 is explicitly out of scope).
7. **DIR-015 and DIR-017** left `pending`, each given an explicit disposition note
   stating the out-of-scope reason (per the HARD GATES instruction above), not
   silently ignored.
8. **`inherited-core.md` was NOT touched.** No new script/hook was added — the
   change is pure `OUTER-LOOP.md` prose + one new git branch, per the charter's
   explicit non-goals.

## Done-when clauses — evidence

### 1. Branch `exp5-outer-driver` exists, created from `master` HEAD as of the m22→m23 boundary

```
$ git branch -v | grep outer-driver
  exp5-outer-driver          e3602c6 exp5 SELECT m23: charter M23-outer-driver-isolation (DIR-018)
$ git log --oneline -1 exp5-outer-driver
e3602c6 exp5 SELECT m23: charter M23-outer-driver-isolation (DIR-018)
```

`e3602c6` is the m22→m23 charter-authoring commit (the last commit before this
milestone's own dispatch), confirming the branch point. **MET.**

### 2. `OUTER-LOOP.md` step 0 (DRAIN) gains the master→driver merge sub-step

Excerpt (as landed, `experiments/quay-perpetual-stream/OUTER-LOOP.md`, appended to
the end of step 0):

```
   **Driver-isolation merge sub-step (M23-outer-driver-isolation, DIR-018) — run BEFORE SELECT:**
   the OUTER loop's own commit stream lives on the dedicated branch `exp5-outer-driver`, never
   directly on human-shared `master` (charter authoring, per-iteration worktree base points, and
   inner-merge conflict resolution all happen there). As part of THIS drain step, deliberately
   merge `master` → `exp5-outer-driver`: `git checkout exp5-outer-driver && git merge master`. This
   is the ONE place human commits made directly to `master` (via `/quay-directive` or manual edits)
   enter the driver's own history. **No-silent-drop discipline applies to this merge, mandatorily:**
   any conflict must be resolved **per-file**, reading BOTH sides' actual content before choosing —
   never a blanket `git checkout --ours` or `--theirs` across the whole conflict set (the DIR-013
   failure this rule exists to prevent). For each conflicted file, record a one- or two-line
   **reconciliation note in the DRAIN log** stating which side's content was kept/merged and why
   ...
```

`git diff --stat` confirms `OUTER-LOOP.md` +33/-0 lines, entirely additive to step 0
and step 6. **MET.**

### 3. `OUTER-LOOP.md` step 6/7 gains the driver→master publish sub-step

Excerpt (as landed, appended after the design-only-milestone impl-row gate, before
step 7):

```
   - **Driver→master publish sub-step (M23-outer-driver-isolation, DIR-018) — the ONLY point the
     loop's own work lands on `master`:** once ALL the gates above (adversarial-audit,
     V_meta consolidation-lag, design-only impl-row) have cleared for this milestone, publish the
     milestone's result from the driver branch to `master` as **exactly one**
     `git checkout master && git merge --no-ff exp5-outer-driver` commit — one atomic, deliberate
     publish per milestone boundary. ...
     Step 7's `milestone_counter++` and dashboard update follow this publish commit, not precede it.
```

**MET.**

### 4. No-silent-drop reconciliation-note requirement written explicitly

Both sub-steps above carry the requirement inline (not left implicit): DRAIN's
sub-step says "any conflict must be resolved **per-file** ... never a blanket `git
checkout --ours` or `--theirs` ... record a ... **reconciliation note in the DRAIN
log**"; ABSORB's sub-step says "The **same no-silent-drop discipline from step 0's
DRAIN merge applies here too** ... resolve it per-file — never a blanket
`--ours`/`--theirs` — and record a reconciliation note in this ABSORB's log entry."
**MET.**

### 5. This milestone's own two iteration worktrees created off `exp5-outer-driver`

```
$ git worktree list | grep M23
.../M23-outer-driver-isolation/worktrees/iteration-0  e3602c6 [exp5-m23-iteration-0]
.../M23-outer-driver-isolation/worktrees/iteration-1  907ce08 [exp5-m23-iteration-1]
$ git merge-base --is-ancestor exp5-outer-driver exp5-m23-iteration-1 && echo YES
YES
$ git merge-base --is-ancestor exp5-outer-driver exp5-m23-iteration-0 && echo YES
YES
```

Both worktree branches point at commits descending from `exp5-outer-driver`
(iteration-0 sits exactly at the branch point `e3602c6`; iteration-1 is one commit
ahead, `907ce08`, this iteration's own work). Neither was created off `master`
directly (they were created off the driver branch per the dispatcher notes, and
`master` at time of dispatch was also at `e3602c6` — but the *intended* parent per
the charter/dispatcher is `exp5-outer-driver`, and the branch ancestry check above
confirms that relationship holds regardless of the coincidental value equality at
this specific boundary). **MET.**

### 6. This milestone's own ABSORB demonstrated landing on `master` via exactly one `git merge --no-ff exp5-outer-driver`

Per the charter's own dispatcher notes, this is the **orchestrator's** job, performed
AFTER both iteration-0 and iteration-1 are merged into `exp5-outer-driver` first
(with per-file conflict resolution / reconciliation notes per in-scope item 4), and
only THEN merged `exp5-outer-driver` → `master` as the single ABSORB publish. This
iteration does not perform that publish itself — it documents precisely what the
merge sequence WILL look like, per the charter's own instruction ("You do NOT need to
actually merge to master yourself"):

```
# Step A (already done, orchestrator, at charter-authoring): 
git checkout -b exp5-outer-driver master   # from e3602c6

# Step B (inner-merge, orchestrator, after both iterations complete):
git checkout exp5-outer-driver
git merge --no-ff exp5-m23-iteration-0   # or iteration-1, whichever lands first
git merge --no-ff exp5-m23-iteration-1   # per-file conflict resolution + reconciliation
                                          # note per in-scope item 4 if they conflict

# Step C (the actual Done-when-6 proof, orchestrator, at ABSORB):
git checkout master
git merge --no-ff exp5-outer-driver      # exactly ONE publish commit
git log --oneline --first-parent master  # must show no interleaved loop commits
                                          # directly on master before this merge
```

This is the documented merge sequence; the orchestrator executes Step C as part of
M23's own ABSORB (governed by the newly-landed step 6/7 text itself — dogfooding the
process on the milestone that created it). **Documented per charter instruction; the
actual publish commit is the orchestrator's responsibility post-merge, not
independently re-createable by a single inner iteration without the other
iteration's work also being present on the driver branch.**

### 7. `git diff --stat` against pre-charter base `e3602c6` shows only `OUTER-LOOP.md` + this milestone's own bookkeeping changed

```
$ git diff --stat e3602c6 -- experiments/quay-perpetual-stream
 experiments/quay-perpetual-stream/OUTER-LOOP.md    | 33 ++++++++++++
 experiments/quay-perpetual-stream/backlog.md       |  1 +
 .../DIR-018-isolate-the-autonomous-driver-from-human-steering-own-worktree-deliberate-merge.md | 58 ++++++++++++++++++++--
 .../DIR-015-materialize-the-m-task-backlog-projection-implementation-as-a-selectable-candidate.md | 11 ++++
 .../DIR-017-dod-installation-program-mandatory-order-and-the-meta-enforcer-human-verified-foothold.md | 11 ++++
 5 files changed, 109 insertions(+), 5 deletions(-)
```

No `inherited-core.md` edits, no Core CLI/skill code touched. **MET.**

### 8. `backlog.md` gains an `M-OUTER-DRIVER-ISOLATION` row (DONE); DIR-018 archived with filled Resolution

`backlog.md` gained the `M-OUTER-DRIVER-ISOLATION` row (see diff above, +1 net line
— appended as a new table row after `M-TASK-TO-PLAN-SKILL-IMPL-PHASE7`), marked
**DONE (m23, 2026-07-18)** with evidence in the same style/tone as prior DONE rows.
`directives/archive/DIR-018-*.md` exists with status `applied` and a filled
`## Resolution` section (item-by-item accounting of all 4 Requested-action items).
**MET.**

## Line-budget / gate-hash checks (run before/at this iteration)

```
$ experiments/quay-perpetual-stream/scripts/it0-ceiling-line-budget-check.sh charters/M23-outer-driver-isolation.md
PASS: charters/M23-outer-driver-isolation.md — scope within the small-milestone norm
(no declared line budget > 2000, in-scope item count at or under threshold 8). No
phase/stage plan required.

$ experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh --by-reference experiments/quay-perpetual-stream/charters/M23-outer-driver-isolation.md
PASS: ... GATE-HASH-REF (5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93)
matches current pinned source (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md
lines 100-131) sha256.
```

## Adversarial-audit gate

This milestone is typed risk/option + governance-integrity, Δv̂=0 by design (no VT
chart cell, per M18/M21 precedent) — condition (a) (nonzero realized VT Δv on a
capability-growth-typed milestone) does not apply. Condition (b) (iteration-0
recommending skipping iteration-1) is not authorized and was not read (this
iteration ran blind to iteration-0's materials per the independent-re-derivation
mandate) — both iterations run regardless. Neither condition fires; this is a
documented no-op, stated explicitly here per the non-blanket cadence rule.

## Termination

Done-when clauses 1-5, 7, 8 are fully met with pasted evidence above; clause 6 is
documented per the charter's own instruction (orchestrator's responsibility,
post-merge of both iterations into the driver branch). Scope is small and bounded
(one file, one branch, bookkeeping) — no further build work remains for this
iteration. Terminating per §3.2 condition 1 (Done-when complete, real material
independently re-derived: this iteration wrote its own DRAIN/ABSORB sub-step wording,
its own backlog row, its own DIR-018 Resolution, and its own DIR-015/DIR-017
disposition notes, blind to iteration-0's version of the same).

Commit: `907ce08` on branch `exp5-m23-iteration-1`.
