# Charter M115-audit-session-id-mechanism-fix — audit-independence dispatch mechanism fix

**Milestone id:** M115
**Task:** `tasks/exp5-DEFECT-M114-AUDIT-SESSION-ID-MECHANISM.md`
**Surface:** methodology-class / governance-integrity, instrument-correction
**Charter authored:** 2026-07-22
**Base commit:** master HEAD (see `git rev-parse HEAD` at dispatch time)
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

At M114's ABSORB, the dispatched adversarial-audit subagent's own env-var self-report
(`CLAUDE_CODE_SESSION_ID`) came back identical to the orchestrator's own session id — this
harness's `Agent` tool gives dispatched subagents the same session env as the parent, not a fresh
one. `audit-independence-check.ts` correctly FAILed closed on this (no valid distinct id found in
the artifact). M114 worked around it by having the orchestrator record the `Agent`-tool-assigned
`agentId` (a genuinely distinct, harness-assigned dispatch handle) as the artifact's session id
instead, corroborated by the dispatch-record file — this got M114's gate to PASS, but was a
per-ABSORB manual correction, not a fix to the underlying instructions that every future milestone's
audit dispatch would otherwise repeat.

## Scope

1. **Fix the instructions, not the mechanism:** `audit-independence-check.ts`'s corroboration logic
   already works correctly once given the right distinct id (verified: M114's corrected artifact
   PASSed). The fix is documentation-only: update `inherited-core.md`'s "Adversarial-audit role"
   section + `OUTER-LOOP.md`'s "Dispatch-record file" procedure to instruct the ORCHESTRATOR (never
   the subagent) to record the `Agent`-tool's own returned dispatch id as the artifact's
   `Audit session id:` line — never ask the subagent to self-report via env var.
2. **Fix the stale DIR-032 vehicle reference** in `inherited-core.md`'s item 2 (still said
   `baime:iteration-executor` for audit dispatch; `OUTER-LOOP.md` step 6 already correctly says
   "generic Explore/general-purpose subagent" per DIR-032 — this was an undetected drift between the
   two docs for the SAME dispatch mechanism).
3. **Validate the fix live:** this very milestone (M115) requires its own mandatory adversarial
   audit at ABSORB — dispatch it FOLLOWING the just-corrected procedure and confirm the resulting
   artifact's `Audit session id:` line is correct on the FIRST attempt, with no post-hoc orchestrator
   correction needed (the exact AC3 test).

**Not in scope:** any change to `audit-independence-check.ts`'s own logic (already correct); any
retroactive re-verification of M105's or any other past milestone's audit-independence corroboration
(noted as an open, unverifiable-post-hoc question in the task Resolution, not chased further here).

## Class routing

**Methodology/design-class** — a documentation/instruction fix to Tier-B methodology docs
(`inherited-core.md`, `OUTER-LOOP.md`). No `quay-task-to-plan` pipeline required (DIR-014). Direct
outer-loop execution, consistent with the M108/M111–M114 precedent for small, well-bounded
methodology-class closures.

## Acceptance Criteria

- [ ] `inherited-core.md`'s "Adversarial-audit role" section updated: new item 5 instructs the
      orchestrator (not the subagent) to record the `Agent`-tool dispatch id as the artifact's
      session id.
- [ ] `OUTER-LOOP.md`'s "Dispatch-record file" procedure updated with the matching step (write the
      session-id line into the artifact itself, not just the dispatch-record file + ABSORB entry).
- [ ] M115's OWN adversarial audit, dispatched per the corrected procedure, produces an artifact
      whose `Audit session id:` line is correct on the first attempt (`audit-independence-check.ts`
      PASSes without an orchestrator post-hoc correction).

## Definition of Done

References the standard inherited-core DoD clauses; the bar is REAL LANDING, not artifacts:
- [ ] Both doc edits landed on `master`.
- [ ] M115's live audit dispatch demonstrates the fix working end-to-end (pasted `audit-independence-check.ts` PASS output, no correction step).
- [ ] it0 DoD meta-enforcer passes all clauses.

## GATE-HASH-REF

`22c64fc383d6fc03ba375f8b9ce463abce3459d318c8787e33d8bcb321d876e1`
