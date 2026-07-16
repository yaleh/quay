---
status: pending
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
