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

## Acceptance Criteria
- [ ] AC1: reproduce the double count first. A fixture OSD round with 1 verified cluster, then a discovery-method ingest, yields **2** ledger entries for the one cluster (different `source_ref`) on the pre-fix code (pasted). After the fix: exactly 1 (pasted).
- [ ] AC2: the same concept found in two separate fixture rounds gets the same concept key, with two occurrences linked, not two independent findings (pasted).
- [ ] AC3: a real OSD round (resident or fixture-replayed from a real call capture) persists ≥1 verifier citation `file:line@commit` that a mechanical check confirms exists with the quoted text. A fabricated citation planted in a fixture capture is rejected and counted (pasted, both).
- [ ] AC4: no budget change; no historical record rewritten.
- [ ] AC5: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC5 checked with pasted evidence. No citation in any carrier originates from model prose without a matching tool read.

## Touches
- tasks/gap-discovery-findings-lack-stable-identity-and-source-evidence-and-double-ingest-into-experience.md
- plugin/scripts/open-semantic-discovery-routine.ts
- plugin/scripts/discovery-method-routine.ts
- docs/analysis/discovery-experience-ledger.mjs
- docs/analysis/discovery-portfolio.mjs
- plugin/test/open-semantic-discovery-routine.test.mjs
- plugin/test/discovery-experience-ledger.test.mjs
