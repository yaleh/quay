# DIR-003

- status: pending
- created_by: human (Yale)
- created_at: 2026-07-16
- title: G3 out-of-band audit must be dispatched by the orchestrator via the
  native Agent/Task tool — stop attempting it via manda nested-subagent from
  inside the iteration-executor

## Finding

`ITERATION-PROMPTS.md` already specifies, in two places, that the G3
out-of-band audit is an **orchestrator-side** dispatch using the **native**
Agent/Task tool:

- §0 checklist item: "(iteration subagent and G3 audit subagent,
  **orchestrator-side**) Both dispatches confirmed run_in_background=true —
  see §0a below."
- §Method-steps knowledge reference: "G3 out-of-band audit discipline
  (`reference/g3-audit-discipline.md`): **native Agent/Task tool (not manda)
  is the permanent G3 mechanism**. Three caught overclaims in experiment 1
  (iterations 29, 59, 61) demonstrate this guardrail finds real problems.
  Treat it as genuinely independent — not a formality."

Despite this, iterations 3, 4, and 5 each had the iteration-executor
subagent itself attempt the G3 audit by calling
`mcp__plugin_manda_manda__Agent(to="cord", ...)` from inside its own
execution, then falling back to a same-session adversarial pass when that
call timed out (iteration 4: complex-task dispatch timed out at 90s;
iteration 3: daemon was reported unreachable at the time). This is a drift
from the protocol as already written, in two respects:

1. **Wrong dispatcher.** The audit is supposed to be dispatched by the
   orchestrator (the session that dispatches the iteration-executor itself),
   not requested by the iteration-executor from within its own run. The
   iteration-executor has no way to make this genuinely independent even if
   the manda call succeeded — it is still the same iteration's own session
   requesting a nested call, sharing context and blind spots, and (per
   DIR-020) a manda depth-1 caller must never be synchronous
   same-session-as-broker in the first place.
2. **Wrong mechanism.** The protocol names the native Agent/Task tool, not
   manda, as "the permanent G3 mechanism." manda nested-subagent dispatch
   for G3 has an additional, now-demonstrated reliability problem
   independent of the "wrong dispatcher" issue: iteration 4's own trial
   showed complex, multi-step tasks (file reads + adversarial analysis +
   file write — exactly G3 audit's shape) time out at 90s, while only
   trivial/medium-complexity tasks (single-word echo; single-file
   structured-read) succeed.

Iterations 4 and 5 also used these same manda-Agent trials as evidence for
the `completeness` V_meta factor's re-trigger-4 search (probing whether an
unconditional native fresh-context dispatch primitive exists). That
investigation is legitimate and separate from G3 audit execution — it
should continue on its own terms. This directive addresses only the G3
audit *execution* channel, not the reliability-envelope investigation.

## Requested action

1. Future iterations must **not** attempt
   `mcp__plugin_manda_manda__Agent` (or any manda nested-subagent call) as
   the mechanism for a G3 out-of-band audit. If a G3 trigger applies this
   iteration (Core change or V-factor lift), the iteration-executor's own
   report should:
   - perform the existing same-session adversarial self-check as an
     interim, explicitly-labeled-as-limited pass (as iterations 1-5 already
     do), and
   - explicitly state that a genuinely independent G3 audit, dispatched via
     the native Agent/Task tool, is to be performed by the orchestrator as
     a separate step outside the iteration-executor's own run — not
     something the iteration-executor can trigger itself.
2. The orchestrator (main session) takes on the responsibility of actually
   dispatching that independent native Agent/Task audit as a follow-up step
   after each iteration that has a live G3 trigger, and recording its
   verdict in `experiments/quay-core-bootstrap/audits/iteration-{N}-adjudicate.md`
   (superseding or supplementing the same-session pass already on file for
   that iteration, as appropriate).
3. This does **not** retroactively invalidate iterations 1-5's audit
   verdicts — those already honestly recorded the same-session independence
   limitation. No re-audit of past iterations is required by this
   directive alone.
4. This does **not** block the manda-Agent reliability-envelope
   investigation (trivial/medium/complex trials for V_meta re-trigger 4
   purposes) — that may continue under existing §0b guidance, decoupled
   from G3 audit execution.
5. Record, in the iteration that applies this directive, which of the
   above were done, and cite it in this directive's own Resolution section
   per the standard lifecycle.

## Resolution

**Applied: iteration 7 (2026-07-16)**

1. This iteration (iteration 7) does not trigger G3: QC-007 modifies only
   Skill documentation files (`packages/quay-native/skills/author/SKILL.md`
   and `packages/quay-native/skills/execute/SKILL.md`) — no source files in
   `packages/quay/`, `packages/quay-native/src/`, or `packages/quay-github/`
   were touched. G3 is triggered for Core source changes and V-factor lifts
   requiring independent audit. No V-factor lift from QC-007 itself (it is
   a documentation accuracy update). Therefore G3 is not triggered this
   iteration, so items 1 and 2 from "Requested action" are noted as practice
   going forward, not as an action required this iteration.

2. The iteration-7 report (§9) explicitly states: "G3 not triggered this
   iteration — no Core source change, no V-factor lift from QC-007. The
   completeness score move (if any) is attributed to QC-007's Skill file
   update serving as evidence consolidation, not to a new capability
   discovery requiring independent adjudication. DIR-003 applied: manda is
   not used for G3; the orchestrator is responsible for independent G3 audit
   dispatch when a genuine trigger arises."

3. The manda reliability-envelope investigation (re-trigger 4 search) may
   continue separately under §0b guidance — this directive does not restrict
   that investigation.

**Archived**: moved from `pending/` to `archive/` this iteration.
