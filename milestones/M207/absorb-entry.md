## M207 ABSORB entry

**Milestone id:** M207
**Task:** gap-dir126d-deferred-phase-timing-recurrence-tracking (per-phase-boundary `nowMs`
self-reporting on `prepare-admission-check.ts` + `phaseTimings`/`findingCodes[]` recurrence-tracking
fields on the committed telemetry record — the two enrichment ideas DIR-126-D deferred)
**Charter:** experiments/quay-perpetual-stream/charters/M207-gap-dir126d-deferred-enrichment.md
**Value type:** capabilityGrowth
**Deliverable:** yes

## Backlog row

| gap-dir126d-deferred-phase-timing-recurrence-tracking | Add per-phase-boundary `nowMs` self-reporting to `prepare-admission-check.ts`'s JSON output (additive field, all six CLI modes) and `phaseTimings`/`findingCodes[]` (with `recurrenceKey`/`firstSeenGeneration`/`lastSeenGeneration`) to the committed telemetry record's frozen schema (purely additive, `schemaVersion` held at 2); workflow accumulation in both `prepare-milestone.js` mirrors threads phase timing + finding codes onto the existing `--record-generation`/`--record-attempt` dispatches; receiver-side parse + trailing-span close + local recurrence scan in `proposal-convergence.ts` (both mirrors); no new dispatch, no sandbox `Date.now()`/`import()` | TBD | - | milestone-candidate, human-steered, priority:urgent, surface:method-infra |

<!--
surface:method-infra — this milestone's ## Touches are entirely methodology/workflow
infrastructure: experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts +
proposal-convergence.ts (+ plugin/scripts/ mirrors), .claude/workflows/prepare-milestone.js (+
plugin/workflows/ mirror), and their test files. Touches NO packages/quay* product code, so the
product-touching surface labels (cli/web-ui/provider-abi/mcp) do NOT apply. Purely additive to the
telemetry record DIR-126-D landed; no existing field renamed/removed, schemaVersion held at 2
(additive-growth precedent at proposal-convergence.ts:356-357).

The audit-disposition / ABSORB-gate-run sections below are completed during the Land phase
(adversarial acceptance audit + 7-gate absorb run), per inherited-core.md.
-->

## Adversarial audit disposition (M207)

TBD — completed by the Audit phase.

## ABSORB gate run (M207, post-audit)

TBD — completed at Land.
