# M23-outer-driver-isolation — iteration-0 report

Charter: `experiments/quay-perpetual-stream/charters/M23-outer-driver-isolation.md`
Worktree: `milestones/M23-outer-driver-isolation/worktrees/iteration-0`, branch `exp5-m23-iteration-0`

## HARD GATES — literal command output

### `ls -1 experiments/quay-perpetual-stream/directives/pending/` (as observed at DRAIN, before this iteration's own archival work)
```
DIR-015-materialize-the-m-task-backlog-projection-implementation-as-a-selectable-candidate.md
DIR-017-dod-installation-program-mandatory-order-and-the-meta-enforcer-human-verified-foothold.md
DIR-018-isolate-the-autonomous-driver-from-human-steering-own-worktree-deliberate-merge.md
```

**Disposition of each:**
- **DIR-018** — APPLIED. This IS what M23 builds toward (per the dispatch prompt's explicit
  instruction). Full Resolution section filled in and the file moved
  `directives/pending/` → `directives/archive/DIR-018-*.md`. See "DIR-018 archival" section below
  for the Resolution text.
- **DIR-015** — DEFERRED, out of scope for M23. Reason: M23's charter is purely the DIR-018
  git-topology/process fix; it performs no work toward DIR-015 item 2
  (charter/dispatch `M-TASK-BACKLOG-PROJECTION-IMPL`'s own implementation). A disposition note was
  appended to `directives/pending/DIR-015-*.md` (file stays in `pending/`, `status:` unchanged);
  see the note's text below.
- **DIR-017** — DEFERRED, out of scope for M23. Reason: the charter's explicit non-goals state
  "Do not touch DIR-017's scope (the Definition-of-Done meta-enforcer) — that is a separate,
  larger, human-verification-gated program; this milestone is purely the git-topology/process fix
  DIR-018 names, independent of DIR-017's own ordering." A disposition note was appended to
  `directives/pending/DIR-017-*.md` (file stays in `pending/`, `status:` unchanged).

### `git worktree list` (post-work, this iteration's own worktree)
```
/home/yale/work/quay/experiments/quay-perpetual-stream/milestones/M23-outer-driver-isolation/worktrees/iteration-0  e3602c6 [exp5-m23-iteration-0]
/home/yale/work/quay/experiments/quay-perpetual-stream/milestones/M23-outer-driver-isolation/worktrees/iteration-1  e3602c6 [exp5-m23-iteration-1]
```
Both M23 worktrees are branched from commit `e3602c6`, which is the current HEAD of
`exp5-outer-driver` (confirmed below) — NOT `master` HEAD directly. This is the dogfooded proof
in-scope item 5 requires.

### `git log --oneline exp5-outer-driver -3`
```
e3602c6 exp5 SELECT m23: charter M23-outer-driver-isolation (DIR-018)
477e7a6 exp5 ABSORB m22: quay-task-to-plan skill Phase 7 landed, milestone_counter 21→22
372ef2a Merge exp5-m22-iteration-0 into master: M22 quay-task-to-plan skill Phase 7 (iteration-0 kept for skill files)
```
`e3602c6` is both `exp5-outer-driver` HEAD and this iteration's worktree base commit — branch
ancestry confirmed: `exp5-m23-iteration-0` traces to `exp5-outer-driver`, not to `master` directly
(at the m22→m23 boundary `master` and `exp5-outer-driver` happened to be at the same commit,
`e3602c6`, since `exp5-outer-driver` was freshly cut from `master` HEAD for this exact milestone —
see in-scope item 1 below for why that is the correct, intended starting state, not a coincidence
that undermines the isolation claim).

## Line-budget / gate-hash checks (run before dispatch, re-confirmed this iteration)

```
$ bash experiments/quay-perpetual-stream/scripts/it0-ceiling-line-budget-check.sh experiments/quay-perpetual-stream/charters/M23-outer-driver-isolation.md
PASS: experiments/quay-perpetual-stream/charters/M23-outer-driver-isolation.md — scope within the small-milestone norm (no declared line budget > 2000, in-scope item count at or under threshold 8). No phase/stage plan required.
EXIT: 0

$ bash experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh --by-reference experiments/quay-perpetual-stream/charters/M23-outer-driver-isolation.md
PASS: experiments/quay-perpetual-stream/charters/M23-outer-driver-isolation.md GATE-HASH-REF (5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93) matches current pinned source (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131) sha256.
EXIT: 0
```

## Work performed (in-scope items 1-5)

1. **Driver branch.** `exp5-outer-driver` already existed, created from `master` HEAD at the
   m22→m23 boundary (`e3602c6`) — confirmed by `git log --oneline exp5-outer-driver -3` above
   showing `e3602c6` as HEAD, and `git worktree list` (full repo view, not pasted in full here for
   brevity) showing `exp5-outer-driver` at `e3602c6`. This iteration did not need to create the
   branch (already present per the dispatcher's prior setup); this iteration's own work is items
   2-5.

2. **`OUTER-LOOP.md` step 0 (DRAIN) — master→driver merge sub-step.** Added immediately after the
   existing `it0-dir-projection-check.sh` reconcile paragraph, before step 1 (SELECT):

```
**Master → driver merge sub-step (DIR-018 / M23-outer-driver-isolation, isolation discipline —
runs BEFORE SELECT, as part of DRAIN):** the OUTER loop's own commit stream (charter authoring,
per-iteration worktree base points, inner-merge conflict resolution) lives on the dedicated
branch `exp5-outer-driver`, never directly on human-shared `master`. At this DRAIN step, before
SELECT, deliberately fast-forward/merge `master` → `exp5-outer-driver`:
`git checkout exp5-outer-driver && git merge master` (or fast-forward if `master` is a strict
ancestor). This is the ONLY point at which human commits made directly to `master` (via
`/quay-directive`, manual edits, or any other human-authored commit) enter the driver's own
history — human steering merges in deliberately, at this named boundary, never by racing the
loop for the same `master` mid-milestone.
```

3. **`OUTER-LOOP.md` step 6/7 (ABSORB) — driver→master publish sub-step.** Added as a new bullet
   inside step 6, positioned AFTER the adversarial-audit gate, V_meta consolidation-lag gate, and
   design-only-milestone impl-row gate (all three existing HARD BLOCKs), and BEFORE step 7's
   `milestone_counter++` line (which was also edited to reference this new sub-step):

```
- **Driver → master publish sub-step (DIR-018 / M23-outer-driver-isolation, HARD sequencing —
  runs AFTER the adversarial-audit gate, V_meta consolidation-lag gate, and design-only-
  milestone impl-row gate above all clear, and BEFORE step 7's `milestone_counter++`):** this is
  the ONLY point at which the loop's own work (charter drafts, iteration worktrees/branches,
  inner-merge conflict resolution — all of which happened upstream on `exp5-outer-driver`) lands
  on `master`. Publish via a single, atomic, deliberate merge:
  `git checkout master && git merge --no-ff exp5-outer-driver` — exactly one `--no-ff` merge
  commit per milestone boundary, never a sequence of individual milestone commits interleaved
  directly onto `master`. [...]
```
   Full text in the diff (see `git diff e3602c6 -- experiments/quay-perpetual-stream/OUTER-LOOP.md`).
   Step 7's own line was edited from "...design-only-milestone impl-row gate above clear)." to
   "...design-only-milestone impl-row gate above clear, AND the driver→master publish sub-step
   above has landed the milestone's work on `master`)." — making the publish a hard prerequisite of
   the counter increment, matching the other two HARD BLOCKs' placement/shape.

4. **No-silent-drop reconciliation-note requirement — written explicitly.** Added as its own bolded
   paragraph directly under item 2's master→driver text (applies to BOTH directions by cross-
   reference):

```
**No-silent-drop reconciliation-note requirement (standing instruction, applies to BOTH merge
directions below — DIR-018 item 3):** any conflict encountered during this master→driver merge
(or the driver→master publish merge at step 6/7 below) MUST be resolved **per-file**, reading
both sides' actual content — **never** a blanket `git checkout --ours` / `git checkout --theirs`
applied wholesale without reading both sides (this is the exact DIR-013 failure this rule exists
to prevent [...]). For every file with a real conflict, record a short **reconciliation
note** in this DRAIN step's log entry (or the ABSORB log entry, for the driver→master direction)
stating: which file, what each side contained, which content was kept/merged and why. A missing
or blank reconciliation note is not a valid resolution of a conflict [...] This is a documented
convention, not a new script or pre-commit hook (per DIR-018's own "keep it minimal, not a heavy
process" request) [...]
```
   The driver→master publish bullet (item 3, step 6) cross-references this same requirement rather
   than duplicating the text, to keep `OUTER-LOOP.md` from ballooning.

   Also amended step 5 (DISPATCH INNER) so per-iteration worktrees are documented as created off
   `exp5-outer-driver` HEAD rather than `master` HEAD — the mechanism this milestone dogfoods on
   itself (see Done-when 5 below).

   Explicitly did NOT touch `inherited-core.md`, did NOT build DIR-017 work, did NOT add any
   automated enforcement hook/script — all three are the charter's stated non-goals.

5. **Dogfood on this milestone itself.** Both `exp5-m23-iteration-0` and `exp5-m23-iteration-1`
   worktrees were pre-created (by the dispatcher, before this iteration began) off `exp5-outer-
   driver` HEAD (`e3602c6`), not `master` HEAD directly — confirmed by the `git worktree list` /
   `git log --oneline exp5-outer-driver -3` pasted above. This iteration's own charter/edit work
   happened entirely inside that worktree, on branch `exp5-m23-iteration-0`. The final
   `exp5-outer-driver` → `master` publish merge is explicitly NOT performed by this iteration (per
   the dispatch instructions) — it is the orchestrator's job after both M23 iterations are merged
   into `exp5-outer-driver`. The merge sequence this iteration documents/will look like, once the
   orchestrator performs it:
```
git checkout exp5-outer-driver
git merge exp5-m23-iteration-0    # (+ exp5-m23-iteration-1, per-file reconciliation if conflicting)
git checkout master
git merge --no-ff exp5-outer-driver
```

## DIR-018 archival — Resolution section (full text, also present in the archived file)

Moved `directives/pending/DIR-018-*.md` → `directives/archive/DIR-018-*.md`, `status:` line
changed `pending` → `applied`, and the following `## Resolution` section filled in (verbatim, see
the archived file for the canonical copy):

- resolved_by: M23-outer-driver-isolation, iteration-0, 2026-07-18
- outcome: applied — all 4 Requested-action items done, dogfooded on this milestone itself
- evidence: item-by-item mapping of DIR-018's 4 Requested-action items to the `OUTER-LOOP.md`
  step 0 / step 5 / step 6-7 amendments above, the dogfooded-proof worktree evidence, and an
  explicit note that no new script/hook was built (item 4, minimal-process request honored). Full
  text in `directives/archive/DIR-018-isolate-the-autonomous-driver-from-human-steering-own-worktree-deliberate-merge.md`.

## backlog.md — new row

Appended a new `## DIR-018-sourced candidate (2026-07-18, SELECTED for m23)` section with a single
`M-OUTER-DRIVER-ISOLATION` row, marked `**DONE (m23, 2026-07-18, iteration-0)**`, in the same
table-row style/tone as the existing DONE rows (e.g. `M-IMPL-ROW-ENFORCEMENT`, `M-VMETA-GATE`) —
full evidence recap (branch creation, both `OUTER-LOOP.md` sub-steps, dogfooded worktree proof,
DIR archival/disposition, `git diff --stat` scope) inlined in the row's notes column per the
established convention.

## Done-when clause mapping (8 clauses)

- [x] 1. `exp5-outer-driver` exists, created from `master` HEAD at the m22→m23 boundary — see
   `git log --oneline exp5-outer-driver -3` above: HEAD `e3602c6` is the exact m22→m23 SELECT
   commit; `git branch -v` (full repo view) shows `exp5-outer-driver e3602c6 [exp5 SELECT m23: ...]`.
```
$ git log --oneline exp5-outer-driver -1
e3602c6 exp5 SELECT m23: charter M23-outer-driver-isolation (DIR-018)
```
- [x] 2. `OUTER-LOOP.md` step 0 (DRAIN) gained the master→driver merge sub-step + reconciliation
   requirement — pasted verbatim above (in-scope items 2/4).
```
$ grep -n "Master → driver merge sub-step" experiments/quay-perpetual-stream/OUTER-LOOP.md
46:   **Master → driver merge sub-step (DIR-018 / M23-outer-driver-isolation, isolation discipline —
```
- [x] 3. `OUTER-LOOP.md` step 6/7 gained the driver→master publish sub-step — pasted verbatim
   above (in-scope item 3).
```
$ grep -n "Driver → master publish sub-step" experiments/quay-perpetual-stream/OUTER-LOOP.md
220:   - **Driver → master publish sub-step (DIR-018 / M23-outer-driver-isolation, HARD sequencing —
```
- [x] 4. No-silent-drop reconciliation-note requirement written as a standing instruction — pasted
   verbatim above (in-scope item 4), applies to both directions by explicit cross-reference.
```
$ grep -n "No-silent-drop reconciliation-note requirement" experiments/quay-perpetual-stream/OUTER-LOOP.md
56:   **No-silent-drop reconciliation-note requirement (standing instruction, applies to BOTH merge
```
- [x] 5. M23's own two iteration worktrees created off `exp5-outer-driver` (not `master`) — `git
   worktree list` pasted above, both at `e3602c6` = `exp5-outer-driver` HEAD.
```
$ git worktree list | grep -i m23
.../M23-outer-driver-isolation/worktrees/iteration-0  e3602c6 [exp5-m23-iteration-0]
.../M23-outer-driver-isolation/worktrees/iteration-1  e3602c6 [exp5-m23-iteration-1]
```
- [~] 6. ABSORB landing on `master` via exactly one `git merge --no-ff exp5-outer-driver` — NOT yet
   performed by this iteration (correctly deferred to the orchestrator per the dispatch
   instructions, after both M23 iterations are merged into the driver branch). The mechanism and
   exact command sequence are fully specified in `OUTER-LOOP.md` step 6/7 (clause 3 above) and in
   this report's "Dogfood" section. This clause will be satisfied when the orchestrator performs
   that publish merge; it is not claimed complete by this iteration.
- [x] 7. `git diff --stat` against pre-charter base `e3602c6` shows only `OUTER-LOOP.md` +
   `backlog.md` + this milestone's own DIR-015/017/018 bookkeeping changed:
```
$ git diff --stat e3602c6
 experiments/quay-perpetual-stream/OUTER-LOOP.md    | 53 ++++++++++++++++++++--
 experiments/quay-perpetual-stream/backlog.md       |  6 +++
 .../DIR-018-...deliberate-merge.md                 | 51 +++++++++++++++++++--   (rename pending/ -> archive/)
 .../DIR-015-...selectable-candidate.md             |  8 ++++
 .../DIR-017-...human-verified-foothold.md          |  8 ++++
 5 files changed, 118 insertions(+), 8 deletions(-)
```
   No `inherited-core.md` edits, no Core CLI/skill code touched.
- [x] 8. `backlog.md` gained the `M-OUTER-DRIVER-ISOLATION` row (marked DONE at ABSORB); DIR-018
   archived with a filled `## Resolution` section, done by this dispatched iteration (not
   pre-emptively by the orchestrator) — see sections above.
