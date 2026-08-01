# M233 Plan — epoch scope-change grants full review

- **Milestone:** M233
- **Task:** `gap-prepare-milestone-epoch-scope-change-grants-full-review`
- **Charter:** `experiments/quay-perpetual-stream/charters/M233-gap-prepare-milestone-epoch-scope-change-grants-full-review.md`
- **Base revision:** `65f414c4` (master HEAD short-sha at plan authoring, 2026-08-01)
- **Class:** development · **Value type:** capabilityGrowth · **type:** execution

## Purpose

`proposal-convergence.ts`'s epoch circuit breaker has `maxFullReviewsPerEpoch: 1` and
`maxNewEpochResetCount: 3`. When a prepare-milestone task's Proposal is corrected across
multiple ProposalReview/mechanism-inventory rounds (the DIR-099-B wall — 6 invalid rounds,
~2M tokens, then manual takeover), the full-review cap is consumed and the reset quota is
exhausted, so the CORRECTED body can never get a fresh full review. The epoch record today
stores `charterHash` + `reviewPolicyHash` and deliberately tracks no body-content hash; the
existing `scopeHash()` helper (`sha256(_canonicalJSON({acBoxCount, touchesSorted}))`) does
not change on a Proposal-only text correction. This milestone adds a `bodyScopeHash` field
(over the task body content, distinct from `scopeHash()`), migrates the 22 existing
`.quay/prepare-epochs/*.json` records, and grants a fresh full-review allowance when
`bodyScopeHash` changes since the last full review — WITHOUT consuming a `--new-epoch` reset
(`resets` untouched). The `maxFullReviewsPerEpoch` cap still bounds re-review of an
UNCHANGED scope (DIR-120/M192 protection regression-tested as preserved).

## Touch set (complete)

Committed files edited/created:

