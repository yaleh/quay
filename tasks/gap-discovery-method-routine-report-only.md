---
id: gap-discovery-method-routine-report-only
title: "Discovery Method: minimal report-only routine on the existing routine
  track (only after the independent regression)"
status: ready
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
- [x] `node --test plugin/test/discovery-method-routine.test.mjs` exits 0, covering: absent section ⇒ disabled with zero spawns; `enabled:false` same; halted same; malformed ⇒ failed; a budget breach ⇒ failed with the carrier byte-identical; two rounds on identical inputs ⇒ the second ingests 0 and makes 0 model calls; no authoring import (static control plus a mutation that turns it red).
- [x] `node --test plugin/test/quality-gate-driver.test.mjs plugin/test/arch-discovery-routine.test.mjs` exits 0 (no behaviour change to existing routines).
- [x] Real one-shot round through the routine entry against `/data/home/yale/work/quay`. Paste the `scan-round` line and the quality-round fact.
- [ ] Production: at least one `scan-round` line with ts after this task lands, written by the resident quality-gate driver. If it has not run yet, leave unticked and write 未读到. （待外部）

### AC1 — `node --test plugin/test/discovery-method-routine.test.mjs` (exit 0)

```
$ node --test plugin/test/discovery-method-routine.test.mjs ; echo "EXIT=$?"
✔ case (1)/(2)/(4) — parseDiscoveryMethodSection: disabled section, malformed section, interval floor
✔ case (1) — section absent ⇒ not-evaluated:disabled and ZERO spawns
✔ case (2) — enabled:false ⇒ not-evaluated:disabled and ZERO spawns
✔ case (4) — malformed section / interval < 360m ⇒ failed and ZERO spawns
✔ case (3) — halted ⇒ not-evaluated:halted and ZERO spawns
✔ the durable due gate — not due inside the interval ⇒ ZERO spawns
✔ case (5) — a wall-budget breach ⇒ failed, carrier byte-identical, last-run NOT advanced
✔ case (6) — an ingest refusal (WATERMARK_MISMATCH) ⇒ failed with that reason, carrier untouched
✔ case (7) — two rounds on identical inputs ⇒ round 2 ingests 0 and makes 0 model calls
✔ a round with new Experiences and NO model seam ⇒ failed (never a silent no-op)
✔ case (8) — after a full round nothing under tasks/ or goals/ changed, and the source is filing-free
✔ readHeldOutCases — only Experiences carrying an evaluation_pin, and an unreadable ledger is not 'no cases'
✔ RoutineSpec — buildDiscoveryMethodRoutine wires config + ctx.halted into the round
✔ readDiscoveryMethodConfig — an absent section is present:false with no error (off by default)
✔ discoveryMethodRoutineFromConfig — absent ⇒ NO routine assembled (the host's routine set is unchanged)
✔ qualityGateRoutines — the discovery-method routine joins the table ONLY when it is passed in
ℹ tests 16   ℹ pass 16   ℹ fail 0
EXIT=0
```

Case → AC1 clause:

| AC1 clause | case |
|---|---|
| absent section ⇒ disabled, zero spawns | `case (1)` — asserts `ingest.calls.length === 0` AND `reflect.calls.length === 0` AND no carrier file |
| `enabled:false` same | `case (2)` |
| halted same | `case (3)` |
| malformed ⇒ failed | `case (4)` (two shapes: non-boolean `enabled`, and `interval:359m` under the 360m floor) |
| budget breach ⇒ failed, carrier byte-identical | `case (5)` — a pre-seeded carrier line, an injected clock that advances 1s per read, `max_wall_ms: 1`; asserts the file is byte-identical and `readLastRunMap(...)["discovery-method"] === undefined` |
| two rounds on identical inputs ⇒ 2nd ingests 0, 0 model calls | `case (7)` — round 1 ingests 2, one reflect call; round 2 (clock advanced past 360m) ingests 0, `reflected: null`, `model_calls: 0`, and the reflection seam's call count is still 1 |
| no authoring import (static control + a mutation that turns it red) | `case (8)` — the predicate `selectFilings\|fileRoutineTask\|driveItems\|task_write\|goal_write\|writeTask\|writeGoal\|lifecycle_promote\|lifecycle_retreat\|lifecycle_complete` is asserted absent on the real file, a **non-zero control** shows the same predicate finds a token that IS present (`appendCarrierRecords`), and the **mutation** (`src + 'import { writeTask } from "./nowhere.ts";'`) is asserted to make the SAME predicate match |

## Definition of Done
- AC1–AC3 ticked with output pasted; AC4 read from production or recorded as not yet read.
- `scripts/test.sh --for-task gap-discovery-method-routine-report-only` green.

### AC2 — existing routine tests unchanged (exit 0)

```
$ node --test plugin/test/quality-gate-driver.test.mjs plugin/test/arch-discovery-routine.test.mjs ; echo "EXIT=$?"
ℹ tests 46   ℹ pass 46   ℹ fail 0
EXIT=0
```

### AC3 — real one-shot round against `/data/home/yale/work/quay`

