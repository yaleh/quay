# DIR-017

- **status:** pending
- **created_by:** human (Yale), asserted directly in this live conversation
- **created_at:** 2026-07-16
- **title:** Require a deliberate, scoped manda nested-subagent verification trial during an iteration — not passive "prefer it if an organic occasion arises"

## Finding

DIR-015 action 4 (applied at iteration 70) added §0b to
`experiment/ITERATION-PROMPTS.md`: development/testing operations that
need a subagent to borrow a capability not natively available "should
prefer the manda nested-subagent mechanism... where it can be shown to
work reliably." As written, this guidance is entirely **conditional on an
organic occasion arising** — it only activates if some iteration's own
task happens to need capability-borrowing. Iteration 71 is direct
evidence of how weak that trigger is in practice: its own report states
plainly that its work (adding a canonical exclusion-set section to
`provenance.md`) was "plain in-session documentation editing" with
nothing in its shape for §0b to apply to — the same is true of most of
this experiment's recent iterations (65, 67, 68, 70 were also
protocol/directive-maintenance work, per iteration 71's own §1 citation).
Left this way, §0b can go indefinitely without ever being exercised,
simply because the live backlog's shape rarely produces a task that
organically needs it — which is a fact about the backlog, not evidence
about the mechanism's reliability one way or the other.

This conversation separately observed iteration 71 itself miss a
directive (DIR-016) that was mechanically present in `pending/`
throughout its run, only caught by its own independent audit (now
recorded as the 15th post-hoc correction, per `experiment/directives/
pending/DIR-016-*.md`'s own appended "Progress note"). That is a distinct
failure from this one, but it reinforces the same underlying lesson this
directive is about: **passive/conditional triggers in this experiment's
protocol have a demonstrated tendency to silently produce zero action**
(the same shape as `reusability`/`completeness`/`validation` sitting flat
for 40-60+ consecutive iterations, and as DIR-011/DIR-012 action 2/DIR-015
sitting deferred because they depended on someone else acting). A
"prefer X where an organic occasion arises" clause is exactly this shape
of passive trigger, applied now to an infrastructure question — whether
the manda nested-subagent mechanism can ever actually be shown to work —
that the human considers worth resolving affirmatively, not by waiting.

This experiment already has a clean, legitimate precedent for exactly
this kind of deliberate, bounded, diagnostic-only trial that makes no
V-factor claim: iteration 14's minimal "reply PONG" sanity check, and
DIR-014 action 3's two bounded (150s/60s) re-test attempts at iteration
68 — both explicitly scoped as infrastructure verification, not
feature/credit work, and both recorded plainly regardless of outcome.

## Requested action

1. Amend `experiment/ITERATION-PROMPTS.md` §0b to add a **time-bounded
   affirmative obligation**, not just a conditional preference: if no
   iteration has recorded a live-verified manda nested-subagent trial
   (success or failure) for **N consecutive iterations** since DIR-015
   was applied (suggest N=3, i.e. by iteration 73 at the latest, since
   iterations 70-72 span DIR-015's application through the present), the
   next iteration must construct and run a minimal, low-stakes
   development/testing operation for the sole purpose of exercising the
   manda nested-subagent mechanism end-to-end — modeled directly on
   iteration 14's PONG check / DIR-014 action 3's bounded re-test, not
   invented ad hoc — under the current, corrected preconditions (§0a
   non-blocking dispatch confirmed; a live monitor per G6; and, per this
   conversation's own prior analysis, ideally an actively-watching
   responder loop on the broker side, not merely a bound monitor process
   — note whether one exists or not as part of the trial's own record,
   since its absence would itself explain a further failure without
   reopening any settled question).
2. The trial must be explicitly labeled infrastructure/diagnostic work,
   claim **no V_instance or V_meta factor movement** regardless of
   outcome (mirroring iteration 68's own explicit statement to that
   effect), and record the result plainly either way — a further failure
   is data, not a reason to suppress or delay reporting it, per §0b's own
   existing "record failures plainly" caveat.
3. This does not change DIR-015 action 3's settled scope (manda remains
   permanently out of bounds for G3 audit dispatch) — this directive is
   about generating an actual, current data point for the dev/test
   application §0b already opened up, not about reopening the audit
   question.
4. If, once applied, the trial succeeds and is later independently
   reproduced (per this conversation's own prior guidance: do not
   generalize from a single success, consistent with this experiment's
   own standing evidence discipline), that would be a candidate finding
   for later extraction into the general BAIME methodology-bootstrapping
   framework — noted here for continuity, not as an action this
   directive itself requires.

## Resolution

<!-- Filled in by whichever iteration applies this directive. -->

## Progress note (added 2026-07-16, iteration 72)

Read in full this iteration. **Deferred, not applied** — iteration 72's
assigned scope was narrowly "apply DIR-016" (extend DIR-015's
non-blocking-dispatch requirement to the G3 audit subagent); applying
DIR-017 in the same iteration (a separate §0b amendment plus, per its own
N=3 window, an eventual bounded manda nested-subagent trial) would violate
this experiment's standing one-action-one-proof discipline and risks
leaving DIR-016 itself only partially applied. This is iteration 72; DIR-017's own
suggested deadline is "by iteration 73 at the latest" — this deferral does
not yet exceed that window, but the very next iteration (73) is the
deadline itself and must explicitly apply DIR-017 or explicitly extend/
reject its window with reasoning, not silently let it lapse. Still
`status: pending`. No V-factor movement is implied by this deferral.
