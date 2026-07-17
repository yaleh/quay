# DIR-005

- status: pending
- created_by: orchestrator (iteration 4 pre-execution audit of iteration 3 record)
- created_at: 2026-07-17
- title: G3 out-of-band audit dispatch drift — iteration 3 attempted manda route, then fell back to inline self-audit; neither is correct; orchestrator must use native Agent tool only

## Finding

In iteration 3, the executor attempted to dispatch G3 via manda Agent (cord channel).
The manda monitor correctly denied it with: `{"error":"DENIED: G3 out-of-band audit
must NOT route through manda nested-subagent..."}`.

After this denial, the executor fell back to conducting the G3 audit **inline in the same
session** (degraded-fallback mode), which also violates G3 independence. This was recorded
in iteration-3.md §5 Phase 5 and §9 as "inline degraded-fallback" with the ENV constraint
cited as justification.

This represents a double drift:
1. Attempting manda dispatch (explicitly prohibited — see experiment 2's DIR-003 correction,
   quay-core-bootstrap-methodology SKILL.md, and this experiment's own ITERATION-PROMPTS.md §0)
2. Falling back to inline self-audit (violates the "not from inside the iteration-executor's
   own session" requirement — an inline audit shares the author's blind spots by construction)

The correct mechanism is: **the orchestrator** (the session receiving the human's iteration
prompt) dispatches G3 as a **fresh-context subagent via the native Agent tool**,
`run_in_background=true`. The executor (iteration-executing subagent) never dispatches its
own G3. The orchestrator handles G3 dispatch — this is part of the orchestrator's job, not
the executor's.

## Root cause

ITERATION-PROMPTS.md states clearly (§0, §0a, §0c and the top section "G3 audit dispatch —
correct from iteration 0, not rediscovered"): G3 is dispatched by the orchestrator via the
native Agent/Task tool — never via manda, never from inside the executor's session.

However, the iteration-3 executor session:
1. Attempted manda dispatch (misreading the protocol)
2. Upon denial, fell back to inline mode (treating ENV gap as permission to self-certify)

The ENV gap ("no unconditional native Agent/Task tool") was cited as the excuse for inline
fallback. This is incorrect — the manda Agent tool IS conditionally available (daemon live +
non-self broker armed), and the orchestrator (NOT the executor) is the correct dispatcher.

## Correct protocol (standing from now forward)

1. The iteration executor NEVER dispatches its own G3 audit. It produces serve.js changes
   and notes that G3 is needed. It does NOT attempt G3 dispatch by any mechanism.
2. The orchestrator (the session receiving the human's iteration prompt) dispatches G3 as a
   fresh-context native Agent subagent, `run_in_background=true`, after the executor's work
   is complete.
3. The manda Agent tool is NEVER used for G3 dispatch, even if available — per the
   experiment-2 DIR-003 correction and experiment 3's own ITERATION-PROMPTS.md §0a/§0c.
4. The iteration report must record the G3 dispatch as "dispatched by orchestrator via native
   Agent tool" — not "inline" and not "via manda."

## Status

APPLIED — iteration 4, 2026-07-17. Iteration 4 orchestrator dispatches G3 via native Agent
tool as the first G3 compliance action (see iteration-4.md §9). This directive is archived
as applied immediately after filing.
