---
id: gap-evidence-store-has-no-resident-producer-so-discovery-method-ingests-nothing-forever
title: evidence store 只被空引导、仍无任何常驻 routine 写入 → discovery_method 永远
  verified/ingested 0（与「本轮无新增」同形）
status: done
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

## How it was done
- **`docs/analysis/discovery-experience-ledger.mjs`** — new `clusterStoreRecords(clusterRecords, {experiment, runId})` projects a round's verdict-bearing cluster records into the store's OWN shapes (`{kind, rec}` for `emit`): a `hypothesis` carrying the cluster's own `claim` grounded in its own `evidence_lines` under the shared `subject_key` (the key the store's `joinOutcomeToClaims` joins on), and an `outcome` carrying `clusterVerdict(rec)` — the ONE existing derivation, reused, never a second reading of the same three fields. Shadow and baseline arms are excluded structurally (they reach neither the Portfolio nor the Experience ledger either). `ingestNewOutcomes` now also reports `store_records` (a direct count of record-holding lines) and a named `store_state` via the new pure `storeStateOf`: `empty` / `no-new-since-watermark` / `scanned-none-ingested` / `ingested`, with `null` for "never established".
- **`plugin/scripts/open-semantic-discovery-routine.ts`** — step ⑩c: after the carrier append and the Experience/Portfolio writes, the round projects those records with `emit(records, {writeStore:true, root})` **through the engine's production validator**, under the **shared checkout** the batch ingester itself resolves (`modules.ledger.resolveCarrierRoot`), and appends its own `kind:"evidence-store-write"` carrier line carrying the tally (`attempted` / `hypotheses` / `outcomes` / `accepted` / `refused` / `refused_reasons` / `stored` / `store_refused` / `error`). Refusals are reported, never dropped; nothing is synthesized — every field is read off the cluster record the round just wrote.
- **`plugin/scripts/discovery-method-routine.ts`** — the carrier `ingested` block carries `store_records` + `store_state`, and the round's Fact NAMES what its `ingested 0` means: the `EVIDENCE_STORE_NO_PRODUCER` token when the store holds 0 records, its own sentence for `no-new-since-watermark`, and a third for `scanned-none-ingested`. The vocabulary is read off the loaded ledger module, never re-spelled here.
- **Budgets unchanged.** The manual CLI's `--write-store` semantics are untouched (`out` is never passed).

## Acceptance Criteria
- [x] AC1: before the fix, on a dist host with OSD + discovery_method enabled, a real OSD round with ≥1 cluster verdict leaves the store at 0 lines (pasted).
- [x] AC2: after the fix, the same round appends the cluster's real outcome record(s) to the store (validator-accepted, pasted). The next discovery-method round ingests ≥1 Experience from them (pasted).
- [x] AC3: discovery-method on an empty, never-written store reports a state distinct from "0 new since watermark" (pasted, both states).
- [x] AC4: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC4 checked with pasted real evidence; no synthetic records; budgets unchanged.

## Evidence

Both legs use ONE recipe: a clean-room host (its own `git init -b develop`, a `plugin/scripts` tree so the discovery routines really have an inventory, a `quay init`-shaped `.quay/config.yml` + `profiles.yml`), whose `.quay/plugin` points at a **packaged dist kernel** — never a quay source checkout. The ONE variable between legs is the artifact:

```
BEFORE  /data/home/yale/work/quay-scratch/official-dist-020-dev-r5-kindstop   (the r5 dist kernel)
AFTER   /data/home/yale/work/quay-scratch/gap-evidence-after-artifact         (built from THIS branch by
        plugin/scripts/publish-dist-branch.sh --no-build --branch gap-evidence-dist → orphan 8d95564e3,
        materialised `.git`-free with `git archive`)

$ grep -c clusterStoreRecords      <X>/docs/analysis/discovery-experience-ledger.mjs   0 (BEFORE) / 1 (AFTER)
$ grep -c store_state              <X>/docs/analysis/discovery-experience-ledger.mjs   0 (BEFORE) / 4 (AFTER)
$ grep -c evidence-store-write     <X>/scripts/dist/quality-gate-driver.js             0 (BEFORE) / 1 (AFTER)
$ grep -c EVIDENCE_STORE_NO_PRODUCER <X>/scripts/dist/quality-gate-driver.js           0 (BEFORE) / 3 (AFTER)
$ grep -c writeStore               <X>/docs/analysis/*.mjs | grep -v ':0'              1 (BEFORE) / 2 (AFTER)
```