```
$ grep -n "^| M-OUTER-DRIVER-ISOLATION" experiments/quay-perpetual-stream/backlog.md | cut -c1-80
| M-OUTER-DRIVER-ISOLATION | Isolate the OUTER loop's own commit stream from
$ ls experiments/quay-perpetual-stream/directives/archive/ | grep DIR-018
DIR-018-isolate-the-autonomous-driver-from-human-steering-own-worktree-deliberate-merge.md
```

## Adversarial-audit gate (evaluated per charter instruction)

Per `inherited-core.md`'s Adversarial-audit cadence rule: condition (a) requires a
capability-growth-typed milestone with nonzero realized VT Δv — this milestone is typed
risk/option + governance-integrity with Δv̂=0 by design, so condition (a) does not apply regardless
of outcome. Condition (b) requires iteration-0 (this report) to recommend skipping iteration-1 —
NOT recommended; iteration-1 should run per standard practice (independent re-derivation material:
whether the DRAIN/ABSORB sub-steps' wording actually prevents the M18-class shared-index collision
or merely relocates it, and whether Done-when clauses 5-6's dogfooded proof genuinely demonstrates
isolation rather than merely asserting it — both flagged as real re-derivation material in the
charter's own closing paragraph). Neither condition fires; this is a documented no-op per the
non-blanket cadence rule.

## Termination

Charter's in-scope work items 1-5 all complete (item 1 pre-existing from dispatcher setup, items
2-5 built this iteration); 7 of 8 Done-when clauses fully satisfied, clause 6 correctly deferred to
the orchestrator's post-merge publish step per explicit dispatch instructions (not a gap — the
charter's own dispatcher notes state "You do NOT need to actually merge to master yourself"). No
further build work identified within this iteration's scope. Converged.
