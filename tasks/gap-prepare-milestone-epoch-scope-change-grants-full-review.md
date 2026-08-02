---
id: gap-prepare-milestone-epoch-scope-change-grants-full-review
title: prepare-milestone epoch blocks a corrected task body's full review —
  scope change should grant a fresh full-review allowance
status: done
labels:
  - gap
  - defect
  - milestone-candidate
  - human-steered
parent: null
children: []
extra:
  schema: v1
---
**type:** execution

**Reclassified (2026-08-02, ADR-021 review):** this task has exactly **1 mechanism** (bodyScopeHash
scope-change grant). The A-J implementation steps in the Proposal are details of that single
mechanism, not independent mechanisms. The split decision at
`milestones/prepare-decisions/gap-prepare-milestone-epoch-scope-change-grants-full-review.json`
is SUPERSEDED. The child task stub (gap-prepare-milestone-epoch-scope-change-grants-full-review-A)
is deleted — its 9 ACs are merged back into this parent's AC section.
The original ProposalReview returned `split-subsystem-blocking-cluster` (wiring-coverage gaps) —
correct response is to add AC checkboxes covering the claims, not to split.

## Split into an independently landable child (2026-08-01)

This task has been split into one independently landable sub-task with its own M-number and milestone
charter (split decision: `milestones/prepare-decisions/gap-prepare-milestone-epoch-scope-change-grants-full-review.json`):

| Child | M-number | Title | Mechanism |
|-------|----------|-------|-----------|
| [gap-prepare-milestone-epoch-scope-change-grants-full-review-A](gap-prepare-milestone-epoch-scope-change-grants-full-review-A.md) | **M266** | Scope-change grants a fresh full-review allowance | `bodyScopeHash` at epoch record top level; `checkEpochCaps`/`_checkEpochCapsInline` reset `fullReviews` on scope change without consuming `--new-epoch`; unchanged scope stays capped (DIR-120 protection preserved) |

The child is independently reviewable and landable. This parent is **done** when the child is done.

**Original parent charter:** `experiments/quay-perpetual-stream/charters/M233-gap-prepare-milestone-epoch-scope-change-grants-full-review.md`
(preserved for context).

**Parent plan:** `docs/plans/M233-gap-prepare-milestone-epoch-scope-change-grants-full-review.md`
(superseded by the child plan at `docs/plans/M266-gap-prepare-milestone-epoch-scope-change-grants-full-review-a.md`).

---

## Finding

`proposal-convergence.ts`'s epoch mechanism has `maxFullReviewsPerEpoch: 1` and
`maxNewEpochResetCount: 3`. When a prepare-milestone task's Proposal is corrected through
multiple ProposalReview/mechanism-inventory rounds (e.g. DIR-099-B went through 6
mechanism-inventory-invalid rounds), the epoch's full-review cap (1) is consumed and the
reset quota (3) is exhausted -- so the CORRECTED body can never get a fresh full review.
The only paths left are COMMIT/SPLIT/OVERRIDE, and `--override-budget` grants only
minutes, not full-review allowance. Result: the orchestrator must manually author the plan
+ receipt (DIR-099-B precedent, 2026-08-01), bypassing the prepared-gate discipline.

Real case: DIR-099-B -- 6 prepare attempts, all failing mechanism-inventory-invalid with
progressively narrower edge cases; body corrected each round; epoch then blocked the 7th
full review. DIR-103-A/B/C hit the same reset-exhaustion wall. Cost: ~2M tokens of prepare
attempts + a manual takeover per task.

**Root cause:** the epoch cannot distinguish "unchanged scope re-hitting the cap"
(correctly blocked -- the DIR-120/M192 unbounded-restart protection) from "corrected scope
deserving a fresh review" (currently wrongly blocked). The epoch identity is keyed on
`(taskId, charterHash, reviewPolicyHash)` only -- deliberately Proposal/AC/Touches-insensitive
by design (`_currentEpochIdentity()`, line 1940-1947, explicitly does NOT read the task file).
The existing `scopeHash()` export (line 1067-1072) is deliberately prose-insensitive -- it
hashes only `{acBoxCount, touchesSorted}` -- and therefore does NOT change on a Proposal-only
text correction of the DIR-099-B mechanism-inventory class.

The epoch record today stores `charterHash` + `reviewPolicyHash` only and deliberately
tracks NO scope/proposal hash. The fix therefore REQUIRES an epoch-schema extension: add a
`bodyScopeHash` field to the record. `bodyScopeHash` is a hash over the task's `## Proposal`
section content -- explicitly DISTINCT from the existing `scopeHash()` helper. When
`bodyScopeHash` changes since the last full review, reset the `fullReviews` counter
(grant a fresh full-review allowance for the NEW scope) WITHOUT consuming a `--new-epoch`
reset. The `maxFullReviewsPerEpoch` cap continues to bound re-review of an UNCHANGED scope
-- the DIR-120 protection is structurally preserved.

## Proposal

### Problem framing (grounded in current code)

The `prepare-milestone` epoch circuit breaker (`proposal-convergence.ts` lines 1630-1656, introduced via DIR-125/M192 and hardened via `gap-prepare-milestone-task-epoch-budget-reset`) caps cumulative full reviews at `maxFullReviewsPerEpoch: 1` per `(taskId, charterHash, reviewPolicyHash)` identity. When a prepare-milestone task's `## Proposal` body is corrected across multiple generations -- the mechanism-inventory-invalid class of corrections where a reviewer identifies that the Proposal's mechanism claims are incomplete, the human operator edits the task body, and a re-dispatch triggers a fresh full review -- the epoch's `fullReviews` counter reaches 1 after the first generation's full review and stays there.

