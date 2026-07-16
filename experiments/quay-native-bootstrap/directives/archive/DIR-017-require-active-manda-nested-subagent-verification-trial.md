# DIR-017

- **status:** archived (resolved iteration 73 — see Resolution below)
- **created_by:** human (Yale), asserted directly in this live conversation
- **created_at:** 2026-07-16
- **title:** Require a deliberate, scoped manda nested-subagent verification trial during an iteration — not passive "prefer it if an organic occasion arises"

## Finding

DIR-015 action 4 (applied at iteration 70) added §0b to
`experiments/quay-native-bootstrap/ITERATION-PROMPTS.md`: development/testing operations that
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
recorded as the 15th post-hoc correction, per `experiments/quay-native-bootstrap/directives/
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

1. Amend `experiments/quay-native-bootstrap/ITERATION-PROMPTS.md` §0b to add a **time-bounded
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

**resolved_by:** iteration 73
**outcome:** applied (both requested actions)

**Action 1 — §0b amendment, applied.** `experiments/quay-native-bootstrap/ITERATION-PROMPTS.md`
§0b's heading was updated to note "time-bounded trial obligation added by
DIR-017, iteration 73." A new subsection, "### Time-bounded affirmative
obligation (added by DIR-017, iteration 73)," was added after the
pre-existing "Mandatory caveats" list, stating: the N=3-consecutive-
iteration rule (iterations 70-72 elapsed since DIR-015 with zero recorded
trial, so the obligation was triggered at exactly this iteration, matching
DIR-017's own suggested "by iteration 73 at the latest" window); the
minimum content every future trial run under this obligation must include
(§0a check to the extent inspectable, G6 check via `ps`, an explicit
responder-loop-existence check, one attempt + at most one bounded retry,
no V-factor claim, plain recording of the result either way); and an
explicit "Explicitly NOT reopened by this addition" closing paragraph
mirroring DIR-016 action 3's own non-reopening precedent, reaffirming
DIR-015 action 3's permanent retirement of manda-for-G3-audit-dispatch is
untouched. See `experiments/quay-native-bootstrap/iterations/iteration-73.md` §5 ("Action 1")
for the full diff description.

**Action 2 — the bounded trial itself, applied and run live.** Dispatched
via `mcp__plugin_manda_manda__Agent`, a minimal PING/PONG-style prompt
("reply PONG"), modeled directly on iteration 14's own PONG check and
DIR-014 action 3's bounded re-tests, not invented ad hoc:
  - **Attempt 1** (90s timeout, 2026-07-16T02:41:25Z start): FAILED —
    `MCP error -32603: timeout waiting for cap "agent.spawn" result after
    1m30s: context deadline exceeded`.
  - **Attempt 2 / the one permitted bounded retry** (60s timeout,
    2026-07-16T02:43:02Z start): FAILED — identical error signature,
    `timeout waiting for cap "agent.spawn" result after 1m0s: context
    deadline exceeded`.
  - Total elapsed: ~2m42s, well within "bounded, not indefinite."
  - **Preconditions confirmed before the trial**: G6 — `manda monitor
    quay-bootstrap --root .` (PID 2621778) confirmed live and a
    descendant of the driving session's own process tree (PID 3176586),
    via direct `ps` re-verification (see `iteration-73.md` §2). §0a — not
    self-verifiable from inside the executing subagent's own context, per
    the same structural limitation iterations 69-72 already identified;
    recorded as such, not guessed.
  - **Responder-loop-existence check, performed and recorded as
    requested**: a full `ps -ef | grep -E "manda (monitor|serve)"` scan
    found only `manda monitor <name> --root .` processes (three: `cord`,
    `terminal`, `quay-bootstrap`) and `manda serve start` daemon
    processes — **no separate, actively-watching responder-loop process**
    (something that claims/answers `cap-requests-*` events, as opposed to
    a monitor that merely renders them to its own output) was found
    anywhere in the live process tree. This is consistent with, not a
    reversal of, DIR-014's own already-established finding that the
    inbound rendering adapter is stateless with "no side effects." Its
    absence alone is sufficient to fully explain both timeouts without
    reopening any settled question.
  - **Outcome recorded plainly: FAILURE, both attempts, identical error
    signature to DIR-011/012/014's own prior findings.** This is the
    third independent, live-reproduced confirmation of the same root
    cause under G6+§0a-corrected preconditions (after iteration 65's and
    iteration 68's own trials) — the mechanism's dev/test unreliability is
    now well-established, not suppressed or softened. See
    `experiments/quay-native-bootstrap/iterations/iteration-73.md` §5 ("Action 2") for the full
    transcript.

**No V_instance or V_meta factor movement is claimed for either action**,
exactly as this directive's own action 2 required — the trial's failure
is data about the mechanism's reliability, not a scoring event.

**DIR-015 action 3's settled scope is explicitly NOT reopened**: manda
nested-subagent dispatch remains permanently out of bounds for G3 audit
dispatch specifically. This directive and its trial concern the separate
dev/test capability-borrowing application (§0b) only.

**No self-audit artifact was created by this iteration** — no file with
"audit"/"adjudicate" in its name was authored or committed by the
executing session; the independent out-of-band G3 audit of this
iteration's own work is, per standing discipline, exclusively the
top-level orchestrator's separate, later, freshly-dispatched job.

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