### AC1 — PASS (pre-fix dist kernel: a real OSD round with ≥1 cluster verdict leaves the store at 0 lines)

Host `/data/home/yale/work/quay-scratch/gap-evidence-store-target-b`, `.quay/plugin` → the r5 kernel. A pre-fix `discovery_method` round bootstrapped the store first, so the file **existed at 0 lines before** the OSD round:

```
$ node <r5>/scripts/dist/quality-gate-driver.js --once --root <host> --run-id b1-dm --json
--- discovery-method : verified
round ran (invoked_by:resident-driver, interval 360m): ingested 0 experience(s), reflected 0 unit(s),
  minted 0 candidate(s), 0 evaluated verdict(s) (0 correct), 0 promotion(s), 0 retirement(s),
  0 model call(s), wall 26ms; appended 1 scan-round line to .quay/discovery-method-findings.jsonl …
ingested={"experiences":0,"scanned":0,"duplicates":0,"advanced_to":0,"store_bootstrapped":true}
store after bootstrap: 0 line(s)
```

then ONE real OSD round (real `claude -p` calls through the production launcher):

```
$ node <r5>/scripts/dist/quality-gate-driver.js --once --root <host> --run-id b2-osd --json
--- open-semantic-discovery : verified
round ran (invoked_by:resident-driver, interval 360m): investigator read the pin with Read,Grep,Glob
  (focus: <not stated>), 12 cluster(s) from 1 run(s), 3 verified, 0 CONFIRMED after independent
  refutation, 7 model call(s) costing $0.669469, wall 265459ms; appended 1 scan-round + 3 cluster
  record(s) to .quay/open-semantic-discovery-findings.jsonl and advanced the production last-run;
  ingested 3 cluster(s): 3 Experience(s), 0 Portfolio row(s); methods BASELINE …

$ ls -l <host>/.quay/architecture-evidence-store.jsonl
-rw-rw-r-- 1 yale yale 0 Oct 14 15:27 architecture-evidence-store.jsonl
$ wc -l <host>/.quay/architecture-evidence-store.jsonl
0
```

The round's own three cluster records, read back off the carrier (`verifier_verdict` is the "≥1 cluster verdict"):

```json
{"record_id": "open-semantic-discovery@2026-10-14T07:27:49.829Z#1", "verifier_verdict": "undetermined", "refutation_verdict": "not-run", "confirmed": false}
{"record_id": "open-semantic-discovery@2026-10-14T07:27:49.829Z#2", "verifier_verdict": "undetermined", "refutation_verdict": "not-run", "confirmed": false}
{"record_id": "open-semantic-discovery@2026-10-14T07:27:49.829Z#3", "verifier_verdict": "undetermined", "refutation_verdict": "not-run", "confirmed": false}
```

The same shape was read on a second pre-fix host (`gap-evidence-store-target`, `--run-id ev1-before-osd`): 12 clusters, **3 verified / 1 confirmed**, 10 model calls, $0.621355, and the store **absent** afterwards. The zero is not an artifact of one host or one round's outcome.

### AC2 — PASS (the fix's round appends validator-accepted outcome records; the next discovery_method round ingests 3 Experiences)

Host `/data/home/yale/work/quay-scratch/gap-evidence-store-target-e`, `.quay/plugin` → the artifact built from this branch. One real OSD round:

```
$ node <AFTER>/scripts/dist/quality-gate-driver.js --once --root <host> --run-id e2-osd --json
--- open-semantic-discovery : verified
round ran (invoked_by:resident-driver, interval 360m): investigator read the pin with Read,Grep,Glob
  (focus: <not stated>), 12 cluster(s) from 1 run(s), 3 verified, 1 CONFIRMED after independent
  refutation, 13 model call(s) costing $0.882499, wall 560334ms; appended 1 scan-round + 3 cluster
  record(s) …; ingested 3 cluster(s): 3 Experience(s), 1 Portfolio row(s); methods BASELINE …
evidence_store={"attempted":3,"hypotheses":0,"outcomes":3,"accepted":3,"refused":0,
                "refused_reasons":{},"stored":3,"store_refused":[],"error":null}
```