Each subsequent generation's full-review gate at line 996 of `.claude/workflows/prepare-milestone.js` is blocked: `_checkEpochCapsInline(true)` returns `{ breached: true, breachedCap: 'full-review-cap-exceeded' }`. The only escape is `--new-epoch` (human-invoked CLI), hard-capped at `maxNewEpochResetCount: 3`. DIR-099-B exhausted that cap through 6 mechanism-inventory-invalid rounds; DIR-103-A/B/C hit the same wall. The corrected body becomes **permanently unreviewable** through the normal pipeline. Human operators must manually author the plan + receipt, bypassing the prepared-gate discipline entirely. Cost: ~2M tokens of prepare attempts + a manual takeover per task.

**Root cause:** the epoch identity (`_currentEpochIdentity`, lines 1940-1947) is deliberately Proposal/AC/Touches-insensitive -- it hashes only the charter file and the review-policy version constants (`_currentReviewPolicyHash()`). The existing `scopeHash()` function (lines 1067-1072) is also deliberately prose-insensitive -- it hashes only `{acBoxCount, touchesSorted}`. Together they create a blind spot: a genuine `## Proposal` rewrite (the mechanism-inventory class of corrections) changes NO hash the epoch system tracks. The epoch cannot distinguish "unchanged scope re-hitting the cap" (correctly blocked -- the DIR-120/M192 unbounded-restart protection) from "corrected scope deserving a fresh review" (currently wrongly blocked).

The epoch record schema today (line 1839, `buildEpochRecord()`) stores `charterHash` + `reviewPolicyHash` at record top level but deliberately tracks NO proposal-content hash. The fix therefore requires a schema extension: add a `bodyScopeHash` field at the epoch record top level.

### Chosen mechanism: `bodyScopeHash` -- a body-content-sensitive hash stored at the epoch record top level

Add a `bodyScopeHash` field (type: `string | null`) to the epoch record that stores `sha256(extractSection(taskBody, "Proposal") || "")` -- a hash over the task's `## Proposal` section text. This is EXPLICITLY DISTINCT from the existing `scopeHash()` function (which hashes AC-checkbox count + Touches only, deliberately prose-insensitive) and from `.generation.json`'s `proposalHash` (which serves the resume/reuse-terminal decision, not scope-change detection). The computation reuses the same well-tested `_readCurrentHashes()` computation at lines 726-739 of `proposal-convergence.ts`: `sha256(extractSection(taskBody, "Proposal") || "")`. The name `bodyScopeHash` is chosen over `proposalHash` to avoid confusion with `.generation.json`'s `proposalHash` field.

**Storage location: record TOP LEVEL, not in `counters`.** `counters` is zeroed on `--new-epoch` (line 2149: `counters: {}`). If `bodyScopeHash` were inside `counters`, a `--new-epoch` reset would erase it, making post-reset scope-change detection impossible. At the top level (alongside `charterHash` and `reviewPolicyHash`), `bodyScopeHash` persists across resets -- it is operational metadata about the scope being reviewed, not a cumulative counter.