The routine entry is the same `runDiscoveryMethod` the driver's routine table calls; run from the task
worktree's script file against the MAIN checkout as root (the production-reading convention). All
Discovery carriers resolve to the SHARED checkout, so the round's line landed in
`/data/home/yale/work/quay/.quay/discovery-method-findings.jsonl`.

```
$ node --experimental-strip-types <worktree>/plugin/scripts/discovery-method-routine.ts \
      --once --root /data/home/yale/work/quay --json
{"root":"/data/home/yale/work/quay","model":"v4.1flash-anthropic","fact":{"name":"discovery-method","value":{
 "kind":"scan-round","routine":"discovery-method","ts":"2026-10-12T09:10:40.114Z","wall_ms":14,
 "ingested":{"experiences":0,"scanned":0,"duplicates":0,"advanced_to":270},
 "reflected":null,
 "candidates":{"minted":0,"persisted":0,"records":[]},
 "held_out":{"read":false,"cases":null,"unreadable":null},
 "verdicts":{"total":0,"evaluated":0,"correct":0,"not_evaluated":0,"skipped_budget":0,"records":[]},
 "promotions":[],"retirements":[],"model_calls":0,
 "tokens":{"input":null,"output":null,"cache_read":null,"cache_creation":null},"cost_usd":null},
 "state":"verified"}}
```

**The `scan-round` line as written to the carrier** (verbatim, one line):

```
{"kind":"scan-round","routine":"discovery-method","ts":"2026-10-12T09:10:40.114Z","wall_ms":14,"ingested":{"experiences":0,"scanned":0,"duplicates":0,"advanced_to":270},"reflected":null,"candidates":{"minted":0,"persisted":0,"records":[]},"held_out":{"read":false,"cases":null,"unreadable":null},"verdicts":{"total":0,"evaluated":0,"correct":0,"not_evaluated":0,"skipped_budget":0,"records":[]},"promotions":[],"retirements":[],"model_calls":0,"tokens":{"input":null,"output":null,"cache_read":null,"cache_creation":null},"cost_usd":null}
```

**The quality-round fact** (the `Fact` the loop embeds in the round record's `facts[]` — the driver adds
no writer of its own; `computeRoundRecord` wraps it):

```
name    : discovery-method
state   : verified
value   : the scan-round object above
reason  : round ran: ingested 0 experience(s), reflected 0 unit(s), minted 0 candidate(s),
          0 evaluated verdict(s) (0 correct), 0 promotion(s), 0 retirement(s), 0 model call(s),
          wall 14ms; appended 1 scan-round line to .quay/discovery-method-findings.jsonl
```

**Reading.** The `0` are real zeros, not a dead predicate: the evidence store's watermark already sits at
line 270 (the dependency task's run consumed it), so the ingest scanned 0 lines and ingested 0
Experiences; with nothing new, step (b) is SKIPPED by construction (`reflected: null` — read as "not run",
never as "ran and found nothing") and the round makes **zero model calls** and **zero pin
materialisations**. `held_out.read: false` with `cases: null` says the held-out pool was never opened
(there were no candidates to validate) — deliberately distinct from "the pool was read and was empty"
(硬规则 3b). The three persistent Discovery carriers were left byte-identical by the round:

```
before == after:
  .quay/discovery-experience-ledger.jsonl   md5 c604e7f366fc2fbf5b70f28e540c4a27
  .quay/discovery-method-registry.jsonl     md5 47a30ed2c5a0fb9314c18ad4809259b0
```

The declaration is picked up by the PRODUCTION config of that root (the same read `main()` performs):

```
$ node --experimental-strip-types .quay/ac3/wiring-probe.mjs
{"present":true,"error":null,"enabled":true,"intervalMinutes":360,"maxExperiences":8,"maxModelCalls":6,"maxWallMs":900000}
{"name":"discovery-method","schedule":{"kind":"interval","minutes":360}}
{"modelSeamOk":true,"modelId":"v4.1flash-anthropic","reason":null}
```

…and the durable window advanced (`/data/home/yale/work/quay/.quay/routine-last-run.json`):
`"discovery-method": 1791796240114`.

### AC4 — production round written by the resident quality-gate driver

未读到. The routine is declared (`loop.discovery_method:` in the workspace config) and assembled by the
driver's routine table, but no round has been written by the RESIDENT quality-gate driver yet — the only
`scan-round` line in the carrier is the one-shot run above (AC3). Nothing here can manufacture that line:
it requires the resident driver to reach a due window (360m) after this task lands, which is exactly what
AC4 says to leave unticked for.

## Touches
- tasks/gap-discovery-method-routine-report-only.md
- plugin/scripts/discovery-method-routine.ts (new)
- plugin/test/discovery-method-routine.test.mjs (new)
- plugin/scripts/quality-gate-driver.ts
- plugin/scripts/capability-catalog-declarations.json
- docs/carrier-registry.json
- .quay/config.yml

## Blocker

**2026-10-12T09:26:07.367Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: AssertionError [ERR_ASSERTION]: the real publish script FAILED (exit 1):
- run_id：wk-prod-anchor
- session_id：260a7c53-998a-4683-91ea-a29b5641f50f
