# M13-task-backlog-projection — iteration-1

**Type:** independent re-derivation (parallel to a concurrently-produced iteration-0 in a separate
worktree; per instructions, iteration-0's materials were NOT read at any point during this
iteration — this is a from-scratch derivation from the same primary sources, not a review).

**Worktree:** `experiments/quay-perpetual-stream/milestones/M13-task-backlog-projection/worktrees/iteration-1`
**Branch:** `exp5-m13-iteration-1`
**Base commit:** `c2217c99`
**Final commit:** `18af59f` ("M13 iteration-1: independently-derived task-backlog-primitive
projection design doc")

## HARD GATES (raw output, pasted)

**1. `ls -1 directives/pending/`**
```
$ ls -1 /home/yale/work/quay/experiments/quay-perpetual-stream/directives/pending/
(no output — directory is empty)
$ echo exit:$?
exit:0
```
Confirmed empty, as expected (both DIR-009 and DIR-010 are archived, not pending).

**2. manda hub addr + healthz**
```
$ cat /home/yale/work/quay/.manda/hub.addr
http://localhost:46215
$ curl -s "$(cat /home/yale/work/quay/.manda/hub.addr)/healthz"
{"root":"/home/yale/work/quay"}
```
Manda hub is running and healthy; not otherwise load-bearing for this doc-only milestone (no
manda dispatch used within this iteration itself — this report was produced by a directly
dispatched iteration-executor, not a further nested manda dispatch).

**3. `curl -s http://localhost:4173/ -o /dev/null -w "%{http_code}\n"`**
```
200
```
Quay Web UI is live and responding.

**4. Worktree/branch confirmation**
```
$ pwd
/home/yale/work/quay/experiments/quay-perpetual-stream/milestones/M13-task-backlog-projection/worktrees/iteration-1
$ git log --oneline -1
c2217c9 DRAIN (m12->m13 boundary): fix DIR-projection Gap B drift, disposition DIR-009/010/011
```
(captured before this iteration's own commit; post-commit `git log --oneline -1` is `18af59f`,
see below.)

## Sources read (in full, per dispatch instructions)

1. Charter: `experiments/quay-perpetual-stream/charters/M13-task-backlog-projection.md` (absolute
   path, read on disk).
2. `experiments/quay-perpetual-stream/inherited-core.md` (pinned Tier-B core).
3. `experiments/quay-perpetual-stream/directives/archive/DIR-009-track-exp5-work-as-quay-tasks-backlog-primitive-projection.md`
   and `DIR-010-directive-projection-drift-cross-experiment-id-collision-and-boundary-only-reconcile.md`.
4. `DIR-002-*.md` (archive), M05-dir-projection's file listing (iteration-0/iteration-1 reports,
   `it0-dir-projection-check.sh`/`.mjs` source), and
   `experiments/quay-continuous-bootstrap/gap-list.md` grepped for `QX-*` precedent (PR-005 row,
   plus the ~50 `QX-NNN` closure entries throughout the file).
5. `experiments/quay-perpetual-stream/backlog.md`'s `M-GH-WRITE` (line 40) and
   `M-ABI-PARENT-WRITE` (line 61) DONE rows, used as the two real inputs for the worked backfill
   example (§6 of the design doc); also read the `M-TASK-BACKLOG-PROJECTION` row itself (line 67)
   for its own framing/residue note.

