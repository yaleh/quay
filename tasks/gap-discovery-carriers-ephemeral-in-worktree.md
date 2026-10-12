---
id: gap-discovery-carriers-ephemeral-in-worktree
title: "Discovery Method: ledger/registry/attempt carriers die with the
  worktree; persist to shared checkout atomically, quarantine the invalidly
  promoted method"
status: todo
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra: {}
depends_on:
  - gap-discovery-method-record-tool-vs-subject-leak
---
## Proposal
The read-only audit found that all Discovery Method runtime state is lost when a worktree is torn down:
- `.quay/discovery-experience-ledger.jsonl`, `.quay/discovery-method-registry.jsonl` and `.quay/discovery-reflection-attempts.jsonl` resolve relative to the CALLER's root.
- Every real run so far happened inside a task worktree, so on 2026-10-12 `ls /data/home/yale/work/quay/.quay/discovery-*` is empty.
- The Phase 2 run had to rebuild the registry because the Phase 0/1 carriers were already gone.
- The only `active` method ever recorded (`method-afe5ac899aa54241`, `shared-contract-divergence` v2) was promoted on invalid evidence (see `gap-discovery-method-generalization-lineage-and-temporal-binding`), and now exists nowhere.

Its absence is accidental, not a decision. Once persistence exists it must be retired explicitly and must not be re-promoted on that evidence.

## Plan
1. **Persistent location.** All three carriers resolve to the SHARED checkout via `resolveSharedCheckout` (`plugin/scripts/per-task-suite-record.ts`, git-common-dir based). This holds whatever the caller's cwd/root, including from a task worktree. An unresolvable shared checkout ⇒ refuse (`SHARED_CHECKOUT_UNRESOLVED`), never fall back to the worktree.
2. **Atomic, idempotent append.**
   - Each record is serialized with a deterministic `id`.
   - The append takes an exclusive lock file and writes one `O_APPEND` line followed by an fsync.
   - A record whose `id` already exists is skipped and reported (`DUPLICATE_ID`), not appended twice.
3. **Recovery.**
   - Readers report a torn or unparseable trailing line as `malformed_lines: N`; a malformed carrier is never shown as empty or clean.
   - A `repairCarrier(root, name)` function backs up the file, truncates ONLY a torn final line, and reports what it removed.
4. **Quarantine.**
   - Append a `status:"retired"` record for `shared-contract-divergence`. Its `retirement_reason` cites the invalid promotion: lineage leak (held-out was the v1 seed) and temporal mismatch (graded post-fix code against a pre-fix label).
   - `activeMethods(root)` returns only methods whose latest version is `active`.
   - Any transition to `active` must carry a `generalization_evidence` ref to a recorded `validateGeneralization` verdict that passed the lineage and temporal checks. Without it ⇒ `PROMOTION_WITHOUT_VALID_GENERALIZATION`.
5. Carriers stay gitignored. Declare them in `docs/carrier-registry.json` only if that registry covers `docs/analysis` producers; check, and state the result.

## Acceptance Criteria
- [ ] `node --test plugin/test/discovery-experience-ledger.test.mjs plugin/test/discovery-method-registry.test.mjs plugin/test/discovery-reflection.test.mjs` exits 0, with new cases:
  - (a) writing from a fixture git worktree lands in the fixture's MAIN checkout `.quay/`;
  - (b) an unresolvable shared checkout ⇒ refusal, no file written;
  - (c) re-appending the same record ⇒ `DUPLICATE_ID`, the file is byte-identical;
  - (d) a carrier with a torn last line reads as `malformed_lines: 1` and `repairCarrier` restores a parseable file with a backup;
  - (e) two concurrent appenders produce two whole lines, never an interleaved one;
  - (f) promotion to `active` without valid `generalization_evidence` ⇒ refused.
- [ ] Real: from inside this task's worktree, append one Experience and one method record. Then show they exist under `/data/home/yale/work/quay/.quay/` (paste `ls -la` and the lines), and do NOT exist under the worktree's `.quay/`.
- [ ] Quarantine, real: write the retirement record for `shared-contract-divergence` to the persistent registry. Paste it. Paste `activeMethods()` output showing it absent. Paste an attempted re-promotion citing the old evidence being refused.
- [ ] Mutation control: make the resolver fall back to the caller's root and show case (a) goes red. Paste, then revert.

## Definition of Done
- All AC ticked with output pasted.
- `scripts/test.sh --for-task gap-discovery-carriers-ephemeral-in-worktree` green.

## Touches
- tasks/gap-discovery-carriers-ephemeral-in-worktree.md
- docs/analysis/discovery-experience-ledger.mjs
- docs/analysis/discovery-method-registry.mjs
- docs/analysis/discovery-reflection.mjs
- plugin/test/discovery-experience-ledger.test.mjs
- plugin/test/discovery-method-registry.test.mjs
- plugin/test/discovery-reflection.test.mjs
