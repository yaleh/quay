---
id: gap-quality-continuous-resource-diagnostic-routine-mechanical-filter-then-semantic
title: Quality 持续资源诊断
  routine：机械采集筛选在前、语义只处理新异常，复用既有架构发现身份/去重/verifier-refuter/Portfolio
status: ready
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra: {}
depends_on:
  - gap-suite-verdict-green-on-oom-killed-incomplete-run-lands-on-11-percent-of-files
  - gap-suite-memory-telemetry-anon-file-shmem-swap-psi-concurrency-process-tree-unknown-not-zero
  - gap-test-spawned-resident-drivers-outlive-their-suite-no-process-group-reaping
  - gap-resumable-long-experiments-via-driver-adopt-restart-not-separate-scheduler
---
## Proposal
**Capability requested 2026-10-14: a Quality-kind routine that continuously diagnoses the unified execution record (A: completeness/OOM, telemetry, process-lifecycle) for OOM/leak/hang/long-tail/repeated-expensive-experiment anomalies, mechanically collecting and filtering BEFORE any model call, and calling a model only on evidenced NEW anomalies — not re-diagnosing the whole history every round.**

This session's own diagnosis of `quality-gate-driver-loop-watchdog.test.mjs` is the worked example this routine should have caught automatically: a file's duration/outcome shape changed sharply at a specific commit (1.7-1.9s pass -> hang, 4/4 times, exactly at `e18ec4b04`). That pattern (a mechanical signal: duration distribution shift keyed to a commit range) is detectable without any model call; a model is only useful for the causal narrative, after the mechanical signal already narrowed the suspect to one file and one commit range.

Must cooperate with, not duplicate, the architecture-discovery identity/dedup work already landed (`gap-discovery-findings-lack-stable-identity-and-source-evidence-and-double-ingest-into-experience`, done) and the existing Finding -> verifier/refuter -> Task -> merge -> Portfolio/Experience pipeline (`open-semantic-discovery-routine.ts`, `discovery-method-routine.ts`). It must reuse that pipeline's verifier/refuter and dedup mechanism, not build a second one.

