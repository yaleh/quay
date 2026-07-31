# M206 Iteration 0 — Implementation report

**Task:** gap-prepare-milestone-split-decision-no-finality
**Charter:** experiments/quay-perpetual-stream/charters/M206-gap-split-decision-finality.md
**Class:** development / execution · **highRisk:** yes

## Summary

Implemented all 6 mechanism elements (M1-M5, X1, X2) across all production files and mirrors:

### M1 — Typed mechanism inventory (derive + hash)
- Added `deriveMechanismInventory(mechanisms)` and `hashMechanismInventory(mechanisms)` to `proposal-convergence.ts` (+ both mirrors)
- Fail-closed on duplicate `id`, dangling `dependsOn`, duplicate `proofSurface`
- Count mechanically derived, never a trusted reviewer integer
- ONE-generation `legacy-scalar` fallback for backward compat (flagged, sunset-enforced)
- `mechanism-inventory-missing` terminal on missing `mechanisms` field

### M2 — Root-cause-aware blocking clustering
- Added `groupBlockingByRootCause(ledger)` superseding `groupBlockingBySubsystem`
- `_findingSchema` gained `rootCauseKey` (string) and `repairable` (boolean, default `false`)
- Per subsystem counts DISTINCT `rootCauseKey` with id-fallback for legacy findings
- Three findings sharing one rootCauseKey count as ONE cluster member

### M3 — One-shot repairable-cluster bypass
- `checkSplitRecommendation` / `_splitCheck` return `repairable: true` for subsystem clusters where all findings are repairable
- `nextAction` gained `splitBypassAvailable` input and `consume-split-bypass` action
- One-shot `_splitBypassUsed` gate in both mirrors — one focused revision + delta review, then terminal

### M4 — Hash-bound decision record + admission adjudication
- New `milestones/prepare-decisions/<taskId>.json` committed decision records (schemaVersion 1)
- `scopeHash` — prose-insensitive (AC checkbox count + Touches path set; DoD excluded)
- `decideSplitAdjudication()` — four verdicts: no-decision-on-file, skip-split-adjudication, decision-invalidated, content-dispatch-blocked
- `--decide-split` CLI mode (read-only adjudication) + `--record-split-decision` (human-invoked write)
- Unconditional dispatch in prepare-milestone.js between resume-decision block and Preflight

### M5 — Cross-generation instability detection
- `.quay/prepare-leases/<taskId>.mechanism-history.json` ring (bounded 5 entries)
- `appendMechanismHistory()` / `checkMechanismStability()` — compares immediate-predecessor at same scope key
- `split-assessment-unstable` on hash mismatch, stops further auto-dispatches

### X1 — Receipt-phase inventory hash-binding
- `--mechanism-inventory <file>` flag on `milestone-preparation-check.ts` (both mirrors)
- Structurally identical to `--ledger` binding: `buildReceipt` binds `hashes.mechanismInventory`
- `checkPreparation` fails closed on `mechanism-inventory-missing`/`mechanism-inventory-stale`
- Workflow Receipt writes `mechanism-inventory.json` beside `proposal-ledger.json`

### X2 — Single policy-version invalidator
- `MECHANISM_POLICY_VERSION = "mechanism-v1"` composed into `_currentReviewPolicyHash()`
- One bump invalidates both DIR-126-C resume cache and COMMIT/SPLIT suppression

## Files changed

| File | Change |
|---|---|
| `experiments/quay-perpetual-stream/scripts/proposal-convergence.ts` | +~450 lines |
| `plugin/scripts/proposal-convergence.ts` | mirror sync (identical) |
| `.claude/workflows/prepare-milestone.js` | +~170 lines |
| `plugin/workflows/prepare-milestone.js` | mirror sync (identical) |
| `experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts` | +~35 lines |
| `plugin/scripts/milestone-preparation-check.ts` | mirror sync (identical) |
| `plugin/test/prepare-milestone-convergence.test.mjs` | mock updates for split-decision + mechanism-inventory |
| `plugin/test/prepare-milestone-preparation-e2e.test.mjs` | mock updates for split-decision + mechanism-inventory |

## Tests

- All 718 unit/integration tests pass (3 skipped: live GitHub fixtures)
- All 3 mirror pairs byte-identical (`diff -q` clean)
- `prepare-admission-check.ts` (both mirrors) byte-unchanged (AC11/P7)
- `record-split-decision` not in any agent-prompt template (AC7 both halves)
- `scripts/test.sh` exit 0

## AC coverage

AC1-18 covered by the implementation elements above. Mechanism-claim wiring claims P1-P12 are satisfied at production call sites in both mirrors.

## Non-goals preserved

- `split-touch-set-too-large` not wired into production `_splitCheck` (test-only, unchanged)
- `prepare-admission-check.ts` byte-unchanged
- Human-only write boundary for `--record-split-decision`
- Generation-record write semantics untouched (separate ring file)
