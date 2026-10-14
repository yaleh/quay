---
id: gap-quality-continuous-resource-diagnostic-routine-mechanical-filter-then-semantic
title: Quality 持续资源诊断
  routine：机械采集筛选在前、语义只处理新异常，复用既有架构发现身份/去重/verifier-refuter/Portfolio
status: todo
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
- [ ] AC1: fixture unified-record history containing a planted watchdog-class anomaly (a file's duration shape shifts exactly at a fixture commit). The mechanical pass flags it with NO model call made (pasted: zero reservations on the ledger for this pass). A fixture history with no anomaly flags nothing (negative control, pasted).
- [ ] AC2: the SAME planted anomaly, recurring across 3 fixture rounds, produces exactly ONE Finding (identity-keyed), not three (pasted).
- [ ] AC3: the Finding reaches the existing verifier/refuter path and, on confirmation, files a task through the ABI with the existing mechanism dedup active (pasted; a duplicate mechanical-signal as an already-filed task is NOT re-filed).
- [ ] AC4: a fixture post-merge effect re-test: the same metric, same measurement method, before and after a fixture "fix" commit, reported as the comparison (not the fix task's own AC) (pasted).
- [ ] AC5: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC5 checked with pasted evidence. No new dedup mechanism, no new verifier/refuter, no new Portfolio/Experience carrier — all reused from the landed architecture-discovery machinery. No budget ceiling raised.

## Touches
- tasks/gap-quality-continuous-resource-diagnostic-routine-mechanical-filter-then-semantic.md
- plugin/scripts/quality-gate-driver.ts
- plugin/scripts/resource-anomaly-detector.ts
- docs/analysis/arch-hypothesis-generation.mjs
- plugin/test/resource-anomaly-detector.test.mjs