`experiments/quay-perpetual-stream/milestones/M13-task-backlog-projection/iterations/` and
`.../worktrees/iteration-0/` were **not** read at any point (confirmed: `ls` on the milestone dir
before starting work showed only `iterations/` and `worktrees/` as empty-of-content siblings to
this iteration's own worktree; no file under either path was opened).

## Work performed

Wrote `docs/proposals/exp5-task-backlog-primitive-projection.md` (607 lines) inside the worktree,
covering DIR-009's 13 numbered items, DIR-010's 4 numbered items as a dedicated §14 sub-section,
a worked backfill example (§6), and a "Done-when clauses a future implementing milestone would
need" checklist (§15). Committed on `exp5-m13-iteration-1`.

## Charter Done-when clause mapping

**Clause 1** — doc exists, addresses all 13 DIR-009 items, with a section-by-section mapping table.
Evidence: the doc's own "Table of contents / DIR-009 item map" section (top of the file) is a
literal table: doc section → DIR-009 item(s) answered, covering items 1 through 13 with no gaps
(§1→1, §2→2, §3→3, §4→4, §5→5, §6→6, §7→7, §8→8, §9→9, §10→10, §11→11, §12→12, §13→13). Met.

**Clause 2** — DIR-010 sub-section addressing all 4 numbered items, single concrete
namespace-decision resolution (not a menu). Evidence: doc §14, with four explicitly-numbered
sub-headers ("Item 1" through "Item 4"). Item 1's resolution is stated as one sentence up front:
"**Recommended resolution: experiment-prefixed task ids for all newly-created projected/backfilled
tasks going forward**" followed by reasoning that explicitly rejects the other two DIR-010-named
options (`extra.experiment` join field, per-experiment label filter) rather than listing them as
open alternatives. Met.

**Clause 3** — canonical-direction decision explicitly confirmed or revised from DIR-009's own
tentative option (b), stated not silent. Evidence: doc §1, heading "Task as the backlog primitive —
canonical-direction decision," opens with: "**Recommendation: confirm DIR-009's own tentative
option (b)**... This is an independent re-confirmation, not a rubber-stamp" — followed by two
independent arguments (per-pass-incremental-write shape defeats a pure-projection model; `task_list`
read-path reuse advantage) not present verbatim in DIR-009's own text. Met — explicit agreement with
independent reasoning, not silence and not restatement.

**Clause 4** — worked backfill example using ≥2 real closed `backlog.md` DONE rows, actual proposed
task id/labels/body content. Evidence: doc §6 "Worked example: M09-gh-write and
M12-abi-parent-write" quotes both source rows verbatim from `backlog.md` lines 40/61, then gives
two complete task specifications (`exp5-M09`, `exp5-M12`) with concrete `id`/`title`/`labels`/
`status`/full `body` (provenance/source/value-type/outcome/status-mirror sections), each body
populated with the real DONE-column facts (coverage numbers, Δv, commit hashes) transcribed from
the source rows. Met.

**Clause 5** — "Done-when clauses a future implementing milestone would need" section, itself a
checklist. Evidence: doc §15, a 13-item `- [ ]` checklist (anti-drift check updates, backfill
execution, SELECT/ABSORB write-back wiring, regeneration script, Web UI verification, test suite,
`git diff --stat` gate). Met.

**Clause 6** — no product code / `OUTER-LOOP.md` / `inherited-core.md` / `it0-dir-projection-check.*`
touched; `git diff --stat` against pre-charter base pasted.
Evidence:
```
$ git diff --stat c2217c99 18af59f
 .../exp5-task-backlog-primitive-projection.md      | 607 +++++++++++++++++++++
 1 file changed, 607 insertions(+)
```
Only the new doc file changed (this milestone's own `iterations/` bookkeeping file — this report —
is committed separately in this same worktree's git history, not shown in the diff above since it
is added after this diff was captured; the design-doc commit itself is a single-file diff). Met.

**Clause 7** — `backlog.md`'s `M-TASK-BACKLOG-PROJECTION` row updated at ABSORB, pasted diff.
**Not applicable to this inner iteration** — per the charter's own text, `backlog.md` is updated "at
ABSORB," which is an outer-loop action taken once the milestone (across both iteration-0 and
iteration-1, and whatever reconciliation the outer loop performs between them) is judged DONE and
stable. This inner iteration is a single independent re-derivation pass, not the outer-loop ABSORB
step itself — that update is the outer loop's responsibility once it has both iterations' outputs to
reconcile. Flagged explicitly, not silently skipped.

## Independence signal (explicit, per dispatch instructions)

