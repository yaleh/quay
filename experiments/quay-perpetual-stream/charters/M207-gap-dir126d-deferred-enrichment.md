# M207 — gap-dir126d-deferred-phase-timing-recurrence-tracking: phase timing + finding recurrence
tracking, extending DIR-126-D's landed telemetry record

**Task:** gap-dir126d-deferred-phase-timing-recurrence-tracking · **Class:** development
**Value type:** capabilityGrowth · **Deliverable:** yes · **Charter tokens:** ~0.2 K
**type:** execution · **highRisk:** yes

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ > 0 (capability-growth, deliverable, method-infra surface). DIR-126-D/M203 (landed `6a24bf3`,
`milestone_counter` 199→200) originally scoped two enrichment ideas — per-phase-boundary
`nowMs` timing ("Mechanism B.1") and `findingCodes[]`/`recurrenceKey` finding-recurrence tracking
("Mechanism B.3") — but a later real ProposalReview round found neither was actually mandated by the
M203 charter and deferred both to keep DIR-126-D's own `mechanismCount` at a defensible size (see
`gap-prepare-milestone-split-decision-no-finality`/M206 for the systemic fix to that same class of
issue). Both ideas are real, additive extensions to the telemetry record DIR-126-D already lands in
production — this child now picks them up.

## Why highRisk

Touches `prepare-admission-check.ts` (+ `plugin/scripts/` mirror) — a shared dependency used by
every real `prepare-milestone` dispatch's Admission/Preflight/`_renewLease` phase-timing calls, not
scoped to DIR-126-D alone — plus `proposal-convergence.ts` (+ mirror), extending the already-landed,
already-production telemetry record shape DIR-126-D's own recurrence-consuming code (`decideResume
Generation`) reads. A regression here would affect every future milestone's Prepare stage, not just
this one's own new fields.

## Scope

Per `tasks/gap-dir126d-deferred-phase-timing-recurrence-tracking.md`'s own Requested action /
Acceptance Criteria / Definition of Done — not duplicated here. In short: add per-phase-boundary
`nowMs` self-reporting to `prepare-admission-check.ts`'s existing JSON output (additive field only,
no reshaping of anything existing), and `findingCodes[]`/`recurrenceKey`/`firstSeenGeneration`/
`lastSeenGeneration` to the committed telemetry record's frozen schema.

## Touches

Per the task's own `## Touches` list — not duplicated here.

## Done-when

Per the task's own AC/DoD. A fresh independent audit confirms both additive fields are real,
production-wired (not `--selftest`-only), and that existing consumers of `prepare-admission-check.
ts`'s JSON output and DIR-126-D's own telemetry-record schema are unaffected by the additive
extension (no shape becomes stricter, no existing field renamed/removed).

## Inner termination

Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ e9905ca4931bfdc889c96d7ae83d657e786316c7
