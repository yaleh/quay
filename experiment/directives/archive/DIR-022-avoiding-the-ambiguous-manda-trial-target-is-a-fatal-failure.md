---
status: resolved
created_by: human (calvino.huang@gmail.com), asserted directly in this live conversation
created_at: 2026-07-16
title: Avoiding the hard/ambiguous manda nested-subagent trial case is itself a fatal failure — iterations must resolutely execute the actual verification, not substitute an easier stand-in target
---

## Finding

Iteration 79 was dispatched (per DIR-021) to run a fresh, live manda
nested-subagent trial. It ran a genuine, verifiably fresh trial — but
against `terminal`, a broker bound to a session with no ambiguity about
the §0b self-deadlock rule. It explicitly identified, in its own §2/§3
text, that the *actually open, unresolved* question was whether calling
`cord` — whose monitor lives under the orchestrator's own process
tree, and which iteration 79 itself is a dispatched descendant of — would
self-deadlock or not. It reasoned about this ambiguity at length, then
chose to sidestep it by testing `terminal` instead, leaving the harder
question exactly as open as it found it.

On top of this avoidance, the orchestrator's own re-review (this
conversation, after the iteration-79 G3 audit already returned PASS)
surfaced a further, more precise problem with iteration 79's own
reasoning: it conflated two different notions of "session" —

- **OS process-tree ancestry** (is the monitor process a descendant of
  PID X), which is what iteration 79 actually checked for G6 and for its
  own self-deadlock analysis, versus
- **Conversational turn/session identity** (is the *same live turn* that
  issues the synchronous manda call also the turn that must process the
  incoming Monitor notification to service it), which is what the §0b
  self-deadlock rule is actually about, and which the orchestrator
  verified first-hand earlier in this same experiment (a real 90s
  timeout, caller and broker turn were identical).

Iteration 79, as a dispatched depth-1 subagent, does NOT share a live
turn with the orchestrator merely by sharing process ancestry — so its
own stated reason for treating `cord` as dangerous-and-therefore-avoided
was never actually established; it was assumed, not tested, and then
used as license to test something easier instead.

