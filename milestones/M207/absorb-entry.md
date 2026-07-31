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

adversarial-audit disposition: REFUTED

AC 11/12 confirmed by fresh independent audit (own test runs, own real-CLI executions, own
greps/cmps — not the implementer's self-report): AC1/AC11 admission nowMs all six modes ×2
mirrors (74/74 each); AC2 renewal-bounded equality fixture (68/68); AC3 recurrence pin/advance
fixtures + audit's own real-CLI A/B over the real archive (97/97); AC4 cmp ×3 + sync-vendor
--check CLEAN; AC5 zero new import edges (4 mentions all comments); AC7 source-guard fixture;
AC8 fail-soft fixtures; AC9 trailing close endedAtMs === recordedAtMs (fixture + audit's real
run); AC10 TDZ + 3 pre-lease fixtures; AC12 identifier spot-checks real. DoD: landed on master
(dc3d6c4 = HEAD, ancestor check true) and real non-fixture callsite evidence produced by this
audit's own real CLI runs.

REFUTATION (machine-caught, this pass): AC6's negative enforcement sub-assertion (CLAIM C9) is
empirically false. milestone-preparation-check.ts:287 (computeCapacityReport, LANDED M204/
DIR-126-E commit 23f8891) runs validateTelemetryRecord over EVERY disk-read record — outside
the AC's proposal-convergence.ts-only grep scope. A/B proof on the SAME committed archive:
dc3d6c4~1 `--capacity-report` → code:ok, sampleCount:31, zero telemetry exclusions; dc3d6c4
(HEAD) → ALL 27 pre-M207 records excluded as telemetry-field-missing ("missing required field
'phaseTimings'"), telemetry population 0, code:insufficient-samples. The REQUIRED_TOP widening
is therefore NOT forward-only-safe; the landed latent-trap comment ("nothing re-validates
committed history") is false as written; the charter's Done-when consumer-protection clause
("existing consumers of DIR-126-D's own telemetry-record schema are unaffected... no shape
becomes stricter") is violated. AC6 left UNCHECKED in the task file with full evidence.

Secondary observation (not verdict-determining): full `scripts/test.sh` under parallel load
times out 3 load-boundary M52 delivery-standalone-smoke spawn tests (60-79s each); all 3 pass
in isolation at HEAD (9-13s) — same environmental load-boundary class the build itself
disclosed repairing in build-dist-smoke; not M207-caused (M207 touches no gate code path).

V_meta consolidation-lag: PASS: no confirmed-unconsolidated row past K without a dated carry-forward