**Grant logic:** when checking the full-review cap in `checkEpochCaps()` (lines 1882-1918), if the stored `bodyScopeHash` (from the on-disk epoch record's top-level field) is non-null and differs from the current task body's `bodyScopeHash`, the scope has demonstrably changed since the last full review -- reset `fullReviews` to the current generation's `fullReviewDelta` (typically 1) for the purpose of cap evaluation, granting a fresh full-review allowance **without consuming `--new-epoch`**. The grant is a counter reset WITHIN the same epoch, not a new epoch creation. No reset count consumed; no human CLI call dispatched. The `resets[]` array and `overrides[]` array are untouched. The ONLY mutations: `fullReviews` counter is set to `fullReviewDelta` and `bodyScopeHash` is updated.

**Conservative on absent field:** `recordBodyScopeHash === null` does NOT grant. When a pre-migration record has no `bodyScopeHash`, we cannot prove the scope changed, so the existing cap applies. Tasks already at the cap before deployment need manual recovery (`--new-epoch` or `--override-budget`). The fix prevents FUTURE tasks from getting stuck.

### Concrete control and data flow

**A. Schema extension -- `buildEpochRecord()` (lines 1839-1873).** Add a `bodyScopeHash` field (type: `string | null`) at the record TOP LEVEL (not nested in `counters`), defaulting to `null` when omitted or falsy. The field is additive -- existing records without it are handled via the null-default, matching the established additive-field convention (M207's `phaseTimings`/`findingCodes` precedent in `buildTelemetryRecord`). No `EPOCH_SCHEMA_VERSION` bump is required (same precedent: M207 kept `TELEMETRY_SCHEMA_VERSION` at 2 for additive in-family growth). `buildEpochRecord` is the single record constructor consumed by `--record-epoch-dispatch`, `--new-epoch`, `--epoch-status` (for the no-epoch-record path), and test helpers -- adding a field here materializes it in every write path. **[CLAIM-1: buildEpochRecord extended with bodyScopeHash at record top level]**

**B. `checkEpochCaps()` decision logic (lines 1882-1918).** The function signature gains two optional parameters: `bodyScopeHash` (the stored value from the epoch record's top level) and `currentBodyScopeHash` (the hash of the CURRENT on-disk `## Proposal` section). The evaluation order is preserved exactly as-is -- fingerprint cap first (lines 1894-1901), then full-review cap with scope-change grant, then time cap. The scope-change check is inserted WITHIN the existing `checkFullReviewCap` block (lines 1903-1909), AFTER `fullReviews >= maxFullReviews` but BEFORE returning `breached: true`:

```
if (checkFullReviewCap && fullReviews >= maxFullReviews) {
  if (bodyScopeHash != null && currentBodyScopeHash != null && bodyScopeHash !== currentBodyScopeHash) {
    return { breached: false, scopeChanged: true };
  }
  return { breached: true, breachedCap: "full-review-cap-exceeded", ... };
}
```

This is a single decision point for both CLI and workflow paths. If either hash is null (migration state) or they match, the existing `breached: true` return is preserved. The fingerprint cap is still checked BEFORE this block -- a task that keeps hitting the same terminal fingerprint is broken regardless of body changes. The time cap is still checked AFTER this block -- a body change does NOT reset the cumulative time counter. `checkEpochCaps()` is consumed by both `proposal-convergence.ts`'s own post-dispatch cap computation AND by the workflow's inline `_checkEpochCapsInline()` -- the signature change in the TS module MUST be mirrored in the JS inline version, with cross-check test coverage. **[CLAIM-2: checkEpochCaps scope-change grant decision point -- returns {breached: false, scopeChanged: true} on hash mismatch]**

**C. `_recordEpochDispatchCli()` counter-reset logic (lines 2001-2075).** The function accepts an optional `--bodyScopeHash` CLI flag (for testability and explicit override). When recording a dispatch where `fullReviewDelta > 0` (a full review actually ran this generation):

1. Determine the stored `bodyScopeHash`: from the existing record's top-level field (or `null` if no record exists or field absent).
2. Compare the `--bodyScopeHash` flag value against the stored value.
3. If they differ AND the new `bodyScopeHash` is non-null: the `fullReviews` counter is SET to `fullReviewDelta` (typically 1) rather than accumulated -- the new body scope gets its OWN full-review budget. The stored `bodyScopeHash` is updated. **[CLAIM-3: _recordEpochDispatchCli resets fullReviews to fullReviewDelta on hash mismatch]**
4. If they match OR the new `bodyScopeHash` is null: `fullReviews` accumulates normally (`base.fullReviews + fullReviewDelta`). The `bodyScopeHash` is recorded.

When `fullReviewDelta === 0` (no full review this generation), the existing `bodyScopeHash` from the record is preserved and carried forward unchanged. **[CLAIM-4: bodyScopeHash carried forward when fullReviewDelta is 0, without touching resets[]]**

The `resets[]` array is NOT touched by the scope-change grant -- no mutation of `resets[]`, no call to `_newEpochCli`. `_recordEpochDispatchCli` is the ONLY automated write path -- every prepare-milestone.js terminal routes through it. The counter-reset logic happens INSIDE this one function, so every terminal that records a full review benefits from the scope-change grant with zero per-callsite changes.

**D. `_epochStatusCli()` body hash computation (lines 1952-1991).** Gains an optional `--compute-body-scope-hash` boolean flag. When true, the function reads the task file (`tasks/<taskId>.md`) via `fs.readFileSync` (the SAME pattern `_readCurrentHashes` and `_resolveCheckpointCli` already use -- zero new I/O class), extracts the `## Proposal` section via the already-imported `extractSection` (from `task-schema.ts`), hashes it with `sha256(proposal || "")`, and returns `bodyScopeHash` (the current hash) alongside `recordBodyScopeHash` (from the on-disk epoch record's top-level field, or `null` if absent/corrupt/no-record). The workflow receives both values in a single CLI call, avoiding a second dispatch. When false or absent, behavior is byte-identical to current -- the task file is NOT read. **[CLAIM-5: --epoch-status --compute-body-scope-hash reads task body and computes hash, returns both current and stored]**

**E. `_checkEpochCapsInline(checkFullReviewCap, currentBodyScopeHash)` in both workflow mirrors (lines 389-415).** The signature gains `currentBodyScopeHash` as an optional parameter. The comparison is `_epochBase.bodyScopeHash` (loaded from `--epoch-status`, stored at the `_epochBase` object's own top level, distinct from `_epochBase.counters`) vs. `currentBodyScopeHash`. When `checkFullReviewCap === true` and `c.fullReviews >= maxFullReviews` and `_epochBase.bodyScopeHash` is non-null and differs from `currentBodyScopeHash`: returns `{ breached: false, scopeChanged: true }`. Both `.claude/workflows/prepare-milestone.js` and `plugin/workflows/prepare-milestone.js` are updated identically -- verified by the existing cross-check test extended to cover `bodyScopeHash` logic. **[CLAIM-10: cross-check test covers bodyScopeHash in both mirrors]**

**F. Workflow state threading.**

1. **Admission `--epoch-status` call (line 358):** Extended to `--epoch-status --taskId ${_taskId} --workspace . --charterFile ${_charterFile} --highRisk ${_highRisk} --compute-body-scope-hash true`. The returned `bodyScopeHash` is stored as `_currentBodyScopeHash`. **[CLAIM-6: workflow admission loads bodyScopeHash via single --epoch-status dispatch]**

2. **`_epochBase` carries `bodyScopeHash` (line 374 area):** After loading `_epochStatusVerdict`, also load `_epochBase.bodyScopeHash = _epochStatusVerdict.recordBodyScopeHash ?? null` -- stored at the `_epochBase` object's own top level (alongside `_epochBase.counters`), NOT inside `_epochBase.counters`.

3. **Full-review gate (line 996):** Becomes `_checkEpochCapsInline(true, _currentBodyScopeHash)`. When `_epochCap.scopeChanged === true`, the gate is satisfied (no breach), the full-review agent dispatches normally, and `_epochThisGenFullReviews` is incremented as usual. `_epochBreachExit` is NOT called when `scopeChanged: true`. **[CLAIM-7: workflow full-review gate passes _currentBodyScopeHash to _checkEpochCapsInline; _epochBreachExit NOT called on scopeChanged]**

4. **`_recordEpochDispatch()` (lines 422-427):** Gains `--bodyScopeHash ${_currentBodyScopeHash}`, passing the admission-time computed hash so the counter-reset logic runs at write time. **[CLAIM-8: _recordEpochDispatch passes --bodyScopeHash flag]**

**G. `_newEpochCli()` -- carry `bodyScopeHash` forward (lines 2146-2156).** When creating a new epoch record via `--new-epoch`, carry the existing record's `bodyScopeHash` forward: add `bodyScopeHash: existing?.bodyScopeHash ?? null` to the `buildEpochRecord()` call inside `_newEpochCli()`. This preserves the scope hash across `--new-epoch` resets, consistent with the design principle that `bodyScopeHash` is operational metadata (like `charterHash`). Both TS sources identical.

**H. `_currentBodyScopeHash` is loaded ONCE at admission** (via the single `--epoch-status --compute-body-scope-hash true` dispatch) and used for the ENTIRE generation. Zero additional CLI dispatches beyond the existing status call. The hash is the admission-time value -- there is a single-digit-second race window between the status call and the actual full-review dispatch where a concurrent `task_write` could change the body, but the window is accepted (fail-closed: the next dispatch will compute the correct hash).

**I. Migration behavior.** The ~22 existing `.quay/prepare-epochs/*.json` records (schemaVersion 1, no `bodyScopeHash` field) are handled transparently: `buildEpochRecord()` defaults `bodyScopeHash` to `null`; `checkEpochCaps()` treats null stored hash as "no comparison possible -- apply existing cap." On the FIRST full review after the code lands: `_recordEpochDispatchCli()` receives a non-null `bodyScopeHash` and stores it; the existing `fullReviews` counter is preserved (the prior review was of the same body). Future body changes WILL trigger the reset. No runtime backfill script is required -- migration is transparent and self-healing on first natural access. **[CLAIM-9: null bodyScopeHash on existing records = no grant, existing cap applied]**

### Key design decisions

1. **Hash target: `## Proposal` section only, not the entire body.** The AC/DoD/Touches/Plan sections are downstream artifacts -- a change to them does not indicate that the Proposal's mechanism claims have been corrected. Hashing the Proposal alone captures the class of corrections this gap addresses (mechanism-inventory rewrites, claim clarifications). If a future gap requires sensitivity to AC/DoD changes, a separate field can be added -- this is a minimal, targeted fix.

2. **`bodyScopeHash` stored at record TOP LEVEL, not in `counters`.** `counters` is zeroed on `--new-epoch` (line 2149: `counters: {}`). If `bodyScopeHash` were inside `counters`, a `--new-epoch` reset would erase it, making post-reset scope-change detection impossible. At the top level, it persists across resets alongside `charterHash` (which similarly survives resets -- a reset captures the old hashes in the `resets[]` entry but the new record carries the current hashes at top level).

3. **Reuses existing `sha256(extractSection(taskBody, 'Proposal'))` computation from `_readCurrentHashes()` lines 726-739.** This reuses an existing well-tested computation rather than inventing a new hashing function. The name `bodyScopeHash` is chosen over `proposalHash` to avoid confusion with the `proposalHash` field in `.generation.json` (which serves a different purpose -- resume/reuse-terminal decision, not scope-change detection).

4. **The grant is a counter reset WITHIN the same epoch, not a new epoch creation.** No `--new-epoch` needed; no reset count consumed; no human CLI call dispatched. The epoch record's `epochId`, `parentEpochId`, `resets`, and `overrides` are all untouched. The ONLY mutations: `fullReviews` counter set to `fullReviewDelta` and `bodyScopeHash` updated.

5. **`--compute-body-scope-hash` piggybacks on the existing `--epoch-status` call.** Adding it to `_epochStatusCli()` means zero additional CLI dispatches in the workflow's admission sequence. The workflow's epoch-status call (line 358) already returns ALL epoch state; adding one boolean flag and one response field does not increase the dispatch count.

6. **The `checkEpochCaps()` evaluation order is preserved.** The scope-change check is inserted WITHIN the existing `checkFullReviewCap` block (lines 1903-1909), AFTER the repeated-terminal-fingerprint check (which must still gate regardless of scope change -- a task that keeps hitting the same terminal fingerprint is broken regardless of body changes). The time-cap check remains independent -- a body change does NOT reset the cumulative time counter (you can correct the scope but you cannot reclaim expended agent time).

7. **`--new-epoch` `resets` array is NOT touched by the scope-change grant.** The grant path is purely inside `checkEpochCaps`/`_checkEpochCapsInline` and `_recordEpochDispatchCli` -- it does not call `_newEpochCli`, it does not append to `resets[]`, and `maxNewEpochResetCount` enforcement is untouched. The two mechanisms are orthogonal: the grant is automatic scope-change detection; `--new-epoch` is a human decision.

8. **`_recordEpochDispatchCli` resets `fullReviews` to `fullReviewDelta` (not zero).** The `fullReviewDelta`-reset handles the edge case where the caller reports `fullReviewDelta: 0` (no full review this generation) but `bodyScopeHash` changed -- the counter stays as-is (no gratuitous mutation). When `fullReviewDelta > 0`, the counter is set to `fullReviewDelta` (typically 1), giving the new scope its own full-review budget.

9. **The scope-change grant does NOT skip the full-review agent -- it only removes the cap block.** The `checkFullReviewCap: true` gate at line 996 returns `{ breached: false, scopeChanged: true }` instead of `{ breached: true, ... }`. The full-review agent still dispatches normally. The difference is that it is allowed to run when the epoch's `fullReviews` counter previously hit the cap.

10. **Residual guards still bound scope-churn.** The scope-change grant consumes NO reset count, so `maxNewEpochResetCount` never bounds it -- but unbounded re-correction is still bounded by the remaining caps `_checkEpochCapsInline` ALSO checks: `maxRepeatedFingerprint` (2, over `terminalFingerprints`), and the cumulative `observableAgentMs` cap (90/150 min + override minutes). A task that churns its body through 20 corrections will still hit one of those walls. Additionally, the scope-change only grants ONE full review per hash change -- by recording the new `bodyScopeHash` after the full review runs, a second dispatch with the same body (now unchanged) hits the cap again.

### Defaults and failure behavior

- **Default (null `bodyScopeHash`):** fail-closed -- no grant. The existing `maxFullReviewsPerEpoch: 1` cap applies. Covers pre-migration records, corrupt/missing task files (where `bodyScopeHash` computation fails), and the first full review after code deployment (where stored hash is null).
- **Missing task file during `--epoch-status` with `--compute-body-scope-hash`:** `bodyScopeHash` returns as `sha256("")` -- same as a task without a `## Proposal` section. The status call still succeeds; the grant comparison is `sha256("")` vs whatever the record stores. This is NOT a new failure mode -- the existing Preflight phase already reads the task file and would have failed first.
- **Corrupt epoch record:** existing `epoch-corrupt` path (lines 2010-2012) still applies -- no mutation, manual `--new-epoch` required. Corrupt record with absent `bodyScopeHash` is not special.
- **Hash collision:** SHA-256 over document-scale Proposal text is cryptographically collision-resistant. If two genuinely different Proposals produce the same sha256, the grant is skipped (treated as unchanged scope) -- fail-closed.
- **`bodyScopeHash` read race:** a concurrent `task_write` that changes the Proposal text between the workflow's `--epoch-status --compute-body-scope-hash` call and the actual full-review dispatch would cause the `bodyScopeHash` to be stale. `_recordEpochDispatchCli` at terminal receives the same admission-time hash. This is accepted: the window is single-digit seconds and the next dispatch will compute the correct hash. Worst case is a denied grant for one generation (fail-closed).
- **After `maxNewEpochResetCount` exhausted AND body unchanged:** The scope-change grant does not apply (body unchanged), and `--new-epoch` is blocked at its hard ceiling. The only paths remain COMMIT/SPLIT -- the grant does not create a new infinite-regress path.

### Compatibility

- **Backward compatible with existing epoch records.** `bodyScopeHash: null` in existing records means full-review cap applies unchanged.
- **Backward compatible with non-workflow CLI callers.** `--record-epoch-dispatch` without `--bodyScopeHash` preserves behavior unchanged (stored `bodyScopeHash` becomes `null`). `--epoch-status` without `--compute-body-scope-hash` preserves behavior unchanged (no `bodyScopeHash` field returned).
- **Backward compatible with existing tests.** `checkEpochCaps()` called without the new optional parameters preserves behavior unchanged (the new parameters are optional with defaults preserving existing behavior).
- **Schema version:** stays `1`. The `bodyScopeHash` field is an additive in-family growth -- same precedent as the `tokensObserved` field which was added without a version bump.
- **Both workflow mirrors stay byte-identical** for the epoch logic. The cross-check test in `proposal-convergence.test.mjs` (the "prepare-milestone.js inline caps match capsFor()" pattern) is extended to also cover `_checkEpochCapsInline`'s `bodyScopeHash` logic.
- **`milestone-preparation-check.ts` compatibility:** the receipt-side `checkEpochCaps` import (if any) continues to work -- the new parameters are optional, and omitting them preserves the existing behavior.
- **`.generation.json` compatibility:** untouched -- the epoch record and the generation record are separate files with separate schemas. `bodyScopeHash` lives only in the epoch record.

### Risks

1. **Trivial body changes to bypass the cap.** Risk: an operator adds a non-meaningful change to the Proposal, `bodyScopeHash` changes, and a fresh full review is granted. Mitigation: the residual guards (`maxRepeatedFingerprint`, `observableAgentMs` cap) still apply. A full review that finds zero new issues and returns "zero-finding" will record a terminal fingerprint; 2+ occurrences of the same `(terminalPhase, reason)` fingerprint triggers the fingerprint cap. The cumulative time cap also ticks. Additionally, the scope-change only grants ONE full review per hash change -- by recording the new `bodyScopeHash` after the full review runs, a second dispatch with the same body (now unchanged) hits the cap again.

2. **Unbounded chain via repeated genuine corrections.** A task whose body is genuinely corrected 10 times could get 10 full reviews. Mitigation: this is BY DESIGN -- a genuinely corrected body deserves a fresh review. The bounds are the repeated-terminal-fingerprint cap (catching tasks that keep failing the same way) and the cumulative observable-time cap (90/150 min + overrides). The `maxNewEpochResetCount` (3) does NOT bound this path, which is exactly the fix.

3. **Naming collision between `bodyScopeHash` and `scopeHash`.** The existing `scopeHash()` (prose-insensitive) and the new `bodyScopeHash` (prose-sensitive) serve different purposes. Mitigation: `bodyScopeHash` is typed as a standalone top-level field in the epoch record, never computed via the `scopeHash()` function. Code reviewers must verify call sites use the CORRECT hash for their purpose.

4. **`_epochStatusCli` now reads the task body.** Previously it only read the charter file. Reading the task body adds an fs call, but it is the same fs call `_readCurrentHashes` and `_resolveCheckpointCli` already make -- no new I/O class. Risk: a task file deleted mid-dispatch would cause `--epoch-status` to fail, blocking Admission. Mitigation: the existing Preflight phase already reads the task file and would have failed first -- this is not a new failure mode.

### Non-goals

- **Not changing the epoch identity key** (`charterHash, reviewPolicyHash`). The epoch remains Proposal/AC/Touches-insensitive -- a body change does not create a new epoch, it merely resets the `fullReviews` counter within the same epoch.
- **Not changing `--new-epoch` or `--override-budget` semantics.** Both remain human-invoked-only, with their existing hard ceilings.
- **Not extending the grant to other caps** (time, fingerprint). Only the `fullReviews` counter is reset -- the scope-change grant targets the specific class of failure the DIR-099-B incident exposed.
- **Not a general "changed anything -> free review" mechanism.** Only the `## Proposal` section is hashed. Changes to Plan, AC, DoD, Touches alone do not trigger the grant (though they would trigger a cold generation via `decideResumeGeneration`'s `taskContractHash` mismatch, which then proceeds through normal full-review admission).
- **Not removing or weakening the DIR-120 unbounded-restart protection** -- unchanged scope at the cap stays blocked.
- **Not resetting the cumulative observable-time counter on body change.** Time expended is real cost; it cannot be retroactively un-expended. Only the full-review COUNTER (a policy artifact) resets. The time cap continues to accumulate across body changes.
- **Not auto-detecting WHAT changed in the body.** This mechanism detects THAT the body changed (via hash comparison), not HOW it changed. The DIR-126-C resume mechanism and `classifyProposalDiff()` cross-generation checkpoint already handle semantic diff classification. This mechanism is a binary gate: changed -> grant; unchanged -> apply cap.
- **Not replacing `--new-epoch` or `--override-budget`.** Those remain the human-invoked escape valves for genuine budget exhaustion. This mechanism only handles the case where the body scope has changed -- it does NOT grant additional budget for an unchanged scope that genuinely needs more time.

### AC coverage

- **AC 1 ("changed body gets fresh full-review allowance without --new-epoch reset"):** covered by `checkEpochCaps` returning `{ breached: false, scopeChanged: true }` when `bodyScopeHash` is non-null and differs from `currentBodyScopeHash`, AND by the workflow's `_checkEpochCapsInline(true, _currentBodyScopeHash)` at line 996 proceeding to dispatch the full-review agent instead of calling `_epochBreachExit`. The REAL production dispatch site (line 996) actually GRANTS the changed-scope full review.
- **AC 2 ("unchanged scope at cap stays blocked"):** covered by `checkEpochCaps` returning `{ breached: true, breachedCap: 'full-review-cap-exceeded' }` when `bodyScopeHash === currentBodyScopeHash` (or either is null). The DIR-120 protection is regression-tested.
- **AC 3 ("grant does not increment resets"):** covered by the grant path being purely inside `checkEpochCaps`/`_checkEpochCapsInline` and `_recordEpochDispatchCli` -- no mutation of `resets[]` array, no call to `_newEpochCli`. `maxNewEpochResetCount` enforcement is untouched.
- **AC 4 ("re-corrected body bounded by residual guards"):** covered by the fact that `_checkEpochCapsInline` evaluates ALL caps (fingerprint, time, full-review) in order -- a scope-change grant only bypasses the full-review cap at that call site; the fingerprint and time caps are still checked and can still breach independently. Each body change resets `fullReviews` to 1 for the new scope. `maxRepeatedFingerprint: 2` catches 3 identical terminal outcomes; the cumulative time cap (90/150 min + overrides) catches runaway cost.
- **AC 5 ("both workflow mirrors updated identically"):** covered by the existing cross-check test in `proposal-convergence.test.mjs` that diff-validates `_checkEpochCapsInline` matches `checkEpochCaps` -- extended to cover the new `bodyScopeHash` parameters. Both `.claude/workflows/prepare-milestone.js` and `plugin/workflows/prepare-milestone.js` carry identical logic.
- **AC 6 ("tests RED/GREEN for all four cases"):** four cases: (a) unchanged scope at cap -> blocked, (b) changed scope at cap -> granted, (c) no stored `bodyScopeHash` -> conservative/blocked, (d) changed-scope grant with fingerprint-cap still catching repeated terminals. All four are testable against the pure `checkEpochCaps` function and against CLI fixtures. Additionally: `buildEpochRecord()` persists `bodyScopeHash` at top level with null default; `_recordEpochDispatchCli` resets `fullReviews` on mismatch; CLI round-trip test verifies real record write/read.

### Alternatives considered and rejected

1. **Extend `--override-budget` to grant full-review allowance, not just time.** Rejected: `--override-budget` is bounded by `maxOverrideCount: 3` and is primarily a time-budget mechanism. Extending it to grant full-review allowance conflates two different resource types and would still exhaust the override quota.

2. **Include the Proposal hash in the epoch's identity key.** Rejected: this would mean every Proposal edit creates a new epoch with fresh counters -- equivalent to an auto-`--new-epoch` on every body change, bypassing the `maxNewEpochResetCount` cap entirely. This is strictly more permissive than the scope-change grant (which only resets `fullReviews`, not all counters -- cumulative time, fingerprint history, and all other state survive) and would eliminate the epoch's value as a cumulative circuit breaker.

3. **Use the existing `scopeHash()` as the change detector.** Rejected: `scopeHash()` is specifically designed to be **insensitive** to Proposal text changes -- it hashes only `{acBoxCount, touchesSorted}`. The DIR-099-B mechanism-inventory class of corrections changes the Proposal text WITHOUT changing AC count or Touches. Using `scopeHash()` would not detect the class of changes this gap addresses.

4. **Add a per-generation `proposalHash` to `.generation.json` and compare.** Rejected: `.generation.json` is a per-generation artifact (created by `_recordGenerationCli`, lines 958-970) overwritten each generation. The epoch record is the durable cross-generation store. Comparing against `.generation.json` would only work for one prior generation -- not for the multi-generation repair sequences (DIR-099-B had 6 generation boundaries) this gap targets.

5. **Make the `bodyScopeHash` comparison in `_recordEpochDispatchCli` only (write side), not in `checkEpochCaps` (read/check side).** Rejected: `_recordEpochDispatchCli` runs AFTER the full review completes -- it is a terminal recording. If the cap check already blocked the full review at line 996, the workflow never reaches the record-dispatch step. The check must happen BEFORE the full-review agent dispatch, at the `checkFullReviewCap: true` gate. Hence it must be in `checkEpochCaps` / `_checkEpochCapsInline`.

6. **Use the entire task body (all sections) for `bodyScopeHash`.** Rejected: AC/DoD/Touches/Plan changes do not indicate a Proposal rewrite -- they are downstream artifacts. Including them would grant a full review on AC-only edits (e.g. adding an audit checkbox), which is not the problem this gap addresses. Keeping the hash scoped to the Proposal section avoids false grants.

7. **Auto-trigger `--new-epoch` when body changes.** Rejected: `--new-epoch` is a human-invoked-only CLI surface with explicit `--reason`/`--owner`/`--confirmUnchangedScope` requirements and a hard `maxNewEpochResetCount: 3` ceiling. Auto-triggering it would bypass the human-decision requirement and silently consume the reset quota. The point of this fix is that a body correction should NOT require a human reset at all.

8. **Deploy a separate migration script for existing records.** Rejected: null-default transparent migration at read time is simpler, self-healing, and requires zero operational toil. A separate script would be a one-shot run that could be forgotten. The first natural access to each epoch record triggers the update.

### Mechanism-claim wiring (DIR-117)

Claims requiring matching AC items with proof at the production callsite:

- **CLAIM-1:** `buildEpochRecord()` gains `bodyScopeHash` field at record TOP LEVEL (not in `counters`), defaulting to `null`. Both TS sources identical. Proven by: `buildEpochRecord` unit test extended with `bodyScopeHash` cases.
- **CLAIM-2:** `checkEpochCaps()` returns `{ breached: false, scopeChanged: true }` when `bodyScopeHash != null && currentBodyScopeHash != null && bodyScopeHash !== currentBodyScopeHash` -- the single decision point for both CLI and workflow paths. Both TS sources identical. Proven by: `checkEpochCaps` unit test with `bodyScopeHash` cases.
- **CLAIM-3:** `_recordEpochDispatchCli()` accepts `--bodyScopeHash` flag and resets `fullReviews` counter to `fullReviewDelta` (not zero) when the flag differs from the stored record's `bodyScopeHash`. Both TS sources identical. Proven by: CLI round-trip test writing an epoch record with one hash, then calling `--record-epoch-dispatch --fullReviewDelta 1 --bodyScopeHash <different>` and verifying `fullReviews` is 1 (not 2).
- **CLAIM-4:** `_recordEpochDispatchCli()` does NOT increment `resets[]` when resetting `fullReviews` due to `bodyScopeHash` change, and carries `bodyScopeHash` forward unchanged when `fullReviewDelta === 0`. Both TS sources identical. Proven by: the same CLI round-trip test verifying `resets.length` is unchanged, and a separate test verifying carry-forward on zero delta.
- **CLAIM-5:** `_epochStatusCli()` with `--compute-body-scope-hash true` reads the task file and computes `sha256(extractSection(taskBody, 'Proposal'))`, returning both `bodyScopeHash` (current) and `recordBodyScopeHash` (from on-disk record top level, or null). Both TS sources identical. Proven by: test verifying the returned hash matches independently-computed sha256 of the task's Proposal section.
- **CLAIM-6:** The workflow admission `--epoch-status` call includes `--compute-body-scope-hash true` and stores the returned `bodyScopeHash` as `_currentBodyScopeHash`. Both workflow mirrors identical. Proven by: the full-review gate test verifying that a changed body scope hash causes the full-review agent to be dispatched (not `_epochBreachExit`).
- **CLAIM-7:** The workflow full-review gate at line 996 passes `_currentBodyScopeHash` to `_checkEpochCapsInline(true, ...)` -- the ONLY `checkFullReviewCap: true` call site. `_epochBreachExit` is NOT called when `scopeChanged: true`. Both workflow mirrors identical. Proven by: the same test as CLAIM-6.
- **CLAIM-8:** The workflow `_recordEpochDispatch()` call includes `--bodyScopeHash ${_currentBodyScopeHash}`. Both workflow mirrors identical. Proven by: the terminal telemetry test verifying the epoch record's `bodyScopeHash` is updated after a full review.
- **CLAIM-9:** Existing records without `bodyScopeHash` cause `checkEpochCaps()` to apply the existing cap (no grant). Proven by: `checkEpochCaps` test with `bodyScopeHash: null`.
- **CLAIM-10:** The existing cross-check test (inline mirror matches exported `checkEpochCaps`) covers the new `bodyScopeHash` parameters in both workflow mirrors. Proven by: extended cross-check test verifying identical behavior between the TS function and both JS mirrors for the `bodyScopeHash` logic.

## Plan

Milestone plan: `docs/plans/M233-gap-prepare-milestone-epoch-scope-change-grants-full-review.md`
(base `65f414c4`, 2026-08-01). 9 stages across RED -> implementation -> GREEN -> real-landing
(Phase A-E); every AC item (1-6) maps to at least one stage; stopping rule = at most 3
Plan-check rounds, success only at F_i = 0.


## Requested action

1. In `proposal-convergence.ts`: extend the epoch record schema with a `bodyScopeHash`
   field at record top level (not in `counters`), and when recording/checking a full
   review compare the current `bodyScopeHash` to the epoch record's stored value; if they
   differ, reset the `fullReviews` counter (the scope changed -> the prior full review was
   of a different body; a fresh full review is legitimate). `maxNewEpochResetCount` is not
   consumed.
2. If `bodyScopeHash` is UNCHANGED and `fullReviews >= maxFullReviewsPerEpoch`, keep the
   current fail-closed behavior (COMMIT/SPLIT/OVERRIDE).
3. RED/GREEN tests:
   - unchanged scope, fullReviews=1 -> full review blocked (existing behavior preserved);
   - CHANGED scope, fullReviews=1 -> full review GRANTED (new behavior), and the counter
     resets so the new scope gets its own full-review budget;
   - changed-scope-grant does not increment `resets` (no `--new-epoch` consumption);
   - changed scope can still be re-changed (scope-churn) -- bounded by the real residual
     guards, NOT by `maxNewEpochResetCount` (the grant path consumes no reset, so that
     counter never bounds it): the repeated-terminal-fingerprint cap (`maxRepeatedFingerprint`
     = 2) and the cumulative observable-time cap (90/150 min + overrides).
4. Confirm the DIR-120/M192 unbounded-restart protection still holds: a task whose body
   is NOT changed cannot trigger repeated full reviews.

## Acceptance Criteria

- [x] A task whose body changed since its last full review gets a fresh full-review
  allowance without a `--new-epoch` reset -- demonstrated at the REAL production dispatch
  site: the `_checkEpochCapsInline(true)` gate in `.claude/workflows/prepare-milestone.js`
  (before the round-0 full-review dispatch) actually GRANTS the changed-scope full review
  (real before/after, not asserted).
- [x] An unchanged-scope task at the full-review cap stays blocked (COMMIT/SPLIT/OVERRIDE)
  -- the DIR-120 protection is regression-tested.
- [x] The changed-scope grant does not increment `resets`.
- [x] A re-corrected body after a grant (further correction) can get another grant -- but
  bounded by the real residual guards (`maxRepeatedFingerprint`: 2 repeated-terminal-
  fingerprint cap; cumulative 90/150-min observable-time cap + overrides), so unbounded
  scope-churn cannot bypass them indefinitely.
- [x] Both workflow mirrors -- `.claude/workflows/prepare-milestone.js` and
  `plugin/workflows/prepare-milestone.js` -- are updated identically with the same
  `_checkEpochCapsInline(true)` grant behavior.
- [x] Tests: `experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs` and
  `plugin/test/prepare-milestone-convergence.test.mjs` RED/GREEN for all four cases,
  with each of the 10 mechanism claims in `## Proposal` having a matching, falsifiable
  test assertion requiring real production evidence -- specifically:
  1. CLAIM-1 (`bodyScopeHash` stored + checked in `_recordEpochDispatchCli`)
  2. CLAIM-2 (`scopeChanged: true` -> full-review cap grant in `checkEpochCaps`)
  3. CLAIM-3 (`--compute-body-scope-hash` piggybacked on `--epoch-status`)
  4. CLAIM-4 (grant path purely inside `checkEpochCaps`/`_checkEpochCapsInline`, no
     side-effects on `resets[]`)
  5. CLAIM-5 (`bodyScopeHash` read-race: concurrent `task_write` between the workflow's
     `--epoch-status` and ProposalReview is benign -- old hash -> no grant after all)
  6. CLAIM-6 (task-body read reuses the same `fs.readFileSync` pattern as
     `_readCurrentHashes` and `_resolveCheckpointCli`)
  7. CLAIM-7 (grant does not increment `resets` -- separate from `--new-epoch`)
  8. CLAIM-8 (`_epochElapsedMsSoFar`/`_lastBoundaryMs` unchanged for scoped grant)
  9. CLAIM-9 (missing `bodyScopeHash` on existing records -> no grant, existing cap)
  10. CLAIM-10 (cross-check test verifies identical `bodyScopeHash` behavior between
      TS function and both workflow JS mirrors)

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] Landed on `master` under human-steered discipline.
- [ ] A real prepare-milestone task that previously required manual takeover (e.g. the
  DIR-099-B/DIR-103-A/B/C class) now converges through the normal pipeline with a changed
  scope.
- [ ] A fresh independent audit finds no refutation.

## Human verification

1. Does a corrected body get a fresh full review without a reset, while an unchanged body
   stays capped?
2. Is the DIR-120 unbounded-restart protection regression-tested as preserved?

## Touches

- `experiments/quay-perpetual-stream/scripts/proposal-convergence.ts`
- `plugin/scripts/proposal-convergence.ts`
- `.claude/workflows/prepare-milestone.js`
- `plugin/workflows/prepare-milestone.js`
- `experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs`
- `plugin/test/prepare-milestone-convergence.test.mjs`
- `docs/plans/M233-gap-prepare-milestone-epoch-scope-change-grants-full-review.md`