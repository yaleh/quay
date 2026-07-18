# DIR-002

- status: applied (M05-dir-projection stability-confirmed iteration-1, 2026-07-18) — see resolution note below
- created_by: human (Yale Huang), asserted directly in this live conversation
- created_at: 2026-07-18
- title: Directives-as-quay-tasks — the requirement stands; restore the restrained file-canonical + task-projection design (exp4 DIR-006's Option-B rollback was a transition failure rationalized as a decision)

## Finding

The original requirement (human, exp4 dev conversation, 2026-07-17) was NOT
"tasks replace files". It was **restrained dogfooding**: steering directives
should also appear in quay's own task board alongside dev tasks, visible and
filterable, via the self-hosted task mechanism. The restrained form was
explicitly agreed: `/quay-directive` writes the `DIR-NNN.md` file AND calls
`task_write` to create a `label: directive` task whose body is a thin
**projection** (link to the DIR file + Finding summary + status mirror);
iterations already read `directives/pending/`, extended with a `task_list
--label directive` read; Web UI needs zero code (`?label=directive` already
works, QW-005). File stays canonical; the task is a generated projection, so
there is a single source of truth and no drift.

exp4's DIR-006 execution failed as a textbook **transition failure**, then
rationalized the failure as a decision (evidence in DIR-006's own record,
`experiments/quay-continuous-bootstrap/directives/archive/DIR-006-*.md`):
1. **it11** did the destructive half (created DIR-004/005 tasks, DELETED the
   files, making tasks authoritative) — inverting "projection" into
   "replacement".
2. **it11** deferred and never did the enabling half — original requested-action
   item 3, updating the `quay-directive` skill to emit tasks. The tooling kept
   producing files.
3. So **it12-14** every new directive (DIR-007/008/009) came back as a file →
   both mechanisms live at once = the dual-representation the requirement
   explicitly forbade (the human cited `manda`/`epicd` drift as the cautionary
   case; the botched execution reproduced exactly that drift).
4. **it15** "resolved" by rolling back to files-only, citing "the task mechanism
   was never adopted" — but non-adoption was *caused by* the skipped tooling
   step (2), not by any defect in the design. it15 correctly diagnosed the root
   cause ("an invariant with no mechanical enforcement is what failed here") yet
   built no enforcement and instead discarded the actual goal (board visibility /
   dogfooding) entirely.

Net: the requirement was never met and has not changed. exp5 currently inherits
the files-only end-state (its `/quay-directive` writes files only; exp5
`directives/` has no task projection), so the goal is still open here.

## Disposition note (outer-loop drain, m4, 2026-07-18)

DEFERRED, not applied or rejected: drained mid-M04-discover (iteration-0 just landed with a
significant real finding, MD-001 merge-drift, and iteration-1 stability-confirmation is already
queued — pulling the milestone to pivot now would waste that in-flight work, unlike DIR-001 which
arrived before any inner iteration had run). This directive's own requested action is itself a
full standalone explore/methodology-infra milestone (`M-DIR-PROJECTION`) — sized exactly like
M-GATES/M-ABI-EVAL, not a quick fold-in. Added to `backlog.md` as a charter-ready candidate,
top priority for m5 SELECT (ahead of `M-GH-WRITE`/`M-GH-PARENT`, which are real but lower-urgency
per-provider fixes, not a repeated governance-drift risk). See `backlog.md`'s DIR-002-sourced row
and `dashboard.md`'s m4 log for the SELECT-time reasoning.

## Requested action

Open an exp5 **explore, methodology-infrastructure** milestone (suggested id
`M-DIR-PROJECTION`) that restores the restrained design and — this time —
completes the enabling half with mechanical enforcement. Do NOT re-run it11's
file→task cutover-and-delete.

Scope:
1. **Keep files canonical** (git-colocated, PR-reviewable, no running server —
   these strengths, correctly noted by it15, are retained).
2. **Complete the enabling half**: update the `/quay-directive` skill so that,
   in addition to writing `DIR-NNN.md`, it creates/refreshes a `label: directive`
   quay task whose body is a generated projection (DIR file link + Finding
   summary + status mirror). The projection is generated, never hand-authored, so
   no second authoritative copy exists.
3. **Iteration/loop read path**: the outer-loop inbox drain (OUTER-LOOP.md step 0)
   additionally reads `task_list --label directive`, reconciled against the files.

Binary Done-when (mandatory, §3.4) — these double as the answer to "how do we
verify/apply this feature in the experiment mechanism":
1. `[ ]` Running `/quay-directive` once produces BOTH the file AND a
   `label: directive` task whose body links the file — pasted evidence, not prose.
2. `[ ]` Web UI `?label=directive` lists that directive alongside dev tasks —
   pasted real screenshot or `curl` transcript (dogfooding evidence-gate, per
   M-GATES — a real run, not "looks fine").
3. `[ ]` **Anti-drift reconciliation check** exists and passes: an automated check
   that FAILS if a `label: directive` task has no corresponding DIR file, or if the
   two disagree on status. This is the mechanical enforcement it15 identified as
   missing but never built — the single-source-of-truth guarantee, in tooling not
   prose.
4. `[ ]` Full existing test suite still passes (pasted raw output).

This is the same dogfooding thread as DIR-001: forcing quay's own governance onto
quay's own board makes `task_write`/label/Web-UI carry real load, exactly the hard
paths the eval loop otherwise never exercises.

## Resolution (added when moved to archive/, or updated in place if deferred)

**Progress note (M05-dir-projection iteration-0, 2026-07-18):** all four requested-action
Done-when clauses were built and demonstrated live this iteration:
1. `/quay-directive`'s SKILL.md updated (step 5) to call `task_write` after writing the file —
   confirmed live via a real DIR-003 invocation, task_get pasted in iteration-0's report.
2. Web UI `?label=directive` lists DIR-003 alongside dev tasks — real screenshot + curl transcript
   pasted in iteration-0's report.
3. Anti-drift check `experiments/quay-perpetual-stream/scripts/it0-dir-projection-check.sh` built
   and demonstrated catching BOTH failure modes (task-with-no-file, status-disagreement) with real
   PASS/FAIL output.
4. `OUTER-LOOP.md` step 0 updated to also run `task_list --label directive`, reconciled via the
   new script.
Still **status: pending** (not moved to archive/) at the end of iteration-0: per this milestone's
own charter (§ "Milestone is DONE when all five are met and stable ≥1 iteration"), the outer-loop
convention in this experiment is to confirm stability across an iteration boundary before final
archival — see iteration-0's own recommendation on whether an iteration-1 stability-confirmation
pass is warranted. If iteration-1 (or the outer-loop ABSORB step) confirms no regression, this
directive should then be marked `status: applied` and moved to `archive/` at that point, citing
this progress note plus the iteration-1 confirmation as evidence.

**Final resolution (M05-dir-projection iteration-1, 2026-07-18):** independently re-verified from a
fresh worktree (branch `exp5-m05-iteration-1`), not merely re-reading iteration-0's prose. All 6
independent re-verification checks confirmed iteration-0's claims accurate, with ONE real
correction found and fixed: the anti-drift check's live-invocation path
(`it0-dir-projection-check.sh`, no JSON-file argument) and the `OUTER-LOOP.md` wiring text both
used the CLI flag `--labels` (plural), which `packages/quay/bin/quay.js`'s `task list` silently
ignores (the real flag is `--label`, singular) — confirmed live: `--labels directive` returned all
165 tasks unfiltered, `--label directive` correctly returned 3. This bug was masked in
iteration-0's own testing because every invocation there passed a pre-fetched JSON file (bypassing
the live-CLI code path), and further masked at runtime by the `.mjs` companion's id-shape filter
(`/^DIR-\d+$/`) which happened to produce the same correct-looking result on this repo's current
data by coincidence, not by the flag actually working. Fixed in both files this iteration
(`s/--labels directive/--label directive/`), re-verified: live-path FAIL output unchanged
(DIR-004/DIR-005), full 31/31 test suite still green post-fix. All five Done-when clauses
independently re-confirmed with fresh, self-run evidence (task_get, curl, screenshot, script
FAIL/PASS x3 modes, test suite) — see `experiments/quay-perpetual-stream/milestones/
M05-dir-projection/iterations/iteration-1.md`. Milestone recommendation: DONE (stable, 2nd
consecutive clean iteration per charter §3.2 condition 1).
