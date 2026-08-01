---
id: gap-prepare-milestone-epoch-scope-change-grants-full-review-A
title: "Scope-change grants a fresh full-review allowance (corrected task body gets full review)"
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
  - human-steered
parent: gap-prepare-milestone-epoch-scope-change-grants-full-review
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

Split from gap-prepare-milestone-epoch-scope-change-grants-full-review (M233) — the single mechanism:
**scope-change grants full review**. A corrected task body (a `## Proposal` rewrite of the
mechanism-inventory class) gets a fresh full-review allowance without consuming a `--new-epoch` reset,
while an unchanged-scope task at the full-review cap stays blocked (COMMIT/SPLIT/OVERRIDE) — the
DIR-120/M192 unbounded-restart protection is structurally preserved.

### Chosen mechanism

The epoch circuit breaker (`proposal-convergence.ts`, both mirrors) cannot distinguish "unchanged scope
re-hitting the cap" (correctly blocked) from "corrected scope deserving a fresh review" (currently
wrongly blocked). The fix adds a **`bodyScopeHash`** field to the epoch record at TOP LEVEL (not in
`counters`), computed as `sha256(extractSection(taskBody, "Proposal") || "")` — explicitly DISTINCT
from the existing prose-insensitive `scopeHash()` helper. When the stored `bodyScopeHash` differs from
the current body's hash, the `fullReviews` counter is reset to the generation's `fullReviewDelta`
(typically 1) for cap evaluation — granting a fresh full-review allowance WITHOUT consuming `--new-epoch`
and WITHOUT mutating `resets[]`/`overrides[]`.

1. **`buildEpochRecord()`** — add `bodyScopeHash` (type `string | null`) at record top level,
   defaulting to `null` when omitted/falsy; additive, no `EPOCH_SCHEMA_VERSION` bump (M207
   `phaseTimings`/`findingCodes` precedent). [CLAIM-1]
2. **`checkEpochCaps()`** — the full-review-cap block (lines 1903-1909) gains the scope-change grant:
   if `bodyScopeHash != null && currentBodyScopeHash != null && bodyScopeHash !==
   currentBodyScopeHash`, return `{breached: false, scopeChanged: true}`; otherwise preserve the
   existing `breached: true` (`full-review-cap-exceeded`). Fingerprint cap checked BEFORE, time cap
   AFTER — unchanged. [CLAIM-2]
3. **`_recordEpochDispatchCli()`** — accepts optional `--bodyScopeHash`; when `fullReviewDelta > 0` and
   the new hash differs from the stored value (both non-null), SET `fullReviews` to `fullReviewDelta`
   rather than accumulate; store the new hash. When `fullReviewDelta === 0`, carry the stored hash
   forward unchanged. `resets[]` NOT touched. [CLAIM-3/4]
4. **`_epochStatusCli()`** — optional `--compute-body-scope-hash true` reads the task file (same
   `fs.readFileSync` pattern as `_readCurrentHashes`), computes the current `bodyScopeHash`, and
   returns it alongside the stored `recordBodyScopeHash`. [CLAIM-5]
5. **`_checkEpochCapsInline(checkFullReviewCap, currentBodyScopeHash)` in BOTH workflow mirrors** —
   mirrors the TS grant logic; `_epochBase.bodyScopeHash` loaded from `--epoch-status` at `_epochBase`
   top level (distinct from `_epochBase.counters`). [CLAIM-10]
6. **Workflow state threading** — admission `--epoch-status` call gains `--compute-body-scope-hash
   true` → `_currentBodyScopeHash`; the full-review gate (line 996) becomes
   `_checkEpochCapsInline(true, _currentBodyScopeHash)` and `_epochBreachExit` is NOT called when
   `scopeChanged: true`; `_recordEpochDispatch()` passes `--bodyScopeHash ${_currentBodyScopeHash}`.
   [CLAIM-6/7/8]
7. **`_newEpochCli()`** — carries the existing record's `bodyScopeHash` forward. [preserves scope hash
   across resets]
8. **Migration** — existing records without `bodyScopeHash` → `null` → no grant, existing cap applied
   (self-healing on first natural access). [CLAIM-9]

**Failure behavior:** null `bodyScopeHash` (pre-migration, corrupt task file) → fail-closed, no grant;
hash collision → grant skipped (fail-closed); read-race window (concurrent `task_write` between status
call and full-review dispatch) → benign stale hash, no grant for one generation (fail-closed). The
grant is bounded by the residual guards: `maxRepeatedFingerprint` (2) and the cumulative
`observableAgentMs` cap (90/150 min + overrides) still apply to churn.

**WIRING-CLAIM (EPOCH-SCOPE-GRANT):** the full-review gate at the REAL production dispatch site
(`_checkEpochCapsInline(true, _currentBodyScopeHash)` in `.claude/workflows/prepare-milestone.js`
before the round-0 full-review dispatch) GRANTS the changed-scope full review (`scopeChanged: true` →
agent dispatches, `_epochBreachExit` NOT called) while unchanged scope at the cap stays blocked. →
AC1/AC2/AC3.

## Acceptance Criteria

- [ ] A task whose body changed since its last full review gets a fresh full-review allowance WITHOUT a
  `--new-epoch` reset — demonstrated at the REAL production dispatch site (the full-review gate before
  the round-0 dispatch actually GRANTS the changed-scope review, real before/after, not asserted).
- [ ] An unchanged-scope task at the full-review cap stays blocked (COMMIT/SPLIT/OVERRIDE) — the
  DIR-120/M192 protection is regression-tested.
- [ ] The changed-scope grant does NOT increment `resets` and does NOT consume `--new-epoch` or
  `--override-budget`.
- [ ] A re-corrected body after a grant can get another grant — but bounded by the residual guards
  (`maxRepeatedFingerprint` 2-terminal cap; cumulative 90/150-min observable-time cap + overrides).
- [ ] Both workflow mirrors — `.claude/workflows/prepare-milestone.js` and
  `plugin/workflows/prepare-milestone.js` — are updated identically with the same
  `_checkEpochCapsInline(true)` grant behavior; the cross-check test covers `bodyScopeHash` in both.
- [ ] Tests RED/GREEN for all four cases (unchanged blocked, changed granted, no stored hash →
  conservative, churn bounded); each of the 10 mechanism claims has a matching falsifiable assertion
  requiring real production evidence.

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] Landed on `master` under human-steered discipline.
- [ ] A real prepare-milestone task that previously required manual takeover (the DIR-099-B /
  DIR-103-A/B/C class) now converges through the normal pipeline with a changed scope (real dispatch
  evidence).
- [ ] A fresh independent audit finds no refutation.

## Touches

- `experiments/quay-perpetual-stream/scripts/proposal-convergence.ts`
- `plugin/scripts/proposal-convergence.ts`
- `.claude/workflows/prepare-milestone.js`
- `plugin/workflows/prepare-milestone.js`
- `experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs`
- `plugin/test/prepare-milestone-convergence.test.mjs`
- `docs/plans/M266-gap-prepare-milestone-epoch-scope-change-grants-full-review-a.md`