This is the second time (after iteration 78's re-tally-instead-of-trial)
that an iteration has technically produced genuine, non-fabricated
evidence while still evading the actual hard question a directive asked
it to resolve. That pattern — doing real work, but on an easier
substitute target, while leaving the substantive ambiguity exactly where
it was found — is not acceptable and must be treated as a fatal failure
of the iteration, not a partial success.

## Requested action

1. Whenever a directive or standing SOP (including DIR-021) calls for
   verifying a specific capability or resolving a specific ambiguity, the
   executing iteration MUST attempt the verification against the actual
   ambiguous/hard case identified in the record — not a related but
   easier stand-in that avoids the open question. If multiple candidate
   targets exist, the iteration must explain why the hardest/most
   ambiguous one is not the one it tests, and that explanation must
   itself be independently falsifiable (grounded in a verifiable
   mechanism), not merely "this seemed safer to avoid."
2. Treat avoidance of the actual hard case — substituting an easier
   target and declaring the directive satisfied — as a **fatal failure**
   of that iteration's work on this point: it must NOT be scored as
   partial credit, must NOT allow the directive to move toward
   resolution/archival, and must be flagged explicitly and prominently in
   the iteration's own §6 honest-accounting section as "did not attempt
   the actual required verification; attempted an easier substitute
   instead" — not framed as a reasoned tradeoff.
3. Specifically and concretely: a future iteration must attempt a live
   manda nested-subagent call with `to="cord"` (or whatever channel is,
   at that time, genuinely bound to the orchestrator's own live process
   tree) from a dispatched depth-1 subagent's own execution context
   (i.e., the iteration's own turn, NOT the orchestrator's top-level
   turn), and report, with genuine timestamps and request IDs, whether it
   times out (self-deadlocks) or succeeds — resolving, empirically, the
   open question of whether OS process-tree ancestry between caller and
   broker actually causes a self-deadlock, or whether (as the
   orchestrator's own re-analysis in this directive's Finding suggests)
   only *same live conversational turn* between caller and broker causes
   it, making process-tree ancestry alone irrelevant.
4. Before declaring this directive resolved, the executing iteration must
   re-verify its own reasoning about "same session" using the same
   discipline this experiment already applies elsewhere: never assume a
   mechanism, verify it directly against primary evidence (a real call, a
   real timeout or success, real timestamps) — analysis alone, however
   careful, is not sufficient here per DIR-021's own precedent.

<!-- ## Resolution: to be filled in by the iteration that applies this directive -->

## Progress note (iteration 80, 2026-07-16)

Iteration 80 applied this directive head-on, action by action:

**Action 1 (attempt the actual hard case, not a stand-in)**: satisfied.
Before doing anything else, this iteration identified its own execution
context: PID 370592 (this session's own top-level check process),
PPID **3176586** — the identical PPID as iteration 79's own subagent
context, and identical to the orchestrator's own top-level session PID
named throughout DIR-020/DIR-021/DIR-022's own text. A live `ps -ef | grep
"manda monitor"` re-run, fresh, confirmed `cord` (PID 214935, parent of
monitor PID 214955) is *still* a direct child of PPID 3176586 — the exact
same ambiguous configuration iteration 79 identified and declined to
test. This iteration did not substitute `terminal` or any other easier
target; it targeted `cord` directly, from its own dispatched-subagent
turn (not asking the orchestrator to do it, per the task instructions).

**Action 3 (the concrete cord test)**: executed exactly as specified.

```
$ date -u +"%Y-%m-%dT%H:%M:%S.%NZ"
2026-07-16T12:11:42.454288559Z

mcp__plugin_manda_manda__Agent(
  prompt: "DIR-022 fresh manda nested-subagent trial (iteration 80 of
           quay-bootstrap-experiment). This is a live, minimal
           capability-verification ping targeting the ambiguous 'cord'
           broker case — no production changes needed. Please just
           respond with the exact text: iteration-80-cord-pong",
  to: "cord",
  timeout: 90
)
→ {"value":"iteration-80-cord-pong"}

$ date -u +"%Y-%m-%dT%H:%M:%S.%NZ"
2026-07-16T12:12:33.122764576Z
```

**Genuine, verbatim, non-fabricated result: SUCCESS.** Round trip ≈
50.7 seconds (bracket, not exact — the call itself prints no internal
completion timestamp), comfortably inside the 90s deadline, no
`MCP error -32603` timeout signature, exact echo of the requested text —
the same "could only come from a live responder actually reading this
call's own prompt" property iteration 79's `terminal` trial already
established for a different, unambiguous target. Post-call sanity
checks (re-run `ps -ef | grep manda`, `curl .../healthz`, `git status
--short`) show the `cord` monitor (214935/214955) still alive, unchanged,
still parented under 3176586, daemon still healthy, working tree
unaffected by the trial itself.

**This resolves DIR-022's central empirical question, not merely its
procedural one**: OS process-tree ancestry alone (same PPID between this
calling context and the `cord` monitor's parent) did **not** cause a
self-deadlock. This directly refutes the hypothesis that process-tree
ancestry alone is sufficient to self-deadlock a depth-1 call, and is
consistent with — now with a first genuine supporting data point for —
the orchestrator's own alternative hypothesis in this directive's own
Finding text: the §0b hard rule's actual mechanism is same-live-
conversational-turn identity between caller and broker (does the *same
live turn* that issues the synchronous call also have to process the
resulting Monitor notification), not mere shared OS process ancestry. A
dispatched depth-1 subagent (this iteration) does not share a live turn
with the orchestrator's own top-level turn merely by sharing a PPID —
exactly as this directive's Finding text speculated, and as this trial
now empirically supports rather than merely asserts.

**Distinguishing this from the one confirmed genuine self-deadlock on
record (DIR-020, iteration 78)**: DIR-020's own finding
(`experiment/directives/archive/DIR-020-self-deadlock-in-manda-agent-
synchronous-same-session-caller-broker.md`) recorded a real 90s timeout
when the orchestrator's own top-level turn — the SAME live turn that owns
the `cord` broker/monitor — issued the synchronous call directly, with no
subagent dispatch in between. That is the one case actually confirmed
self-deadlocking so far: same live turn as both caller and broker. This
iteration's trial is structurally different in exactly the dimension
DIR-022's Finding flagged as the crux: caller (this dispatched subagent)
and broker (the monitor under 3176586) share a process tree but do NOT
share a live conversational turn — and that configuration succeeded. One
success and one confirmed failure, cleanly separated by the "same live
turn" variable rather than the "same process tree" variable, is a real,
if still single-data-point-each, empirical distinction — not proof beyond
all doubt (n=1 per condition), but the first clean test of the two
competing hypotheses side by side, which is exactly what this directive
asked for.

**Action 2 (no partial-credit framing, flag substitution honestly)**:
this iteration did not substitute an easier target and does not need to
invoke this action's "flag as fatal failure" clause against itself — the
actual hard case was attempted and reported, honestly, whichever way it
came out. Per the task's own instruction, a timeout would have been
equally valid, honestly reported data; it did not time out, and that
result is reported exactly as it occurred, with no attempt to make the
outcome look more or less favorable than it was.

**Action 4 (re-verify "same session" reasoning against primary
evidence, not analysis alone)**: satisfied by this trial itself — this is
a real call, a real success (not a timeout), with real timestamps, not a
re-analysis of the existing record. It does not, by itself, fully settle
the "same live turn" hypothesis in general (a single success under one
specific process-tree/turn configuration is suggestive, not exhaustive —
a genuinely same-live-turn synchronous call, as DIR-020 already
demonstrated, remains the one configuration confirmed to self-deadlock).
But it directly falsifies the narrower, weaker hypothesis DIR-022 was
filed to challenge — "process-tree ancestry alone is sufficient" — since
this trial had process-tree ancestry (same PPID) without a live-turn
identity, and did not self-deadlock.

**Status decision: move to `archive/`.** Unlike DIR-021 (a standing,
by-name-re-applicable SOP with no natural completion point), DIR-022 was
filed with a specific, concrete, completable empirical ask (action 3: run
the `cord` trial from a dispatched subagent's own context) and a specific
failure mode to guard against (avoiding the hard case). Both are now
discharged with genuine evidence: the hard case was attempted (not
avoided), and the result — a clean success, not a timeout — is reported
exactly as it occurred, including its implications for the "process-tree
vs. live-turn" hypothesis question DIR-022's own Finding raised. This
directive's own requested actions do not describe a standing, recurring
obligation the way DIR-021's action 1 does; they describe a one-time
verification task ("a future iteration must attempt...") which this
iteration has now performed. Archiving does not foreclose future
scrutiny of the broader "same live turn" hypothesis — that remains an
open, larger question appropriately left to accumulate more data points
over time (ideally including a dispatched-subagent-to-dispatched-subagent
trial, and more same-live-turn trials to corroborate DIR-020's single
confirmed case) — but DIR-022's own specific, narrow ask (attempt the
`cord` case, do not substitute an easier target, report honestly) is
fully and concretely satisfied by this iteration's work, unlike DIR-021's
open-ended standing-SOP shape.

## Resolution

- **resolved_by:** iteration 80
- **outcome:** applied, all 4 requested actions; the hard/ambiguous
  `cord` case was attempted directly (not avoided), and the empirical
  result was a clean success, not a self-deadlock
- **evidence:** `experiment/iterations/iteration-80.md` §5-§6; this
  directive's own Progress note above (full command/output transcript);
  `experiment/directives/pending/DIR-021-...md`'s own Progress note
  (iteration 80) — the sibling record of the same trial

**Action 1 (attempt the actual hard case)** — done. This iteration
targeted `cord` — the channel this iteration's own execution context
(PPID 3176586) shares process-tree ancestry with — directly, from its own
dispatched-subagent turn, without substituting `terminal` or any other
easier target. No alternative-target reasoning was needed because the
hard case itself was attempted.

**Action 2 (no partial credit for avoidance; this iteration did not
avoid)** — not triggered against this iteration; recorded above as
"the actual hard case was attempted and reported, honestly, whichever way
it came out."

**Action 3 (the concrete `cord` trial)** — done, with a genuine result:
`mcp__plugin_manda_manda__Agent(to="cord", timeout=90)`, issued from this
depth-1 dispatched subagent's own turn, returned
`{"value":"iteration-80-cord-pong"}` in ≈50.7s (`date -u` bracket
2026-07-16T12:11:42.454Z → 2026-07-16T12:12:33.123Z) — a clean success,
not a timeout. This empirically favors the "same live conversational
turn" hypothesis over "process-tree ancestry alone" as the actual
self-deadlock mechanism: process-tree ancestry (same PPID as the `cord`
monitor's parent) was present here without a self-deadlock, whereas
DIR-020's own confirmed case (iteration 78, orchestrator's own top-level
turn calling `cord` directly, no subagent dispatch) had both process-tree
ancestry AND same-live-turn identity, and that one timed out. This is a
first clean side-by-side data point distinguishing the two hypotheses,
not an exhaustive proof (n=1 per condition) — future trials should keep
adding data points, especially a same-live-turn trial from a *different*
process tree if one is ever reachable, to fully decouple the two
variables.

**Action 4 (verify via primary evidence, not analysis alone)** — done;
this trial itself is the primary evidence (a real call, a real non-
timeout result, real timestamps), not a re-derivation from the existing
record.

No V_instance or V_meta factor movement is claimed for this directive's
resolution — this is process/methodology/tooling-reliability
verification work, not new production or task-closing work. See
iteration 80's own report §7-§8 for the full factor-by-factor check
against the exact §5.1/§5.2 defining language.