The round's own `evidence-store-write` carrier line (the tally, refusals reported):

```json
{"kind":"evidence-store-write","routine":"open-semantic-discovery","invoked_by":"resident-driver","ts":"2026-10-14T07:41:58.837Z","round_ts":"2026-10-14T07:32:38.700Z","attempted":3,"hypotheses":0,"outcomes":3,"accepted":3,"refused":0,"refused_reasons":{},"stored":3,"store_refused":[],"error":null}
```

and the store it left — every record `accepted:3 / stored:3`, i.e. accepted by the production validator AND really appended:

```
$ wc -l <host>/.quay/architecture-evidence-store.jsonl
3
$ cat <host>/.quay/architecture-evidence-store.jsonl
{"kind":"outcome","id":"outcome-c65a37dfbd7ee66d","experiment":"open-semantic-discovery","experiment_ref":"open-semantic-discovery@2026-10-14T07:32:38.700Z#1","verdict":"refuted","subject_key":"invariant|rework-predictors.ts,worker-driver.ts","case_id":"open-semantic-discovery@2026-10-14T07:32:38.700Z#1","run":"osd-2048807-1791963158464-3dkpdl","ts":"2026-10-14T07:36:24.162Z","verdict_reason":"none","confirmed":false}
{"kind":"outcome","id":"outcome-a30499ee41bb756f","experiment":"open-semantic-discovery","experiment_ref":"open-semantic-discovery@2026-10-14T07:32:38.700Z#2","verdict":"supported","subject_key":"invariant|driver-filters.ts,over90-task-gate.ts,routine-file-gate.ts,task-status.ts","case_id":"open-semantic-discovery@2026-10-14T07:32:38.700Z#2","run":"osd-2048807-1791963158464-3dkpdl","ts":"2026-10-14T07:39:45.831Z","verdict_reason":"none","confirmed":true}
{"kind":"outcome","id":"outcome-f1f8ad97ac84e7c5","experiment":"open-semantic-discovery","experiment_ref":"open-semantic-discovery@2026-10-14T07:32:38.700Z#3","verdict":"undetermined","subject_key":"invariant|arch-coverage-report.ts,checker-io.ts,checker-mechanical-spine-check.ts,outer-anchor-check.ts,outer-cron-registry.ts,verify-plugin-channel-assertions.ts","case_id":"open-semantic-discovery@2026-10-14T07:32:38.700Z#3","run":"osd-2048807-1791963158464-3dkpdl","ts":"2026-10-14T07:41:50.144Z","verdict_reason":"verifier:verdict-not-in-vocab","confirmed":false}
```

Every field is the cluster's own: `experiment_ref` is the carrier cluster's `record_id`, the `verdict` is `clusterVerdict(rec)` off that same carrier line, and `subject_key` names the components that cluster named — nothing here was invented.

The NEXT `discovery_method` round, reading exactly that store:

```
$ node <AFTER>/scripts/dist/quality-gate-driver.js --once --root <host> --run-id e3-dm-ingest --json
--- discovery-method : verified
round ran (invoked_by:resident-driver, interval 360m): ingested 3 experience(s), reflected 3 unit(s),
  minted 0 candidate(s), 0 evaluated verdict(s) (0 correct), 0 promotion(s), 0 retirement(s),
  3 model call(s), wall 31381ms; appended 1 scan-round line …
ingested={"experiences":3,"scanned":3,"duplicates":0,"advanced_to":3,"store_bootstrapped":false,"store_records":3,"store_state":"ingested"}
```

