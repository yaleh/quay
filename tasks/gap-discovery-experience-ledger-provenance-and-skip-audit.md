---
id: gap-discovery-experience-ledger-provenance-and-skip-audit
title: "Experience ledger: worker-written entries labelled user, no author
  field, and 5 filtered outcomes leave no per-record trace"
status: ready
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra: {}
---
## Proposal
Production acceptance check, 2026-10-12, of `.quay/discovery-experience-ledger.jsonl` (118 entries: 116 `system`, 2 `user`) against `.quay/architecture-evidence-store.jsonl` (121 outcomes).

1. **False user provenance.**
   - The 2 `reported_by:"user"` entries are `experience-5e20efdfaaf99116` (`EXP-carriers-ephemeral-in-worktree`) and `experience-2519951c56dc2990` (`EXP-post-gate-write`). Both were written by a task worker, carry a synthetic `ts` of `2026-10-12T00:00:00.000Z`, and describe a defect the worker itself found. No human reported them.
   - Meanwhile the one genuinely user-reported case, the Probe/Meta coupling the user pointed out before any tool ran, is ABSENT from the production ledger. It only ever existed in a since-destroyed worktree.
2. **Unauditable gap.**
   - The 5 outcomes without a ledger entry are store lines 9/18/28/40/49 (`outcome-9e6d7e295cbee878`, `-3d9cbb30bb825059`, `-44479971ff16fdac`, `-65c8177059358730`, `-1d5faf3428b4ecff`). All have `verdict:"proposed"` (ownership-active loop).
   - `ingestNewOutcomes` filters them (`docs/analysis/discovery-experience-ledger.mjs`, around line 1098: `if (!d.ok) { skipped++; ... continue; }`). It only increments `skipped_not_ingestible`; there is no per-record trace of what was skipped or why, and no way to re-evaluate when the mapping changes.
3. **No author on entries.** Every entry lacks an `authored_by`, so a worker-written entry cannot be told apart from a driver-ingested one.

## Plan
1. **`authored_by` is required on every new Experience:** `{actor: "ingester" | "task-worker" | "operator-session", ref: <task id | session id | "ingestNewOutcomes">}`.
2. **`reported_by:"user"` needs `user_provenance`:** `{kind: "conversation" | "task-body", ref, quote}`, where `quote` is ≥20 chars of the human's own words. Without it ⇒ `USER_PROVENANCE_MISSING`.
   - A write from a task-worker process with `reported_by:"user"` is always refused (`USER_SOURCE_FROM_WORKER`). Detect the worker via an explicit `authored_by.actor`; an absent actor is refused for `user`.
3. **Correct the two existing entries append-only:** write a `kind:"experience-correction"` record per entry, setting `reported_by:"system"` and `authored_by:{actor:"task-worker"}`, with the reason. Readers apply corrections. Never rewrite or delete the original lines.
4. **Per-record skip ledger:** `.quay/discovery-ingest-skips.jsonl`, with `{store_line, outcome_id, verdict, reason_code, mapping_version, ts}` for every outcome not ingested. Reason codes:
   - `VERDICT_NOT_INGESTIBLE:<verdict>`
   - `DUPLICATE_SOURCE_REF`
   - `READ_FAILED` (transient)
   - `MALFORMED`

   Recording rules:
   - Dedup skip records on `(outcome_id, reason_code, mapping_version)`.
   - `READ_FAILED` records are retried on the next round, and the watermark does not advance past them.
   - When the verdict→role mapping version changes, previously skipped `VERDICT_NOT_INGESTIBLE` records are re-evaluated.
5. **One-time backfill:** record a skip entry for each of the 5 existing gaps, using the real store lines. This makes `ingested + skipped == outcomes scanned` hold, and checkable.
6. **The genuine Probe/Meta user case:** the operator session (not a worker) ingests it with `user_provenance` quoting the user's own message.
   - The user message is in session `e6db01fa-cceb-44f2-8b83-02f868644460`; locate it with `grep` on that session's jsonl under `~/.claude/projects/-data-home-yale-work-quay/`.
   - The worker of this task must NOT perform this write. It only builds the path and leaves an operator command in the task body. That AC is marked （待外部）.

## Acceptance Criteria
- [ ] `node --test plugin/test/discovery-experience-ledger.test.mjs` exits 0, with new cases:
  - (a) a new Experience without `authored_by` is refused;
  - (b) `reported_by:"user"` without `user_provenance` ⇒ `USER_PROVENANCE_MISSING`;
  - (c) `reported_by:"user"` with `authored_by.actor:"task-worker"` ⇒ `USER_SOURCE_FROM_WORKER`;
  - (d) a correction record changes what readers report, and the original line stays byte-identical;
  - (e) a `proposed` outcome yields one skip record with `VERDICT_NOT_INGESTIBLE:proposed`, and a second round adds none (dedup);
  - (f) a simulated `READ_FAILED` holds the watermark and is retried and ingested on the next round;
  - (g) bumping `mapping_version` re-evaluates earlier `VERDICT_NOT_INGESTIBLE` skips.
- [ ] Real reconciliation on production carriers: after the backfill, paste outcomes scanned (121), ingested (116), skip records (5) with each `store_line`, `outcome_id` and `reason_code`, and the arithmetic `116 + 5 = 121` with 0 unexplained.
- [ ] Real correction: paste the two correction records, and a reader listing showing both entries now `reported_by:"system"` with `authored_by.actor:"task-worker"`. Paste the user-entry count after correction (0, until AC4).
- [ ] Operator ingestion of the genuine Probe/Meta user case with a real quote from the user's message, done by the operator session, not the worker. Paste the record. （待外部）
- [ ] Mutation control: drop the `USER_SOURCE_FROM_WORKER` rule and show case (c) goes red. Paste, then revert.

## Definition of Done
- AC1–AC3 and AC5 ticked with output pasted; AC4 by the operator or recorded as pending.
- `scripts/test.sh --for-task gap-discovery-experience-ledger-provenance-and-skip-audit` green.

## Touches
- tasks/gap-discovery-experience-ledger-provenance-and-skip-audit.md
- docs/analysis/discovery-experience-ledger.mjs
- plugin/test/discovery-experience-ledger.test.mjs
