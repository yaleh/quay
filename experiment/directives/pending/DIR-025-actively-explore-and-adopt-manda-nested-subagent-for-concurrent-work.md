---
status: pending
created_by: human (calvino.huang@gmail.com), asserted directly in this live conversation
created_at: 2026-07-16
title: Actively explore and adopt manda nested subagent as the primary mechanism for concurrent work — expanding beyond capability-borrowing toward concurrent task development and, eventually, concurrent iteration execution
---

## Finding

Through iterations 78-82 and this live conversation, this experiment has
built up a substantial, hard-won body of evidence about manda
nested-subagent reliability: a confirmed genuine self-deadlock mechanism
(DIR-020), a confirmed hard rule to avoid it (§0b's depth-1 rule), two
independently-audited genuine successes against structurally distinct
brokers including the previously-ambiguous same-process-tree case
(iterations 79/80), and a freshly-discovered, not-yet-fixed bug in the
broker's own spawn discipline (DIR-024). Throughout this build-up, actual
*use* of the mechanism has been deliberately kept narrow: §0b (added by
DIR-015) scopes it to "development/testing operations... that need a
subagent to invoke a tool/capability not natively available" — explicitly
NOT a general-purpose concurrency or task-execution tool, and explicitly
barred from ever becoming load-bearing for anything beyond that scope
without its own directive.

The human has now directly instructed a change of strategic direction:
this experiment should **actively explore and apply** manda nested
subagent going forward, treating bugs found along the way as expected and
fixable (not blockers to retreat from), with the explicit longer-term
goal of using this mechanism to run **concurrent iterations** and
**concurrent development of multiple quay tasks** — i.e., using manda
nested subagent as genuine *scaling* infrastructure for both the
experiment's own process and quay's own software development, not merely
as an occasionally-borrowed capability.

This is a significant scope expansion, and the reason it specifically
requires manda (rather than, e.g., the orchestrator's own native
Agent/Task tool, or the Workflow tool's native parallel()/pipeline())
is structural: a dispatched subagent (an iteration-executor, or any
leaf agent it spawns) has **no native Agent/Task tool of its own** — this
was independently reconfirmed at iteration 82. The orchestrator's own
native tools can already fan out parallel work when the orchestrator
itself is the one doing it; manda nested subagent is the only known
mechanism by which a *dispatched execution context itself* (an iteration,
or a leaf it spawns) can further fan out concurrent sub-work from within
its own turn.

## Requested action

1. **Supersede §0b's scope restriction going forward.** The "development/
   testing operations... capability-borrowing only" framing in
   `experiment/ITERATION-PROMPTS.md` §0b (added by DIR-015) is expanded:
   manda nested subagent may now be actively explored and applied for
   genuine concurrent task-execution use cases within an iteration's own
   work — not only when the iteration's task organically needs a missing
   tool. The per-use reliability discipline in §0b's caveats (cite a
   live-verified success for the specific operation at hand; record
   failures plainly) remains in full force and is NOT relaxed — expanding
   *scope of use* does not relax the *evidentiary standard* for each use.
2. **The G3 out-of-band audit boundary is explicitly NOT reopened by this
   directive.** DIR-015 action 3 / DIR-016's permanent retirement of
   manda nested-subagent for the G3 audit dispatch specifically remains
   unchanged — the audit must continue to be dispatched via the
   orchestrator's own native Agent/Task tool, unconditionally, regardless
   of how far this directive's concurrency exploration otherwise extends.
3. **Sequencing**: before attempting concurrent quay-task development or
   concurrent iterations, the next relevant iteration (or a directly
   human-instructed live trial in this conversation) must:
   a. Apply DIR-024's fix (broker-side `agent.spawn` servicing must
      actually use `run_in_background=true`) and confirm it, citing the
      actual dispatch call used — do not attempt a concurrency trial
      against a broker not yet confirmed to spawn in the background, since
      a foreground-spawning broker would silently serialize concurrent
      requests and produce a false negative about the mechanism's real
      capability (already flagged by DIR-024 action 2).
   b. ~~Run a minimal, bounded trial of 2-3 concurrent async `Dispatch`
      calls against a single confirmed-background-spawning broker,~~
      **Post-hoc correction (orchestrator, same-session, 2026-07-16):** this
      action's original text incorrectly assumed `mcp__plugin_manda_manda__Dispatch`
      is an async variant of the `Agent`/cap-request nested-subagent
      mechanism. It is not — `Dispatch`/`DispatchStatus`/`DispatchProgress`/
      `DispatchSettle` are a separate pending-task-queue protocol
      (`pending-<to>` channel, claim/settle semantics), unrelated to
      `agent.spawn`/`caps-broker.md`. The `Agent` tool itself (the actual
      nested-subagent mechanism this whole DIR chain concerns) has **no
      async mode** — it is always a blocking MCP call; `timeout<=0` means
      "wait indefinitely," not "return immediately." Corrected action: run
      a minimal, bounded trial of 2-3 `Agent()` calls issued as separate
      tool-use blocks **within a single conversational turn** (which
      Claude Code executes concurrently) — or from 2-3 distinct sessions
      each issuing one call — against a single confirmed-background-
      spawning broker, recording whether they are serviced genuinely
      concurrently (overlapping leaf-agent lifetimes) or merely
      queued-and-serial, and recording behavior at the `agent.spawn`
      depth/quota guard (MAX_DEPTH=3, MAX_SPAWN=10) under this load.
   c. Only after (a) and (b) produce genuine, recorded evidence, attempt
      an actual application: a single iteration fanning out, via manda
      nested subagent, concurrent work on 2-3 independent, non-conflicting
      quay tasks (e.g. distinct QN-* tasks touching disjoint files), then
      reconciling/merging the results within that same iteration's own
      OCA cycle and single σ/V calculation — this keeps the existing
      sequential per-iteration state model (M_{n-1}→M_n, s_{n-1}→s_n)
      intact while parallelizing the *work inside* one iteration.
   d. Treat "concurrent execution of multiple full iterations" (parallel
      OCA cycles each producing their own iteration-N.md and σ/V
      transition) as a separate, harder goal requiring its own follow-up
      directive once (c) has produced real experience — this directive
      authorizes exploring toward it but does not itself attempt to
      redesign the sequential state/provenance model needed to support
      truly concurrent iterations. Concretely identify, in whichever
      iteration first attempts step (c), what would need to change about
      the provenance/state model to support (d), so the follow-up
      directive has real, evidence-based design input rather than
      speculation.
4. **Bugs found while pursuing this are expected, not blockers.** Per the
   human's explicit instruction, report any reliability issue,
   self-deadlock, quota exhaustion, or broker misbehavior discovered along
   the way plainly (per this experiment's standing evidence discipline) —
   do not retreat from the exploration because of a discovered bug; file
   it (as DIR-024 already models) and continue exploring around or past
   it once fixed.
5. This remains a standing SOP, not a one-time task — re-read and
   re-apply on any future iteration whose work could plausibly use
   concurrent task execution, mirroring DIR-021's own standing-SOP
   precedent.

<!-- ## Resolution: to be filled in by the iteration/session that applies this directive -->