and the three Experiences it wrote, read back from `.quay/discovery-experience-ledger.jsonl` (source = the store's outcome records, `reported_by:"system"`):

```
EXP-c65a37dfbd7ee66d | confirmed-negative | outcome-c65a37dfbd7ee66d | no-linked-claim-record | open-semantic-discovery@2026-10-14T07:32:38.700Z#1: verifier verdict "refuted" on subject invariant|rework-pre…
EXP-a30499ee41bb756f | found-unresolved    | outcome-a30499ee41bb756f | no-linked-claim-record | open-semantic-discovery@2026-10-14T07:32:38.700Z#2: verifier verdict "supported" on subject invariant|driver-f…
EXP-f1f8ad97ac84e7c5 | undetermined        | outcome-f1f8ad97ac84e7c5 | no-linked-claim-record | open-semantic-discovery@2026-10-14T07:32:38.700Z#3: verifier verdict "undetermined" on subject invariant|arch-…
```

⛔ **`hypotheses:0` is reported, not papered over.** These three clusters carried no `evidence_lines`, and the store's validator REFUSES an ungrounded hypothesis (`HYPOTHESIS_UNGROUNDED`). The projection therefore emitted no `hypothesis` record and the join resolves to the explicit third value `no-linked-claim-record` — the honest reading, not a synthesized citation (DoD: no synthetic records). A round whose clusters DO cite evidence projects a hypothesis too (pinned by the fixture test in `open-semantic-discovery-routine.test.mjs`).

### AC3 — PASS (two zeros, two readings)

```
$ … --run-id e1-dm-empty        (fresh host, store never held a record)
--- discovery-method : verified
round ran (invoked_by:resident-driver, interval 360m): ingested 0 experience(s) — EVIDENCE_STORE_NO_PRODUCER:
  the evidence store holds 0 record(s), so NOTHING has ever written it; this is NOT «nothing new since the
  watermark», it is a store with no resident producer, and it stays at 0 until one is wired, reflected 0
  unit(s), minted 0 candidate(s), … 0 model call(s), wall 29ms …
ingested={"experiences":0,"scanned":0,"duplicates":0,"advanced_to":0,"store_bootstrapped":true,"store_records":0,"store_state":"empty"}

$ … --run-id e4-dm-nonew        (the SAME host, after E2/E3: watermark at the end of the store)
--- discovery-method : verified
round ran (invoked_by:resident-driver, interval 360m): ingested 0 experience(s) — no new outcome records
  since the watermark (the store holds 3 record(s); this round read none past it), reflected 0 unit(s),
  minted 0 candidate(s), … 0 model call(s), wall 27ms …
ingested={"experiences":0,"scanned":0,"duplicates":0,"advanced_to":3,"store_bootstrapped":false,"store_records":3,"store_state":"no-new-since-watermark"}
```

Both rounds `ingested 0`; they are two different readings. Distinct `store_state`, distinct `store_records`, and two different sentences in the Fact — neither reachable from the other. (`advanced_to` 0 vs 3 is the watermark half of the same distinction.) The pre-fix kernel has neither: its `ingested` block stops at `store_bootstrapped`, and both of its rounds read the identical `verified … ingested 0 experience(s) …` sentence.

### AC4 — PASS

```
$ bash scripts/test.sh --for-task gap-evidence-store-has-no-resident-producer-so-discovery-method-ingests-nothing-forever --allow-thin
== scoped static checks (change-relevant tier; the complete set still runs in the full-suite gate) ==
  … 24 change-relevant checkers, all PASS …
ℹ tests 246
ℹ pass 246
ℹ fail 0
exit=0
```

Scoped-gate cache recorded for develop `53643b36b` (an ancestor of HEAD). Anti-drift Touches pre-merge gate:
`ANTI-DRIFT OK: … 5 actual file(s), all within declared Touches (6 glob(s))`.

### DoD
- AC1–AC4 checked, each with pasted real evidence above (two pre-fix OSD rounds, one post-fix OSD round, four `discovery_method` rounds).
- **No synthetic record.** The store's every byte comes from a cluster record the round had already written to its own carrier; the projection refuses (and reports) anything the production validator rejects, and the one case where it could have invented a citation (`hypotheses:0`) is reported instead.
- **Budgets unchanged**: no `max_experiences` / `max_model_calls` / `verify_reserve` / `max_wall_ms` / `max_model_calls_per_24h` / `max_usd_per_24h` value was touched by this change; the rounds above ran under the declared envelopes and their `reservations` blocks are on their carrier lines.

## Touches
- tasks/gap-evidence-store-has-no-resident-producer-so-discovery-method-ingests-nothing-forever.md
- plugin/scripts/open-semantic-discovery-routine.ts
- plugin/scripts/discovery-method-routine.ts
- docs/analysis/discovery-experience-ledger.mjs
- plugin/test/open-semantic-discovery-routine.test.mjs
- plugin/test/discovery-method-routine.test.mjs
