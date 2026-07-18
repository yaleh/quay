# DIR-010

- status: pending
- created_by: human (Yale Huang), asserted directly in this live conversation
- created_at: 2026-07-18
- title: The M05 directive-projection mechanism has two live structural gaps — cross-experiment task-id collisions (global id space vs per-experiment DIR numbering) and reconcile-only-at-milestone-boundary — so 5 of 6 exp5 directive projections are currently drifted/wrong and nothing catches it between boundaries

## Finding

Running the M05 anti-drift check by hand this conversation
(`scripts/it0-dir-projection-check.sh experiments/quay-perpetual-stream`)
reported **5 divergences** among the existing directive projections — i.e. only
the freshly-created DIR-009 was consistent. Investigating each revealed two
distinct, structural root causes, not one stale-mirror slip:

**Gap A — cross-experiment task-id collision (global id space vs per-experiment
DIR numbering).** The `/quay-directive` skill states DIR numbering is
per-experiment ("`<EXPERIMENT>`'s own DIR-001 is unrelated to any other
experiment's DIR-001"), but the native task store's id space is flat/global.
So exp4's leftover `DIR-004`/`DIR-005` tasks (labelled `experiment-4`, bodies
about SEA release artifacts / action buttons — QX-057/QX-038 era) occupy the
ids `DIR-004`/`DIR-005`, and exp5's own DIR-004 (milestone-sizing) and DIR-005
(v-meta consolidation-lag gate) files **collide on the same task ids**. The
anti-drift check joins file↔task by bare `DIR-NNN` with no experiment
discriminator, so it matched exp4's tasks against exp5's files and reported
"no status-mirror field." The real consequence: **exp5's DIR-004 and DIR-005
were never actually projected at all** — the ids were already taken — and the
collision was invisible until the check was run manually.

**Gap B — reconcile only at milestone boundaries; out-of-vocabulary status.**
exp5's DIR-006/DIR-007/DIR-008 are correctly projected (right experiment), but
M10-audit-consolidation moved all three from `pending/` to `archive/` and set
their file `status: resolved` without regenerating the projections, so each
task's `Status mirror:` is stuck at `pending` while the file says `resolved`.
The M05 check is *designed* to fail on exactly this — and it does — but nothing
runs it between milestone boundaries: `OUTER-LOOP.md`'s drain/reconcile step
(cycle step 0) only fires at SELECT, and the loop is currently mid-M11, so the
drift has sat uncaught. Separately, `resolved` is not in the skill's documented
mirror vocabulary (`pending | applied | deferred | rejected`) — M10 wrote a
status the mechanism doesn't recognize, a second, smaller consistency gap.

Net: the M05 mechanism's *detector* works (it caught all 5), but its *coverage*
(id namespace) and its *trigger cadence* (boundary-only) are both too weak for
it to have prevented or promptly surfaced the drift. This is the enforcement-
half-never-built pattern DIR-002 warned about, recurring one level up.

## Requested action

Record this as a design consideration (no implementation required in this pass;
same routing as DIR-009 — design first). It is closely coupled to DIR-009
(same projection mechanism) and may be folded into DIR-009's design doc as a
sub-section rather than a separate deliverable, if that reads more coherently.
Cover at least:

1. **Experiment namespace for projections.** Decide how projected tasks
   disambiguate across experiments given a flat task-id space. Options to weigh:
   an experiment-prefixed task id (e.g. `exp5-DIR-004`), an `extra.experiment`
   field the check joins on in addition to `DIR-NNN`, or a per-experiment label
   the check filters by before matching. Whatever is chosen, the anti-drift
   check must stop mis-joining across experiments — the join key must include an
   experiment discriminator. Note the corollary for DIR-009's own design:
   exp5's *milestone/backlog* tasks will face the same collision risk and need
   the same namespace decision.

2. **Reconcile cadence stronger than boundary-only.** The check should run more
   often than just at SELECT — candidates: a standing check (the domain-misfit
   "standing-check ≡ audit-channel" pattern M05's own charter already invoked),
   a pre-commit/CI hook, or at every ABSORB (whichever milestone changes a DIR's
   file status is responsible for regenerating its projection *in the same
   action*, per the skill's step 5c — which M10 did not do). Make the "who
   regenerates on status change" responsibility enforced, not just documented.

3. **Mirror-status vocabulary.** Either extend the documented vocabulary to
   include `resolved` (and reconcile it with `applied`), or require file statuses
   to use only the documented set — so a milestone can't write a status the
   projection mechanism silently can't mirror.

4. **Immediate disposition of the 5 current divergences** (to be executed by the
   next outer-loop drain or the milestone that adopts this design — not
   hand-patched ad hoc now): re-project exp5's real DIR-004/DIR-005 under the
   chosen namespace, and regenerate DIR-006/DIR-007/DIR-008's mirrors to match
   their `resolved`/`applied` file status. Until then, the check will keep
   failing — which is correct (it is doing its job); do not suppress it.

## Resolution
<!-- added when moved to archive/, or updated in place if deferred:
- resolved_by: iteration-N / milestone M-NN
- outcome: applied | deferred | rejected
- evidence: pointer to the design doc / iteration report section / commit -->