1. `experiments/quay-perpetual-stream/scripts/proposal-convergence.ts`
2. `plugin/scripts/proposal-convergence.ts` (mirror of #1 — must stay byte-identical)
3. `.claude/workflows/prepare-milestone.js`
4. `plugin/workflows/prepare-milestone.js` (mirror of #3 — must stay byte-identical)
5. `experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs`
6. `plugin/test/prepare-milestone-convergence.test.mjs`
7. `docs/plans/M233-gap-prepare-milestone-epoch-scope-change-grants-full-review.md` (this plan)

Runtime data touched (gitignored, never committed): `.quay/prepare-epochs/*.json` (22
existing records) — the migration backfills `bodyScopeHash` + bumps `schemaVersion`.

## Design (grounded in real symbols)

- **`bodyScopeHash({ taskBody })`** (new export in `proposal-convergence.ts`): `sha256(taskBody)`
  over the full task body markdown read from `tasks/<taskId>.md` (the same read path
  `_readCurrentHashes` at line 726 already uses). Distinct from `scopeHash()` (line 1067):
  a Proposal-only text correction changes `bodyScopeHash` but not `scopeHash` — the exact
  DIR-099-B mechanism-inventory class.
- **Epoch schema v2**: bump `EPOCH_SCHEMA_VERSION` (line 1658) from 1 to 2; `buildEpochRecord`
  (line 1839) materializes `bodyScopeHash: <string|null>`; readers treat an absent field as
  `null` (graceful for legacy records).
- **`checkEpochCaps`** (line 1882): new `bodyScopeChanged = false` param. When
  `checkFullReviewCap && bodyScopeChanged`, the full-review-cap breach (line 1903) is SKIPPED —
  a full review of the changed body is legitimate — and evaluation falls through to the still-
  cumulative time cap and repeated-terminal-fingerprint cap (the real residual guards of AC4).
  `false` default preserves today's fail-closed behavior exactly (AC2).
- **`_epochStatusCli`** (line 1952): additionally reads the task body, computes
  `currentBodyScopeHash`, reads `record.bodyScopeHash` (null if legacy), returns
  `{ bodyScopeHash, storedBodyScopeHash, scopeChanged: !!stored && stored !== current }`, and
  passes `bodyScopeChanged: scopeChanged` to its `checkEpochCaps` call (line 1979).
- **`_recordEpochDispatchCli`** (line 2001): when a full review is actually recorded
  (`fullReviewDelta >= 1`), compute `currentBodyScopeHash`; if the stored `bodyScopeHash` is
  non-null and differs, reset the `fullReviews` accumulation baseline to this generation's own
  delta (`fullReviews: _fullReviewDelta`, not `base.fullReviews + _fullReviewDelta`) and persist
  `bodyScopeHash: currentBodyScopeHash`. When `fullReviewDelta === 0` (a delta-only/terminal
  generation), do NOT update stored `bodyScopeHash` and do NOT reset `fullReviews` — the stored
  hash stays "the body last fully reviewed," preserving the grant signal for the next review.
  `resets` is never touched (AC3). Other counters (`observableAgentMs`,
  `contentAgentDispatches`, `terminalFingerprints`) stay cumulative.
- **`_migrateEpochSchemaCli`** (new): `--migrate-epoch-schema` CLI subcommand (dispatch entry
  beside the existing `--epoch-status`/`--record-epoch-dispatch`/`--new-epoch`/`--override-budget`
  cases, lines 2395-2447). Scans `.quay/prepare-epochs/*.json`, backfills `bodyScopeHash` =
  current task-body hash (or `null` if the task file is unreadable), sets `schemaVersion: 2`,
  rewrites atomically via the existing `_atomicWriteJson`. Idempotent. Rationale: a body
  corrected since its last full review becomes eligible for the grant on the next dispatch; an
  unchanged body keeps `stored === current` so the cap still binds.
- **`prepare-milestone.js` (both mirrors)**: after the `_epochStatusVerdict` parse (line 358),
  capture `_epochScopeChanged = _epochStatusVerdict.scopeChanged === true` and
  `_epochBodyScopeHash = _epochStatusVerdict.bodyScopeHash ?? null`; extend
  `_checkEpochCapsInline(checkFullReviewCap, bodyScopeChanged = false)` (line 398) so the
  full-review-cap branch (line 412) fires only when `!bodyScopeChanged`; change the round-0
  full-review dispatch-site call (line 996) to `_checkEpochCapsInline(true, _epochScopeChanged)`.
  The mirror stays a faithful no-import copy of `checkEpochCaps`, cross-checked by the existing
  source-regex mirror test (exp test file line 298) extended for the new grant semantics.

## Stopping rule

Standardized DIR-117 stopping rule: at most **3** Plan-check rounds; success only at **F_i = 0**
(zero material findings). A nonzero-but-unchanged finding count is still a failure. Round 3 with
`F_i > 0` escalates to human/architect review rather than a 4th round.

---

## Phase A — RED (tests first, TDD)

### Stage 1: RED — core epoch scope-change cases in the experiments test file
- AC: 2, 3, 4, 6
- Files: experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs
- Command: `scripts/test.sh --test-name-pattern="bodyScopeHash|epoch scope-change|migrate-epoch-schema|changed scope" experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs`
- Type: [code]
- Budget: ~130 lines added
- Depends on: (none — standalone RED)
- Expected exit behavior: command runs the focused tests; the NEW tests fail (RED, nonzero
  exit / failed assertions) because `bodyScopeHash`, `checkEpochCaps(bodyScopeChanged)`,
  `_recordEpochDispatchCli` baseline-reset, and `--migrate-epoch-schema` do not exist yet;
  the pre-existing suite must still pass (no collateral breakage).
- New tests (all four requested cases + schema + mirror seed):
  - `checkEpochCaps grants a full review when bodyScopeChanged:true at/over the full-review cap` (AC1 seed — RED)
  - `checkEpochCaps still blocks unchanged scope at the full-review cap (bodyScopeChanged omitted) — DIR-120 preserved` (AC2 — GREEN guard)
  - `_recordEpochDispatchCli: changed bodyScopeHash resets the fullReviews baseline WITHOUT incrementing resets` (AC3 — RED)
  - `scope-churn: a re-corrected body gets another grant, bounded by the time/fingerprint residual guards, never by maxNewEpochResetCount` (AC4 — RED)
  - `bodyScopeHash helper: a Proposal-only text edit changes bodyScopeHash but NOT scopeHash` (RED)
  - `--migrate-epoch-schema backfills bodyScopeHash + schemaVersion 2 on legacy records, idempotent` (RED)
  - seed for the mirror cross-check (asserts `_checkEpochCapsInline` in both workflow mirrors carries the `bodyScopeChanged` grant branch) (AC5 — RED)

### Stage 2: RED — real-workflow dispatch-site grant in the plugin test file
- AC: 1, 5, 6
- Files: plugin/test/prepare-milestone-convergence.test.mjs
- Command: `scripts/test.sh --test-name-pattern="scope-change|epoch full review|mirror identical" plugin/test/prepare-milestone-convergence.test.mjs`
- Type: [code]
- Budget: ~100 lines added
- Depends on: (none — standalone RED, parallel to Stage 1)
- Expected exit behavior: the NEW tests fail (RED) because the workflow mirrors do not yet
  implement the grant. These tests drive the REAL `prepare-milestone.js` files (the existing
  fixture harness stubs only the convergence-agent HTTP channel via
  `reviewHandlers.onEpochStatus/onEpochDispatch`, lines 182-197 of the test file) — the epoch
  gate logic runs for real.
- New tests (one per `MIRRORS` entry, `.claude` + `plugin`):
  - `[mirror] scope-change grant: onEpochStatus returns scopeChanged:true with counters.fullReviews at cap -> the round-0 full review is DISPATCHED, NOT needs-human epoch-full-review-cap-exceeded` (AC1 — the real-dispatch-site before/after, not asserted)
  - `[mirror] unchanged scope at cap (scopeChanged absent/false) -> needs-human epoch-full-review-cap-exceeded — DIR-120 regression` (AC2 — GREEN guard)
  - `[mirror] both workflow mirrors are byte-identical after the grant change (diff empty)` (AC5 — RED)

## Phase B — implementation (core, both proposal-convergence.ts mirrors edited together)

### Stage 3: implement `bodyScopeHash` helper + epoch schema v2
- AC: 1, 2, 4
- Files: experiments/quay-perpetual-stream/scripts/proposal-convergence.ts, plugin/scripts/proposal-convergence.ts
- Command: `diff experiments/quay-perpetual-stream/scripts/proposal-convergence.ts plugin/scripts/proposal-convergence.ts && scripts/test.sh --test-name-pattern="bodyScopeHash helper" experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs`
- Type: [code]
- Budget: ~45 lines
- Depends on: Stage 1
- Expected exit behavior: the diff between the two mirrors is EMPTY (exit 0); the
  `bodyScopeHash helper` test turns GREEN. Adds the exported `bodyScopeHash({ taskBody })`
  helper, bumps `EPOCH_SCHEMA_VERSION` to 2, adds the `bodyScopeHash` field to
  `buildEpochRecord`, and makes record readers treat an absent field as `null` (graceful).
  The remaining Stage-1 tests stay RED until Stage 4/5.

### Stage 4: implement `checkEpochCaps` grant + epoch-status/record-dispatch plumbing
- AC: 1, 2, 3, 4
- Files: experiments/quay-perpetual-stream/scripts/proposal-convergence.ts, plugin/scripts/proposal-convergence.ts
- Command: `diff experiments/quay-perpetual-stream/scripts/proposal-convergence.ts plugin/scripts/proposal-convergence.ts && scripts/test.sh --test-name-pattern="bodyScopeHash|epoch scope-change|changed scope" experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs`
- Type: [code]
- Budget: ~55 lines
- Depends on: Stage 3
- Expected exit behavior: mirrors still byte-identical; the core RED tests (AC1/AC2/AC3/AC4 at
  the `checkEpochCaps`/`_epochStatusCli`/`_recordEpochDispatchCli` level) turn GREEN. Adds the
  `bodyScopeChanged` param to `checkEpochCaps`; `_epochStatusCli` reads the task body, reports
  `bodyScopeHash`/`storedBodyScopeHash`/`scopeChanged`, and passes `bodyScopeChanged` into its
  `checkEpochCaps` call; `_recordEpochDispatchCli` resets the `fullReviews` baseline on a
  full-reviewDelta when the body hash changed and persists the new `bodyScopeHash` (never
  touching `resets`).

### Stage 5: implement + run `--migrate-epoch-schema`
- AC: 3, 6
- Files: experiments/quay-perpetual-stream/scripts/proposal-convergence.ts, plugin/scripts/proposal-convergence.ts, .quay/prepare-epochs/*.json
- Command: `node experiments/quay-perpetual-stream/scripts/proposal-convergence.ts --migrate-epoch-schema --workspace . && node -e "const fs=require('fs');const fsx=require('fs');const files=fsx.readdirSync('.quay/prepare-epochs').filter(f=>f.endsWith('.json'));const bad=files.filter(f=>{const r=JSON.parse(fsx.readFileSync('.quay/prepare-epochs/'+f,'utf8'));return !('bodyScopeHash' in r)||r.schemaVersion!==2});console.log('records='+files.length,'notMigrated='+bad.length);process.exit(bad.length?1:0)"`
- Type: [code]
- Budget: ~50 lines (CLI + dispatch entry)
- Depends on: Stage 4
- Expected exit behavior: the migration runs against the real workspace; the assertion command
  exits 0 only when ALL 22 `.quay/prepare-epochs/*.json` records carry `bodyScopeHash` and
  `schemaVersion === 2` (`records=22 notMigrated=0`). Idempotent (a second run is a no-op).
  The migration test from Stage 1 turns GREEN. `resets` arrays are unchanged by the migration
  (AC3 preserved).

## Phase C — workflow mirrors

### Stage 6: implement the grant in `.claude/workflows/prepare-milestone.js`
- AC: 1, 5
- Files: .claude/workflows/prepare-milestone.js
- Command: `scripts/test.sh --test-name-pattern="scope-change|epoch full review|mirrors inline the SAME epoch" plugin/test/prepare-milestone-convergence.test.mjs experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs`
- Type: [code]
- Budget: ~15 lines
- Depends on: Stage 4
- Expected exit behavior: the workflow-edit acceptance is the mechanical-check discipline this
  repo already uses for these no-import script mirrors (the existing mirror cross-check test at
  exp-test line 298), NOT a coverage percentage — `prepare-milestone.js` is not
  coverage-instrumented by `scripts/test.sh`. After this stage: capture
  `_epochScopeChanged`/`_epochBodyScopeHash` from the epoch-status verdict (line 358), add the
  `bodyScopeChanged` param to `_checkEpochCapsInline` (line 398, full-review branch at line 412
  gated on `!bodyScopeChanged`), and pass `_epochScopeChanged` at the round-0 dispatch site
  (line 996). The plugin-test RED tests (Stage 2) turn GREEN: at `scopeChanged:true` with
  `fullReviews` at cap, the real workflow PROCEEDS to dispatch the round-0 full review (grant);
  at unchanged scope it fails closed to `needs-human epoch-full-review-cap-exceeded`.

### Stage 7: apply the identical edit to `plugin/workflows/prepare-milestone.js`
- AC: 5
- Files: plugin/workflows/prepare-milestone.js
- Command: `diff .claude/workflows/prepare-milestone.js plugin/workflows/prepare-milestone.js`
- Type: [code]
- Budget: ~0 lines net (byte-identical copy of the Stage-6 edit)
- Depends on: Stage 6
- Expected exit behavior: the `diff` of the two workflow mirrors is EMPTY (exit 0). The
  `[mirror] both workflow mirrors are byte-identical` test and the source-regex cross-check
  (exp test line 298 extended in Stage 1) turn GREEN.

## Phase D — GREEN verification

### Stage 8: full GREEN — both test files, coverage, mirror diffs, full suite
- AC: 6
- Files: experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs, plugin/test/prepare-milestone-convergence.test.mjs
- Command: `scripts/test.sh --experimental-test-coverage experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs plugin/test/prepare-milestone-convergence.test.mjs`
- Type: [code]
- Budget: ~10 lines (test corrections if any)
- Depends on: Stages 1-7
- Expected exit behavior: both test files run fully GREEN. Coverage gate: `proposal-convergence.ts`
  (the coverage-instrumented [code] surface) must hold >=80% line coverage, including the new
  `bodyScopeHash`/`checkEpochCaps(bodyScopeChanged)`/`_epochStatusCli` scope reporting/
  `_recordEpochDispatchCli` baseline-reset/`_migrateEpochSchemaCli` paths. Then the full safe
  suite: `scripts/test.sh` (no args) exits 0. Both mirror diffs (Stage 3/4 pair, Stage 7 pair)
  remain empty — re-verified here.

## Phase E — real-landing verification

### Stage 9: real-object migration + dispatch-site before/after + convergence proof
- AC: 1, 4
- Files: .quay/prepare-epochs/*.json, experiments/quay-perpetual-stream/scripts/proposal-convergence.ts, .claude/workflows/prepare-milestone.js
- Command: `Check: node experiments/quay-perpetual-stream/scripts/proposal-convergence.ts --epoch-status --taskId DIR-099-B --workspace . --charterFile experiments/quay-perpetual-stream/charters/M230-dir-099-b-provider-env-validation.md --checkFullReviewCap true`
- Type: [prose]
- Budget: 0 code lines (verification + evidence recording)
- Depends on: Stages 5, 8
- Expected exit behavior: mechanical-check discipline — real objects operated through the
  mechanism, evidence recorded, not asserted:
  1. Re-run `--migrate-epoch-schema` and confirm the 22 real records report
     `records=22 notMigrated=0`; sample-before/sample-after of one record captured.
  2. Build a real before/after at the production dispatch site: a fixture epoch record whose
     stored `bodyScopeHash` differs from its task's current body, then run the real
     `_epochStatusCli --checkFullReviewCap true` — the verdict reports `scopeChanged:true` and
     `capCheck.breached:false` (grant), vs the unchanged-scope control at `fullReviews:1`
     reporting `epoch-full-review-cap-exceeded` (blocked). Record both raw verdicts.
  3. The Stage-2 plugin test already drives the REAL `prepare-milestone.js` through the grant at
     line 996; post-Land, a real DIR-099-B/DIR-103-A/B/C-class prepare dispatch is re-run and
     confirmed to converge through the normal pipeline (DoD item 2), or a recorded needs-human
     reason citing `epoch-full-review-cap-exceeded` for an unchanged body is shown as the
     preserved DIR-120 path.
  4. Fresh independent audit of the landed milestone (DoD item 3) finds no refutation.

## Guardrails / rollback / real-landing verification

- **Guardrails**
  - Unchanged scope at the full-review cap stays fail-closed (COMMIT/SPLIT/OVERRIDE) — the
    DIR-120/M192 protection is byte-preserved (`bodyScopeChanged` defaults to `false`).
  - The changed-scope grant does NOT touch the `resets[]` array and consumes NO `--new-epoch`
    (AC3); `maxNewEpochResetCount` never bounds the grant path.
  - Scope-churn (AC4) remains bounded by the real residual guards: `maxRepeatedFingerprint: 2`
    repeated-terminal-fingerprint cap and the cumulative 90/150-min observable-time cap +
    overrides — both stay cumulative across scope changes.
  - Mirrors stay byte-identical (two `diff` gates: the proposal-convergence.ts pair and the
    prepare-milestone.js pair) and the source-regex cross-check keeps `_checkEpochCapsInline`
    faithful to `checkEpochCaps`.
  - The migration is additive + idempotent + atomic (`_atomicWriteJson`); a corrupt record is
    never blindly overwritten (same fail-closed posture as `--record-epoch-dispatch`).
  - Legacy records without `bodyScopeHash` are readable as `null` — no hard-fail on old data.
- **Rollback**
  - The change is additive (new optional field defaulting to `null`; new optional param defaulting
    to `false`). Rollback = `git revert` of the milestone's Land commit; pre-migration records and
    old binary behavior are fully compatible (graceful `null` read). An interrupted migration is
    recovered by re-running `--migrate-epoch-schema` (idempotent).
- **Real-landing verification**
  - `scripts/test.sh` (full suite) exits 0 post-Land; both mirror diffs empty; coverage >=80% on
    `proposal-convergence.ts`.
  - A real prepare-milestone task of the DIR-099-B/DIR-103-A/B/C class converges through the
    normal pipeline with a changed scope (DoD item 2) — the Stage-9 recorded evidence.
  - Fresh independent audit finds no refutation (DoD item 3).
