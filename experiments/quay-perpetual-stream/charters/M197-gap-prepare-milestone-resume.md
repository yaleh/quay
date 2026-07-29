# M197 — gap-prepare-milestone-cross-generation-no-incremental-reuse

**Task:** gap-prepare-milestone-cross-generation-no-incremental-reuse · **Class:** development ·
**Value type:** capabilityGrowth
**Deliverable:** yes · **Charter tokens:** ~0.3 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ > 0 (capability-growth, deliverable, method-infra surface). `prepare-milestone.js` always
independently re-derives a fresh Proposal on every dispatch, even a redispatch after a prior
generation ended `needs-human`/crashed and its Proposal was already manually repaired. This was
discovered by direct real-world recurrence: three consecutive DIR-119-D/M196 `prepare-milestone`
dispatches each hit the same class of `wiring-coverage` format defect, because each fresh dispatch
discarded the previous round's manual fix. DIR-125 (M193) only bounds convergence WITHIN one
generation; it explicitly never claims to cover a fresh dispatch reusing a prior generation's
adjudicated content. This milestone adds an explicit resume path.

## Why this milestone hand-authors its own Plan, skipping `prepare-milestone`

Dispatching `prepare-milestone.js` for THIS task would retrigger the exact defect being fixed:
`ProposalAuthors` would independently re-derive the Proposal from scratch, discarding the
already-adjudicated, schema-passing content already on disk (`tasks/gap-prepare-milestone-
cross-generation-no-incremental-reuse.md`, `wiring-coverage-complete`, `task-schema-check` PASS).
Per explicit human-steered instruction: hand-author the Proposal/Plan/receipt directly and
dispatch through `execute-milestone.js`'s enforced Prepared gate with a real, honestly-built
receipt — not by weakening or bypassing the gate.

**Provenance honesty note:** because this milestone's preparation was hand-authored under direct
human-steered instruction rather than produced by independent multi-agent
authoring/adjudication/review, the receipt's `provenance` block records the SAME real session id
for every role. This is deliberately NOT a claim of independent multi-agent review — it is an
honest record that this preparation was human-steered single-context authoring, the same category
of exception DIR-117-B's own Plan text anticipated for a resolving milestone that cannot pass
through its own not-yet-built gate. `checkProvenanceDistinctness()` only requires presence/
identification of each role's run identity (a real, non-forged session id — DIR-117 iteration-2
item 2), NOT pairwise distinctness (that check was removed as a category error — see
`milestone-preparation-check.ts`'s own `gap-provenance-sessionid-not-independence-signal` note);
recording the same real id for every role is truthful, not a forged claim.

## Scope

Per `tasks/gap-prepare-milestone-cross-generation-no-incremental-reuse.md`'s own Requested
action / Acceptance Criteria / Definition of Done — not duplicated here. In short: add an explicit
`resumeFromAdjudicatedProposal` input to `prepare-milestone.js` (both mirrors) that skips
`ProposalAuthors`/`Adjudicate` and enters directly at `ProposalReview` using the task's current
`## Proposal`; keep `fullSynthesisCount` semantics accurate across the resume boundary; document
the caller contract in `OUTER-LOOP.md`; RED/GREEN fixture evidence for cold vs. resumed dispatch;
a real reproduction against a manually-fixed Proposal.

## Touches

Per the task's own `## Touches` list — not duplicated here.

## Done-when

Per the task's own AC/DoD.

## Inner termination

Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ ae426937c22fc0f08fedf8227f053d5b2e923951