## Plan
1. **Mechanical pass, every quality round, no model call.** Read the unified record (A's completeness/telemetry/lifecycle carriers) for new occurrences of: a file whose pass/hang/duration shape changed at a specific commit boundary (watchdog-class); a leaked/orphaned process (lifecycle-class); an OOM kill (telemetry-class); a test or experiment whose wall time sits far outside its own historical distribution (long-tail-class); the same expensive experiment re-running from scratch when a checkpoint existed (repeat-expensive-class, ties to the C task). Each class has a concrete, re-derivable signal — not a vibe.
2. **Model call only on a mechanically-flagged NEW anomaly**, using the stable identity key from the landed identity/dedup task so the same recurring anomaly across rounds is one Finding, not N. The model's job is narrowing cause (e.g. which commit, which code path) and proposing the fix direction — it does not re-scan history that the mechanical pass already covered.
3. Route through the EXISTING verifier/refuter + Portfolio/Experience pipeline for confirmation and record-keeping. Do not add a second confirmation mechanism.
4. A confirmed Finding files a Task via the ABI (with the existing mechanism dedup, reused), and after the fix merges, a post-merge effect re-test compares the SAME metric on the same commit-class boundary (e.g.: does the file's duration distribution return to its pre-anomaly shape after the fix lands) — this is the "comparable effect re-test" requirement, and it is a direct re-measurement, not the fix task's own AC.
5. Budget: the mechanical pass costs no model call ever; the semantic pass is capped the same way OSD/discovery-method already are (existing 24h ledger pattern), not a new unlimited allowance.

## Acceptance Criteria
- [x] AC1: fixture unified-record history containing a planted watchdog-class anomaly (a file's duration shape shifts exactly at a fixture commit). The mechanical pass flags it with NO model call made (pasted: zero reservations on the ledger for this pass). A fixture history with no anomaly flags nothing (negative control, pasted).
  - POSITIVE: `node --experimental-strip-types plugin/scripts/resource-anomaly-detector.ts --rounds /tmp/rad-ev/ac1-anomaly.jsonl --root /tmp/rad-ev --no-carrier --json` ⇒ `{"rounds_read":2,"anomalies":1,"distinct_concept_keys":1,"fresh":1,"reservations_before":0,"reservations_after":0,"reservations_delta":0,"classes":["watchdog-shape-shift"]}`; fresh = `{"class":"watchdog-shape-shift","subject":"plugin/test/foo.test.mjs","concept_kind":"resource-watchdog-shape-shift","concept_key":"resource-watchdog-shape-shift|plugin/test/foo.test.mjs","detail":"plugin/test/foo.test.mjs: shape changed at commit c2 (pass->fail+duration-jump)"}`. The fixture: 3 rounds at commit `c1` at 1.7-1.9s passing, 3 rounds at commit `c2` at 60s failing.
  - NEGATIVE CONTROL: `--rounds /tmp/rad-ev/ac1-stable.jsonl` (same file, same two commits, stable durations) ⇒ `{"anomalies":0,"fresh":0,"classes":[],"reservations_delta":0}`.
  - `reservations_delta` is MEASURED, not a constant the code returns: the budget ledger (`.quay/resource-diagnostic-model-budget.jsonl`) is counted immediately before and after the pass. The only reservation point in the module is inside `runSemanticPass`, which a mechanical pass never reaches.
  - The same reading on the REAL 191 MB `.quay/verification-round.jsonl` (200-round tail-bound window, 1005 files) ⇒ `{"rounds_read":200,"anomalies":161,"distinct_concept_keys":25,"fresh":25,"repeated":136,"reservations_delta":0}`, classes `{"long-tail-duration":19,"watchdog-shape-shift":4,"oom-kill":1,"leaked-process":1}` — a 25-suspect list, not corpus noise (the thresholds were swept on this data; the calibration numbers are recorded at the constants).
- [x] AC2: the SAME planted anomaly, recurring across 3 fixture rounds, produces exactly ONE Finding (identity-keyed), not three (pasted).
  - Fixture `/tmp/rad-ev/ac2.jsonl` = 4 rounds with THREE successive commit boundaries, each repeating the same pass->fail/duration shift for one file.
  - PASS 1 (`--rounds /tmp/rad-ev/ac2.jsonl --root /tmp/rad-ev --carrier /tmp/rad-ev/ac2-carrier.jsonl --json`) ⇒ `{"anomalies":3,"keyed":3,"distinct_concept_keys":1,"fresh":1,"repeated":2,"appended":2}` — three readings, ONE key, ONE Finding.
  - PASS 2 over the SAME signal ⇒ `{"anomalies":3,"keyed":3,"distinct_concept_keys":1,"fresh":0,"repeated":3,"appended":1}`.
  - Carrier after both passes (3 lines): `anomaly resource-watchdog-shape-shift|plugin/test/foo.test.mjs | plugin/test/foo.test.mjs: shape changed at commit c2 (pass->fail+duration-jump)` / `scan-round: anomalies=3 fresh=1 repeated=2` / `scan-round: anomalies=3 fresh=0 repeated=3`. Exactly ONE `kind:"anomaly"` line across two passes; the recurrence lives on the scan-round line.
  - The key is the landed `conceptKeyOfCluster` (`docs/analysis/discovery-experience-ledger.mjs`, resolved at runtime by file URL — `concept_key_module` names it), shape `<concept_kind>|<sorted,normalized components>`; the detector invents no second key vocabulary.
- [x] AC3: the Finding reaches the existing verifier/refuter path and, on confirmation, files a task through the ABI with the existing mechanism dedup active (pasted; a duplicate mechanical-signal as an already-filed task is NOT re-filed).
  - The cluster handed to the EXISTING verifier engine (`docs/analysis/arch-hypothesis-generation.mjs` `runVerifier`, via its OWN new `clustersFromAnomalySeeds` adapter that owns the verifier's input contract): `[{"rep":{"concept_kind":"resource-watchdog-shape-shift","components":["plugin/test/foo.test.mjs"],"comps":["foo.test.mjs"],"claim":"plugin/test/foo.test.mjs: shape changed at commit c2 (pass->fail+duration-jump)","evidence_needed":"the per-file/per-round readings named on the finding (duration, outcome, commit boundary, leaked pids, oomKill)","counterexample_requirement":"a reading of the SAME carriers in which this file's/round's shape does not differ from its own history","confidence":null,"concept_key":"resource-watchdog-shape-shift|plugin/test/foo.test.mjs"},"members":["seed:1"]}]`
  - NEW ⇒ `{"concept_key":"resource-watchdog-shape-shift|plugin/test/foo.test.mjs","verified":"supported","refuted":"supported","confirmed":true,"filed":true,"gate_reason":"accepted: actionable, novel, within rate","task_id":"gap-routine-resource-watchdog-shape-shift-e41d43ea"}` (two passes: the verifier pass and an INDEPENDENT refuter pass, both the same `runVerifier`).
  - DUPLICATE (the same mechanical signal already on the board) ⇒ `{"verified":"supported","refuted":"supported","confirmed":true,"filed":false,"gate_reason":"dedup: the board holds 'symbols:plugin/test/foo.test.mjs,resource-watchdog-shape-shift' but its owner's status was NOT EVALUATED ... ⇒ fail-closed","task_id":null}` — created tasks unchanged (still exactly one). The decision is the EXISTING `gateFinding`/`findingKey` (`plugin/scripts/routine-file-gate.ts`); the routine adds no second dedup.
  - REFUTED ⇒ `{"verified":"supported","refuted":"refuted","confirmed":false,"filed":false,"gate_reason":"refuter did not let it through (refuted)"}`. UNREADABLE verifier output ⇒ `{"verified":null,"confirmed":false,"gate_reason":"verifier did not support (not-evaluated:unreadable-verdict)"}` (硬规则 3b).
  - Round level: a NEW anomaly buys exactly one model-side pass; a RECURRENCE buys none (`fresh:0` ⇒ `submittedKeys:[]`, zero spawn); the round-level submit-once throttle is the EXISTING ledger (`readSubmittedKeys`/`appendSubmission`, `plugin/scripts/architecture-review-cluster.ts`); a `max_model_calls_per_24h: 0` cap records `refused: "budget-24h: 0 ≥ cap 0"` and spawns nothing; `halted` records `not-evaluated` with the mechanical reading still appended.
- [x] AC4: a fixture post-merge effect re-test: the same metric, same measurement method, before and after a fixture "fix" commit, reported as the comparison (not the fix task's own AC) (pasted).
  - `--effect-baseline 1800,1850,1750,1900 --effect-before 60000,61000,60500 --effect-after 1850,1800,1900` ⇒ `{"metric":"per-file durationMs","method":"median of the file's own __PERFILE__ durations over the window (.quay/verification-round.jsonl perFile[].durationMs)","baseline":{"n":4,"medianMs":1825},"anomalous":{"n":3,"medianMs":60500},"after":{"n":3,"medianMs":1850},"ratio_after_vs_baseline":1.0137,"verdict":"restored","reason":"after median 1850ms is 1.01× the pre-anomaly baseline 1825ms (tolerance 1.5×) — the shape returned"}`.
  - Negative controls, all distinct: after window still slow ⇒ `still-anomalous`; empty after window ⇒ `not-evaluated`; blank `--effect-after ""` ⇒ `not-evaluated` (⛔ measured defect found and fixed: `Number("")` is 0, so a blank window parsed to `[0]` and read as `restored`); the anomalous window not ≥2× the baseline ⇒ `not-evaluated` ("this is not the anomaly the re-test claims to have fixed").
  - This is a DIRECT re-measurement of the same metric by the same method on the same carriers — ⛔ not the fix task's own AC.
- [x] AC5: `scripts/test.sh --for-task <this task>` green.
  - `bash scripts/test.sh --for-task gap-quality-continuous-resource-diagnostic-routine-mechanical-filter-then-semantic --allow-thin` ⇒ exit 0; `ℹ tests 121 / pass 121 / fail 0`.
  - `anti-drift-touches-check.ts --task … --worktree … --merge-target develop` ⇒ `ANTI-DRIFT OK … 7 actual file(s), all within declared Touches (8 glob(s))`.
  - `bash plugin/scripts/capability-catalog.sh | tail -1` ⇒ `383 scripts | 383 declared | 0 unclassified`; `carrier-registry-completeness` 5/5; `plugin/test/quality-gate-driver.test.mjs` 58/58 (the built-in four routines and their "exactly four" assertions are unchanged — the new routine rides the declarative track, like arch-discovery).

## Definition of Done
- AC1-AC5 checked with pasted evidence. No new dedup mechanism, no new verifier/refuter, no new Portfolio/Experience carrier — all reused from the landed architecture-discovery machinery. No budget ceiling raised. The registration surfaces that a NEW `plugin/scripts/*` file and two new runtime carriers oblige — the six capability tables in `plugin/scripts/capability-catalog-declarations.json`, the two entries in `docs/carrier-registry.json`, and the two ignore rules in `.gitignore` — are declared in `## Touches` and edited there, not left unregistered.

## Touches
- tasks/gap-quality-continuous-resource-diagnostic-routine-mechanical-filter-then-semantic.md
- plugin/scripts/quality-gate-driver.ts
- plugin/scripts/resource-anomaly-detector.ts
- docs/analysis/arch-hypothesis-generation.mjs
- plugin/test/resource-anomaly-detector.test.mjs
- plugin/scripts/capability-catalog-declarations.json
- docs/carrier-registry.json
- .gitignore
