# Case study: the G3-audit-via-manda anti-pattern and its correction (DIR-003)

Source: `experiments/quay-core-bootstrap/directives/archive/DIR-003-g3-audit-native-agent-not-manda.md`,
iterations 3-5 and 7. This is a concrete methodology-drift-and-correction
case study worth preserving as a guardrail for future experiments — the
protocol was already written correctly; the drift was in execution, not
in the protocol text.

## What the protocol already said (before the drift)

`ITERATION-PROMPTS.md` specified, in two separate places, that the G3
out-of-band audit is an **orchestrator-side** dispatch using the
**native** Agent/Task tool:

- "(iteration subagent and G3 audit subagent, **orchestrator-side**) Both
  dispatches confirmed run_in_background=true."
- "G3 out-of-band audit discipline: **native Agent/Task tool (not manda)
  is the permanent G3 mechanism**. Three caught overclaims in experiment 1
  (iterations 29, 59, 61) demonstrate this guardrail finds real problems.
  Treat it as genuinely independent — not a formality."

## What actually happened (the drift, iterations 3-5)

Despite the protocol text above, iterations 3, 4, and 5 each had the
**iteration-executor subagent itself** attempt the G3 audit by calling
`mcp__plugin_manda_manda__Agent(to="cord", ...)` from inside its own
execution, then falling back to a same-session adversarial pass when that
call timed out or the daemon was unreachable.

This was wrong in two independent respects:

1. **Wrong dispatcher.** The audit is supposed to be dispatched by the
   orchestrator (the session that dispatches the iteration-executor
   itself), not requested by the iteration-executor from within its own
   run. Even if the manda call had succeeded, it would still be the same
   iteration's own session requesting a nested call — sharing context and
   blind spots, and (per the project's DIR-020 hard rule) a manda depth-1
   caller must never be synchronous same-session-as-broker in the first
   place.
2. **Wrong mechanism.** The protocol names the native Agent/Task tool, not
   manda, as the permanent G3 mechanism. manda nested-subagent dispatch
   for G3 additionally has a demonstrated reliability problem independent
   of the dispatcher issue: complex, multi-step tasks (file reads +
   adversarial analysis + file write — exactly G3 audit's shape) time out
   at 90s (see `manda-reliability-envelope.md`; this specific finding
   later got a nuance correction at 150s, but the dispatcher problem is
   independent of timeout tuning and remains wrong regardless).

## The correction (DIR-003, applied iteration 7)

1. Future iterations must **not** attempt `mcp__plugin_manda_manda__Agent`
   (or any manda nested-subagent call) as the mechanism for a G3
   out-of-band audit. If a G3 trigger applies, the iteration-executor's
   own report performs the existing same-session adversarial self-check
   as an interim, explicitly-labeled-as-limited pass, and explicitly
   states that a genuinely independent G3 audit dispatched via the native
   Agent/Task tool is to be performed by the orchestrator separately.
2. The orchestrator (main/top-level session) takes on responsibility for
   actually dispatching that independent native Agent/Task audit as a
   follow-up step after each iteration with a live G3 trigger.
3. This did **not** retroactively invalidate iterations 1-5's audit
   verdicts — they had already honestly recorded the same-session
   independence limitation.
4. This did **not** block the separate, legitimate manda-Agent
   reliability-envelope investigation (§manda-reliability-envelope.md) —
   that investigation's use of manda is a different purpose (probing
   whether an unconditional primitive exists) from using manda to execute
   the audit itself, and continued under existing guidance.

## Why this is worth preserving as a guardrail

The protocol text was already correct. The drift happened anyway, for
three consecutive iterations, apparently because "manda is available and
plausible-looking for this" was a stronger local pull than re-reading the
protocol's own explicit dispatcher/mechanism statement each iteration.
The correction mechanism that caught it (a human-authored directive,
DIR-003, not the iteration loop's own self-check) is itself evidence that
directive-based external steering remains necessary even when a protocol
document already states the correct design — self-consistency checking
by the iteration loop against its own governing document is not
guaranteed to happen without an explicit trigger.

## Consuming-scope guidance

- When designing or inheriting a G3 (or equivalent out-of-band audit)
  mechanism, explicitly state, in a place read at the **start of every
  iteration** (not just once in a design doc), which tool/dispatcher
  combination is authoritative — and treat any nested-subagent call
  (manda or otherwise) originating from inside the very session being
  audited as automatically disqualifying, regardless of whether the call
  succeeds.
- If a reliability-envelope investigation of a dispatch primitive (e.g.
  manda) is running concurrently with G3 audit design, keep the two uses
  explicitly separate in the iteration report — conflating "we are
  probing whether manda can do G3-shaped work" with "we are using manda
  to perform this iteration's actual G3 audit" was exactly the drift that
  occurred here.
- Treat this case study as a concrete precedent the next time a
  self-audit or gate mechanism is proposed to be dispatched from inside
  the thing it's meant to be checking.

## Related directives (same experiment, shorter findings)

- **DIR-001** (G6 manda-daemon-live-and-direct-child recheck): after the
  human started a manda monitor process outside any iteration's own
  actions, DIR-001 required the next iteration to mechanically re-verify
  G6 (daemon healthz + `ps`-based direct-child check) rather than
  carrying forward iteration 0's "NOT CONFIRMED" finding by assumption.
  Resolved iteration 2: re-check performed, result unchanged (still NOT
  CONFIRMED at that point — this was before the port-28912 bug was found
  in iteration 4; see `manda-daemon-address-bug.md`).
- **DIR-002** (proactive provenance.md size-control policy): given
  experiment 1's `provenance.md` grew unchecked to 10,887 lines before a
  reactive one-time compaction was needed (DIR-023 in experiment 1),
  DIR-002 proactively adopted, at iteration 2 (94 lines in), a terse
  per-task entry-format norm, a 1,500-line mechanical size-check
  threshold, and a pre-validated compaction procedure — all before any
  blowup occurred. This is a case of applying an experiment-1 lesson
  proactively rather than waiting to rediscover it reactively; useful
  precedent for experiment 3's design (adopt known operational lessons
  at design time, don't wait for them to recur).
