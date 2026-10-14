---
id: gap-evidence-store-has-no-resident-producer-so-discovery-method-ingests-nothing-forever
title: evidence store 只被空引导、仍无任何常驻 routine 写入 → discovery_method 永远
  verified/ingested 0（与「本轮无新增」同形）
status: todo
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra: {}
---
## Proposal
**Follow-up to `gap-discovery-method-evidence-store-never-autonomously-populated` (done, chose option (b): bootstrap an empty store).** Measured 2026-10-14 on ClaudeCodeUI, r5 dist kernel. The fix behaves as designed. The first resident discovery-method round bootstrapped an empty store (`ingested.store_bootstrapped:true`, `.quay/architecture-evidence-store.jsonl` = 0 bytes) and reported:

`verified | ingested 0 experience(s), reflected 0 unit(s), minted 0 candidate(s), 0 evaluated verdict(s) … 0 model call(s), wall 42ms`.

That reading is honest, but it is now permanent. Option (a) was not done: **still zero resident routines pass `writeStore:true`** (`grep -n writeStore plugin/scripts/*-routine.ts` → 0 hits). Nothing will ever append an `outcome` to that store on this host. So discovery-method will report a clean, empty, `verified` round every 360m indefinitely: enabled and invoked, but structurally unable to ingest an Experience. Under the original `EVIDENCE_STORE_MISSING` this condition was at least visible as `failed`. Now it is shaped like "nothing new this round" (硬规则 4: a reading that cannot be non-zero carries no information).

Real outcome material does exist on this host. OSD's resident rounds already produce verifier/refuter verdicts per cluster. In `.quay/open-semantic-discovery-findings.jsonl`, `kind:"cluster"` records carry `verdict: undetermined/…` and `ingestion` records. They are simply never emitted into the store.

## Plan
1. Implement option (a) for ONE resident producer: OSD's round already holds real `hypothesis`/`outcome` shapes. It should `emit(..., {writeStore:true, root})` its own real cluster outcomes (validated by the production validator, refusals reported, never synthesized).
2. Make discovery-method's round distinguish "store bootstrapped/empty because no producer is wired" from "store has records, none new since the watermark". These are two different states and must not share the `verified … ingested 0` shape (3b).
3. No change to budgets, and no backfill of historical outcomes that cannot be re-validated.

## Acceptance Criteria
- [ ] AC1: before the fix, on a dist host with OSD + discovery_method enabled, a real OSD round with ≥1 cluster verdict leaves the store at 0 lines (pasted).
- [ ] AC2: after the fix, the same round appends the cluster's real outcome record(s) to the store (validator-accepted, pasted). The next discovery-method round ingests ≥1 Experience from them (pasted).
- [ ] AC3: discovery-method on an empty, never-written store reports a state distinct from "0 new since watermark" (pasted, both states).
- [ ] AC4: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC4 checked with pasted real evidence; no synthetic records; budgets unchanged.

## Touches
- tasks/gap-evidence-store-has-no-resident-producer-so-discovery-method-ingests-nothing-forever.md
- plugin/scripts/open-semantic-discovery-routine.ts
- plugin/scripts/discovery-method-routine.ts
- docs/analysis/discovery-experience-ledger.mjs
- plugin/test/open-semantic-discovery-routine.test.mjs
- plugin/test/discovery-method-routine.test.mjs
