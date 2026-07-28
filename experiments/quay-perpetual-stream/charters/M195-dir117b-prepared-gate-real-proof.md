# M195 — DIR-117-B: prove the Prepared-gate preparation pipeline on one real milestone

**Task:** DIR-117-B · **Class:** development · **Value type:** capabilityGrowth
**Deliverable:** yes · **Charter tokens:** ~0.5 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ > 0 (capability-growth, deliverable, method-infra surface). DIR-117/M191 landed the
preparation MECHANISM (`prepare-milestone.js`, `milestone-preparation-check.ts`, the
`Prepared` phase as opt-in) but, by its own bootstrap-paradox construction, could not run the
real SELECT→prepare→execute route. This milestone IS that real proof — unlike M193/M194, which
deliberately skipped `prepare-milestone`, this milestone is itself prepared by the real workflow
and executed through the real `Prepared` gate, then closes the back-compat hole by flipping the
gate to enforced-by-default and making `prepare-milestone.js`'s ProposalReview call
`wiring-coverage-check.ts`'s real `checkWiringCoverage()` function instead of prompting an LLM
to approximate it.

## Why this milestone does NOT skip `prepare-milestone`

The M193/M194 skip precedent does not apply — it exists for tasks already carrying a full,
real, line-cited Proposal split from real review findings. Skipping preparation here would
destroy this milestone's own primary evidence: DIR-117-B's AC #1/#2 require a REAL
`prepare-milestone.js` run whose receipt a REAL `execute-milestone.js` call consumes. This
milestone is the vehicle and the payload at once (the same self-referential shape DIR-117's own
Plan anticipated for its resolving milestone, minus the paradox — the mechanism being proven
already exists).

## Scope

Per `tasks/DIR-117-B.md`'s own Requested action / Acceptance Criteria — not duplicated here.
In short: (1) real `prepare-milestone.js` run for DIR-117-B producing
`milestones/M195/preparation.json` + `docs/plans/M195-*.md`; (2) real `execute-milestone.js`
run consuming that receipt through the `Prepared` phase into Build; (3) a real negative-control
run (stale receipt) returning `{outcome:"revision-needed", phase:"Prepared"}` before Build;
(4) `ProposalReview` wired to `checkWiringCoverage()` directly (both mirrors, with a real
fixture proving the finding count increments from the function's return value); (5) default
flip — a MISSING `preparationReceiptFile` becomes fail-closed in both
`.claude/workflows/` and `plugin/workflows/` mirrors, byte-identical, plus the OUTER-LOOP.md
disclosure update; (6) DIR-117's own dirStatus/Resolution updated to point at this real
evidence.

## Touches

Per `tasks/DIR-117-B.md`'s own `## Touches` list — not duplicated here.

## Done-when

Per `tasks/DIR-117-B.md`'s own AC/DoD — real workflow journal + preparation.json +
docs/plans evidence for both the positive and negative-control runs; the default flip in both
byte-identical mirrors; the grep-confirmable real `checkWiringCoverage()` call site in both
`prepare-milestone.js` mirrors with its incrementing-finding-count fixture; a fresh independent
wiring-focused audit after Land. On completion, DIR-117's own remaining AC item (real
post-DIR-117 milestone through the full route) is satisfied by THIS milestone's record.

## Inner termination

Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ 8c781aa9ab7bc634e4a90073b646e1ab4af335d1