This section states, for the outer loop's later comparison, whether this iteration's two
judgment calls were reached by straightforward application of the source directives or required
independent extrapolation beyond what DIR-009/DIR-010 state outright.

- **Canonical-direction judgment (§1, clause 3):** **Agrees** with DIR-009's own tentative
  recommendation (option b). This agreement was **not** a default/rubber-stamp — the doc's
  reasoning (per-pass-incremental-write-volume argument, `task_list` read-path-reuse argument) was
  independently constructed during this iteration and is not a restatement of DIR-009's own
  justification (DIR-009's own justification cites items 8/9/10's write requirements as
  "incompatible with never-hand-edited projection"; this doc's §1 makes a related but distinct
  argument about M05's projection model being safe specifically because DIR-file changes are rare,
  and unsafe for backlog data specifically because SELECT/ABSORB changes are frequent — a
  frequency/write-volume argument DIR-009's text does not itself make explicit). A from-scratch
  reading of DIR-009 alone, without the M05 mechanism's actual code/skill mechanics in hand, could
  plausibly have landed on option (a) instead, reasoning that "restraint historically served M05
  well, extend it here too" — this iteration rejected that path after inspecting M05's actual
  per-DIR update frequency (rare, manual) versus backlog data's expected update frequency (every
  SELECT/ABSORB cycle), which is a genuinely independent piece of evidence-gathering, not a
  foregone conclusion from the charter text alone.
- **Namespace-decision judgment (§14 item 1, clause 2):** experiment-prefixed ids. This was **not**
  the path of least resistance among the three options DIR-010 lists — a superficially simpler
  reading might have picked the per-experiment label filter (smallest apparent diff to the existing
  `it0-dir-projection-check.mjs`, since it only adds a label-check, not an id-rename). This
  iteration explicitly reasoned through why that option is structurally weaker (an easily-forgotten
  extra join step vs. a collision made impossible by construction) before recommending the
  id-prefix approach instead, and extended the same recommendation into the backlog-task worked
  example (§6 uses `exp5-M09`/`exp5-M12`, not bare `M09`/`M12`) for full consistency across both
  halves of the design — a generalization DIR-010's own text only hints at via its final
  "corollary" sentence rather than stating outright.

Net: both of this iteration's two required judgment calls converge with the human's own tentative
steer in the source directives, but were reached via independently-constructed supporting
arguments rather than by simply repeating the directive text — the outer loop's comparison against
iteration-0 should weight this as "same conclusion, independently re-derived reasoning," not "both
iterations just copied the directive."

## Reflection

- **What was learned:** the M05 mechanism's actual code (`it0-dir-projection-check.mjs`'s
  bare-`DIR-NNN` join, `Status mirror:`/`extra.dirStatus` dual-representation) is more informative
  for this design than DIR-009/DIR-010's prose alone — several of this doc's recommendations (§4's
  mirror-image projection direction, §10's "check simply ignores unrelated fields" resolution,
  §14 item 1's rejection of the label-filter option) came from reading the actual script logic, not
  just the directive text.
- **Challenges:** DIR-009 item 2 (variable granularity) and DIR-009 item 12 (portable grouping
  representation) overlap substantially — this doc resolved the overlap by making §2 own the
  conceptual model (epic vs. milestone-grouping) and §12 own the portability constraint
  (label vs. parent/children), cross-referencing rather than duplicating.
- **Next focus (outer loop):** reconcile this iteration's output against the concurrently-produced
  iteration-0, in particular comparing the two independent namespace-decision and
  canonical-direction judgments for convergence/divergence, before ABSORB updates `backlog.md`'s
  `M-TASK-BACKLOG-PROJECTION` row (clause 7, not performed by this inner iteration).

## Artifacts

- `docs/proposals/exp5-task-backlog-primitive-projection.md` (this worktree, commit `18af59f`)
- This report: `experiments/quay-perpetual-stream/milestones/M13-task-backlog-projection/iterations/iteration-1.md`
