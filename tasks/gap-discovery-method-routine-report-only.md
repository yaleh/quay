---
id: gap-discovery-method-routine-report-only
title: "Discovery Method: minimal report-only routine on the existing routine
  track (only after the independent regression)"
status: todo
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra: {}
depends_on:
  - gap-discovery-method-loop-independent-regression
---
## Proposal
This is the minimal report-only routine for the Discovery Method loop. It must not start before the independent regression (`gap-discovery-method-loop-independent-regression`) is done; that ordering is the dependency of this task.

It reuses the existing routine track exactly as `plugin/scripts/arch-discovery-routine.ts` does: interval scheduling via `routine-scheduler.isDue` plus the durable `.quay/routine-last-run.json`, the caller-side watchdog, halt via `.quay/quality-control.json`, and the quality-round fact. It adds no driver kind, no scheduler and no meta-driver change, and it creates no task or Goal.

## Plan
1. New `plugin/scripts/discovery-method-routine.ts`, a `RoutineSpec` for the quality-gate driver. Each due round:
   - (a) `ingestNewOutcomes` (watermarked, quota);
   - (b) one bounded `reflect()` round over the new Experiences, if any;
   - (c) `validateGeneralization` for new candidates against held-out cases that have an `evaluation_pin`.
   It writes only the persistent discovery carriers and one `scan-round` line in `.quay/discovery-method-findings.jsonl`. The `scan-round` line records: experiences ingested, units reflected, candidates, verdicts, promotions, retirements, model calls, tokens, wall time, and gateway-rate cost.
2. Config `loop.discovery_method:` with:
   - `enabled`
   - `interval` (floor 360m)
   - `max_experiences`, `max_model_calls`, `max_wall_ms`
   Absent or `enabled:false` ⇒ `not-evaluated:disabled` and zero spawns. Malformed ⇒ `failed`, zero spawns.
3. Fail-closed: any step's refusal (`WATERMARK_MISMATCH`, an unresolved shared checkout, a budget breach) ⇒ the round is `failed` with that reason; nothing appended beyond the fact; last-run is not advanced.
4. Report-only, structurally: the routine imports no task/goal authoring function. Reuse the static control and mutation pattern of `plugin/test/arch-discovery-routine.test.mjs`.
5. Declare the new script in `plugin/scripts/capability-catalog-declarations.json` and the carrier in `docs/carrier-registry.json`.

## Acceptance Criteria
- [ ] `node --test plugin/test/discovery-method-routine.test.mjs` exits 0, covering: absent section ⇒ disabled with zero spawns; `enabled:false` same; halted same; malformed ⇒ failed; a budget breach ⇒ failed with the carrier byte-identical; two rounds on identical inputs ⇒ the second ingests 0 and makes 0 model calls; no authoring import (static control plus a mutation that turns it red).
- [ ] `node --test plugin/test/quality-gate-driver.test.mjs plugin/test/arch-discovery-routine.test.mjs` exits 0 (no behaviour change to existing routines).
- [ ] Real one-shot round through the routine entry against `/data/home/yale/work/quay`. Paste the `scan-round` line and the quality-round fact.
- [ ] Production: at least one `scan-round` line with ts after this task lands, written by the resident quality-gate driver. If it has not run yet, leave unticked and write 未读到. （待外部）

## Definition of Done
- AC1–AC3 ticked with output pasted; AC4 read from production or recorded as not yet read.
- `scripts/test.sh --for-task gap-discovery-method-routine-report-only` green.

## Touches
- tasks/gap-discovery-method-routine-report-only.md
- plugin/scripts/discovery-method-routine.ts (new)
- plugin/test/discovery-method-routine.test.mjs (new)
- plugin/scripts/quality-gate-driver.ts
- plugin/scripts/capability-catalog-declarations.json
- docs/carrier-registry.json
- .quay/config.yml
