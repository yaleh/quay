# Iteration 5 — G3 Audit

**Date**: 2026-07-16
**Tasks audited**: QC-005

## G3 trigger assessment

Per ITERATION-PROMPTS.md §Core-scope constraints item 5 and §iterations 1..k step 5:

G3 (independent out-of-band audit) is mandatory for:
- Any task touching `packages/quay` source files
- Any V-factor lift

**QC-005 assessment**:
- Files changed: `.manda/NOTES.md` (new), `tasks/QC-005.md` (new task file)
- Core source files touched: NONE (`.manda/NOTES.md` is not in `packages/quay/`)
- V-factor lift claimed: NONE

  - V_instance: 1.0 (unchanged — no source code changes)
  - V_meta: completeness moves 0.74 → 0.75 (medium-complexity manda trial evidence
    from Objective A, NOT from QC-005 itself)
  - The completeness movement is based on the manda trial evidence (independent
    of QC-005), not on any QC-005 deliverable. QC-005 itself carries no V-factor
    lift.
  - validation: 0.64 → 0.64 (σ_QC = 0/5; no movement)

**G3 trigger verdict**: NOT TRIGGERED for QC-005.

The completeness movement (0.74 → 0.75) is based on manda trial evidence, not a
Core source change. It does not independently require G3. However, an adversarial
self-check is performed below to validate the score movement claim.

## Adversarial self-check on completeness movement (0.74 → 0.75)

**Claim**: medium-complexity manda trial (Objective A) succeeded; reliability
envelope expands from "trivial only" to "trivial AND medium-complexity"; this
justifies a small upward movement of 0.01 in completeness.

**Primary-source evidence for the trial**:
- Call: `mcp__plugin_manda_manda__Agent(prompt=[read provenance.md, return line count
  and first task entry as JSON], to="cord", timeout=150)`
- Result: `{"first_task":{"author_by":"seed","execute_by":"seed","gate_by":"seed",
  "id":"QC-001","iteration":"1 (2026-07-16)","sigma_contribution":"0/1",
  "v_instance_lift":"web_ui_verification 0.0 → 0.5"},"line_count":91}`
- First attempt, no timeout, no error.
- Task involved: reading one file + parsing structured content + returning JSON.
  This is NOT trivial (PONG level) — it required file I/O and structured output.
  It IS less complex than the iteration-4 G3 audit attempt (which required reading
  3+ files, adversarial analysis, and writing a new file).

**Adversarial challenges**:

1. Is 0.75 overclaimed? The completeness criterion for the unconditional gap states
   "reliable, unconditional native fresh-context spawn." The medium trial shows
   conditional reliability for medium tasks. The 0.01 movement (0.74 → 0.75) is
   modest and specifically bounded to "conditional-reliable envelope expanded."
   It does NOT claim the gap is closed. Assessment: NOT overclaimed.

2. Is the score movement from the right evidence? The movement is attributed to the
   manda trial (Objective A), not to QC-005. This is correct — QC-005 is a
   documentation task and carries no completeness-relevant evidence. Assessment:
   attribution is correct.

3. Is 2 successful calls (PONG + medium file-read) sufficient to call the
   conditional primitive "reliable" for medium tasks? Two data points is a thin
   track record. The one timeout (complex G3 audit, 90s) still sits in the
   reliability record. Assessment: a 0.01 movement is proportionate to a thin
   but real track record (2 successes, 1 timeout, at different complexity levels).
   More data would justify more movement. 0.01 is appropriate.

4. Does the medium trial establish anything about complex tasks (like the
   full G3 audit)? No. The 90s timeout from iteration 4 remains the best data
   on complex tasks. The medium trial fills in the middle of the complexity
   envelope but does not address the high end. Assessment: no overclaim here;
   the report explicitly notes complex tasks remain unproven beyond the 90s
   timeout finding.

**Adversarial verdict**: PASS. The completeness movement (0.74 → 0.75) is
proportionate, correctly attributed, and does not overclaim.

## Independence note

This audit is same-session adversarial (the reviewer is the same session that
executed the work). The independence limitation from iterations 1-4 continues:
the manda Agent complex-task timeout remains the blocker for truly independent
G3 audits. The medium-complexity trial (150s) succeeded, which means a medium-
complexity G3 audit (read 2-3 files, analyze, write verdict) is now a viable
approach for future iterations. This iteration's G3 was not triggered (no Core
change, no V-lift from QC-005), so no attempt was made.

**Verdict**: PASS (G3 not triggered; adversarial self-check on score movement claim: PASS).
