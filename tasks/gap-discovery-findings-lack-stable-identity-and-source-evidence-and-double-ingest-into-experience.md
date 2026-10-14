---
id: gap-discovery-findings-lack-stable-identity-and-source-evidence-and-double-ingest-into-experience
title: 架构发现 finding 无稳定身份(212 簇 212 个 record_id)、无真实源码证据(0/212)、同一簇经 OSD 直写与
  store→ingest 两路重复进 Experience
status: ready
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra: {}
---
## Proposal
**Three measured defects in how architecture-discovery findings are identified and evidenced (2026-10-14, quay's own carriers).**

**1. No claim carries source evidence.** `.quay/open-semantic-discovery-findings.jsonl` holds 212 `kind:"cluster"` records, and **0 of 212** carry any evidence field. A claim points only at `members` (e.g. `["r1:H3"]`), which are hypothesis ids inside a per-run temp directory that does not survive the round. So no persisted claim can be checked against the source it is about. The Portfolio (`.quay/discovery-portfolio.jsonl`, 39 rows) has `evidence_level` but no file:line references either.

**2. No stable identity across rounds.** The 212 clusters have **212 distinct `record_id`s** of the form `open-semantic-discovery@<round-ts>#<n>`. Identity is per round, so the same concept rediscovered next round is a new finding. Cross-round linkage happens only through the Portfolio's `duplicate_of`. Arch-discovery uses yet another identity scheme (`finding_fp` / `subject_key` `<class>:<name>|<path>#<line>`), and OSD only reads it for dedup candidates.

**3. Latent double count of the same cluster in the Experience ledger.** Since `gap-evidence-store-has-no-resident-producer-so-discovery-method-ingests-nothing-forever` landed (07:50Z, `647161286`), one OSD cluster reaches `.quay/discovery-experience-ledger.jsonl` by **two** paths:
- (i) **directly**, via `ingestExperience` (`open-semantic-discovery-routine.ts:2507`), with `source_ref = open-semantic-discovery@…` and `caseId = clusterCaseId(recordId)`;
- (ii) via the evidence-store projection (`:4906`, `emit(writeStore:true)`), which discovery-method's `ingestNewOutcomes` then ingests with `source_ref = outcome-<hash>`.

The two `source_ref`s never match, so ledger dedup cannot see that they are the same cluster. Reflection then counts it twice. **Measured frequency so far: 0.** No OSD round with ≥1 cluster has run since the producer landed (store outcomes referencing OSD = 0; via-store ledger entries from an OSD projection = 0), so this is latent, but deterministic on the first such round. Hard rule 12 applies: AC1 must reproduce it before any fix.

## Plan
1. **Stable identity.** Derive a concept key for a cluster from its normalized subject: the sorted component paths plus `concept_kind`, the same normalization arch-discovery's `componentsFromSubjectKey` uses. Store it on every cluster record, Portfolio row, store outcome and Experience entry, and use it as the dedup key across rounds and across both ingestion paths. `record_id` stays as the per-round occurrence id. Do not rewrite historical records. A fold or map file is fine.
2. **Real source evidence.** For confirmed and for verifier-supported clusters, persist the `file:line` (+ commit pin) citations the verifier/refuter actually read with its tools during the round, extracted from the real tool-call results in the call capture. **Never from model prose alone.** A citation whose line does not exist at the pin, or does not contain the quoted text, is dropped and counted (`evidence_unverifiable:N`). A cluster with no surviving citation is recorded as such, not given an invented one.
3. **One path into Experience per cluster.** Pick one: either OSD stops the direct `ingestExperience` and lets the store path be the single route, or the store projection carries the concept key and `ingestNewOutcomes` skips an outcome whose concept key already has a system Experience from the same round. State the reason for the choice.

> **Chosen: the second, and here is the reason.** The direct carrier→Experience projection stays the authoritative route and the store path is deduped against it, because the DIRECT route is the one that carries the round's own narration — `role`/`summary`/`components` read off the carrier record, `evidence_level: production-open`, and the `source_ref` back-pointer to the exact carrier line. The store projection's only unique contribution is making the store non-empty for the batch ingester. Removing the direct route would delete that narration, and it would make the ledger's contents depend on whether `discovery-method` happened to run in the same window as the round. The dedup is scoped to ONE round: a later round's occurrence of the same concept is a legitimate new occurrence (the ledger's own `recurred-after-fix` reading is built on exactly that), so a global concept-key dedup would delete a real signal. The chosen rule is spelled in `ingestNewOutcomes` and the skip is named by its own reason code.

## Acceptance Criteria
- [x] AC1: reproduce the double count first. A fixture OSD round with 1 verified cluster, then a discovery-method ingest, yields **2** ledger entries for the one cluster (different `source_ref`) on the pre-fix code (pasted). After the fix: exactly 1 (pasted).
  - One script, run against BOTH checkouts, driving the REAL modules on each side (`clusterStoreRecords` → the store's own writer → `ingestNewOutcomes`), one confirmed cluster via the direct path and the store path.
  - PRE-FIX (`9999f7b22`): `ledger_entries_for_this_one_cluster: 2`; `source_refs: ["open-semantic-discovery@2026-10-14T09:00:00.000Z#1", "outcome-8a1bd12c3b2d5ff4"]`; `ingest {scanned:1, ingested:1, duplicates:0}`; projected records carry `concept_key=(absent)`.
  - POST-FIX (same script, same fixture): `ledger_entries_for_this_one_cluster: 1`; `source_refs: ["open-semantic-discovery@2026-10-14T09:00:00.000Z#1"]`; `ingest {scanned:1, ingested:0, duplicates:1, concept_duplicates:1}`; projected records carry `concept_key=duplication|plugin/scripts/x.ts`.
  - The reading is a skip that can take a false value: `ingestNewOutcomes` still READS the store (`scanned:1`), and a genuinely new outcome (a different round, an unseen subject) still becomes an Experience — asserted as the negative control in `discovery-experience-ledger.test.mjs` and `open-semantic-discovery-routine.test.mjs`.
- [x] AC2: the same concept found in two separate fixture rounds gets the same concept key, with two occurrences linked, not two independent findings (pasted).
  - Two real rounds, same components + `concept_kind`, DIFFERENT claim (so the round's own mechanical byte-identical exception cannot be what links them):
    `round1 open-semantic-discovery@2026-10-14T08:29:24.538Z#1 concept_key=duplication|a.ts occurrences=1`
    `round2 open-semantic-discovery@2026-10-14T08:39:24.595Z#1 concept_key=duplication|a.ts occurrences=2 linked=["open-semantic-discovery@2026-10-14T08:29:24.538Z#1"]`
  - The linkage is a FOLD over the carrier's own earlier production clusters (every earlier cluster record already carries the subject the key is derived from), so historical records are keyed without being rewritten; both Portfolio rows and every Experience entry carry the same `concept_key`, while the per-round `record_id`s stay distinct.
- [x] AC3: a real OSD round (resident or fixture-replayed from a real call capture) persists ≥1 verifier citation `file:line@commit` that a mechanical check confirms exists with the quoted text. A fabricated citation planted in a fixture capture is rejected and counted (pasted, both).
  - `citations=[{"file":"plugin/scripts/a.ts","line":1,"commit":"7511a0159965b9af4acd12645db661a56574894e","quote":"export const a = 1;"},{"file":"plugin/scripts/a.ts","line":2,"commit":"7511a0159965b9af4acd12645db661a56574894e","quote":"export const b = 2;"}]`
    `evidence_unverifiable=1` — and `evidence_lines` (the model's own prose) is carried SEPARATELY: `["a.ts:1 — fixture evidence"]`.
  - The mechanical check, run independently of the round: `git show 7511a0159965b9af4acd12645db661a56574894e:plugin/scripts/a.ts | line 1 = "export const a = 1;"` — the round's pin is a REAL checkout of that commit, so `file:line@commit` is checkable rather than decorative.
  - The fabricated pair (a `Read` result claiming line 99 of a 2-line file) appears in NO `citations` list and is COUNTED in `evidence_unverifiable`; the citation text comes from the tool RESULT's bytes, never from the model's answer.
- [x] AC4: no budget change; no historical record rewritten.
  - No budget-carrying line is touched: `git diff develop...HEAD` over the two routines matches no `max_model_calls_per_24h` / per-call ceiling / `reservingStep(` / cap arithmetic line ⇒ `(none)`; no model call was added (`reservingStep` call sites are unchanged), and the pre-existing call-count assertions still pass.
  - No migration, backfill or rewrite path was added (`(no migration/backfill/rewrite path was added)`). `concept_key` is additive on records written from now on; a record that predates the field is keyed by DERIVING the key from its own `concept_kind` + `components` at read time, in the fold — nothing on disk is rewritten.
- [x] AC5: `scripts/test.sh --for-task <this task>` green.
  - `bash scripts/test.sh --for-task gap-discovery-findings-lack-stable-identity-and-source-evidence-and-double-ingest-into-experience --allow-thin` ⇒ exit 0; `ℹ tests 278 / pass 278 / fail 0`.
  - Anti-drift (`anti-drift-touches-check.ts --merge-target develop`) ⇒ `ANTI-DRIFT OK … 6 actual file(s), all within declared Touches (7 glob(s))`.

## Definition of Done
- AC1-AC5 checked with pasted evidence. No citation in any carrier originates from model prose without a matching tool read. (A cluster's `citations` are derived ONLY from the `Read` tool results in the call's own stream; a citation that does not re-check against the pin is dropped and counted, and a cluster with nothing surviving records an empty list plus a nonzero `evidence_unverifiable` — never an invented citation.)

## Touches
- tasks/gap-discovery-findings-lack-stable-identity-and-source-evidence-and-double-ingest-into-experience.md
- plugin/scripts/open-semantic-discovery-routine.ts
- plugin/scripts/discovery-method-routine.ts
- docs/analysis/discovery-experience-ledger.mjs
- docs/analysis/discovery-portfolio.mjs
- plugin/test/open-semantic-discovery-routine.test.mjs
- plugin/test/discovery-experience-ledger.test.mjs
