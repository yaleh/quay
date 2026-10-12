---
id: gap-discovery-experience-auto-ingest-from-evidence-store
title: "Discovery Method: no automatic Experience ingestion; watermarked,
  quota-bounded, killable ingester from evidence-store outcomes via one unified
  entry"
status: ready
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra: {}
depends_on:
  - gap-discovery-carriers-ephemeral-in-worktree
---
## Proposal
The read-only audit found that no Experience is ever ingested automatically. `ingestFromEvidenceStoreOutcome` (`docs/analysis/discovery-experience-ledger.mjs`) has no caller outside its test. In the only real run, the 5 system-sourced entries were chosen by a worker, and their `role`/`components`/`summary` were hand-written — and the summaries stated the answer ("paired with two divergent keys", "REQUIRED_FIELDS declared twice"), which then went verbatim into the reflection prompt.

The user's requirement is that every system-produced Finding enters through the SAME controlled entry as user feedback: one function, two sources. It must not require a human to pick records or describe them.

## Plan
1. **Unified entry.** `ingestExperience(root, { source: "system" | "user", ... })`. `ingestFeedback` and the evidence-store adapter become thin callers of it. One validator, one dedup, one carrier.
2. **Automatic batch ingester.** `ingestNewOutcomes(root, { maxPerRun, enabled })` scans `.quay/architecture-evidence-store.jsonl` for `kind:"outcome"` records past a persisted watermark: `{ line, line_sha256 }` in the shared-checkout `.quay/discovery-ingest-watermark.json`, written atomically.
   - **Derived fields.** The ingester derives everything from the record itself; nothing is caller-written.
     - `role` comes from `verdict`: supported → `found-unresolved`; refuted → `confirmed-negative`; undetermined → `undetermined`. Add `found-unresolved` and `undetermined` to the role vocabulary. `found-and-fixed` / `recurred-after-fix` only when the record names a task id whose develop status is `done` (and, for recurrence, a later outcome on the same `subject_key`).
     - `components` come from `subject_key`.
     - `summary` is the record's own `experiment_ref`/statement text, truncated.
   - **Pin.** `evaluation_pin` comes from the record's experiment pre-registration when resolvable (`prereg` path → `pin`); otherwise `null`, and `validateGeneralization` will refuse to use that Experience as a held-out.
3. **Controls.**
   - `maxPerRun` quota, with the remainder reported.
   - `enabled:false` ⇒ zero reads and zero writes (kill switch).
   - Dedup by `source_ref`.
4. **Fail-closed.**
   - Unreadable store ⇒ refuse.
   - The watermark line's sha256 no longer matches (store rewritten or truncated) ⇒ refuse with `WATERMARK_MISMATCH`. Never silently restart from line 0.
   - A malformed outcome line is counted and skipped, and the watermark does not advance past an unparsed line.
5. No model calls in ingestion.

## Acceptance Criteria
- [ ] `node --test plugin/test/discovery-experience-ledger.test.mjs` exits 0, with new cases:
  - (a) a fixture store with 3 outcomes ⇒ 3 Experiences, watermark at the last line;
  - (b) a second run ⇒ 0 ingested;
  - (c) `maxPerRun:2` ⇒ 2 ingested, the remainder reported, the next run ingests the rest;
  - (d) `enabled:false` ⇒ zero file writes;
  - (e) a rewritten store (watermark sha mismatch) ⇒ `WATERMARK_MISMATCH`, nothing written;
  - (f) `summary`/`components` equal the values derived from the record, and a caller-supplied summary is rejected for `source:"system"`;
  - (g) a user-sourced Experience goes through the same `ingestExperience` and lands in the same carrier.
- [ ] Real run against the real evidence store, in the persistent shared-checkout location (requires `gap-discovery-carriers-ephemeral-in-worktree`). Paste:
  - the outcome count scanned, Experiences ingested, duplicates skipped, and the watermark;
  - the derived records for the fan-in lock (`E-DT-1-Hp cluster 11`), REQUIRED_FIELDS (`E-HYPGEN-AB-1-B cluster 8`), C5 (`E-HYPGEN-ACCEPT-1 cluster 5`) and C7 (`E-HYPGEN-ACCEPT-1 cluster 7`, which must be `confirmed-negative`) outcomes;
  - a second run showing 0 new.
- [ ] Negative control: copy the store, delete its first line, point the ingester at the copy with the real watermark, and show `WATERMARK_MISMATCH`. Paste.

## Definition of Done
- All AC ticked with output pasted.
- `scripts/test.sh --for-task gap-discovery-experience-auto-ingest-from-evidence-store` green.

## Touches
- tasks/gap-discovery-experience-auto-ingest-from-evidence-store.md
- docs/analysis/discovery-experience-ledger.mjs
- plugin/test/discovery-experience-ledger.test.mjs
